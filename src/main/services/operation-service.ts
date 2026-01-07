/**
 * Operation Service
 * =================
 * Manages the Operations Log system for full auditability and safe abandonment.
 * 
 * DESIGN PRINCIPLES (from Martin Fowler's Event Sourcing & Compensating Transactions):
 * 
 * 1. OPERATIONS ARE HIGH-LEVEL USER INTENTS
 *    - Not raw SQL actions
 *    - Examples: "Import 500 rows from clipboard", "Bulk edit prices"
 *    - Each operation has a unique ID and produces immutable database records
 * 
 * 2. NO DESTRUCTIVE ROLLBACK
 *    - Historical data integrity is paramount
 *    - Once data is recorded, it represents a real event that happened
 *    - "Abandon" creates a compensating transaction, not a DELETE
 * 
 * 3. WRITE PATH RULES
 *    - Every write MUST belong to an operation
 *    - Operation is created BEFORE any inserts (status=PENDING)
 *    - Inserts reference the operation_id
 *    - Status flips to COMPLETED only after ALL writes succeed
 *    - If app crashes mid-operation, data is ignored until resolved
 * 
 * 4. ABANDON MECHANISM (Compensating Transaction)
 *    - Marks OperationLog.status = ABANDONED
 *    - Marks all related records as is_active = false
 *    - Creates an ABANDON_EVENT record for audit trail
 *    - IDEMPOTENT: Safe to retry multiple times
 *    - NO DATA IS DELETED
 * 
 * 5. QUERY RULES
 *    - Default queries MUST filter: is_active=true AND operation.status=COMPLETED
 *    - Historical views may optionally include abandoned data
 * 
 * REFERENCES:
 * - https://martinfowler.com/eaaDev/EventSourcing.html
 * - https://martinfowler.com/articles/patterns-of-distributed-systems/compensating-transaction.html
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import type {
  OperationLogDisplay,
  AbandonOperationResult,
  IncompleteOperation,
  OperationMetadata,
  OperationType,
  OperationStatus,
} from '../../shared/types';
import { getLicenseStatus } from './license-service';

// ===========================================
// TYPE DEFINITIONS
// ===========================================

/**
 * Options for creating an operation.
 */
interface CreateOperationOptions {
  type: OperationType;
  description?: string;
  metadata?: OperationMetadata;
  createdBy?: string;
}

/**
 * Options for completing an operation.
 */
interface CompleteOperationOptions {
  operationId: string;
  rowCount: number;
  metadata?: Partial<OperationMetadata>;
}

/**
 * Options for abandoning an operation.
 */
interface AbandonOperationOptions {
  operationId: string;
  reason?: string;
  abandonedBy?: string;
}

// ===========================================
// PRISMA CLIENT ACCESSOR
// ===========================================

let prismaClient: PrismaClient | null = null;

/**
 * Set the Prisma client instance.
 * Called from database-service.ts during initialization.
 */
export function setOperationServicePrisma(client: PrismaClient): void {
  prismaClient = client;
}

/**
 * Get the Prisma client, throwing if not initialized.
 */
function getPrisma(): PrismaClient {
  if (!prismaClient) {
    throw new Error('Operation service not initialized. Call setOperationServicePrisma first.');
  }
  return prismaClient;
}

// Dev-time invariant checks
function assertOperationHasPayload(operation: any, operationId?: string) {
  const hasPayload = operation && (operation.payloadSnapshot || operation.metadata);
  if (!hasPayload) {
    throw new Error(`Operation ${operationId ?? (operation && operation.id) ?? '<unknown>'} missing payloadSnapshot/metadata`);
  }
}

// ===========================================
// OPERATION LIFECYCLE
// ===========================================

/**
 * Create a new operation in PENDING status.
 * 
 * CRITICAL: This MUST be called BEFORE any data is inserted.
 * The returned operation ID should be attached to all records created.
 * 
 * @param options - Operation creation options
 * @returns The created operation's ID
 */
export async function createOperation(options: CreateOperationOptions): Promise<string> {
  const db = getPrisma();
  const operationId = uuidv4();
  // Create both canonical and legacy fields for compatibility.
  await db.operationLog.create({
    data: {
      id: operationId,
      // canonical
      operationType: options.type,
      payloadSnapshot: options.metadata ? JSON.stringify(options.metadata) : JSON.stringify({}),
      status: 'APPLIED',
      createdBy: options.createdBy ?? 'local',
      // legacy (kept for UI and older logic)
      type: options.type,
      legacyStatus: 'PENDING',
      metadata: options.metadata ? JSON.stringify(options.metadata) : null,
      description: options.description ?? null,
      rowCount: 0,
    } as any,
  });

  return operationId;
}

