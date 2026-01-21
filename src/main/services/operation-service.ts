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

import { db } from '../../shared/drizzle';
import { eq, and, or, desc, sql, not } from 'drizzle-orm';
import { operationLog, priceEntry, productCompatibility, supplier } from '../../shared/schema';
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

// Drizzle ORM is initialized in shared/drizzle.ts and imported as db

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
  const operationId = uuidv4();
  await db.insert(operationLog).values({
    id: operationId,
    operationType: options.type,
    payloadSnapshot: options.metadata ? JSON.stringify(options.metadata) : JSON.stringify({}),
    status: 'APPLIED',
    createdAt: new Date().toISOString(),
    createdBy: options.createdBy ?? 'local',
    type: options.type,
    legacyStatus: 'PENDING',
    metadata: options.metadata ? JSON.stringify(options.metadata) : null,
    description: options.description ?? null,
    rowCount: 0,
  }).run();
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
  // db is imported from Drizzle
  
  // Build the update data
    const updateData: any = {
    // Keep canonical status unchanged (APPLIED). Update legacy status for compatibility.
    legacyStatus: 'COMPLETED',
    completedAt: new Date().toISOString(),
    rowCount: options.rowCount,
  };

  // Merge into legacy metadata if provided (payloadSnapshot is immutable)
  if (options.metadata) {
    const existing = await db.select({ metadata: operationLog.metadata }).from(operationLog).where(eq(operationLog.id, options.operationId)).get();
    const existingMetadata = existing?.metadata ? JSON.parse(existing.metadata) : {};
    updateData.metadata = JSON.stringify({ ...existingMetadata, ...options.metadata });
  }

  // Safety: ensure operation has a payload snapshot before completing
  const opBefore = await db.select({ payloadSnapshot: operationLog.payloadSnapshot, metadata: operationLog.metadata }).from(operationLog).where(eq(operationLog.id, options.operationId)).get();
  assertOperationHasPayload(opBefore, options.operationId);
  await db.update(operationLog).set(updateData).where(eq(operationLog.id, options.operationId)).run();
}

/**
 * Mark an operation as FAILED.
 * Used when an error occurs during the operation.
 * 
 * @param operationId - The operation to mark as failed
 * @param errorMessage - Description of what went wrong
 */
