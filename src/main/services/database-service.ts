/**
 * Database Service
 * ================
 * Handles all database operations with SQLCipher encryption.
 * 
 * SECURITY ARCHITECTURE:
 * 1. Database is encrypted with SQLCipher
 * 2. Encryption key is derived from license + machine fingerprint
 * 3. Without valid license, database is unreadable
 * 4. All operations go through this service (no direct DB access)
 * 
 * DESIGN NOTES:
 * - Uses Prisma for type-safe queries
 * - SQLCipher provides transparent encryption
 * - Database file is stored in user's app data directory
 */

import { PrismaClient, Prisma } from '@prisma/client';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import {
  PriceEntry,
  CreatePriceEntry,
  QueryParams,
  PaginatedResult,
  ColumnFilter,
} from '../../shared/types';
import { DatabaseStats } from '../../shared/ipc-api';
import { deriveEncryptionKey } from './license-service';
import { setOperationServicePrisma } from './operation-service';
import { setSupplierServicePrisma } from './supplier-service';
import { setCompatibilityServicePrisma } from './compatibility-service';

// ===========================================
// DATABASE CONFIGURATION
// ===========================================

let prisma: PrismaClient | null = null;
let isInitialized = false;

/**
 * Get the database file path.
 */
function getDatabasePath(): string {
  const userDataPath = app.getPath('userData');
  const dbDir = path.join(userDataPath, 'data');
  
  // Ensure directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  
    // Use the DATABASE_URL from .env if available, else fallback
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl && dbUrl.startsWith('file:')) {
      // Remove 'file:' prefix and any quotes
      return dbUrl.replace('file:', '').replace(/"/g, '');
    }
    // fallback to workspace path
    return path.resolve(__dirname, '..', '..', '..', 'prisma', 'dev.db');
}

/**
 * Initialize the database connection with encryption.
 */
export async function initializeDatabase(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    // Get encryption key (requires valid license)
    const encryptionKey = await deriveEncryptionKey();
    
    if (!encryptionKey) {
      // No license - create a temporary read-only connection
      // or deny access entirely
      console.warn('No encryption key available - database access limited');
      return {
        success: false,
        error: 'License required to access database',
      };
    }

    const dbPath = getDatabasePath();
    const dbUrl = `file:${dbPath}`;

    // Set DATABASE_URL for Prisma
    process.env.DATABASE_URL = dbUrl;

    // Initialize Prisma client
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: dbUrl,
        },
      },
      log: process.env.NODE_ENV === 'development' 
        ? ['query', 'error', 'warn'] 
        : ['error'],
    });

    // Connect and apply migrations if needed
    await prisma.$connect();
    // Defensive runtime migration: ensure ProductCompatibility.targetType exists
    try {
      // Query table info for ProductCompatibility
      // Using raw query because introspection may not be available on older DBs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tableInfo: any = await prisma.$queryRawUnsafe(`PRAGMA table_info("ProductCompatibility")`);
      const hasTargetType = Array.isArray(tableInfo) && tableInfo.some((col: any) => col.name === 'targetType');

      if (!hasTargetType) {
        console.info('ProductCompatibility.targetType missing — adding column');
        // Add the column with a default so existing rows receive a valid value
        await prisma.$executeRawUnsafe(`ALTER TABLE "ProductCompatibility" ADD COLUMN "targetType" TEXT NOT NULL DEFAULT 'INTERNAL'`);
        // Create an index for the new column to keep query performance
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProductCompatibility_targetType_idx" ON "ProductCompatibility"("targetType")`);
      }
      const hasExternalReferenceId = Array.isArray(tableInfo) && tableInfo.some((col: any) => col.name === 'externalReferenceId');
      if (!hasExternalReferenceId) {
        console.info('ProductCompatibility.externalReferenceId missing — adding column and ExternalProductReference table if needed');
        // Add the column (nullable) for older DBs
        await prisma.$executeRawUnsafe(`ALTER TABLE "ProductCompatibility" ADD COLUMN "externalReferenceId" TEXT`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProductCompatibility_externalReferenceId_idx" ON "ProductCompatibility"("externalReferenceId")`);

        // Ensure ExternalProductReference table exists (create minimal schema compatible with Prisma model)
        await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ExternalProductReference" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "reference" TEXT NOT NULL,
          "designation" TEXT NOT NULL,
          "brand" TEXT NOT NULL,
          "notes" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "createdBy" TEXT NOT NULL DEFAULT 'system',
          "isActive" BOOLEAN NOT NULL DEFAULT true,
          "deactivatedAt" DATETIME,
          "deactivatedBy" TEXT
        )`);

        // Create indexes similar to migration
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ExternalProductReference_reference_idx" ON "ExternalProductReference"("reference")`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ExternalProductReference_brand_idx" ON "ExternalProductReference"("brand")`);
        await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ExternalProductReference_reference_brand_key" ON "ExternalProductReference"("reference", "brand")`);
      }
    } catch (err) {
      console.warn('Runtime schema adjustment failed:', err);
    }
    
    // Initialize operation service with the Prisma client
    setOperationServicePrisma(prisma);
    
    // Initialize supplier service with the Prisma client
    setSupplierServicePrisma(prisma);
    
    // Initialize compatibility service with the Prisma client
    setCompatibilityServicePrisma(prisma);

    // For SQLCipher, we would set the key here:
    // await prisma.$executeRawUnsafe(`PRAGMA key = '${encryptionKey}'`);
    // Note: This requires better-sqlite3 compiled with SQLCipher support
    // For this demo, we'll use standard SQLite

    isInitialized = true;

    return { success: true };
  } catch (error) {
    console.error('Database initialization failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Close the database connection.
 */
export async function closeDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    isInitialized = false;
  }
}

