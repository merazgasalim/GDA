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
  'IMPORT',              // Bulk import from clipboard/file
  'MANUAL_ADD',          // Single entry manual creation  
  'BULK_EDIT',           // Bulk modification of existing entries
  'BULK_DELETE',         // Soft-delete of multiple entries
  'SYSTEM_MIGRATE',      // System-initiated data migration
  'SUPPLIER_CREATE',     // Supplier entity creation
  'COMPATIBILITY_ADD',   // Add product compatibility relation
  'COMPATIBILITY_REMOVE',// Remove (soft-delete) product compatibility relation
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
  supplierName: z.string().min(1),
  supplierPhone: z.string().nullable(),
  price: z.number().positive(),
  currency: z.string().default('DZD'),
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
  supplierName: z.string().min(1, 'Supplier name is required'),
  supplierPhone: z.string().optional().nullable(),
  price: z.number().positive('Price must be positive'),
  currency: z.string().default('DZD'),
  arrivageDate: z.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type CreatePriceEntry = z.infer<typeof CreatePriceEntrySchema>;

// ===========================================
// SUPPLIER TYPES (CORE DOMAIN)
// ===========================================
// Supplier is a core domain entity that will be reused across:
// - Imports (linking price entries to normalized suppliers)
// - Pricing history (tracking supplier price patterns)
// - Provenance (auditing data sources)
// - Audit logs (traceability)
//
// DESIGN DECISIONS:
// 1. Contacts are NORMALIZED (not JSON) for queryability and integrity
// 2. Phone/Email are separate types with different validation rules
// 3. Channel is only relevant for PHONE contacts
// 4. At least ONE phone is REQUIRED (business rule)

/**
 * Contact type enumeration - mirrors Prisma enum.
 * PHONE and EMAIL have different validation and behavior rules.
 */
export const ContactTypeSchema = z.enum(['PHONE', 'EMAIL']);
export type ContactType = z.infer<typeof ContactTypeSchema>;

/**
 * Phone channel enumeration - determines communication method.
 * Only applicable when contact type is PHONE.
 */
export const PhoneChannelSchema = z.enum(['REGULAR', 'WHATSAPP', 'VIBER', 'TELEGRAM']);
export type PhoneChannel = z.infer<typeof PhoneChannelSchema>;

/**
 * Supplier contact schema - represents a single contact entry.
 * 
 * INVARIANTS:
 * - Channels array is required for PHONE type (can have multiple), null for EMAIL
 * - Value must be valid phone format or email format based on type
 * - Only one primary contact per type per supplier
 */
export const SupplierContactSchema = z.object({
  id: z.string().uuid(),
  supplierId: z.string().uuid(),
  type: ContactTypeSchema,
  channels: z.array(PhoneChannelSchema).nullable(), // Only for PHONE type, multiple allowed
  value: z.string().min(1),
  isPrimary: z.boolean().default(false),
  createdAt: z.date(),
});
export type SupplierContact = z.infer<typeof SupplierContactSchema>;

/**
 * Full Supplier entity with all fields.
 */
export const SupplierSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  address: z.string().min(5, 'Address must be at least 5 characters'),
  website: z.string().url().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  contacts: z.array(SupplierContactSchema),
  operationId: z.string().nullable(),
});
export type Supplier = z.infer<typeof SupplierSchema>;

/**
 * Input for creating a new contact.
 * ID and timestamps are auto-generated.
 */
export const CreateSupplierContactSchema = z.object({
  type: ContactTypeSchema,
  channels: z.array(PhoneChannelSchema).nullable().optional(), // Multiple channels for PHONE
  value: z.string().min(1, 'Contact value is required'),
  isPrimary: z.boolean().default(false),
});
export type CreateSupplierContact = z.infer<typeof CreateSupplierContactSchema>;

/**
 * Input for creating a new supplier.
 * 
 * VALIDATION RULES (enforced at service layer):
 * - name: required, min 2 chars, trimmed
 * - address: required, min 5 chars
 * - website: optional, must be valid URL if present
 * - phones: at least one entry required, valid format
 * - emails: optional, valid format if present
 * - No duplicate contact values within same supplier
 */
export const CreateSupplierSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').transform(s => s.trim()),
  address: z.string().min(5, 'Address must be at least 5 characters'),
  website: z.string().url('Invalid URL format').optional().nullable().or(z.literal('')),
  phones: z.array(CreateSupplierContactSchema.extend({
    type: z.literal('PHONE'),
    // Multiple channels allowed per phone (e.g., both Regular and WhatsApp)
    channels: z.array(PhoneChannelSchema).min(1, 'At least one channel is required'),
  })).min(1, 'At least one phone number is required'),
  emails: z.array(CreateSupplierContactSchema.extend({
    type: z.literal('EMAIL'),
    channels: z.null().optional(), // Channels not used for emails
  })).optional().default([]),
});
export type CreateSupplier = z.infer<typeof CreateSupplierSchema>;

/**
 * Result of supplier creation operation.
 */
export interface CreateSupplierResult {
  success: boolean;
  supplier?: Supplier;
  operationId?: string;
  errors?: SupplierValidationError[];
}

/**
 * Validation error for supplier form.
 */
export interface SupplierValidationError {
  field: string;
  message: string;
  index?: number; // For array fields (phones, emails)
}

/**
 * Paginated list result for suppliers.
 */
export interface SupplierListResult {
  data: Supplier[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Query parameters for listing suppliers.
 */
export interface SupplierQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: 'name' | 'createdAt';
  sortDirection?: 'asc' | 'desc';
}

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
  { id: 'price', header: 'Prix', accessorKey: 'price', visible: true, sortable: true, filterable: true, width: 100 },
  { id: 'entryDate', header: 'Date', accessorKey: 'entryDate', visible: true, sortable: true, filterable: true },
];

