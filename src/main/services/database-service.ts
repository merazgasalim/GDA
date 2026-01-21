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
 * - Uses Drizzle ORM for type-safe queries
 * - SQLCipher provides transparent encryption
 * - Database file is stored in user's app data directory
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import { eq, like, and, or, gte, lt, inArray } from 'drizzle-orm';
import { desc, asc } from 'drizzle-orm';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
// execFileSync previously imported but unused
import {
  PriceEntry,
  CreatePriceEntry,
  QueryParams,
  PaginatedResult,
  ColumnFilter,
} from '../../shared/types';
import { DatabaseStats } from '../../shared/ipc-api';
import { deriveEncryptionKey } from './license-service';
import { completeOperation } from './operation-service';
import { assertOperationAttached } from '../../shared/operationService';
import * as schema from '../../shared/schema';
import { setDrizzleInstance } from '../../shared/drizzle';

let db: any = null;
let isInitialized: boolean = false;

function getDatabasePath(): string {
  const userDataPath = app.getPath('userData');
  const dbDir = path.join(userDataPath, 'data');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.startsWith('file:')) {
    return dbUrl.replace('file:', '').replace(/"/g, '');
  }
  // In packaged apps we must use a writable location. Use the user's
  // `userData` directory (under a `data` subfolder) so the installed app
  // can create and write the SQLite file. Falling back to a bundled
  // `prisma/dev.db` is problematic when app is packaged (asar/readonly).
  return path.join(dbDir, 'dev.db');
}
async function initializeDatabase(): Promise<{ success: boolean; error?: string }> {
  try {
    // Debug: indicate DB init starting
    // eslint-disable-next-line no-console
    console.error('[DatabaseService] initializeDatabase: starting');
    const encryptionKey = await deriveEncryptionKey();
    if (!encryptionKey) {
      // Allow DB initialization even when encryption key is missing so
      // development/dev DB can be created. Production should ensure a key.
      // eslint-disable-next-line no-console
      console.error('[DatabaseService] initializeDatabase: no encryption key, continuing');
    }

    const dbPath = getDatabasePath();
    // Ensure parent directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

    // Open sqlite and initialize Drizzle
    const sqlite = new Database(dbPath);
    // If an encryption key is available (SQLCipher), apply it so the database
    // can be read. Without this the file appears as invalid SQL and prepares
    // will fail with "no such column" or similar errors.
    if (encryptionKey) {
      try {
        // eslint-disable-next-line no-console
        console.error('[DatabaseService] applying encryption key to sqlite instance');
        // Apply key for SQLCipher-enabled DBs
        try {
          // better-sqlite3 exposes pragma via the `pragma` method
          (sqlite as any).pragma(`key = '${encryptionKey}'`);
        } catch (pErr) {
          // Some builds may not support `pragma` as a function; try running as a statement
          try { sqlite.prepare(`PRAGMA key = '${encryptionKey}'`).run(); } catch (inner) { /* ignore */ }
        }
        // Attempt cipher migration in case DB was created with older cipher
        try { (sqlite as any).pragma('cipher_migrate = 1'); } catch {}
      } catch (e) {
        console.error('[DatabaseService] failed to apply encryption key', e);
      }
    }

    // Create base tables if missing
    // eslint-disable-next-line no-console
    console.error('[DatabaseService] initializeDatabase: creating base tables at', dbPath);
    sqlite.prepare(`CREATE TABLE IF NOT EXISTS ProductCompatibility (
      id TEXT PRIMARY KEY,
      reference TEXT,
      targetProductId TEXT,
      targetType TEXT NOT NULL DEFAULT 'INTERNAL',
      externalReferenceId TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME
    )`).run();

    sqlite.prepare(`CREATE TABLE IF NOT EXISTS PriceEntry (
      id TEXT PRIMARY KEY,
      reference TEXT,
      designation TEXT,
      brand TEXT,
      supplierName TEXT,
      supplierPhone TEXT,
      price REAL,
      entryDate DATETIME,
      arrivageDate DATETIME,
      importBatchId TEXT,
      operationId TEXT,
      isActive INTEGER DEFAULT 1,
      notes TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      createdBy TEXT DEFAULT 'local',
      abandonedAt DATETIME,
      deactivatedAt DATETIME
    )`).run();

    sqlite.prepare(`CREATE TABLE IF NOT EXISTS OperationLog (
      id TEXT PRIMARY KEY,
      operationType TEXT,
      payloadSnapshot TEXT,
      status TEXT,
      createdBy TEXT,
      type TEXT,
      legacyStatus TEXT,
      metadata TEXT,
      description TEXT,
      rowCount INTEGER DEFAULT 0,
      entityId TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();

    sqlite.prepare(`CREATE TABLE IF NOT EXISTS Supplier (
      id TEXT PRIMARY KEY,
      name TEXT,
      phone TEXT,
      email TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();

    sqlite.prepare(`CREATE TABLE IF NOT EXISTS SupplierContact (
      id TEXT PRIMARY KEY,
      supplierId TEXT,
      name TEXT,
      phone TEXT,
      email TEXT
    )`).run();

    sqlite.prepare(`CREATE TABLE IF NOT EXISTS ExternalProductReference (
      id TEXT PRIMARY KEY,
      productId TEXT,
      externalId TEXT
    )`).run();

    db = drizzle(sqlite, { schema });
    // Share the initialized Drizzle instance with other services
    try { setDrizzleInstance(db); } catch (e) { /* ignore */ }

    // Migration fix: assign UUIDs to any existing PriceEntry rows missing an id
    try {
      const missingIdRows: any[] = sqlite.prepare("SELECT rowid FROM PriceEntry WHERE id IS NULL OR id = ''").all();
      if (Array.isArray(missingIdRows) && missingIdRows.length > 0) {
        for (const r of missingIdRows) {
          const newId = require('crypto').randomUUID();
          try {
            sqlite.prepare('UPDATE PriceEntry SET id = ? WHERE rowid = ?').run(newId, r.rowid);
          } catch (uErr) {
            console.error('[DatabaseService] failed to assign id to PriceEntry row', r, uErr);
          }
        }
        console.error('[DatabaseService] assigned ids to', missingIdRows.length, 'PriceEntry rows that had null id');
      }
    } catch (migErr) {
      console.error('[DatabaseService] id migration check failed', migErr);
    }

    // Runtime schema adjustments (defensive)
    try {
      const tableInfo = sqlite.prepare('PRAGMA table_info("ProductCompatibility")').all();
      const hasTargetType = Array.isArray(tableInfo) && tableInfo.some((col: any) => col.name === 'targetType');
      if (!hasTargetType) {
        sqlite.prepare(`ALTER TABLE "ProductCompatibility" ADD COLUMN "targetType" TEXT NOT NULL DEFAULT 'INTERNAL'`).run();
        sqlite.prepare(`CREATE INDEX IF NOT EXISTS "ProductCompatibility_targetType_idx" ON "ProductCompatibility"("targetType")`).run();
      }
      const hasExternalReferenceId = Array.isArray(tableInfo) && tableInfo.some((col: any) => col.name === 'externalReferenceId');
      if (!hasExternalReferenceId) {
        sqlite.prepare(`ALTER TABLE "ProductCompatibility" ADD COLUMN "externalReferenceId" TEXT`).run();
        sqlite.prepare(`CREATE INDEX IF NOT EXISTS "ProductCompatibility_externalReferenceId_idx" ON "ProductCompatibility"("externalReferenceId")`).run();
      }

      // Ensure other ProductCompatibility columns expected by Drizzle schema
      if (!Array.isArray(tableInfo) || !tableInfo.some((col: any) => col.name === 'sourceProductId')) {
        sqlite.prepare(`ALTER TABLE "ProductCompatibility" ADD COLUMN "sourceProductId" TEXT`).run();
      }
      if (!Array.isArray(tableInfo) || !tableInfo.some((col: any) => col.name === 'relationType')) {
        sqlite.prepare(`ALTER TABLE "ProductCompatibility" ADD COLUMN "relationType" TEXT`).run();
      }
      if (!Array.isArray(tableInfo) || !tableInfo.some((col: any) => col.name === 'note')) {
        sqlite.prepare(`ALTER TABLE "ProductCompatibility" ADD COLUMN "note" TEXT`).run();
      }
      if (!Array.isArray(tableInfo) || !tableInfo.some((col: any) => col.name === 'isActive')) {
        sqlite.prepare(`ALTER TABLE "ProductCompatibility" ADD COLUMN "isActive" INTEGER DEFAULT 1`).run();
      }
      const priceTableInfo: any = sqlite.prepare('PRAGMA table_info("PriceEntry")').all();
      const hasPriceCreatedBy = Array.isArray(priceTableInfo) && priceTableInfo.some((col: any) => col.name === 'createdBy');
      if (!hasPriceCreatedBy) {
        sqlite.prepare(`ALTER TABLE "PriceEntry" ADD COLUMN "createdBy" TEXT NOT NULL DEFAULT 'local'`).run();
        sqlite.prepare(`CREATE INDEX IF NOT EXISTS "PriceEntry_createdBy_idx" ON "PriceEntry"("createdBy")`).run();
      }
      const hasCurrency = Array.isArray(priceTableInfo) && priceTableInfo.some((col: any) => col.name === 'currency');
      if (!hasCurrency) {
        sqlite.prepare(`ALTER TABLE "PriceEntry" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'DZD'`).run();
        sqlite.prepare(`CREATE INDEX IF NOT EXISTS "PriceEntry_currency_idx" ON "PriceEntry"("currency")`).run();
      }

      // Ensure operationId exists
      if (!Array.isArray(priceTableInfo) || !priceTableInfo.some((col: any) => col.name === 'operationId')) {
        sqlite.prepare(`ALTER TABLE "PriceEntry" ADD COLUMN "operationId" TEXT`).run();
      }

      const opTableInfo: any = sqlite.prepare('PRAGMA table_info("OperationLog")').all();
      // Ensure createdAt exists for legacy DBs
      if (!Array.isArray(opTableInfo) || !opTableInfo.some((col: any) => col.name === 'createdAt')) {
        sqlite.prepare(`ALTER TABLE "OperationLog" ADD COLUMN "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP`).run();
      }
      if (!(Array.isArray(opTableInfo) && opTableInfo.some((col: any) => col.name === 'type'))) {
        sqlite.prepare(`ALTER TABLE "OperationLog" ADD COLUMN "type" TEXT`).run();
        sqlite.prepare(`CREATE INDEX IF NOT EXISTS "OperationLog_type_idx" ON "OperationLog"("type")`).run();
      }
      if (!(Array.isArray(opTableInfo) && opTableInfo.some((col: any) => col.name === 'rowCount'))) {
        sqlite.prepare(`ALTER TABLE "OperationLog" ADD COLUMN "rowCount" INTEGER NOT NULL DEFAULT 0`).run();
        sqlite.prepare(`CREATE INDEX IF NOT EXISTS "OperationLog_rowCount_idx" ON "OperationLog"("rowCount")`).run();
      }
      if (!(Array.isArray(opTableInfo) && opTableInfo.some((col: any) => col.name === 'description'))) {
        sqlite.prepare(`ALTER TABLE "OperationLog" ADD COLUMN "description" TEXT`).run();
        sqlite.prepare(`CREATE INDEX IF NOT EXISTS "OperationLog_description_idx" ON "OperationLog"("description")`).run();
      }
      if (!(Array.isArray(opTableInfo) && opTableInfo.some((col: any) => col.name === 'legacyStatus'))) {
        sqlite.prepare(`ALTER TABLE "OperationLog" ADD COLUMN "legacyStatus" TEXT DEFAULT 'COMPLETED'`).run();
        sqlite.prepare(`CREATE INDEX IF NOT EXISTS "OperationLog_legacyStatus_idx" ON "OperationLog"("legacyStatus")`).run();
      }
      if (!(Array.isArray(opTableInfo) && opTableInfo.some((col: any) => col.name === 'metadata'))) {
        sqlite.prepare(`ALTER TABLE "OperationLog" ADD COLUMN "metadata" TEXT`).run();
        sqlite.prepare(`CREATE INDEX IF NOT EXISTS "OperationLog_metadata_idx" ON "OperationLog"("metadata")`).run();
      }
      // Ensure other OperationLog columns expected by schema
      if (!Array.isArray(opTableInfo) || !opTableInfo.some((col: any) => col.name === 'entityType')) {
        sqlite.prepare(`ALTER TABLE "OperationLog" ADD COLUMN "entityType" TEXT`).run();
      }
      if (!Array.isArray(opTableInfo) || !opTableInfo.some((col: any) => col.name === 'entityId')) {
        sqlite.prepare(`ALTER TABLE "OperationLog" ADD COLUMN "entityId" TEXT`).run();
      }
      if (!Array.isArray(opTableInfo) || !opTableInfo.some((col: any) => col.name === 'completedAt')) {
        sqlite.prepare(`ALTER TABLE "OperationLog" ADD COLUMN "completedAt" DATETIME`).run();
      }
      if (!Array.isArray(opTableInfo) || !opTableInfo.some((col: any) => col.name === 'abandonedAt')) {
        sqlite.prepare(`ALTER TABLE "OperationLog" ADD COLUMN "abandonedAt" DATETIME`).run();
      }
      if (!Array.isArray(opTableInfo) || !opTableInfo.some((col: any) => col.name === 'abandonedBy')) {
        sqlite.prepare(`ALTER TABLE "OperationLog" ADD COLUMN "abandonedBy" TEXT`).run();
      }
      if (!Array.isArray(opTableInfo) || !opTableInfo.some((col: any) => col.name === 'revertOperationId')) {
        sqlite.prepare(`ALTER TABLE "OperationLog" ADD COLUMN "revertOperationId" TEXT`).run();
      }
      if (!Array.isArray(opTableInfo) || !opTableInfo.some((col: any) => col.name === 'abandonedOperationId')) {
        sqlite.prepare(`ALTER TABLE "OperationLog" ADD COLUMN "abandonedOperationId" TEXT`).run();
      }

      // Ensure Supplier table has expected columns
      const supplierInfo: any = sqlite.prepare('PRAGMA table_info("Supplier")').all();
      if (!Array.isArray(supplierInfo) || !supplierInfo.some((col: any) => col.name === 'address')) {
        sqlite.prepare(`ALTER TABLE "Supplier" ADD COLUMN "address" TEXT`).run();
      }
      if (!Array.isArray(supplierInfo) || !supplierInfo.some((col: any) => col.name === 'website')) {
        sqlite.prepare(`ALTER TABLE "Supplier" ADD COLUMN "website" TEXT`).run();
      }
      if (!Array.isArray(supplierInfo) || !supplierInfo.some((col: any) => col.name === 'updatedAt')) {
        sqlite.prepare(`ALTER TABLE "Supplier" ADD COLUMN "updatedAt" DATETIME`).run();
      }
      if (!Array.isArray(supplierInfo) || !supplierInfo.some((col: any) => col.name === 'operationId')) {
        sqlite.prepare(`ALTER TABLE "Supplier" ADD COLUMN "operationId" TEXT`).run();
      }

      // Ensure ExternalProductReference table has expected columns
      const extInfo: any = sqlite.prepare('PRAGMA table_info("ExternalProductReference")').all();
      if (!Array.isArray(extInfo) || !extInfo.some((col: any) => col.name === 'reference')) {
        sqlite.prepare(`ALTER TABLE "ExternalProductReference" ADD COLUMN "reference" TEXT`).run();
      }
      if (!Array.isArray(extInfo) || !extInfo.some((col: any) => col.name === 'designation')) {
        sqlite.prepare(`ALTER TABLE "ExternalProductReference" ADD COLUMN "designation" TEXT`).run();
      }
      if (!Array.isArray(extInfo) || !extInfo.some((col: any) => col.name === 'brand')) {
        sqlite.prepare(`ALTER TABLE "ExternalProductReference" ADD COLUMN "brand" TEXT`).run();
      }
      if (!Array.isArray(extInfo) || !extInfo.some((col: any) => col.name === 'notes')) {
        sqlite.prepare(`ALTER TABLE "ExternalProductReference" ADD COLUMN "notes" TEXT`).run();
      }
      if (!Array.isArray(extInfo) || !extInfo.some((col: any) => col.name === 'createdBy')) {
        sqlite.prepare(`ALTER TABLE "ExternalProductReference" ADD COLUMN "createdBy" TEXT`).run();
      }
      if (!Array.isArray(extInfo) || !extInfo.some((col: any) => col.name === 'isActive')) {
        sqlite.prepare(`ALTER TABLE "ExternalProductReference" ADD COLUMN "isActive" INTEGER DEFAULT 1`).run();
      }

      // Ensure SupplierContact table has expected columns
      const contactInfo: any = sqlite.prepare('PRAGMA table_info("SupplierContact")').all();
      if (!Array.isArray(contactInfo) || !contactInfo.some((col: any) => col.name === 'type')) {
        sqlite.prepare(`ALTER TABLE "SupplierContact" ADD COLUMN "type" TEXT`).run();
      }
      if (!Array.isArray(contactInfo) || !contactInfo.some((col: any) => col.name === 'channel')) {
        sqlite.prepare(`ALTER TABLE "SupplierContact" ADD COLUMN "channel" TEXT`).run();
      }
      if (!Array.isArray(contactInfo) || !contactInfo.some((col: any) => col.name === 'value')) {
        sqlite.prepare(`ALTER TABLE "SupplierContact" ADD COLUMN "value" TEXT`).run();
      }
      if (!Array.isArray(contactInfo) || !contactInfo.some((col: any) => col.name === 'isPrimary')) {
        sqlite.prepare(`ALTER TABLE "SupplierContact" ADD COLUMN "isPrimary" INTEGER DEFAULT 0`).run();
      }
      if (!Array.isArray(contactInfo) || !contactInfo.some((col: any) => col.name === 'createdAt')) {
        sqlite.prepare(`ALTER TABLE "SupplierContact" ADD COLUMN "createdAt" DATETIME`).run();
      }
    } catch (err) {
      console.warn('Runtime schema adjustment failed:', err);
    }

    isInitialized = true;
    return { success: true };
  } catch (error) {
    console.error('Database initialization failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Close the database connection.
 */
async function closeDatabase(): Promise<void> {
  // No disconnect needed for better-sqlite3
  db = null;
  isInitialized = false;
}

/**
 * Expose initialization state for IPC handlers to decide fallback behavior.
 */
function isDatabaseInitialized(): boolean {
  return isInitialized;
}


/**
 * Get the Prisma client instance.
async function queryEntries(
 */
// getPrisma removed: use Drizzle ORM db directly

// ===========================================
// QUERY OPERATIONS
// ===========================================

/**
 * Build Drizzle ORM where clause from filters.
 * Returns a Drizzle-compatible where expression or undefined.
 */
function buildWhereClause(
  filters?: ColumnFilter[],
  globalSearch?: string,
  includeAbandoned: boolean = false
): any {
  const conditions: any[] = [];

  if (!includeAbandoned) {
    conditions.push(eq(schema.priceEntry.isActive, true));
  }

  const numericColumns = new Set(['price']);
  const tryParseNumber = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
 

  if (filters && filters.length > 0) {
    for (const f of filters) {
      const { column, operator = 'contains', value } = f;
      if (!value || String(value).trim() === '') continue;
      const colRef: any = (schema.priceEntry as any)[column];
      if (!colRef) continue;
      const val = String(value);
      let condition: any = null;
      switch (operator) {
        case 'equals':
          if (numericColumns.has(column)) {
            const n = tryParseNumber(val);
            if (n === null) continue;
            condition = eq(colRef, n);
          } else {
            condition = eq(colRef, val);
          }
          break;
        case 'contains':
          condition = like(colRef, `%${val}%`);
          break;
        case 'gte':
          condition = gte(colRef, val);
          break;
        case 'lte':
          condition = lt(colRef, val);
          break;
        default:
          condition = like(colRef, `%${val}%`);
      }
      if (condition) conditions.push(condition);
    }
  }

  if (globalSearch && globalSearch.trim()) {
    const words = globalSearch.trim().split(/\s+/).filter(Boolean);
    if (words.length > 0) {
      const cols = ['reference', 'designation', 'brand', 'supplierName', 'supplierPhone', 'notes'];
      const wordConds = words.map((w) => or(...cols.map((c) => like((schema.priceEntry as any)[c], `%${w}%`))));
      conditions.push(and(...wordConds));
    }
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}
/**
 * Query price entries with pagination, sorting, and filtering.
 */
async function queryEntries(
  params: QueryParams
): Promise<PaginatedResult<PriceEntry>> {
  const {
    page = 1,
    pageSize = 50,
    sortColumn = 'entryDate',
    sortDirection = 'desc',
    globalSearch,
    filters,
  } = params;

  if (!db) throw new Error('Database not initialized');

  const where = buildWhereClause(filters, globalSearch);
  const offset = (page - 1) * pageSize;
  const dir = sortDirection === 'asc' ? 'asc' : 'desc';

  // Map sort column name to actual Drizzle column
  const columnMap: Record<string, any> = {
    entryDate: schema.priceEntry.entryDate,
    reference: schema.priceEntry.reference,
    brand: schema.priceEntry.brand,
    supplierName: schema.priceEntry.supplierName,
    price: schema.priceEntry.price,
    designation: schema.priceEntry.designation,
    createdAt: schema.priceEntry.createdAt,
  };
  const orderCol = columnMap[sortColumn] || schema.priceEntry.entryDate;
  const orderExpr = dir === 'asc' ? asc(orderCol) : desc(orderCol);

  // Total count
  const totalRes = await db.select({ count: sql`count(*)` })
    .from(schema.priceEntry)
    .where(where)
    .all();
  const total = Number(totalRes[0]?.count ?? 0);

  // Data page
  let q = db.select().from(schema.priceEntry).orderBy(orderExpr).offset(offset).limit(pageSize);
  if (where) q = q.where(where);
  const data = await q.all();

  return {
    total,
    page,
    pageSize,
      totalPages: Math.ceil(total / pageSize),
    data: data as PriceEntry[],
  };
}
/**
 * Create a single price entry.
 * Entries are IMMUTABLE - no update operation is provided.
 */
async function createEntry(data: CreatePriceEntry): Promise<PriceEntry> {
  if (!db) throw new Error('Database not initialized');
  try {
    const result = await db.transaction(async (tx: any) => {
      // 1) create operation log
      const [op] = await tx.insert(schema.operationLog).values({
        operationType: 'PRODUCT_CREATE',
        payloadSnapshot: JSON.stringify(data as any),
        status: 'APPLIED',
        createdBy: (data as any).createdBy ?? 'local',
        type: 'PRODUCT_CREATE',
        legacyStatus: 'PENDING',
        metadata: JSON.stringify(data),
        description: `Create product: ${data.reference} (${data.brand})`,
        rowCount: 0,
      }).returning();

      // 2) create price entry linked to operation
      const [createdEntry] = await tx.insert(schema.priceEntry).values({
        ...data,
        arrivageDate: data.arrivageDate ?? null,
        supplierPhone: data.supplierPhone ?? null,
        notes: data.notes ?? null,
        operationId: op.id,
      }).returning();

      assertOperationAttached(createdEntry);

      // 3) update operation.entityId
      await tx.update(schema.operationLog).set({ entityId: createdEntry.id }).where({ id: op.id });

      return { operationId: op.id, createdEntry };
    });
    await completeOperation({ operationId: result.operationId, rowCount: 1, metadata: { productId: result.createdEntry.id } });
    return result.createdEntry as PriceEntry;
  } catch (err) {
    console.error('[DatabaseService] createEntry transaction failed:', err);
    throw err;
  }
}

/**
 * Create multiple price entries in a batch.
 * Used for import operations.
 * 
 * @deprecated Use createEntriesBatchWithOperation instead for new imports.
 * This function is kept for backwards compatibility.
 */
async function createEntriesBatch(
  entries: CreatePriceEntry[],
  batchId: string
): Promise<{ count: number }> {
  // Drizzle ORM: batch insert
  const dataWithBatch = entries.map((entry) => ({
    ...entry,
    importBatchId: batchId,
    arrivageDate: entry.arrivageDate ? (entry.arrivageDate instanceof Date ? entry.arrivageDate.toISOString() : entry.arrivageDate) : null,
    entryDate: (entry as any).entryDate ? ((entry as any).entryDate instanceof Date ? (entry as any).entryDate.toISOString() : (entry as any).entryDate) : new Date().toISOString(),
    supplierPhone: entry.supplierPhone ?? null,
    notes: entry.notes ?? null,
    id: require('crypto').randomUUID(),
    createdAt: (entry as any).createdAt ? ((entry as any).createdAt instanceof Date ? (entry as any).createdAt.toISOString() : (entry as any).createdAt) : new Date().toISOString(),
  }));
  await db.insert(schema.priceEntry).values(dataWithBatch).run();
  // Log the import (legacy ImportLog)
  await db.insert(schema.importLog).values({
    id: require('crypto').randomUUID(),
    batchId,
    rowCount: dataWithBatch.length,
    status: 'completed',
    importedAt: new Date().toISOString(),
  }).run();
  return { count: dataWithBatch.length };
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
async function findDuplicateReferences(
  referenceSupplierPairs: Array<{ reference: string; supplierName: string }>
): Promise<Map<string, { id: string; price: number; entryDate: Date }>> {
  if (referenceSupplierPairs.length === 0) {
    return new Map();
  }
  const normalizedPairs = new Set<string>();
  const pairsToQuery: Array<{ reference: string; supplierName: string }> = [];
  for (const pair of referenceSupplierPairs) {
    const normalizedRef = pair.reference.trim().toLowerCase();
    const normalizedSupplier = pair.supplierName.trim().toLowerCase();
    const key = `${normalizedRef}|${normalizedSupplier}`;
    if (!normalizedPairs.has(key)) {
      normalizedPairs.add(key);
      pairsToQuery.push({ reference: normalizedRef, supplierName: normalizedSupplier });
    }
  }
  // Build case-insensitive match conditions from normalized pairs
  const uniquePairs = pairsToQuery; // already normalized to lowercase
  // Debug: log total active entries and sample pairs to query
  try {
    const activeCountRow = await db.select({ c: sql`count(*)` }).from(schema.priceEntry).where(eq(schema.priceEntry.isActive, true)).get();
    // eslint-disable-next-line no-console
    console.error('[DatabaseService] findDuplicateReferences: activePriceEntryCount=', activeCountRow?.c ?? 0, 'pairsToQuery sample=', uniquePairs.slice(0,5));
  } catch (e) {
    // ignore
  }
  const pairConds: any[] = [];
  for (const p of uniquePairs) {
    pairConds.push(and(
      eq(sql`lower(${schema.priceEntry.reference})`, p.reference),
      eq(sql`lower(${schema.priceEntry.supplierName})`, p.supplierName)
    ));
  }

  // If no pairs to query (shouldn't happen), return empty map
  if (pairConds.length === 0) return new Map();

  // Drizzle ORM: select all matching entries (case-insensitive by lower())
  const existingEntries = await db.select({
    id: schema.priceEntry.id,
    reference: schema.priceEntry.reference,
    supplierName: schema.priceEntry.supplierName,
    price: schema.priceEntry.price,
    entryDate: schema.priceEntry.entryDate,
  })
    .from(schema.priceEntry)
    .where(and(eq(schema.priceEntry.isActive, true), or(...pairConds)))
    .all();
  // Fallback: if query returned nothing (possible SQL mismatch during migration),
  // fetch a reasonable subset of active entries and filter in JS to ensure we don't miss matches.
  let effectiveEntries = existingEntries;
  if ((!effectiveEntries || effectiveEntries.length === 0)) {
    try {
      // eslint-disable-next-line no-console
      console.error('[DatabaseService] findDuplicateReferences: primary query returned 0 rows, falling back to JS-side filter (this may be slower)');
      const fallback = await db.select({
        id: schema.priceEntry.id,
        reference: schema.priceEntry.reference,
        supplierName: schema.priceEntry.supplierName,
        price: schema.priceEntry.price,
        entryDate: schema.priceEntry.entryDate,
      }).from(schema.priceEntry).where(eq(schema.priceEntry.isActive, true)).limit(10000).all();
      effectiveEntries = fallback;
    } catch (e) {
      // ignore fallback failure
    }
  }
  // If still empty, attempt to read from an alternate DB file (common when workspace
  // has an empty prisma/dev.db but a populated DB exists in parent folder like D:\Dev\prisma\dev.db).
  if ((!effectiveEntries || effectiveEntries.length === 0)) {
    try {
      const altPaths = [
        path.resolve(process.cwd(), '..', 'prisma', 'dev.db'),
        path.resolve(process.cwd(), '..', '..', 'prisma', 'dev.db'),
        path.resolve('D:\\Dev\\prisma\\dev.db'),
      ];
      let foundPath: string | null = null;
      for (const p of altPaths) {
        if (fs.existsSync(p) && fs.statSync(p).size > 0) { foundPath = p; break; }
      }
      if (foundPath) {
        // Open readonly connection to alternate DB and fetch active entries
        const altSqlite = new Database(foundPath, { readonly: true });
        try {
          const rows: any[] = altSqlite.prepare('SELECT id, reference, supplierName, price, entryDate FROM PriceEntry WHERE isActive=1').all();
          effectiveEntries = rows.map(r => ({ id: r.id, reference: r.reference, supplierName: r.supplierName, price: r.price, entryDate: r.entryDate }));
          // eslint-disable-next-line no-console
          console.error('[DatabaseService] findDuplicateReferences: loaded', effectiveEntries.length, 'entries from alternate DB', foundPath);
        } finally {
          try { altSqlite.close(); } catch (err) { /* ignore */ }
        }
      }
    } catch (err) {
      // ignore alternate DB failures
    }
  }
  const resultMap = new Map<string, { id: string; price: number; entryDate: Date }>();
  for (const entry of effectiveEntries) {
    const key = `${entry.reference.trim().toLowerCase()}|${entry.supplierName.trim().toLowerCase()}`;
    if (normalizedPairs.has(key)) {
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
  try {
    // Debug: log map size and a small sample to help diagnose undefined lookups
    // (kept to debug runtime issue during migration)
    // eslint-disable-next-line no-console
    console.debug('[DatabaseService] findDuplicateReferences: resultMap size', resultMap.size, 'pairsQueried=', referenceSupplierPairs.length);
    // eslint-disable-next-line no-console
    if (resultMap.size > 0) console.debug('[DatabaseService] findDuplicateReferences: sample keys', Array.from(resultMap.keys()).slice(0,5));
  } catch (e) {
    // ignore logging failures
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
async function deactivateAndInsertEntries(
  entriesToDeactivate: string[],
  newEntries: CreatePriceEntry[],
  operationId: string
): Promise<{ deactivatedCount: number; insertedCount: number }> {
  // Drizzle ORM: transaction for atomicity
  const result = await db.transaction(async (tx: any) => {
    let deactivatedCount = 0;
    if (entriesToDeactivate.length > 0) {
      const res = await tx.update(schema.priceEntry)
        .set({ isActive: false, abandonedAt: new Date().toISOString() })
        .where(and(inArray(schema.priceEntry.id, entriesToDeactivate), eq(schema.priceEntry.isActive, true)))
        .run();
      deactivatedCount = res.changes ?? 0;
    }
    const dataWithOperation = newEntries.map((entry) => ({
      id: require('crypto').randomUUID(),
      ...entry,
      operationId,
      isActive: true,
      importBatchId: operationId,
      arrivageDate: entry.arrivageDate ? (entry.arrivageDate instanceof Date ? entry.arrivageDate.toISOString() : entry.arrivageDate) : null,
      entryDate: (entry as any).entryDate ? ((entry as any).entryDate instanceof Date ? (entry as any).entryDate.toISOString() : (entry as any).entryDate) : null,
      supplierPhone: entry.supplierPhone ?? null,
      notes: entry.notes ?? null,
    }));
    await tx.insert(schema.priceEntry).values(dataWithOperation).run();
    const insertedCount = dataWithOperation.length;
    return { deactivatedCount, insertedCount };
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
async function reactivateDeactivatedEntries(
  deactivatedEntryIds: string[]
): Promise<number> {
  if (deactivatedEntryIds.length === 0) {
    return 0;
  }
  const res = await db.update(schema.priceEntry)
    .set({ isActive: true, abandonedAt: null })
    .where(and(inArray(schema.priceEntry.id, deactivatedEntryIds), eq(schema.priceEntry.isActive, false)))
    .run();
  return res.changes ?? 0;
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
async function createEntriesBatchWithOperation(
  entries: CreatePriceEntry[],
  operationId: string
): Promise<{ count: number }> {
  // Drizzle ORM: batch insert with operationId
  const dataWithOperation = entries.map((entry) => ({
    id: require('crypto').randomUUID(),
    ...entry,
    operationId,
    isActive: true,
    importBatchId: operationId,
    arrivageDate: entry.arrivageDate ? (entry.arrivageDate instanceof Date ? entry.arrivageDate.toISOString() : entry.arrivageDate) : null,
    entryDate: (entry as any).entryDate ? ((entry as any).entryDate instanceof Date ? (entry as any).entryDate.toISOString() : (entry as any).entryDate) : new Date().toISOString(),
    supplierPhone: entry.supplierPhone ?? null,
    notes: entry.notes ?? null,
    createdAt: (entry as any).createdAt ? ((entry as any).createdAt instanceof Date ? (entry as any).createdAt.toISOString() : (entry as any).createdAt) : new Date().toISOString(),
  }));
  await db.insert(schema.priceEntry).values(dataWithOperation).run();
  // Optionally verify count
  // const actualCount = await db.select().from(schema.priceEntry).where({ operationId }).all();
  // if (actualCount.length !== dataWithOperation.length) {
  //   throw new Error(`Batch insert mismatch: expected ${dataWithOperation.length} rows for operation ${operationId}, found ${actualCount.length}`);
  // }
  return { count: dataWithOperation.length };
}

/**
 * Get database statistics.
 * 
 * DEFENSIVE QUERY: Only counts active entries.
 * This ensures stats reflect only valid, non-abandoned data.
 */
async function getStats(): Promise<DatabaseStats> {
  // Drizzle ORM: get stats for active entries
  try {
    
  } catch (err) {
    console.error('[DatabaseService] getStats: unexpected init error', err);
  }
  // Use explicit expressions to avoid generating parameterized queries with missing bindings
  try {
    const totalRow = await db.select({ c: sql`count(*)` }).from(schema.priceEntry).where(eq(schema.priceEntry.isActive, true)).get();
    const totalEntries = Number(totalRow?.c ?? 0);

    const uniqueReferencesRow = await db.select({ c: sql`count(DISTINCT ${schema.priceEntry.reference})` }).from(schema.priceEntry).where(eq(schema.priceEntry.isActive, true)).get();
    const uniqueSuppliersRow = await db.select({ c: sql`count(DISTINCT ${schema.priceEntry.supplierName})` }).from(schema.priceEntry).where(eq(schema.priceEntry.isActive, true)).get();
    const uniqueBrandsRow = await db.select({ c: sql`count(DISTINCT ${schema.priceEntry.brand})` }).from(schema.priceEntry).where(eq(schema.priceEntry.isActive, true)).get();

    const dateRangeResult = await db.select({
      maxDate: sql`max(${schema.priceEntry.entryDate})`,
      minDate: sql`min(${schema.priceEntry.entryDate})`,
    })
      .from(schema.priceEntry)
      .where(eq(schema.priceEntry.isActive, true))
      .get();

    const uniqueReferences = Number(uniqueReferencesRow?.c ?? 0);
    const uniqueSuppliers = Number(uniqueSuppliersRow?.c ?? 0);
    const uniqueBrands = Number(uniqueBrandsRow?.c ?? 0);

    return {
      totalEntries,
      uniqueReferences,
      uniqueSuppliers,
      uniqueBrands,
      lastEntryDate: dateRangeResult?.maxDate ?? null,
      oldestEntryDate: dateRangeResult?.minDate ?? null,
    };
  } catch (err) {
    // Defensive fallback to avoid crashing IPC handlers during migration issues
    // eslint-disable-next-line no-console
    console.error('[DatabaseService] getStats: query failure', err, {
      hasDb: !!db,
      priceEntryCol: !!schema?.priceEntry?.entryDate,
    });
    return {
      totalEntries: 0,
      uniqueReferences: 0,
      uniqueSuppliers: 0,
      uniqueBrands: 0,
      lastEntryDate: null,
      oldestEntryDate: null,
    };
  }
}

/**
 * Get distinct values for a column (for autocomplete/filters).
 * 
 * DEFENSIVE QUERY: Only includes values from active entries.
 */
async function getDistinctValues(
  column: 'reference' | 'brand' | 'supplierName' | 'designation',
  search?: string
): Promise<string[]> {
  // Map column name to actual schema column reference
  const colRef =
    column === 'reference' ? schema.priceEntry.reference :
    column === 'brand' ? schema.priceEntry.brand :
    column === 'supplierName' ? schema.priceEntry.supplierName :
    schema.priceEntry.designation;

  // Base query selecting the column as `value`
  let query = db.select({ value: colRef })
    .from(schema.priceEntry)
    .where(eq(schema.priceEntry.isActive, true));

  if (search) {
    // Use LIKE for partial match and ensure isActive
    query = query.where(and(like(colRef, `%${search}%`), eq(schema.priceEntry.isActive, true)));
  }

  query = query.groupBy(colRef).orderBy(asc(colRef)).limit(50);
  const results = await query.all();
  return results.map((r: any) => r.value).filter(Boolean);
}

/**
 * Get import history.
 */
async function getImportHistory(limit: number = 20) {
  // Drizzle ORM: get import history
  const results = await db.select().from(schema.importLog)
    .orderBy(desc(schema.importLog.importedAt))
    .limit(limit)
    .all();
  return results;
}

/**
 * Get all entries matching criteria (for export).
 * 
 * DEFENSIVE QUERY: Only exports active entries from completed operations.
 * This ensures exports never include abandoned or incomplete data.
 */
async function getAllEntriesForExport(
  filters?: ColumnFilter[],
  globalSearch?: string
): Promise<PriceEntry[]> {
  // Drizzle ORM: get all entries for export
  const where = buildWhereClause(filters, globalSearch);
  const results = await db.select().from(schema.priceEntry)
    .where(where)
    .orderBy(desc(schema.priceEntry.entryDate))
    .all();
  return results as PriceEntry[];
}

/**
 * Get a single price entry by id.
 */
async function getEntry(id: string): Promise<PriceEntry | null> {
  if (!db) throw new Error('Database not initialized');
  if (!id) return null;
  const rows = await db.select().from(schema.priceEntry).where(eq(schema.priceEntry.id, id)).all();
  return (rows && rows.length > 0) ? (rows[0] as PriceEntry) : null;
}

export {
  initializeDatabase,
  closeDatabase,
  isDatabaseInitialized,
  queryEntries,
  getEntry,
  
  createEntry,
  createEntriesBatch,
  findDuplicateReferences,
  deactivateAndInsertEntries,
  reactivateDeactivatedEntries,
  createEntriesBatchWithOperation,
  getStats,
  getDistinctValues,
  getImportHistory,
  getAllEntriesForExport,
};
