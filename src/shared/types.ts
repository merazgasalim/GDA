/**
 * Shared Types for Gestion des Arrivages
 * ======================================
 * These types are shared between main and renderer processes.
 * They define the data structures used across the IPC boundary.
 */

import { z } from 'zod';

// ===========================================
// OPERATIONS LOG TYPES
// ===========================================
// These types support the Operations Log system for full auditability.
// See prisma/schema.prisma for detailed documentation on the design rationale.

/**
 * Operation types represent HIGH-LEVEL user intents.
 * Each type is a meaningful business action, not a raw SQL operation.
 */
export const OperationTypeSchema = z.enum([
  'IMPORT',         // Bulk import from clipboard/file
  'MANUAL_ADD',     // Single entry manual creation  
  'BULK_EDIT',      // Bulk modification of existing entries
  'BULK_DELETE',    // Soft-delete of multiple entries
  'SYSTEM_MIGRATE', // System-initiated data migration
]);
export type OperationType = z.infer<typeof OperationTypeSchema>;

/**
 * Operation status lifecycle:
 * PENDING -> COMPLETED (success) or FAILED (error)
 * COMPLETED -> ABANDONED (user-initiated soft-rollback)
 * 
 * CRITICAL: Operations in PENDING status after app restart indicate
 * a crash during the operation. These should prompt user resolution.
 */
export const OperationStatusSchema = z.enum([
  'PENDING',    // Operation started but not finished (crash recovery state)
  'COMPLETED',  // Operation finished successfully  
  'FAILED',     // Operation failed during processing
  'ABANDONED',  // Operation was completed but later abandoned by user
]);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

/**
 * Operation metadata varies by operation type.
 * This is stored as JSON in the database for flexibility.
 */
export const OperationMetadataSchema = z.object({
  // Import operations
  source: z.string().optional(),           // e.g., "clipboard", "file"
  originalFilename: z.string().optional(), // Original file name if from file
  fileHash: z.string().optional(),         // Hash for deduplication
  
  // Edit operations  
  affectedFields: z.array(z.string()).optional(), // Which fields were modified
  reason: z.string().optional(),                   // User-provided reason
  
  // Delete operations
  criteria: z.record(z.unknown()).optional(), // Filter criteria used
  
  // General
  errorMessage: z.string().optional(), // If operation failed
}).passthrough(); // Allow additional properties
export type OperationMetadata = z.infer<typeof OperationMetadataSchema>;

/**
 * Full operation log entry as returned from the database.
 */
export const OperationLogSchema = z.object({
  id: z.string().uuid(),
  type: OperationTypeSchema,
  status: OperationStatusSchema,
  rowCount: z.number().int().nonnegative(),
  createdAt: z.date(),
  completedAt: z.date().nullable(),
  abandonedAt: z.date().nullable(),
  createdBy: z.string(),
  abandonedBy: z.string().nullable(),
  metadata: z.string().nullable(), // JSON string
  description: z.string().nullable(),
  abandonedOperationId: z.string().nullable(),
});
export type OperationLog = z.infer<typeof OperationLogSchema>;

/**
 * Parsed operation with metadata as object (for UI display).
 */
export interface OperationLogDisplay extends Omit<OperationLog, 'metadata'> {
  metadata: OperationMetadata | null;
}

/**
 * Input for creating a new operation.
 */
export const CreateOperationSchema = z.object({
  type: OperationTypeSchema,
  description: z.string().optional(),
  metadata: OperationMetadataSchema.optional(),
  createdBy: z.string().default('local'),
});
export type CreateOperation = z.infer<typeof CreateOperationSchema>;

/**
 * Result of abandoning an operation.
 */
export interface AbandonOperationResult {
  success: boolean;
  operationId: string;
  affectedRowCount: number;
  abandonEventId?: string; // ID of the ABANDON_EVENT operation created
  error?: string;
}

/**
 * Incomplete operations found on app startup (crash recovery).
 */
export interface IncompleteOperation {
  id: string;
  type: OperationType;
  rowCount: number;
  createdAt: Date;
  description: string | null;
}

// ===========================================
// PRICE ENTRY TYPES
// ===========================================