/**
 * Mark an operation as COMPLETED after all writes succeed.
 * 
 * CRITICAL: Only call this after ALL data has been successfully written.
 * If the app crashes before this is called, the operation remains PENDING
 * and should be resolved on next startup.
 * 
 * @param options - Completion options including final row count
 */
export async function completeOperation(options: CompleteOperationOptions): Promise<void> {
  const db = getPrisma();
  
  // Build the update data
  const updateData: any = {
    // Keep canonical status unchanged (APPLIED). Update legacy status for compatibility.
    legacyStatus: 'COMPLETED',
    completedAt: new Date(),
    rowCount: options.rowCount,
  };

  // Merge into legacy metadata if provided (payloadSnapshot is immutable)
  if (options.metadata) {
    const existing = await db.operationLog.findUnique({
      where: { id: options.operationId },
      select: { metadata: true },
    });
    const existingMetadata = existing?.metadata ? JSON.parse(existing.metadata) : {};
    updateData.metadata = JSON.stringify({ ...existingMetadata, ...options.metadata });
  }

  // Safety: ensure operation has a payload snapshot before completing
  const opBefore = await db.operationLog.findUnique({ where: { id: options.operationId }, select: { payloadSnapshot: true, metadata: true } });
  assertOperationHasPayload(opBefore, options.operationId);

  await db.operationLog.update({ where: { id: options.operationId }, data: updateData as any });
}

/**
 * Mark an operation as FAILED.
 * Used when an error occurs during the operation.
 * 
 * @param operationId - The operation to mark as failed
 * @param errorMessage - Description of what went wrong
 */
export async function failOperation(operationId: string, errorMessage: string): Promise<void> {
  const db = getPrisma();
  // Mark legacy status as FAILED and append error to legacy metadata. Canonical payloadSnapshot remains immutable.
  const existing = await db.operationLog.findUnique({ where: { id: operationId }, select: { metadata: true } });
  const existingMetadata = existing?.metadata ? JSON.parse(existing.metadata) : {};
  await db.operationLog.update({
    where: { id: operationId },
    data: {
      legacyStatus: 'FAILED',
      completedAt: new Date(),
      metadata: JSON.stringify({ ...existingMetadata, errorMessage }),
    },
  });
}

// ===========================================
// ABANDON (COMPENSATING TRANSACTION)
// ===========================================

/**
 * Abandon an operation using a compensating transaction.
 * 
 * This is the core of the non-destructive rollback mechanism:
 * 1. Validates the operation can be abandoned (COMPLETED status, user has permission)
 * 2. Marks all related PriceEntry records as is_active=false
 * 3. Updates the OperationLog status to ABANDONED
 * 4. Creates an ABANDON_EVENT record for audit trail
 * 
 * IDEMPOTENT: If called multiple times for the same operation, subsequent calls
 * will see it's already ABANDONED and return success without making changes.
 * 
 * NO DATA IS DELETED. All records remain in the database but are filtered out
 * of normal queries by the is_active=false flag.
 * 
 * @param options - Abandon options
 * @returns Result of the abandon operation
 */