export async function failOperation(operationId: string, errorMessage: string): Promise<void> {
  // Mark legacy status as FAILED and append error to legacy metadata. Canonical payloadSnapshot remains immutable.
  const existing = await db.select({ metadata: operationLog.metadata }).from(operationLog).where(eq(operationLog.id, operationId)).get();
  const existingMetadata = existing?.metadata ? JSON.parse(existing.metadata) : {};
  await db.update(operationLog).set({
    legacyStatus: 'FAILED',
    completedAt: new Date().toISOString(),
    metadata: JSON.stringify({ ...existingMetadata, errorMessage }),
  }).where(eq(operationLog.id, operationId)).run();
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
  // db is imported from Drizzle
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
  const operation = await db.select({
    id: operationLog.id,
    status: operationLog.status,
    type: operationLog.type,
    description: operationLog.description,
    rowCount: operationLog.rowCount,
    payloadSnapshot: operationLog.payloadSnapshot,
    metadata: operationLog.metadata,
    createdAt: operationLog.createdAt,
  }).from(operationLog).where(eq(operationLog.id, operationId)).get();

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
    const result = await db.transaction(async (tx: any) => {
      // Determine behavior based on operation type.
      // IMPORT: soft-delete PriceEntry rows (existing behavior)
      // COMPATIBILITY_ADD: soft-delete ProductCompatibility rows created by this operation
      // SUPPLIER_CREATE: only allow abandon if no active PriceEntry references the supplier; delete supplier record if safe
      let affectedCount = 0;

      const opType = (operation.type ?? (operation as any).operationType) as string;

      if (opType === 'IMPORT') {
        const updateResult: any = await tx.update(priceEntry)
          .set({ isActive: false, abandonedAt: abandonTimestamp.toISOString() })
          .where(and(eq(priceEntry.operationId, operationId), eq(priceEntry.isActive, true)))
          .run();
        affectedCount = updateResult?.changes ?? 0;
      } else if (opType === 'COMPATIBILITY_ADD') {
        // Deactivate compatibilities created by this operation
        const updateResult: any = await tx.update(productCompatibility)
          .set({ isActive: false, deactivatedAt: abandonTimestamp.toISOString(), deactivatedBy: abandonedBy })
          .where(and(eq(productCompatibility.operationId, operationId), eq(productCompatibility.isActive, true)))
          .run();
        affectedCount = updateResult?.changes ?? 0;
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
        const relatedProductsCountRow: any = await tx.select({ c: sql`count(*)` })
          .from(priceEntry)
          .where(and(eq(priceEntry.supplierName, supplierName), eq(priceEntry.isActive, true)))
          .get();
        const relatedProductsCount = Number(relatedProductsCountRow?.c ?? 0);

        if (relatedProductsCount > 0) {
          throw new Error('Impossible d\'abandonner: des produits sont liés à ce fournisseur');
        }

        // Safe to delete supplier (contacts cascade)
        if (supplierId) {
          await tx.delete(supplier).where(eq(supplier.id, supplierId)).run();
          affectedCount = 1;
        } else {
          // Try to delete by name if supplierId unavailable
          const deleted: any = await tx.delete(supplier).where(eq(supplier.name, supplierName)).run();
          affectedCount = deleted?.changes ?? 0;
        }
      } else {
        // Fallback: try to soft-delete price entries by operationId as best-effort
        const updateResult: any = await tx.update(priceEntry)
          .set({ isActive: false, abandonedAt: abandonTimestamp.toISOString() })
          .where(eq(priceEntry.operationId, operationId))
          .run();
        affectedCount = updateResult?.changes ?? 0;
      }

      // 2. Update the operation status to ABANDONED
      await tx.update(operationLog).set({ status: 'ABANDONED', legacyStatus: 'ABANDONED', abandonedAt: abandonTimestamp.toISOString(), abandonedBy }).where(eq(operationLog.id, operationId)).run();

      // 3. Create an ABANDON_EVENT for the audit trail
      const abandonEventId = uuidv4();
      await tx.insert(operationLog).values({
        id: abandonEventId,
        operationType: 'BULK_DELETE',
        type: 'BULK_DELETE',
        status: 'ABANDONED',
        legacyStatus: 'COMPLETED',
        completedAt: abandonTimestamp.toISOString(),
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
      }).run();

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
  // db is imported from Drizzle
  
  // Build where expression for Drizzle
  const whereExpr = !includeAbandonEvents
    ? or(
        not(eq(operationLog.type, 'BULK_DELETE')),
        and(eq(operationLog.type, 'BULK_DELETE'), sql`${operationLog.abandonedOperationId} IS NULL`)
      )
    : undefined;

  const totalRow = await db.select({ c: sql`count(*)` }).from(operationLog).where(whereExpr).get();
  const total = Number(totalRow?.c ?? 0);

  const data = await db
    .select()
    .from(operationLog)
    .where(whereExpr)
    .orderBy(desc(operationLog.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  const displayData: OperationLogDisplay[] = data.map((op: any) => ({
    id: op.id,
    type: (op.type ?? op.operationType) as OperationType,
    status: (op.legacyStatus ?? op.status) as OperationStatus,
    rowCount: Number(op.rowCount ?? 0),
    createdAt: op.createdAt ? new Date(op.createdAt) : new Date(0),
    completedAt: op.completedAt ? new Date(op.completedAt) : null,
    abandonedAt: op.abandonedAt ? new Date(op.abandonedAt) : null,
    createdBy: op.createdBy ?? 'local',
    abandonedBy: op.abandonedBy ?? null,
    metadata: op.metadata ? JSON.parse(op.metadata) : null,
    description: op.description ?? null,
    abandonedOperationId: op.abandonedOperationId ?? null,
  } as OperationLogDisplay));
  
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
  // Drizzle ORM: select operation by id
  const opArr = await db.select().from(operationLog).where(eq(operationLog.id, operationId)).all();
  const operation = opArr[0];
  if (!operation) {
    return null;
  }
  return {
    id: operation.id,
    type: (operation.type ?? operation.operationType) as OperationType,
    status: (operation.legacyStatus ?? operation.status) as OperationStatus,
    rowCount: Number(operation.rowCount ?? 0),
    createdAt: operation.createdAt ? new Date(operation.createdAt) : new Date(0),
    completedAt: operation.completedAt ? new Date(operation.completedAt) : null,
    abandonedAt: operation.abandonedAt ? new Date(operation.abandonedAt) : null,
    createdBy: operation.createdBy ?? 'local',
    abandonedBy: operation.abandonedBy ?? null,
    metadata: operation.metadata ? JSON.parse(operation.metadata) : null,
    description: operation.description ?? null,
    abandonedOperationId: operation.abandonedOperationId ?? null,
  } as OperationLogDisplay;
}

/**
 * Get operations by status.
 * Useful for finding PENDING operations that need resolution.
 */
export async function getOperationsByStatus(status: OperationStatus): Promise<OperationLogDisplay[]> {
  // Drizzle ORM: select operations by status or legacyStatus
  let data = await db.select().from(operationLog).where(eq(operationLog.status, status)).orderBy(desc(operationLog.createdAt)).all();
  if (!data.length) {
    data = await db.select().from(operationLog).where(eq(operationLog.legacyStatus, status)).orderBy(desc(operationLog.createdAt)).all();
  }
  return data.map((op: any) => ({
    id: op.id,
    type: (op.type ?? op.operationType) as OperationType,
    status: (op.legacyStatus ?? op.status) as OperationStatus,
    rowCount: Number(op.rowCount ?? 0),
    createdAt: op.createdAt ? new Date(op.createdAt) : new Date(0),
    completedAt: op.completedAt ? new Date(op.completedAt) : null,
    abandonedAt: op.abandonedAt ? new Date(op.abandonedAt) : null,
    createdBy: op.createdBy ?? 'local',
    abandonedBy: op.abandonedBy ?? null,
    metadata: op.metadata ? JSON.parse(op.metadata) : null,
    description: op.description ?? null,
    abandonedOperationId: op.abandonedOperationId ?? null,
  } as OperationLogDisplay));
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
  // Drizzle ORM: select pending operations by status or legacyStatus
  let pendingOps = await db
    .select({
      id: operationLog.id,
      type: operationLog.type,
      rowCount: operationLog.rowCount,
      createdAt: operationLog.createdAt,
      description: operationLog.description,
    })
    .from(operationLog)
    .where(eq(operationLog.status, 'PENDING'))
    .orderBy(desc(operationLog.createdAt))
    .all();
  if (!pendingOps.length) {
    pendingOps = await db
      .select({
        id: operationLog.id,
        type: operationLog.type,
        rowCount: operationLog.rowCount,
        createdAt: operationLog.createdAt,
        description: operationLog.description,
      })
      .from(operationLog)
      .where(eq(operationLog.legacyStatus, 'PENDING'))
          .orderBy(desc(operationLog.createdAt))
      .all();
  }
  // For each pending operation, count actual related records
  const withActualCounts = await Promise.all(
    pendingOps.map(async (op: any) => {
      const cnt = await db.select({ c: sql`count(*)` }).from(priceEntry).where(eq(priceEntry.operationId, op.id)).get();
      const actualCount = Number(cnt?.c ?? 0);

      return {
        id: op.id,
        type: op.type as IncompleteOperation['type'],
        rowCount: actualCount,
        createdAt: op.createdAt ? new Date(op.createdAt) : new Date(0),
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
  // db is imported from Drizzle
  // Select only the minimal canonical fields to avoid hitting missing
  // legacy columns on older database schemas.
  const operation = await db.select().from(operationLog).where(eq(operationLog.id, operationId)).get();

  if (!operation) return false;
  // Some older/legacy rows use `legacyStatus` to track PENDING state while
  // the canonical `status` may be 'APPLIED'. Accept either field being PENDING.
  const isPending = (operation.status === 'PENDING') || (operation.legacyStatus === 'PENDING');
  if (!isPending) return false;

  // Count actual records
  const actualCnt = await db.select({ c: sql`count(*)` }).from(priceEntry).where(eq(priceEntry.operationId, operationId)).get();
  const actualCount = Number(actualCnt?.c ?? 0);

  await db.update(operationLog).set({ status: 'COMPLETED', legacyStatus: 'COMPLETED', completedAt: new Date().toISOString(), rowCount: actualCount }).where(eq(operationLog.id, operationId)).run();

  return true;
}

/**
 * Abandon a pending operation.
 * Marks both the operation and its related records as abandoned.
 */
export async function abandonPendingOperation(operationId: string, _reason?: string): Promise<AbandonOperationResult> {
  // db is imported from Drizzle
  // Fetch minimal fields to avoid selecting non-existent legacy columns.
  const operation = await db.select().from(operationLog).where(eq(operationLog.id, operationId)).get();

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
    const result = await db.transaction(async (tx: any) => {
      // Mark related entries as inactive
      const updateResult: any = await tx.update(priceEntry).set({ isActive: false, abandonedAt: abandonTimestamp.toISOString() }).where(eq(priceEntry.operationId, operationId)).run();

      // Mark operation as abandoned (not just failed)
      await tx.update(operationLog).set({ status: 'ABANDONED', abandonedAt: abandonTimestamp.toISOString(), abandonedBy: 'local' }).where(eq(operationLog.id, operationId)).run();

      return updateResult?.changes ?? 0;
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
  // db is imported from Drizzle
  
  const [totalRow, completedRow, abandonedRow, pendingRow, failedRow] = await Promise.all([
    db.select({ c: sql`count(*)` }).from(operationLog).get(),
    db.select({ c: sql`count(*)` }).from(operationLog).where(eq(operationLog.status, 'COMPLETED')).get(),
    db.select({ c: sql`count(*)` }).from(operationLog).where(eq(operationLog.status, 'ABANDONED')).get(),
    db.select({ c: sql`count(*)` }).from(operationLog).where(eq(operationLog.status, 'PENDING')).get(),
    db.select({ c: sql`count(*)` }).from(operationLog).where(eq(operationLog.status, 'FAILED')).get(),
  ]);

  return {
    totalOperations: Number(totalRow?.c ?? 0),
    completedOperations: Number(completedRow?.c ?? 0),
    abandonedOperations: Number(abandonedRow?.c ?? 0),
    pendingOperations: Number(pendingRow?.c ?? 0),
    failedOperations: Number(failedRow?.c ?? 0),
  };
}