export const PriceEntrySchema = z.object({
  id: z.string().uuid(),
  reference: z.string().min(1),
  designation: z.string().min(1),
  brand: z.string().min(1),
  constructorRef: z.string().nullable(),
  supplierName: z.string().min(1),
  supplierPhone: z.string().nullable(),
  price: z.number().positive(),
  currency: z.string().default('MAD'),
  entryDate: z.date(),
  arrivageDate: z.date().nullable(),
  notes: z.string().nullable(),
  importBatchId: z.string().nullable(),
  createdAt: z.date(),
  // Operations log fields
  operationId: z.string().nullable(),
  isActive: z.boolean().default(true),
  abandonedAt: z.date().nullable(),
});

export type PriceEntry = z.infer<typeof PriceEntrySchema>;

// For creating new entries (without auto-generated fields)
export const CreatePriceEntrySchema = z.object({
  reference: z.string().min(1, 'Reference is required'),
  designation: z.string().min(1, 'Designation is required'),
  brand: z.string().min(1, 'Brand is required'),
  constructorRef: z.string().optional().nullable(),
  supplierName: z.string().min(1, 'Supplier name is required'),
  supplierPhone: z.string().optional().nullable(),
  price: z.number().positive('Price must be positive'),
  currency: z.string().default('MAD'),
  arrivageDate: z.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type CreatePriceEntry = z.infer<typeof CreatePriceEntrySchema>;

// ===========================================
// QUERY & FILTER TYPES
// ===========================================

export const SortDirectionSchema = z.enum(['asc', 'desc']);
export type SortDirection = z.infer<typeof SortDirectionSchema>;

export const ColumnFilterSchema = z.object({
  column: z.string(),
  value: z.string(),
  operator: z.enum(['contains', 'equals', 'startsWith', 'endsWith', 'gt', 'lt', 'gte', 'lte']).default('contains'),
});
export type ColumnFilter = z.infer<typeof ColumnFilterSchema>;

export const QueryParamsSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(500).default(50),
  sortColumn: z.string().optional(),
  sortDirection: SortDirectionSchema.optional(),
  globalSearch: z.string().optional(),
  filters: z.array(ColumnFilterSchema).optional(),
});
export type QueryParams = z.infer<typeof QueryParamsSchema>;

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ===========================================
// IMPORT TYPES
// ===========================================

export const ImportRowSchema = z.object({
  reference: z.string(),
  designation: z.string(),
  brand: z.string(),
  constructorRef: z.string().optional(),
  supplierName: z.string(),
  supplierPhone: z.string().optional(),
  price: z.number(),
  arrivageDate: z.string().optional(),
  notes: z.string().optional(),
});
export type ImportRow = z.infer<typeof ImportRowSchema>;

export interface ImportPreview {
  rows: ImportRow[];
  errors: ImportError[];
  totalParsed: number;
  validCount: number;
  invalidCount: number;
}

export interface ImportError {
  row: number;
  column?: string;
  message: string;
  rawData?: string;
}

export interface ImportResult {
  success: boolean;
  batchId: string;
  importedCount: number;
  errors: ImportError[];
}

// ===========================================
// CSV IMPORT TYPES (Two-Step Wizard)
// ===========================================

/**
 * Target fields available for CSV column mapping.
 * --none-- means the column will be ignored.
 */
export const CSVTargetFieldSchema = z.enum([
  '--none--',
  'reference',
  'designation',
  'brand',
  'price',
]);
export type CSVTargetField = z.infer<typeof CSVTargetFieldSchema>;

/**
 * Human-readable labels for CSV target fields (French).
 */
export const CSV_TARGET_FIELD_LABELS: Record<CSVTargetField, string> = {
  '--none--': '-- Ignorer --',
  reference: 'Référence',
  designation: 'Désignation',
  brand: 'Marque',
  price: 'Prix',
};

/**
 * Column mapping configuration for CSV import.
 * Maps CSV column index to target field.
 */
export interface CSVColumnMapping {
  [columnIndex: number]: CSVTargetField;
}

/**
 * Parsed CSV data from Step 1.
 */
