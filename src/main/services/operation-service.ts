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
import {
  OperationLog,
  OperationLogDisplay,
  CreateOperation,
  AbandonOperationResult,
  IncompleteOperation,
  OperationMetadata,
  OperationType,
  OperationStatus,
} from '../../shared/types';
import { isFeatureAllowed, getLicenseStatus } from './license-service';

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
  
  await db.operationLog.create({
    data: {
      id: operationId,
      type: options.type,
      status: 'PENDING',
      description: options.description ?? null,
      metadata: options.metadata ? JSON.stringify(options.metadata) : null,
      createdBy: options.createdBy ?? 'local',
      rowCount: 0, // Will be updated on completion
    },
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
  const updateData: Prisma.OperationLogUpdateInput = {
    status: 'COMPLETED',
    completedAt: new Date(),
    rowCount: options.rowCount,
  };
  
  // Merge metadata if provided
  if (options.metadata) {
    const existing = await db.operationLog.findUnique({
      where: { id: options.operationId },
      select: { metadata: true },
    });
    
    const existingMetadata = existing?.metadata 
      ? JSON.parse(existing.metadata) 
      : {};
    
    updateData.metadata = JSON.stringify({
      ...existingMetadata,
      ...options.metadata,
    });
  }
  
  await db.operationLog.update({
    where: { id: options.operationId },
    data: updateData,
  });
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
  
  // Get existing metadata
  const existing = await db.operationLog.findUnique({
    where: { id: operationId },
    select: { metadata: true },
  });
  
  const existingMetadata = existing?.metadata 
    ? JSON.parse(existing.metadata) 
    : {};
  
  await db.operationLog.update({
    where: { id: operationId },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      metadata: JSON.stringify({
        ...existingMetadata,
        errorMessage,
      }),
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
  const operation = await db.operationLog.findUnique({
    where: { id: operationId },
  });
  
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
  if (operation.status !== 'COMPLETED') {
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
  
  try {
    // Use a transaction to ensure atomicity
    const result = await db.$transaction(async (tx) => {
      // 1. Mark all related PriceEntry records as inactive
      //    This is the "soft delete" - data remains but is filtered from queries
      const updateResult = await tx.priceEntry.updateMany({
        where: {
          operationId: operationId,
          isActive: true, // Only update active records (idempotency)
        },
        data: {
          isActive: false,
          abandonedAt: abandonTimestamp,
        },
      });
      
      // 2. Update the operation status to ABANDONED
      await tx.operationLog.update({
        where: { id: operationId },
        data: {
          status: 'ABANDONED',
          abandonedAt: abandonTimestamp,
          abandonedBy: abandonedBy,
        },
      });
      
      // 3. Create an ABANDON_EVENT for the audit trail
      //    This records WHO abandoned WHAT and WHEN
      const abandonEventId = uuidv4();
      await tx.operationLog.create({
        data: {
          id: abandonEventId,
          type: 'BULK_DELETE', // BULK_DELETE type represents the abandon action
          status: 'COMPLETED',
          completedAt: abandonTimestamp,
          rowCount: updateResult.count,
          createdBy: abandonedBy,
          description: `Abandoned operation: ${operation.description || operation.type}`,
          abandonedOperationId: operationId,
          metadata: JSON.stringify({
            abandonedOperationType: operation.type,
            reason: reason || 'User initiated',
            originalRowCount: operation.rowCount,
          }),
        },
      });
      
      return {
        affectedRowCount: updateResult.count,
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
    type: op.type as OperationType,
    status: op.status as OperationStatus,
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
    type: operation.type as OperationType,
    status: operation.status as OperationStatus,
    metadata: operation.metadata ? JSON.parse(operation.metadata) : null,
  };
}

/**
 * Get operations by status.
 * Useful for finding PENDING operations that need resolution.
 */
export async function getOperationsByStatus(status: OperationStatus): Promise<OperationLogDisplay[]> {
  const db = getPrisma();
  
  const data = await db.operationLog.findMany({
    where: { status },
    orderBy: { createdAt: 'desc' },
  });
  
  return data.map((op) => ({
    ...op,
    type: op.type as OperationType,
    status: op.status as OperationStatus,
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
  
  const pendingOps = await db.operationLog.findMany({
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
  
  return withActualCounts;
}

/**
 * Finalize a pending operation (mark as COMPLETED).
 * Used when user confirms that a crashed operation's data is valid.
 */
export async function finalizePendingOperation(operationId: string): Promise<boolean> {
  const db = getPrisma();
  
  const operation = await db.operationLog.findUnique({
    where: { id: operationId },
  });
  
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
export async function abandonPendingOperation(operationId: string, reason?: string): Promise<AbandonOperationResult> {
  const db = getPrisma();
  
  const operation = await db.operationLog.findUnique({
    where: { id: operationId },
  });
  
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