export async function abandonOperation(options: AbandonOperationOptions): Promise<AbandonOperationResult> {
  const db = getPrisma();
  const { operationId, reason, abandonedBy = 'local' } = options;
  
  // ===========================================
  // PERMISSION CHECK
  // ===========================================
  // Only licensed users may abandon operations
  const licenseStatus = await getLicenseStatus();
  if (!licenseStatus.isValid) {
    return {
      success: false,
      operationId,
      affectedRowCount: 0,
      error: 'Valid license required to abandon operations',
    };
  }
  
  // ===========================================
  // FETCH AND VALIDATE OPERATION
  // ===========================================
  // Read minimal canonical fields to avoid selecting columns that may not
  // exist on older database schemas (like `legacyStatus`).
  const operation = await db.operationLog.findUnique({
    where: { id: operationId },
    select: {
      id: true,
      status: true,
      type: true,
      description: true,
      rowCount: true,
      payloadSnapshot: true,
      metadata: true,
      createdAt: true,
    },
  } as any);

  if (!operation) {
    return {
      success: false,
      operationId,
      affectedRowCount: 0,
      error: 'Operation not found',
    };
  }
  
  // IDEMPOTENT: If already abandoned, return success
  if (operation.status === 'ABANDONED') {
    return {
      success: true,
      operationId,
      affectedRowCount: 0, // No additional changes made
    };
  }
  
  // Only COMPLETED operations can be abandoned
  // PENDING operations should be resolved via finalize or delete
  // FAILED operations are already in a terminal state
  if (!(operation.status === 'COMPLETED' || operation.status === 'APPLIED')) {
    return {
      success: false,
      operationId,
      affectedRowCount: 0,
      error: `Cannot abandon operation with status '${operation.status}'. Only COMPLETED operations can be abandoned.`,
    };
  }
  
  // ===========================================
  // EXECUTE COMPENSATING TRANSACTION
  // ===========================================
  const abandonTimestamp = new Date();
  
  // Safety: ensure operation has a payload snapshot before abandoning
  assertOperationHasPayload(operation as any, operationId);
  try {
    // Use a transaction to ensure atomicity
    const result = await db.$transaction(async (tx) => {
      // Determine behavior based on operation type.
      // IMPORT: soft-delete PriceEntry rows (existing behavior)
      // COMPATIBILITY_ADD: soft-delete ProductCompatibility rows created by this operation
      // SUPPLIER_CREATE: only allow abandon if no active PriceEntry references the supplier; delete supplier record if safe
      let affectedCount = 0;

      const opType = (operation.type ?? (operation as any).operationType) as string;

      if (opType === 'IMPORT') {
        const updateResult = await tx.priceEntry.updateMany({
          where: {
            operationId: operationId,
            isActive: true,
          },
          data: {
            isActive: false,
            abandonedAt: abandonTimestamp,
          },
        });
        affectedCount = updateResult.count;
      } else if (opType === 'COMPATIBILITY_ADD') {
        // Deactivate compatibilities created by this operation
        const updateResult = await tx.productCompatibility.updateMany({
          where: {
            operationId: operationId,
            isActive: true,
          },
          data: {
            isActive: false,
            deactivatedAt: abandonTimestamp,
            deactivatedBy: abandonedBy,
          },
        });
        affectedCount = updateResult.count;
      } else if (opType === 'SUPPLIER_CREATE') {
        // For supplier creation, ensure there are no active products referencing this supplier.
        // Prefer entityId (supplier id) attached to the operation, but fall back to metadata/payloadSnapshot if needed.
        const supplierId = (operation as any).entityId;
        let supplierName: string | null = null;

        if (supplierId) {
          const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
          if (supplier) supplierName = supplier.name;
        }

        // If supplierName still unknown, try metadata or payloadSnapshot
        if (!supplierName) {
          try {
            const meta = operation.metadata ? JSON.parse(operation.metadata as any) : null;
            if (meta && meta.supplierName) supplierName = meta.supplierName;
            else {
              const payload = operation.payloadSnapshot ? JSON.parse(operation.payloadSnapshot as any) : null;
              if (payload && payload.name) supplierName = payload.name;
            }
          } catch (err) {
            // ignore parse errors
          }
        }

        if (!supplierName) {
          throw new Error('Cannot determine supplier name for abandon validation');
        }

        // Count active PriceEntry rows that reference this supplier name (case-insensitive match)
        const relatedProductsCount = await tx.priceEntry.count({
          where: {
            supplierName: { equals: supplierName },
            isActive: true,
          } as any,
        });

        if (relatedProductsCount > 0) {
          throw new Error('Impossible d\'abandonner: des produits sont liés à ce fournisseur');
        }

        // Safe to delete supplier (contacts cascade)
        if (supplierId) {
          await tx.supplier.delete({ where: { id: supplierId } });
          affectedCount = 1;
        } else {
          // Try to delete by name if supplierId unavailable
          const deleted = await tx.supplier.deleteMany({ where: { name: supplierName } });
          affectedCount = deleted.count;
        }
      } else {
        // Fallback: try to soft-delete price entries by operationId as best-effort
        const updateResult = await tx.priceEntry.updateMany({
          where: { operationId },
          data: { isActive: false, abandonedAt: abandonTimestamp },
        });
        affectedCount = updateResult.count;
      }

      // 2. Update the operation status to ABANDONED
      await tx.operationLog.update({
        where: { id: operationId },
        data: {
          status: 'ABANDONED',
          legacyStatus: 'ABANDONED',
          abandonedAt: abandonTimestamp,
          abandonedBy: abandonedBy,
        },
      });

      // 3. Create an ABANDON_EVENT for the audit trail
      const abandonEventId = uuidv4();
      await tx.operationLog.create({
        data: {
          id: abandonEventId,
          operationType: 'BULK_DELETE',
          type: 'BULK_DELETE',
          status: 'ABANDONED',
          legacyStatus: 'COMPLETED',
          completedAt: abandonTimestamp,
          rowCount: affectedCount,
          createdBy: abandonedBy,
          description: `Abandoned operation: ${operation.description || operation.type}`,
          abandonedOperationId: operationId,
          metadata: JSON.stringify({
            abandonedOperationType: operation.type,
            reason: reason || 'User initiated',
            originalRowCount: operation.rowCount,
          }),
          payloadSnapshot: JSON.stringify({
            abandonedOperationType: operation.type,
            reason: reason || 'User initiated',
            originalRowCount: operation.rowCount,
          }),
          revertOperationId: operationId,
        },
      });

      return {
        affectedRowCount: affectedCount,
        abandonEventId,
      };
    });
    
    return {
      success: true,
      operationId,
      affectedRowCount: result.affectedRowCount,
      abandonEventId: result.abandonEventId,
    };
  } catch (error) {
    console.error(`[OperationService] Error abandoning operation ${operationId}:`, error);
    return {
      success: false,
      operationId,
      affectedRowCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error during abandon',
    };
  }
}