export interface CSVParsedData {
  /** Raw headers from CSV (if first row is header) */
  headers: string[];
  /** All parsed rows as string arrays */
  rows: string[][];
  /** Detected delimiter used */
  delimiter: string;
  /** Whether first row was treated as header */
  hasHeader: boolean;
  /** Total number of rows (excluding header if hasHeader) */
  totalRows: number;
  /** Number of columns detected */
  columnCount: number;
  /** Hash of the content for deduplication */
  contentHash: string;
  /** Original filename if from file */
  filename?: string;
}

/**
 * Validation error for a single cell in CSV import.
 */
export interface CSVValidationError {
  rowIndex: number;
  columnIndex: number;
  field: CSVTargetField;
  value: string;
  message: string;
}

/**
 * Preview data for Step 2 of CSV import.
 */
export interface CSVImportPreview {
  /** Parsed CSV data from Step 1 */
  parsedData: CSVParsedData;
  /** Current column mapping */
  mapping: CSVColumnMapping;
  /** Validation errors based on current mapping */
  validationErrors: CSVValidationError[];
  /** Number of rows that will be imported (valid rows only) */
  validRowCount: number;
  /** Number of rows with errors */
  invalidRowCount: number;
}

/**
 * Supplier info for CSV import context.
 */
export interface CSVSupplierInfo {
  name: string;
  phone?: string;
  isNew: boolean;
}

/**
 * Complete import configuration from the wizard.
 */
export interface CSVImportConfig {
  /** Parsed CSV data */
  parsedData: CSVParsedData;
  /** Column mapping */
  mapping: CSVColumnMapping;
  /** Selected supplier */
  supplier: CSVSupplierInfo;
  /** Import/arrival date */
  importDate: string;
  /** Strategy for handling duplicates (required if duplicates exist) */
  duplicateStrategy?: DuplicateStrategy;
}

// ===========================================
// DUPLICATE DETECTION TYPES
// ===========================================

/**
 * Strategy for handling duplicate references during import.
 * 
 * CRITICAL: No default selection. User MUST explicitly choose.
 * This prevents accidental data overwrites.
 */
export type DuplicateStrategy = 
  | 'skip'    // Do not import duplicate rows, keep existing prices
  | 'update'  // Deactivate old prices, insert new prices (preserves history)
  | 'abort';  // Cancel the entire import

/**
 * Category of a parsed row after analysis.
 */
export type RowCategory = 
  | 'NEW'                  // No existing record with same reference+supplier
  | 'DUPLICATE_REFERENCE'  // Matches existing active record
  | 'INVALID';             // Missing required fields

/**
 * Information about a detected duplicate.
 */
export interface DuplicateInfo {
  /** Index in the parsed CSV rows array */
  rowIndex: number;
  /** Reference value from CSV */
  reference: string;
  /** ID of the existing database record */
  existingEntryId: string;
  /** Current price in database */
  existingPrice: number;
  /** Price from CSV (may be null if price column not mapped) */
  newPrice: number | null;
  /** Date of existing entry */
  existingDate: Date;
}

/**
 * A row that was found to be a duplicate within the CSV itself.
 * (Same reference appears multiple times in the import)
 */
export interface IntraCsvDuplicate {
  /** Reference that appears multiple times */
  reference: string;
  /** Indices of all rows with this reference */
  rowIndices: number[];
}

/**
 * Result of the pre-import duplicate analysis.
 * 
 * This analysis happens BEFORE any database writes.
 * No OperationLog is created during analysis.
 */
export interface DuplicateAnalysisResult {
  /** Rows that have no matching record in database */
  newRows: number[];
  /** Rows that match existing active records */
  duplicateRows: DuplicateInfo[];
  /** Rows that are invalid (missing required fields) */
  invalidRows: number[];
  /** References that appear multiple times within the CSV */
  intraCsvDuplicates: IntraCsvDuplicate[];
  /** Total counts for UI display */
  summary: {
    totalRows: number;
    newCount: number;
    duplicateCount: number;
    invalidCount: number;
    intraCsvDuplicateCount: number;
  };
  /** Whether user must select a strategy before proceeding */
  requiresStrategySelection: boolean;
}

/**
 * Result of CSV file reading.
 */
