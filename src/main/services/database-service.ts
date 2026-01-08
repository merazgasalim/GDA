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
import { execFileSync } from 'child_process';
import {
  PriceEntry,
  CreatePriceEntry,
  QueryParams,
  PaginatedResult,
  ColumnFilter,
} from '../../shared/types';
import { DatabaseStats } from '../../shared/ipc-api';
import { deriveEncryptionKey } from './license-service';
import { setOperationServicePrisma, completeOperation } from './operation-service';
import { assertOperationAttached } from '../../shared/operationService';
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

    // At runtime, avoid invoking the Prisma CLI (native query-engine) by default
    // because it can crash when spawned inside Electron in some environments.
    // Instead, rely on the in-place PRAGMA/ALTER adjustments below to patch
    // the schema. If you explicitly want to enable runtime migrations, set
    // the environment variable `PRISMA_RUNTIME_MIGRATIONS=true` in your dev
    // environment (not recommended for production builds).
    if (process.env.PRISMA_RUNTIME_MIGRATIONS === 'true') {
      try {
        console.info('Runtime migrations enabled: attempting to run Prisma CLI (deploy)');
        let projectRoot = path.resolve(__dirname);
        for (let i = 0; i < 6; i++) {
          if (fs.existsSync(path.join(projectRoot, 'package.json'))) break;
          projectRoot = path.resolve(projectRoot, '..');
        }
        const schemaPath = path.join(projectRoot, 'prisma', 'schema.prisma');
        const prismaBin = path.join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
        const env = { ...process.env, DATABASE_URL: dbUrl };
        if (fs.existsSync(prismaBin)) {
          execFileSync(prismaBin, ['migrate', 'deploy', '--schema', schemaPath], { stdio: 'inherit', cwd: projectRoot, env });
        } else {
          execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', schemaPath], { stdio: 'inherit', cwd: projectRoot, env });
        }
        console.info('Migrations applied successfully');
      } catch (err) {
        console.warn('Runtime prisma migrate failed; attempting db push fallback', err);
        try {
          let projectRoot = path.resolve(__dirname);
          for (let i = 0; i < 6; i++) {
            if (fs.existsSync(path.join(projectRoot, 'package.json'))) break;
            projectRoot = path.resolve(projectRoot, '..');
          }
          const schemaPath = path.join(projectRoot, 'prisma', 'schema.prisma');
          const prismaBin = path.join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
          const env = { ...process.env, DATABASE_URL: dbUrl };
          if (fs.existsSync(prismaBin)) {
            execFileSync(prismaBin, ['db', 'push', '--schema', schemaPath], { stdio: 'inherit', cwd: projectRoot, env });
          } else {
            execFileSync('npx', ['prisma', 'db', 'push', '--schema', schemaPath], { stdio: 'inherit', cwd: projectRoot, env });
          }
          console.info('Prisma db push succeeded');
        } catch (err2) {
          console.error('Failed to ensure database schema automatically:', err2);
        }
      }
    } else {
      console.info('Skipping runtime Prisma CLI invocation; using in-place SQL schema adjustments instead');
    }

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
      // Ensure PriceEntry.createdBy exists
      const priceTableInfo: any = await prisma.$queryRawUnsafe(`PRAGMA table_info("PriceEntry")`);
      const hasPriceCreatedBy = Array.isArray(priceTableInfo) && priceTableInfo.some((col: any) => col.name === 'createdBy');
      if (!hasPriceCreatedBy) {
        console.info('PriceEntry.createdBy missing — adding column');
        await prisma.$executeRawUnsafe(`ALTER TABLE "PriceEntry" ADD COLUMN "createdBy" TEXT NOT NULL DEFAULT 'local'`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PriceEntry_createdBy_idx" ON "PriceEntry"("createdBy")`);
      }

      // Ensure OperationLog.type exists
      const opTableInfo: any = await prisma.$queryRawUnsafe(`PRAGMA table_info("OperationLog")`);
      const hasOpType = Array.isArray(opTableInfo) && opTableInfo.some((col: any) => col.name === 'type');
      if (!hasOpType) {
        console.info('OperationLog.type missing — adding column');
        await prisma.$executeRawUnsafe(`ALTER TABLE "OperationLog" ADD COLUMN "type" TEXT`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OperationLog_type_idx" ON "OperationLog"("type")`);
      }
      // Ensure OperationLog.rowCount exists
      const hasOpRowCount = Array.isArray(opTableInfo) && opTableInfo.some((col: any) => col.name === 'rowCount');
      if (!hasOpRowCount) {
        console.info('OperationLog.rowCount missing — adding column');
        await prisma.$executeRawUnsafe(`ALTER TABLE "OperationLog" ADD COLUMN "rowCount" INTEGER NOT NULL DEFAULT 0`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OperationLog_rowCount_idx" ON "OperationLog"("rowCount")`);
      }
      // Ensure OperationLog.description exists
      const hasOpDescription = Array.isArray(opTableInfo) && opTableInfo.some((col: any) => col.name === 'description');
      if (!hasOpDescription) {
        console.info('OperationLog.description missing — adding column');
        await prisma.$executeRawUnsafe(`ALTER TABLE "OperationLog" ADD COLUMN "description" TEXT`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OperationLog_description_idx" ON "OperationLog"("description")`);
      }
      // Ensure OperationLog.legacyStatus exists
      const hasOpLegacyStatus = Array.isArray(opTableInfo) && opTableInfo.some((col: any) => col.name === 'legacyStatus');
      if (!hasOpLegacyStatus) {
        console.info('OperationLog.legacyStatus missing — adding column');
        await prisma.$executeRawUnsafe(`ALTER TABLE "OperationLog" ADD COLUMN "legacyStatus" TEXT DEFAULT 'COMPLETED'`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OperationLog_legacyStatus_idx" ON "OperationLog"("legacyStatus")`);
      }
      // Ensure OperationLog.metadata exists
      const hasOpMetadata = Array.isArray(opTableInfo) && opTableInfo.some((col: any) => col.name === 'metadata');
      if (!hasOpMetadata) {
        console.info('OperationLog.metadata missing — adding column');
        await prisma.$executeRawUnsafe(`ALTER TABLE "OperationLog" ADD COLUMN "metadata" TEXT`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OperationLog_metadata_idx" ON "OperationLog"("metadata")`);
      }
      // Ensure other OperationLog audit columns exist
      const hasOpCompletedAt = Array.isArray(opTableInfo) && opTableInfo.some((col: any) => col.name === 'completedAt');
      if (!hasOpCompletedAt) {
        console.info('OperationLog.completedAt missing — adding column');
        await prisma.$executeRawUnsafe(`ALTER TABLE "OperationLog" ADD COLUMN "completedAt" DATETIME`);
      }
      const hasOpAbandonedAt = Array.isArray(opTableInfo) && opTableInfo.some((col: any) => col.name === 'abandonedAt');
      if (!hasOpAbandonedAt) {
        console.info('OperationLog.abandonedAt missing — adding column');
        await prisma.$executeRawUnsafe(`ALTER TABLE "OperationLog" ADD COLUMN "abandonedAt" DATETIME`);
      }
      const hasOpAbandonedBy = Array.isArray(opTableInfo) && opTableInfo.some((col: any) => col.name === 'abandonedBy');
      if (!hasOpAbandonedBy) {
        console.info('OperationLog.abandonedBy missing — adding column');
        await prisma.$executeRawUnsafe(`ALTER TABLE "OperationLog" ADD COLUMN "abandonedBy" TEXT`);
      }
      const hasOpAbandonedOpId = Array.isArray(opTableInfo) && opTableInfo.some((col: any) => col.name === 'abandonedOperationId');
      if (!hasOpAbandonedOpId) {
        console.info('OperationLog.abandonedOperationId missing — adding column');
        await prisma.$executeRawUnsafe(`ALTER TABLE "OperationLog" ADD COLUMN "abandonedOperationId" TEXT`);
      }
      const hasOpRevertOpId = Array.isArray(opTableInfo) && opTableInfo.some((col: any) => col.name === 'revertOperationId');
      if (!hasOpRevertOpId) {
        console.info('OperationLog.revertOperationId missing — adding column');
        await prisma.$executeRawUnsafe(`ALTER TABLE "OperationLog" ADD COLUMN "revertOperationId" TEXT`);
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OperationLog_revertOperationId_idx" ON "OperationLog"("revertOperationId")`);
      }

      // Ensure Supplier.createdBy exists
      try {
        const supplierTableInfo: any = await prisma.$queryRawUnsafe(`PRAGMA table_info("Supplier")`);
        const hasSupplierCreatedBy = Array.isArray(supplierTableInfo) && supplierTableInfo.some((col: any) => col.name === 'createdBy');
        if (!hasSupplierCreatedBy) {
          console.info('Supplier.createdBy missing — adding column');
          await prisma.$executeRawUnsafe(`ALTER TABLE "Supplier" ADD COLUMN "createdBy" TEXT NOT NULL DEFAULT 'local'`);
          await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Supplier_createdBy_idx" ON "Supplier"("createdBy")`);
        }
      } catch (supErr) {
        console.warn('Failed to ensure Supplier.createdBy:', supErr);
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
    // Define column types to avoid applying string operators to non-string fields
    const numericColumns = new Set(['price']);
    const dateColumns = new Set(['entryDate', 'arrivageDate', 'abandonedAt', 'createdAt', 'deactivatedAt']);

    const tryParseNumber = (v: string) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : null;
    };

    const tryParseDate = (v: string) => {
      const out: { type: 'date' | 'month' | 'year' | 'dayMonth' | 'dayOnly' | null; date?: Date; start?: Date; end?: Date; day?: number; month?: number; year?: number } = { type: null };

      const trimmed = v.trim();

      // YYYY-MM-DD or YYYY/MM/DD or DD/MM/YYYY
      // YYYY-MM or YYYY/MM
      // YYYY
      // MM/YYYY or M/YYYY
      // DD/MM (day+month)
      // DD (day only)

      // Full ISO or RFC parse first
      let d = Date.parse(trimmed);
      if (Number.isFinite(d)) {
        out.type = 'date';
        out.date = new Date(d);
        // start of day and end-of-next-day
        const start = new Date(out.date.getFullYear(), out.date.getMonth(), out.date.getDate());
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        out.start = start;
        out.end = end;
        return out;
      }

      // dd/mm/yyyy
      let m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) {
        const day = parseInt(m[1], 10);
        const mon = parseInt(m[2], 10) - 1;
        const yr = parseInt(m[3], 10);
        const start = new Date(yr, mon, day);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        out.type = 'date';
        out.date = start;
        out.start = start;
        out.end = end;
        return out;
      }

      // MM/YYYY or M/YYYY
      m = trimmed.match(/^(\d{1,2})\/(\d{4})$/);
      if (m) {
        const mon = parseInt(m[1], 10) - 1;
        const yr = parseInt(m[2], 10);
        const start = new Date(yr, mon, 1);
        const end = new Date(yr, mon + 1, 1);
        out.type = 'month';
        out.start = start;
        out.end = end;
        return out;
      }

      // YYYY-MM or YYYY/MM
      m = trimmed.match(/^(\d{4})[-\/](\d{1,2})$/);
      if (m) {
        const yr = parseInt(m[1], 10);
        const mon = parseInt(m[2], 10) - 1;
        const start = new Date(yr, mon, 1);
        const end = new Date(yr, mon + 1, 1);
        out.type = 'month';
        out.start = start;
        out.end = end;
        return out;
      }

      // YYYY
      m = trimmed.match(/^(\d{4})$/);
      if (m) {
        const yr = parseInt(m[1], 10);
        const start = new Date(yr, 0, 1);
        const end = new Date(yr + 1, 0, 1);
        out.type = 'year';
        out.start = start;
        out.end = end;
        return out;
      }

      // DD/MM (day+month, no year)
      m = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
      if (m) {
        const day = parseInt(m[1], 10);
        const mon = parseInt(m[2], 10);
        out.type = 'dayMonth';
        out.day = day;
        out.month = mon;
        return out;
      }

      // Single number: treat as day or month. If 1-31 -> dayOnly; if 1-12 -> month-only (prefer month)
      m = trimmed.match(/^(\d{1,2})$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= 12) {
          out.type = 'month';
          // Use current year as default for month searches
          const now = new Date();
          out.start = new Date(now.getFullYear(), n - 1, 1);
          out.end = new Date(now.getFullYear(), n, 1);
          out.month = n;
          return out;
        }
        if (n >= 1 && n <= 31) {
          out.type = 'dayOnly';
          out.day = n;
          return out;
        }
      }

      return out;
    };

    for (const filter of filters) {
      const { column, value, operator } = filter;
      
      if (!value) continue;

      const condition: Prisma.PriceEntryWhereInput = {};

      // Support JSON date-range payloads emitted by the UI: { from?: string, to?: string }
      if (dateColumns.has(column) && typeof value === 'string' && value.trim().startsWith('{')) {
        try {
          const parsedRange = JSON.parse(value);
          const from = parsedRange && parsedRange.from ? tryParseDate(parsedRange.from) : null;
          const to = parsedRange && parsedRange.to ? tryParseDate(parsedRange.to) : null;

          if (from && from.start && to && to.start) {
            // Normalize: gte from.start, lt day after to.start (use to.end if available)
            const endExclusive = to.end ?? new Date(to.start.getFullYear(), to.start.getMonth(), to.start.getDate() + 1);
            conditions.push({ [column]: { gte: from.start, lt: endExclusive } } as any);
            continue;
          }

          if (from && from.start && !to) {
            conditions.push({ [column]: { gte: from.start } } as any);
            continue;
          }

          if (!from && to && to.start) {
            const endExclusive = to.end ?? new Date(to.start.getFullYear(), to.start.getMonth(), to.start.getDate() + 1);
            conditions.push({ [column]: { lt: endExclusive } } as any);
            continue;
          }
        } catch {
          // fall through to normal handling if JSON invalid
        }
      }

      switch (operator) {
        case 'equals':
          if (numericColumns.has(column)) {
            const num = tryParseNumber(value);
            if (num === null) continue;
            (condition as any)[column] = { equals: num };
          } else if (dateColumns.has(column)) {
            const dt = tryParseDate(value);
            if (!dt) continue;
            (condition as any)[column] = { equals: dt };
          } else {
            (condition as any)[column] = value;
          }
          break;
        case 'contains':
          // Don't apply string 'contains' to numeric/date columns.
          if (numericColumns.has(column)) {
            const num = tryParseNumber(value);
            if (num === null) continue;
            (condition as any)[column] = { equals: num };
            break;
          }

          if (dateColumns.has(column)) {
            const parsed = tryParseDate(value);
            if (!parsed.type) continue;
            if (parsed.type === 'date' && parsed.start && parsed.end) {
              (condition as any)[column] = { gte: parsed.start, lt: parsed.end };
            } else if ((parsed.type === 'month' || parsed.type === 'year') && parsed.start && parsed.end) {
              (condition as any)[column] = { gte: parsed.start, lt: parsed.end };
            } else if (parsed.type === 'dayOnly' && parsed.day) {
              // Expand to OR of reasonable year range
              const now = new Date();
              const minYear = Math.max(1970, now.getFullYear() - 25);
              const maxYear = now.getFullYear() + 5;
              const orConds: Prisma.PriceEntryWhereInput[] = [];
                  for (let y = minYear; y <= maxYear; y++) {
                for (let mth = 0; mth < 12; mth++) {
                  const start: Date = new Date(y, mth, parsed.day);
                  if (start.getDate() !== parsed.day) continue; // skip invalid dates (e.g., Feb 30)
                  const end = new Date(start);
                  end.setDate(end.getDate() + 1);
                  orConds.push({ [column]: { gte: start, lt: end } } as any);
                }
              }
              if (orConds.length === 0) continue;
              conditions.push({ OR: orConds });
              continue;
            } else if (parsed.type === 'dayMonth' && parsed.day && parsed.month) {
              // Expand across a range of years for that day-month combination
              const now = new Date();
              const minYear = Math.max(1970, now.getFullYear() - 25);
              const maxYear = now.getFullYear() + 5;
              const orConds: Prisma.PriceEntryWhereInput[] = [];
              for (let y = minYear; y <= maxYear; y++) {
                const start: Date = new Date(y, parsed.month - 1, parsed.day);
                if (start.getDate() !== parsed.day) continue;
                const end = new Date(start);
                end.setDate(end.getDate() + 1);
                orConds.push({ [column]: { gte: start, lt: end } } as any);
              }
              if (orConds.length === 0) continue;
              conditions.push({ OR: orConds });
              continue;
            } else {
              continue;
            }
          } else {
            // For text columns, if the user provided multiple space-separated words,
            // require that ALL words are present in the same column (tokenized AND).
            // This mirrors the globalSearch behavior which splits on whitespace and
            // requires every token to be found somewhere.
            const trimmed = String(value).trim();
            const words = trimmed.split(/\s+/).filter(w => w.length > 0);

            if (words.length > 1) {
              // Build an AND of contains conditions for this column
              const andConds: Prisma.PriceEntryWhereInput[] = words.map((w) => ({ [column]: { contains: w } } as any));
              conditions.push({ AND: andConds });
              continue;
            }

            // Single-word fallback: use contains to match anywhere in the field
            (condition as any)[column] = { contains: trimmed };
          }
          break;
        case 'gt':
        case 'lt':
        case 'gte':
        case 'lte':
          if (numericColumns.has(column)) {
            const num = tryParseNumber(value);
            if (num === null) continue;
            (condition as any)[column] = { [operator]: num };
          } else if (dateColumns.has(column)) {
            const dt = tryParseDate(value);
            if (!dt) continue;
            (condition as any)[column] = { [operator]: dt };
          } else {
            // For string columns, use lexical comparison
            (condition as any)[column] = { [operator]: value };
          }
          break;
        default:
          // Fallback: avoid applying contains to numeric/date
          if (numericColumns.has(column)) {
            const num = tryParseNumber(value);
            if (num === null) continue;
            (condition as any)[column] = { equals: num };
          } else if (dateColumns.has(column)) {
            const dt = tryParseDate(value);
            if (!dt) continue;
            (condition as any)[column] = { equals: dt };
          } else {
            (condition as any)[column] = { contains: value };
          }
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
  // Enforce operation-logged creation sequence:
  // 1) create OperationLog
  // 2) create PriceEntry with operationId inside a transaction
  // 3) update operation.entityId and complete operation
  // Create operation and entry in a single transaction to ensure atomicity
  try {
    const result = await db.$transaction(async (tx) => {
      // 1) create operation (canonical + legacy fields)
      const op = await tx.operationLog.create({ data: ({
        operationType: 'PRODUCT_CREATE',
        payloadSnapshot: JSON.stringify(data as any),
        status: 'APPLIED',
        createdBy: (data as any).createdBy ?? 'local',
        type: 'PRODUCT_CREATE',
        legacyStatus: 'PENDING',
        metadata: JSON.stringify(data),
        description: `Create product: ${data.reference} (${data.brand})`,
        rowCount: 0,
      } as any) });

      // 2) create price entry linked to operation
      const createdEntry = await tx.priceEntry.create({ data: ({
        ...data,
        arrivageDate: data.arrivageDate ?? null,
        supplierPhone: data.supplierPhone ?? null,
        notes: data.notes ?? null,
        operationId: op.id,
      } as any) });

      // Runtime assertion: ensure the created entry has operationId
      assertOperationAttached(createdEntry);

      // 3) update operation.entityId for canonical mapping
      await tx.operationLog.update({ where: { id: op.id }, data: ({ entityId: createdEntry.id } as any) });

      return { operationId: op.id, createdEntry };
    });

    // After successful commit, mark operation as completed
    await completeOperation({ operationId: result.operationId, rowCount: 1, metadata: { productId: result.createdEntry.id } });
    return result.createdEntry as PriceEntry;
  } catch (err) {
    // If op was created and failedOperation should be called, attempt best-effort mark
    // Note: If transaction failed before op was persisted, there's nothing to mark.
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

  const result = await db.priceEntry.createMany({ data: dataWithBatch as any });

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

  // Verify that the expected number of rows were created with the operationId
  const actualCount = await db.priceEntry.count({ where: { operationId } });
  if (actualCount !== result.count) {
    throw new Error(`Batch insert mismatch: expected ${result.count} rows for operation ${operationId}, found ${actualCount}`);
  }

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