// ===========================================
// PRODUCT COMPATIBILITY TYPES (RENVOI / ÉQUIVALENCE)
// ===========================================
// Compatible References feature for auto spare parts.
// 
// DESIGN PRINCIPLES:
// 1. Compatibility is EXPLICIT - never inferred heuristically
// 2. Compatibility is DIRECTIONAL - A → B does NOT imply B → A
// 3. Compatibility does NOT merge stock, pricing, or auto-sync
// 4. Every relation is auditable with full provenance
// 5. Soft-delete via isActive flag preserves audit trail

/**
 * Types of compatibility relationships between products.
 * 
 * EQUIVALENT: Functionally identical, fully interchangeable
 *   Example: Same part from OEM vs aftermarket
 * 
 * SUBSTITUTE: Can be used as replacement, may have minor differences
 *   Example: Different capacity filter that fits same vehicle
 * 
 * OEM_ALTERNATIVE: Alternative from different manufacturer, same specs
 *   Example: Bosch vs Denso spark plug for same engine
 */
export const CompatibilityRelationTypeSchema = z.enum([
  'EQUIVALENT',
  'SUBSTITUTE', 
  'OEM_ALTERNATIVE',
]);
export type CompatibilityRelationType = z.infer<typeof CompatibilityRelationTypeSchema>;

/**
 * Human-readable labels for compatibility relation types (French).
 */
export const COMPATIBILITY_RELATION_LABELS: Record<CompatibilityRelationType, string> = {
  EQUIVALENT: 'Équivalent',
  SUBSTITUTE: 'Substitut',
  OEM_ALTERNATIVE: 'Alternative OEM',
};

/**
 * Descriptions for each compatibility relation type.
 */
export const COMPATIBILITY_RELATION_DESCRIPTIONS: Record<CompatibilityRelationType, string> = {
  EQUIVALENT: 'Pièce identique, interchangeable à 100%',
  SUBSTITUTE: 'Peut remplacer avec de légères différences',
  OEM_ALTERNATIVE: 'Même spécifications, fabricant différent',
};

/**
 * Full ProductCompatibility entity as returned from the database.
 */
export const ProductCompatibilitySchema = z.object({
  id: z.string().uuid(),
  sourceProductId: z.string(),
  targetProductId: z.string(),
  relationType: CompatibilityRelationTypeSchema,
  note: z.string().nullable(),
  isActive: z.boolean().default(true),
  createdAt: z.date(),
  createdBy: z.string(),
  deactivatedAt: z.date().nullable(),
  deactivatedBy: z.string().nullable(),
  operationId: z.string().nullable(),
});
export type ProductCompatibility = z.infer<typeof ProductCompatibilitySchema>;

/**
 * Input for creating a new compatibility relation.
 * 
 * VALIDATION RULES (enforced at service layer):
 * - sourceProductId and targetProductId must be different
 * - Both products must exist in the database
 * - No duplicate relations (same source, target, and type)
 */
export const CreateCompatibilitySchema = z.object({
  sourceProductId: z.string().min(1, 'Source product ID is required'),
  targetProductId: z.string().min(1, 'Target product ID is required'),
  relationType: CompatibilityRelationTypeSchema,
  note: z.string().optional().nullable(),
});
export type CreateCompatibility = z.infer<typeof CreateCompatibilitySchema>;

/**
 * Result of compatibility creation operation.
 */
export interface CreateCompatibilityResult {
  success: boolean;
  compatibility?: ProductCompatibility;
  operationId?: string;
  error?: string;
}

/**
 * Result of compatibility removal operation (soft-delete).
 */
export interface RemoveCompatibilityResult {
  success: boolean;
  operationId?: string;
  error?: string;
}

/**
 * Extended compatibility info with resolved product details for display.
 * Used in the UI to show full reference information.
 */
export interface CompatibilityWithDetails {
  id: string;
  relationType: CompatibilityRelationType;
  note: string | null;
  createdAt: Date;
  createdBy: string;
  /** The target product's reference code */
  reference: string;
  /** The target product's designation/description */
  designation: string;
  /** The target product's brand */
  brand: string;
  /** The target product's supplier name */
  supplierName: string;
  /** The target product's current price (latest active entry) */
  price: number | null;
  /** The source product ID (for bi-directional display) */
  sourceProductId: string;
  /** The target product ID */
  targetProductId: string;
}

/**
 * Query parameters for listing compatibilities.
 */
export interface CompatibilityQueryParams {
  productId: string;
  /** Include incoming relations (where product is target) */
  includeIncoming?: boolean;
  /** Filter by relation type */
  relationType?: CompatibilityRelationType;
  /** Include inactive (soft-deleted) relations */
  includeInactive?: boolean;
}

/**
 * Result of compatibility search - products that can be added as compatible.
 */
export interface CompatibilitySearchResult {
  /** Product entry ID */
  id: string;
  reference: string;
  designation: string;
  brand: string;
  supplierName: string;
  price: number;
  /** Whether this product already has a compatibility relation with the source */
  hasExistingRelation: boolean;
  /** If hasExistingRelation, what type */
  existingRelationType?: CompatibilityRelationType;
}

/**
 * Summary statistics for a product's compatibility relations.
 */
export interface CompatibilitySummary {
  /** Total outgoing relations (this product → others) */
  outgoingCount: number;
  /** Total incoming relations (others → this product) */
  incomingCount: number;
  /** Count by relation type */
  byType: Record<CompatibilityRelationType, number>;
}