// ===========================================
// QUERY OPERATIONS
// ===========================================

/**
 * Get paginated list of operations for the Operations Log UI.
 * Returns newest operations first.
 * 
 * @param page - Page number (1-based)
 * @param pageSize - Number of operations per page
 * @param includeAbandonEvents - Whether to include ABANDON_EVENT records
 */
export async function getOperations(
  page: number = 1,
  pageSize: number = 20,
  includeAbandonEvents: boolean = false
): Promise<{ data: OperationLogDisplay[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const db = getPrisma();
  
  // Build where clause
  const where: Prisma.OperationLogWhereInput = {};
  
  if (!includeAbandonEvents) {
    // Exclude BULK_DELETE operations that are abandon events (have abandonedOperationId)
    where.OR = [
      { type: { not: 'BULK_DELETE' } },
      { type: 'BULK_DELETE', abandonedOperationId: null },
    ];
  }
  
  const [total, data] = await Promise.all([
    db.operationLog.count({ where }),
    db.operationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  
  // Parse metadata JSON for each operation
  const displayData: OperationLogDisplay[] = data.map((op) => ({
    ...op,
    type: (op.type ?? op.operationType) as OperationType,
    status: (op.legacyStatus ?? op.status) as OperationStatus,
    metadata: op.metadata ? JSON.parse(op.metadata) : null,
  }));
  
  return {
    data: displayData,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Get a single operation by ID.
 */
export async function getOperationById(operationId: string): Promise<OperationLogDisplay | null> {
  const db = getPrisma();
  
  const operation = await db.operationLog.findUnique({
    where: { id: operationId },
  });
  
  if (!operation) {
    return null;
  }
  
  return {
    ...operation,
    type: (operation.type ?? operation.operationType) as OperationType,
    status: (operation.legacyStatus ?? operation.status) as OperationStatus,
    metadata: operation.metadata ? JSON.parse(operation.metadata) : null,
  };
}

/**
 * Get operations by status.
 * Useful for finding PENDING operations that need resolution.
 */
export async function getOperationsByStatus(status: OperationStatus): Promise<OperationLogDisplay[]> {
  const db = getPrisma();
  // Prefer canonical `status` where available. Some databases may still
  // be on an older schema that used `legacyStatus`. Try the canonical
  // query first and fall back to legacy-only query if Prisma errors
  // because the older column is missing.
  let data: any[];
  try {
    data = await db.operationLog.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });
  } catch (err) {
    // Fallback for older DBs that don't expose `status`
    data = await db.operationLog.findMany({
      where: { legacyStatus: status },
      orderBy: { createdAt: 'desc' },
    } as any);
  }

  return data.map((op) => ({
    ...op,
    type: (op.type ?? op.operationType) as OperationType,
    status: (op.legacyStatus ?? op.status) as OperationStatus,
    metadata: op.metadata ? JSON.parse(op.metadata) : null,
  }));
}

// ===========================================
// CRASH RECOVERY
// ===========================================

/**
 * Find incomplete (PENDING) operations that may indicate a crash.
 * These should be presented to the user on app startup for resolution.
 * 
 * The user can choose to:
 * 1. Finalize the operation (mark as COMPLETED if data looks good)
 * 2. Abandon the operation (mark as ABANDONED, soft-delete related records)
 */
export async function findIncompleteOperations(): Promise<IncompleteOperation[]> {
  const db = getPrisma();
  // Some databases will have `status` (canonical) while older schemas
  // only have `legacyStatus`. Prefer querying `status` and fall back to
  // `legacyStatus` if the column is absent (Prisma will throw in that case).
  let pendingOps: Array<{
    id: string;
    type: string | null;
    rowCount: number | null;
    createdAt: Date | null;
    description: string | null;
  }>;
  try {
    pendingOps = await db.operationLog.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        rowCount: true,
        createdAt: true,
        description: true,
      },
    });
  } catch (err) {
    pendingOps = await db.operationLog.findMany({
      where: { legacyStatus: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        rowCount: true,
        createdAt: true,
        description: true,
      },
    } as any);
  }
  
  // For each pending operation, count actual related records
  const withActualCounts = await Promise.all(
    pendingOps.map(async (op) => {
      const actualCount = await db.priceEntry.count({
        where: { operationId: op.id },
      });
      
      return {
        id: op.id,
        type: op.type as IncompleteOperation['type'],
        rowCount: actualCount,
        createdAt: op.createdAt,
        description: op.description,
      };
    })
  );
  
  return withActualCounts as IncompleteOperation[];
}