export interface CSVFileReadResult {
  success: boolean;
  content?: string;
  filename?: string;
  error?: string;
}

/**
 * Result of CSV import execution.
 */
export interface CSVImportResult {
  success: boolean;
  operationId: string;
  importedCount: number;
  errors: CSVValidationError[];
  skippedCount: number;
  /** Number of existing records that were updated (deactivated + new inserted) */
  updatedCount: number;
  /** Strategy that was used */
  strategyUsed?: DuplicateStrategy;
}

// ===========================================
// EXPORT TYPES
// ===========================================

export const ExportFormatSchema = z.enum(['csv', 'xlsx']);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const ExportOptionsSchema = z.object({
  format: ExportFormatSchema,
  filters: z.array(ColumnFilterSchema).optional(),
  globalSearch: z.string().optional(),
  columns: z.array(z.string()).optional(), // Specific columns to export
  filename: z.string().optional(),
});
export type ExportOptions = z.infer<typeof ExportOptionsSchema>;

export interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
  rowCount?: number;
}

// ===========================================
// LICENSE TYPES
// ===========================================

export const LicenseTypeSchema = z.enum(['trial', 'full']);
export type LicenseType = z.infer<typeof LicenseTypeSchema>;

export const FeatureFlagsSchema = z.object({
  canExport: z.boolean().default(false),
  canBackup: z.boolean().default(false),
  canImport: z.boolean().default(true),
  maxEntries: z.number().optional(), // undefined = unlimited
});
export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;

export const LicensePayloadSchema = z.object({
  customerId: z.string(),
  customerName: z.string().optional(),
  licenseType: LicenseTypeSchema,
  expirationDate: z.string(), // ISO date string
  issuedAt: z.string(), // ISO date string
  featureFlags: FeatureFlagsSchema,
  machineId: z.string().optional(), // For machine-bound licenses
});
export type LicensePayload = z.infer<typeof LicensePayloadSchema>;

export interface LicenseStatus {
  isValid: boolean;
  isExpired: boolean;
  licenseType: LicenseType | null;
  expirationDate: string | null;
  daysRemaining: number | null;
  customerName: string | null;
  featureFlags: FeatureFlags;
  errorMessage?: string;
}

// Default status for unlicensed/invalid state
export const DEFAULT_LICENSE_STATUS: LicenseStatus = {
  isValid: false,
  isExpired: true,
  licenseType: null,
  expirationDate: null,
  daysRemaining: null,
  customerName: null,
  featureFlags: {
    canExport: false,
    canBackup: false,
    canImport: false,
    maxEntries: 100, // Limited entries for unlicensed users
  },
  errorMessage: 'No valid license found',
};

// ===========================================
// APP STATE TYPES
// ===========================================

export interface AppState {
  isReady: boolean;
  licenseStatus: LicenseStatus;
  databaseStatus: 'connected' | 'disconnected' | 'error';
  errorMessage?: string;
}

// ===========================================
// COLUMN CONFIGURATION
// ===========================================

export interface ColumnConfig {
  id: string;
  header: string;
  accessorKey: keyof PriceEntry;
  visible: boolean;
  width?: number;
  sortable: boolean;
  filterable: boolean;
}

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'reference', header: 'Référence', accessorKey: 'reference', visible: true, sortable: true, filterable: true },
  { id: 'designation', header: 'Désignation', accessorKey: 'designation', visible: true, sortable: true, filterable: true },
  { id: 'brand', header: 'Marque', accessorKey: 'brand', visible: true, sortable: true, filterable: true },
  { id: 'supplierName', header: 'Fournisseur', accessorKey: 'supplierName', visible: true, sortable: true, filterable: true },
  { id: 'supplierPhone', header: 'Téléphone', accessorKey: 'supplierPhone', visible: true, sortable: true, filterable: true },
  { id: 'constructorRef', header: 'Réf. Constructeur', accessorKey: 'constructorRef', visible: true, sortable: true, filterable: true },
  { id: 'price', header: 'Prix', accessorKey: 'price', visible: true, sortable: true, filterable: true, width: 100 },
  { id: 'entryDate', header: 'Date', accessorKey: 'entryDate', visible: true, sortable: true, filterable: true },
];