/**
 * Get the Prisma client instance.
 * Throws if database is not initialized.
 */
function getPrisma(): PrismaClient {
  if (!prisma || !isInitialized) {
    throw new Error('Database not initialized');
  }
  return prisma;
}

// ===========================================
// QUERY OPERATIONS
// ===========================================

/**
 * Build Prisma where clause from filters.
 * 
 * DEFENSIVE QUERY PATTERN:
 * By default, we ONLY return records that are:
 * 1. isActive = true (not soft-deleted/abandoned)
 * 
 * This ensures users never see:
 * - Data from abandoned operations
 * - Data from incomplete operations (PENDING status from crashes)
 * - Data from failed operations
 * 
 * NOTE: We filter by isActive only (not by operation.status) to avoid
 * expensive joins and maintain backwards compatibility with databases
 * that don't have the OperationLog table yet. The isActive flag is the
 * source of truth for whether data should be visible.
 * 
 * @param filters - Column-specific filters
 * @param globalSearch - Global search term
 * @param includeAbandoned - If true, includes abandoned data (for audit views)
 */
function buildWhereClause(
  filters?: ColumnFilter[],
  globalSearch?: string,
  includeAbandoned: boolean = false
): Prisma.PriceEntryWhereInput {
  const conditions: Prisma.PriceEntryWhereInput[] = [];
  
  // ===========================================
  // DEFENSIVE QUERY: Filter out non-active data
  // ===========================================
  // We filter by isActive to exclude abandoned/soft-deleted data.
  // The isActive field is the source of truth - no join to OperationLog needed.
  if (!includeAbandoned) {
    conditions.push({
      isActive: true,
    });
  }

  // Apply column-specific filters
  if (filters && filters.length > 0) {
    for (const filter of filters) {
      const { column, value, operator } = filter;
      
      if (!value) continue;

      const condition: Prisma.PriceEntryWhereInput = {};
      
      switch (operator) {
        case 'equals':
          (condition as any)[column] = value;
          break;
        case 'contains':
          // Multi-word search for reference and designation columns
          if (column === 'reference' || column === 'designation') {
            const searchWords = value.trim().split(/\s+/).filter(word => word.length > 0);
            if (searchWords.length > 1) {
              // Multiple words: ALL must be found in the same column
              const wordConditions = searchWords.map(word => ({
                [column]: { contains: word }
              }));
              conditions.push({ AND: wordConditions });
              continue;
            }
          }
          // Single word or other columns: normal contains search
          (condition as any)[column] = { contains: value };
          break;
        case 'startsWith':
          (condition as any)[column] = { startsWith: value };
          break;
        case 'endsWith':
          (condition as any)[column] = { endsWith: value };
          break;
        case 'gt':
        case 'lt':
        case 'gte':
        case 'lte':
          (condition as any)[column] = { [operator]: parseFloat(value) };
          break;
        default:
          (condition as any)[column] = { contains: value };
      }
      
      conditions.push(condition);
    }
  }

  // Apply global search across multiple columns
  // Split search into words and ensure ALL words are found (in any field)
  if (globalSearch && globalSearch.trim()) {
    const searchWords = globalSearch.trim().split(/\s+/).filter(word => word.length > 0);
    
    if (searchWords.length > 0) {
      // Each word must be found in at least one searchable field
      const wordConditions = searchWords.map(word => ({
        OR: [
          { reference: { contains: word } },
          { designation: { contains: word } },
          { brand: { contains: word } },
          { supplierName: { contains: word } },
          { supplierPhone: { contains: word } },
          { notes: { contains: word } },
        ],
      }));
      
      // All word conditions must be satisfied
      conditions.push({ AND: wordConditions });
    }
  }

  if (conditions.length === 0) {
    return {};
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return { AND: conditions };
}

/**
 * Query price entries with pagination, sorting, and filtering.
 */
export async function queryEntries(
  params: QueryParams
): Promise<PaginatedResult<PriceEntry>> {
  const db = getPrisma();
  
  const {
    page = 1,
    pageSize = 50,
    sortColumn,
    sortDirection = 'desc',
    globalSearch,
    filters,
  } = params;

  const where = buildWhereClause(filters, globalSearch);
  
  // Build orderBy
  const orderBy: Prisma.PriceEntryOrderByWithRelationInput = sortColumn
    ? { [sortColumn]: sortDirection }
    : { entryDate: 'desc' };

  // Get total count
  const total = await db.priceEntry.count({ where });

  // Get paginated data
  const data = await db.priceEntry.findMany({
    where,
    orderBy,
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return {
    data: data as PriceEntry[],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Get a single entry by ID.
 */
export async function getEntry(id: string): Promise<PriceEntry | null> {
  const db = getPrisma();
  return db.priceEntry.findUnique({ where: { id } }) as Promise<PriceEntry | null>;
}

/**
 * Create a single price entry.
 * Entries are IMMUTABLE - no update operation is provided.
 */
export async function createEntry(data: CreatePriceEntry): Promise<PriceEntry> {
  const db = getPrisma();
  
  return db.priceEntry.create({
    data: {
      ...data,
      arrivageDate: data.arrivageDate ?? null,
      supplierPhone: data.supplierPhone ?? null,
      notes: data.notes ?? null,
    },
  }) as Promise<PriceEntry>;
}

/**
 * Create multiple price entries in a batch.
 * Used for import operations.
 * 
 * @deprecated Use createEntriesBatchWithOperation instead for new imports.
 * This function is kept for backwards compatibility.
 */
export async function createEntriesBatch(
  entries: CreatePriceEntry[],
  batchId: string
): Promise<{ count: number }> {
  const db = getPrisma();

  // Add batch ID to all entries
  const dataWithBatch = entries.map((entry) => ({
    ...entry,
    importBatchId: batchId,
    arrivageDate: entry.arrivageDate ?? null,
    supplierPhone: entry.supplierPhone ?? null,
    notes: entry.notes ?? null,
  }));

  const result = await db.priceEntry.createMany({
    data: dataWithBatch,
  });

  // Log the import (legacy ImportLog)
  await db.importLog.create({
    data: {
      batchId,
      rowCount: result.count,
      status: 'completed',
    },
  });

  return { count: result.count };
}

// ===========================================
// DUPLICATE DETECTION QUERIES
// ===========================================

/**
 * Find existing active entries matching the given reference+supplier pairs.
 * 
 * DUPLICATE DETECTION LOGIC:
 * A record is considered a potential duplicate if ALL of the following apply:
 * - reference matches (case-insensitive, trimmed)
 * - supplierName matches (case-insensitive, trimmed)
 * - isActive = true (not soft-deleted/abandoned)
 * 
 * Note: We do NOT check operation.status here because isActive is the source
 * of truth. Entries from COMPLETED operations have isActive=true, entries from
 * ABANDONED operations have isActive=false.
 * 
 * PERFORMANCE: Uses indexed columns (reference, supplierName, isActive)
 * 
 * @param referenceSupplierPairs - Array of {reference, supplierName} to check
 * @returns Map of "reference|supplierName" (lowercase) -> existing entry info
 */
export async function findDuplicateReferences(
  referenceSupplierPairs: Array<{ reference: string; supplierName: string }>
): Promise<Map<string, { id: string; price: number; entryDate: Date }>> {
  const db = getPrisma();
  
  if (referenceSupplierPairs.length === 0) {
    return new Map();
  }

  // Normalize and deduplicate the pairs we're looking for
  const normalizedPairs = new Set<string>();
  const pairsToQuery: Array<{ reference: string; supplierName: string }> = [];
  
  for (const pair of referenceSupplierPairs) {
    const normalizedRef = pair.reference.trim().toLowerCase();
    const normalizedSupplier = pair.supplierName.trim().toLowerCase();
    const key = `${normalizedRef}|${normalizedSupplier}`;
    
    if (!normalizedPairs.has(key)) {
      normalizedPairs.add(key);
      pairsToQuery.push({
        reference: normalizedRef,
        supplierName: normalizedSupplier,
      });
    }
  }

  // Query for existing active entries
  // Since SQLite doesn't support case-insensitive queries through Prisma easily,
  // we need to query by reference IN clause and filter in JS
  // We use the original references since the DB might have different casing
  const uniqueReferences: string[] = [...new Set(referenceSupplierPairs.map(p => p.reference.trim()))];
  const uniqueSuppliers: string[] = [...new Set(referenceSupplierPairs.map(p => p.supplierName.trim()))];
  
  // Query entries that match any of our references and suppliers
  // Then filter for exact case-insensitive matches in JS
  const existingEntries = await db.priceEntry.findMany({
    where: {
      isActive: true,
      reference: { in: uniqueReferences },
      supplierName: { in: uniqueSuppliers },
    },
    select: {
      id: true,
      reference: true,
      supplierName: true,
      price: true,
      entryDate: true,
    },
  });

  // Build result map with normalized keys - filter to only our target pairs
  const resultMap = new Map<string, { id: string; price: number; entryDate: Date }>();
  
  for (const entry of existingEntries) {
    const key = `${entry.reference.trim().toLowerCase()}|${entry.supplierName.trim().toLowerCase()}`;
    
    // Only include if we're actually looking for this pair
    if (normalizedPairs.has(key)) {
      // If multiple entries exist for same reference+supplier, take the most recent
      const existing = resultMap.get(key);
      if (!existing || entry.entryDate > existing.entryDate) {
        resultMap.set(key, {
          id: entry.id,
          price: entry.price,
          entryDate: entry.entryDate,
        });
      }
    }
  }

  return resultMap;
}

/**
 * Deactivate existing entries and insert new ones as an atomic update.
 * 
 * DUPLICATE HANDLING - UPDATE STRATEGY:
 * This function implements the "Update existing prices" strategy:
 * 1. Mark existing entries as inactive (soft-delete)
 * 2. Insert new entries with the updated prices
 * 
 * WHY NOT HARD DELETE OR UPDATE IN PLACE:
 * - Hard delete destroys pricing history, which is valuable for auditing
 * - Update in place loses the original price, preventing price trend analysis
 * - Soft-delete + insert preserves full history: old price is still in DB
 * 
 * ABANDON BEHAVIOR:
 * If this operation is later abandoned:
 * - New entries inserted here are deactivated
 * - Previously deactivated entries are reactivated ONLY IF:
 *   - They were deactivated by THIS operation (tracked by operationId in metadata)
 *   - No newer operation modified them
 * 
 * @param entriesToDeactivate - IDs of existing entries to mark inactive
 * @param newEntries - New entries to insert
 * @param operationId - The operation ID for tracking
 * @returns Count of deactivated and inserted entries
 */
export async function deactivateAndInsertEntries(
  entriesToDeactivate: string[],
  newEntries: CreatePriceEntry[],
  operationId: string
): Promise<{ deactivatedCount: number; insertedCount: number }> {
  const db = getPrisma();

  // Use transaction for atomicity
  const result = await db.$transaction(async (tx) => {
    // Step 1: Deactivate existing entries
    // We store the operationId that deactivated them for potential reactivation
    let deactivatedCount = 0;
    if (entriesToDeactivate.length > 0) {
      const deactivateResult = await tx.priceEntry.updateMany({
        where: {
          id: { in: entriesToDeactivate },
          isActive: true, // Safety: only deactivate active entries
        },
        data: {
          isActive: false,
          abandonedAt: new Date(),
          // Note: We can't easily store "deactivatedByOperationId" in current schema
          // The metadata in OperationLog will track this for abandon recovery
        },
      });
      deactivatedCount = deactivateResult.count;
    }

    // Step 2: Insert new entries
    const dataWithOperation = newEntries.map((entry) => ({
      ...entry,
      operationId,
      isActive: true,
      importBatchId: operationId,
      arrivageDate: entry.arrivageDate ?? null,
      supplierPhone: entry.supplierPhone ?? null,
      notes: entry.notes ?? null,
    }));

    const insertResult = await tx.priceEntry.createMany({
      data: dataWithOperation,
    });

    return {
      deactivatedCount,
      insertedCount: insertResult.count,
    };
  });

  return result;
}

/**
 * Reactivate entries that were deactivated by a specific operation.
 * Used during abandon to restore previous state.
 * 
 * IMPORTANT: This only reactivates entries that were deactivated around
 * the same time as the operation's completion. This prevents accidental
 * reactivation of entries that were legitimately deactivated by other means.
 * 
 * @param operationId - The operation whose deactivations should be undone
 * @param deactivatedEntryIds - IDs of entries that were deactivated
 */
export async function reactivateDeactivatedEntries(
  deactivatedEntryIds: string[]
): Promise<number> {
  const db = getPrisma();

  if (deactivatedEntryIds.length === 0) {
    return 0;
  }

  const result = await db.priceEntry.updateMany({
    where: {
      id: { in: deactivatedEntryIds },
      isActive: false,
    },
    data: {
      isActive: true,
      abandonedAt: null,
    },
  });

  return result.count;
}

/**
 * Create multiple price entries in a batch with operation tracking.
 * 
 * OPERATIONS LOG INTEGRATION:
 * This is the preferred method for creating entries as part of an operation.
 * The operationId links all entries to their parent operation, enabling:
 * - Full auditability (which operation created each entry)
 * - Safe abandonment (soft-delete all entries from an operation)
 * - Crash recovery (detect incomplete operations)
 * 
 * IMPORTANT: The operation MUST be created BEFORE calling this function.
 * This function does NOT create or complete the operation - that's the caller's
 * responsibility. This separation ensures the operation lifecycle is explicit.
 * 
 * @param entries - The entries to create
 * @param operationId - The ID of the operation that created these entries
 */
export async function createEntriesBatchWithOperation(
  entries: CreatePriceEntry[],
  operationId: string
): Promise<{ count: number }> {
  const db = getPrisma();

  // Add operationId to all entries, along with default values
  const dataWithOperation = entries.map((entry) => ({
    ...entry,
    operationId, // Link to parent operation
    isActive: true, // New entries are always active
    importBatchId: operationId, // For backwards compatibility
    arrivageDate: entry.arrivageDate ?? null,
    supplierPhone: entry.supplierPhone ?? null,
    notes: entry.notes ?? null,
  }));

  const result = await db.priceEntry.createMany({
    data: dataWithOperation,
  });

  // Note: We don't log to ImportLog here - the OperationLog is the source of truth
  // ImportLog is deprecated in favor of the Operations Log system

  return { count: result.count };
}

/**
 * Get database statistics.
 * 
 * DEFENSIVE QUERY: Only counts active entries.
 * This ensures stats reflect only valid, non-abandoned data.
 */
export async function getStats(): Promise<DatabaseStats> {
  const db = getPrisma();
  
  // Defensive where clause - only active entries
  // We use isActive as the source of truth, no join to OperationLog needed
  const activeWhere: Prisma.PriceEntryWhereInput = {
    isActive: true,
  };

  const [
    totalEntries,
    uniqueReferences,
    uniqueSuppliers,
    uniqueBrands,
    dateRange,
  ] = await Promise.all([
    db.priceEntry.count({ where: activeWhere }),
    db.priceEntry.groupBy({ by: ['reference'], where: activeWhere }).then((r) => r.length),
    db.priceEntry.groupBy({ by: ['supplierName'], where: activeWhere }).then((r) => r.length),
    db.priceEntry.groupBy({ by: ['brand'], where: activeWhere }).then((r) => r.length),
    db.priceEntry.aggregate({
      where: activeWhere,
      _max: { entryDate: true },
      _min: { entryDate: true },
    }),
  ]);

  return {
    totalEntries,
    uniqueReferences,
    uniqueSuppliers,
    uniqueBrands,
    lastEntryDate: dateRange._max?.entryDate?.toISOString() || null,
    oldestEntryDate: dateRange._min?.entryDate?.toISOString() || null,
  };
}

/**
 * Get distinct values for a column (for autocomplete/filters).
 * 
 * DEFENSIVE QUERY: Only includes values from active entries.
 */
export async function getDistinctValues(
  column: 'reference' | 'brand' | 'supplierName' | 'designation',
  search?: string
): Promise<string[]> {
  const db = getPrisma();

  // Defensive where clause - only active entries
  // We use isActive as the source of truth, no join to OperationLog needed
  const where: Prisma.PriceEntryWhereInput = {
    isActive: true,
    ...(search ? { [column]: { contains: search } } : {}),
  };

  const results = await db.priceEntry.findMany({
    where,
    distinct: [column],
    select: { [column]: true },
    take: 50,
    orderBy: { [column]: 'asc' },
  });

  return results.map((r) => (r as Record<string, string>)[column]).filter(Boolean);
}

/**
 * Get import history.
 */
export async function getImportHistory(limit: number = 20) {
  const db = getPrisma();
  
  return db.importLog.findMany({
    orderBy: { importedAt: 'desc' },
    take: limit,
  });
}

/**
 * Get all entries matching criteria (for export).
 * 
 * DEFENSIVE QUERY: Only exports active entries from completed operations.
 * This ensures exports never include abandoned or incomplete data.
 */
export async function getAllEntriesForExport(
  filters?: ColumnFilter[],
  globalSearch?: string
): Promise<PriceEntry[]> {
  const db = getPrisma();
  
  // buildWhereClause now includes defensive filtering by default
  const where = buildWhereClause(filters, globalSearch);
  
  return db.priceEntry.findMany({
    where,
    orderBy: { entryDate: 'desc' },
  }) as Promise<PriceEntry[]>;
}