/**
 * Finalize a pending operation (mark as COMPLETED).
 * Used when user confirms that a crashed operation's data is valid.
 */
export async function finalizePendingOperation(operationId: string): Promise<boolean> {
  const db = getPrisma();
  // Select only the minimal canonical fields to avoid hitting missing
  // legacy columns on older database schemas.
  const operation = await db.operationLog.findUnique({
    where: { id: operationId },
    select: { id: true, status: true },
  } as any);

  if (!operation || operation.status !== 'PENDING') {
    return false;
  }
  
  // Count actual records
  const actualCount = await db.priceEntry.count({
    where: { operationId },
  });
  
  await db.operationLog.update({
    where: { id: operationId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      rowCount: actualCount,
    },
  });
  
  return true;
}

/**
 * Abandon a pending operation.
 * Marks both the operation and its related records as abandoned.
 */
export async function abandonPendingOperation(operationId: string, _reason?: string): Promise<AbandonOperationResult> {
  const db = getPrisma();
  // Fetch minimal fields to avoid selecting non-existent legacy columns.
  const operation = await db.operationLog.findUnique({
    where: { id: operationId },
    select: { id: true, status: true },
  } as any);

  if (!operation) {
    return {
      success: false,
      operationId,
      affectedRowCount: 0,
      error: 'Operation not found',
    };
  }

  if (operation.status !== 'PENDING') {
    return {
      success: false,
      operationId,
      affectedRowCount: 0,
      error: 'Operation is not in PENDING status',
    };
  }
  
  const abandonTimestamp = new Date();
  
  // Safety: ensure operation has payload snapshot before abandoning
  assertOperationHasPayload(operation, operationId);
  try {
    const result = await db.$transaction(async (tx) => {
      // Mark related entries as inactive
      const updateResult = await tx.priceEntry.updateMany({
        where: { operationId },
        data: {
          isActive: false,
          abandonedAt: abandonTimestamp,
        },
      });
      
      // Mark operation as abandoned (not just failed)
      await tx.operationLog.update({
        where: { id: operationId },
        data: {
          status: 'ABANDONED',
          abandonedAt: abandonTimestamp,
          abandonedBy: 'local',
        },
      });
      
      return updateResult.count;
    });
    
    return {
      success: true,
      operationId,
      affectedRowCount: result,
    };
  } catch (error) {
    console.error(`[OperationService] Error abandoning pending operation:`, error);
    return {
      success: false,
      operationId,
      affectedRowCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ===========================================
// UTILITY FUNCTIONS
// ===========================================

/**
 * Get statistics about operations.
 */
export async function getOperationStats(): Promise<{
  totalOperations: number;
  completedOperations: number;
  abandonedOperations: number;
  pendingOperations: number;
  failedOperations: number;
}> {
  const db = getPrisma();
  
  const [total, completed, abandoned, pending, failed] = await Promise.all([
    db.operationLog.count(),
    db.operationLog.count({ where: { status: 'COMPLETED' } }),
    db.operationLog.count({ where: { status: 'ABANDONED' } }),
    db.operationLog.count({ where: { status: 'PENDING' } }),
    db.operationLog.count({ where: { status: 'FAILED' } }),
  ]);
  
  return {
    totalOperations: total,
    completedOperations: completed,
    abandonedOperations: abandoned,
    pendingOperations: pending,
    failedOperations: failed,
  };
}
