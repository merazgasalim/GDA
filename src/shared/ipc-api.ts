/**
 * IPC API Type Definitions
 * ========================
 * Defines the typed contract between main and renderer processes.
 * This file is used to generate the preload API and ensure type safety.
 */

import type {
  PriceEntry,
  CreatePriceEntry,
  QueryParams,
  PaginatedResult,
  ImportPreview,
  ImportResult,
  ExportOptions,
  ExportResult,
  LicenseStatus,
  ColumnConfig,
  AppState,
  OperationLogDisplay,
  AbandonOperationResult,
  IncompleteOperation,
  CSVParsedData,
  CSVColumnMapping,
  CSVImportConfig,
  CSVImportResult,
  CSVImportPreview,
  CSVFileReadResult,
  DuplicateAnalysisResult,
  // Supplier types
  CreateSupplier,
  CreateSupplierResult,
  Supplier,
  SupplierListResult,
  SupplierQueryParams,
  SupplierValidationError,
  // Compatibility types
  CreateCompatibility,
  CreateCompatibilityResult,
  RemoveCompatibilityResult,
  CompatibilityWithDetails,
  CompatibilityQueryParams,
  CompatibilitySearchResult,
  CompatibilitySummary,
  CompatibilityRelationType,
} from './types';

// ===========================================
// DATABASE API
// ===========================================

export interface DatabaseApi {
  queryEntries: (params: QueryParams) => Promise<PaginatedResult<PriceEntry>>;
  getEntry: (id: string) => Promise<PriceEntry | null>;
  createEntry: (entry: CreatePriceEntry) => Promise<PriceEntry>;
  createEntriesBatch: (entries: CreatePriceEntry[]) => Promise<{ count: number; batchId: string }>;
  getStats: () => Promise<DatabaseStats>;
  getDistinctValues: (column: string, search?: string) => Promise<string[]>;
}

export interface DatabaseStats {
  totalEntries: number;
  uniqueReferences: number;
  uniqueSuppliers: number;
  uniqueBrands: number;
  lastEntryDate: string | null;
  oldestEntryDate: string | null;
}

// ===========================================
// OPERATIONS LOG API
// ===========================================
/**
 * Operations Log API for full auditability and safe abandonment.
 * 
 * SECURITY: abandonOperation requires a valid license.
 * See src/main/services/operation-service.ts for implementation details.
 */
export interface OperationsApi {
  /**
   * Get paginated list of operations for the Operations Log screen.
   * @param page - Page number (1-based)
   * @param pageSize - Number of operations per page
   */
  getList: (page?: number, pageSize?: number) => Promise<OperationListResult>;
  
  /**
   * Get a single operation by ID.
   */
  getById: (operationId: string) => Promise<OperationLogDisplay | null>;
  
  /**
   * Abandon an operation (LICENSE REQUIRED).
   * This marks the operation as ABANDONED and soft-deletes all related records.
   * NO DATA IS DELETED - records are marked as is_active=false.
   * 
   * @param operationId - The operation to abandon
   * @param reason - Optional reason for the abandonment (for audit trail)
   */
  abandon: (operationId: string, reason?: string) => Promise<AbandonOperationResult>;
  
  /**
   * Get incomplete operations that need user resolution (crash recovery).
   */
  getIncomplete: () => Promise<IncompleteOperation[]>;
  
  /**
   * Finalize a pending operation (mark as COMPLETED).
   * Used when user confirms crashed operation's data is valid.
   */
  finalizePending: (operationId: string) => Promise<boolean>;
  
  /**
   * Abandon a pending operation.
   * Used when user wants to discard crashed operation's data.
   */
  abandonPending: (operationId: string, reason?: string) => Promise<AbandonOperationResult>;
  
  /**
   * Get operation statistics.
   */
  getStats: () => Promise<OperationStats>;
}

export interface OperationListResult {
  data: OperationLogDisplay[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface OperationStats {
  totalOperations: number;
  completedOperations: number;
  abandonedOperations: number;
  pendingOperations: number;
  failedOperations: number;
}

// ===========================================
// IMPORT API
// ===========================================

export interface ImportApi {
  parseClipboard: (rawText: string, options?: ImportParseOptions) => Promise<ImportPreview>;
  execute: (rows: CreatePriceEntry[]) => Promise<ImportResult>;
  getHistory: (limit?: number) => Promise<ImportLogEntry[]>;
  
  // CSV Import (Two-Step Wizard)
  csvReadFile: (filePath: string) => Promise<CSVFileReadResult>;
  csvParse: (content: string, options?: CSVParseOptions) => Promise<CSVParseResult>;
  csvValidate: (parsedData: CSVParsedData, mapping: CSVColumnMapping) => Promise<CSVImportPreview>;
  csvAnalyzeDuplicates: (parsedData: CSVParsedData, mapping: CSVColumnMapping, supplierName: string) => Promise<DuplicateAnalysisResult>;
  csvExecute: (config: CSVImportConfig) => Promise<CSVImportResult>;
  csvGetSuppliers: () => Promise<string[]>;
}

export interface CSVParseOptions {
  delimiter?: string;
  hasHeader?: boolean;
  filename?: string;
}

export interface CSVParseResult {
  parsedData: CSVParsedData;
  suggestedMapping: CSVColumnMapping;
}

export interface ImportParseOptions {
  delimiter?: string; // Auto-detect by default
  hasHeader?: boolean;
  columnMapping?: Record<string, string>;
}

export interface ImportLogEntry {
  id: string;
  batchId: string;
  rowCount: number;
  importedAt: string;
  status: 'completed' | 'partial' | 'failed';
  errorMessage?: string;
}

// ===========================================
// SUPPLIER API (CORE DOMAIN)
// ===========================================
/**
 * Supplier API for managing normalized supplier entities.
 * 
 * Suppliers are core domain objects used across:
 * - Imports (linking price entries)
 * - Pricing history
 * - Provenance tracking
 * - Audit logs
 */
export interface SupplierApi {
  /**
   * Create a new supplier with contacts.
   * Validates all fields and persists in a transaction.
   * Creates an OperationLog entry for audit trail.
   */
  create: (input: CreateSupplier) => Promise<CreateSupplierResult>;
  
  /**
   * Get paginated list of suppliers.
   */
  getList: (params?: SupplierQueryParams) => Promise<SupplierListResult>;
  
  /**
   * Get a single supplier by ID.
   */
  getById: (id: string) => Promise<Supplier | null>;
  
  /**
   * Delete a supplier (cascades to contacts).
   * Returns true if deleted, false if not found.
   */
  delete: (id: string) => Promise<boolean>;
  
  /**
   * Validate supplier input without persisting.
   * Returns validation errors if any.
   */
  validate: (input: CreateSupplier) => Promise<{
    isValid: boolean;
    errors: SupplierValidationError[];
  }>;
  
  /**
   * Search suppliers by name (for autocomplete).
   */
  search: (query: string, limit?: number) => Promise<Supplier[]>;
  
  /**
   * Get phone numbers for a supplier by name.
   * Used to show additional phone numbers in the data grid.
   */
  getPhonesByName: (supplierName: string) => Promise<SupplierPhoneInfo[]>;
}

/**
 * Phone information for a supplier.
 */
export interface SupplierPhoneInfo {
  value: string;
  isPrimary: boolean;
  channels: string[] | null;
}

// ===========================================
// PRODUCT COMPATIBILITY API (RENVOI / ÉQUIVALENCE)
// ===========================================
/**
 * Compatibility API for managing product reference relationships.
 * 
 * This is a CORE business feature for auto spare parts:
 * - Explicit, searchable, auditable compatibility tracking
 * - Directional relations (A → B does NOT imply B → A)
 * - Does NOT merge stock, pricing, or auto-sync data
 * 
 * See src/main/services/compatibility-service.ts for implementation.
 */
export interface CompatibilityApi {
  /**
   * Get all compatibility relations for a product.
   * Returns outgoing relations by default, can include incoming.
   * 
   * @param params - Query parameters including productId
   */
  getForProduct: (params: CompatibilityQueryParams) => Promise<CompatibilityWithDetails[]>;
  
  /**
   * Add a new compatibility relation between two products.
   * Creates an OperationLog entry for audit trail.
   * 
   * @param input - Compatibility creation input
   */
  add: (input: CreateCompatibility) => Promise<CreateCompatibilityResult>;
  
  /**
   * Remove a compatibility relation (soft-delete).
   * Preserves audit trail via isActive flag.
   * 
   * @param compatibilityId - ID of the relation to remove
   * @param reason - Optional reason for removal (for audit)
   */
  remove: (compatibilityId: string, reason?: string) => Promise<RemoveCompatibilityResult>;
  
  /**
   * Search for products that can be added as compatible references.
   * Searches by reference, designation, or brand.
   * Indicates if products already have a relation with source.
   * 
   * @param sourceProductId - Source product to find compatibles for
   * @param query - Search query string
   * @param limit - Maximum results (default: 20)
   */
  searchProducts: (
    sourceProductId: string,
    query: string,
    limit?: number
  ) => Promise<CompatibilitySearchResult[]>;
  
  /**
   * Get compatibility summary statistics for a product.
   * 
   * @param productId - Product to get summary for
   */
  getSummary: (productId: string) => Promise<CompatibilitySummary>;
  
  /**
   * Check if a specific compatibility relation exists.
   * 
   * @param sourceProductId - Source product ID
   * @param targetProductId - Target product ID  
   * @param relationType - Type of relation (optional)
   */
  checkExists: (
    sourceProductId: string,
    targetProductId: string,
    relationType?: CompatibilityRelationType
  ) => Promise<boolean>;
  
  /**
   * Get compatibility counts for multiple products in bulk.
   * Returns a map of productId to total count of compatibilities.
   * 
   * @param productIds - Array of product IDs to get counts for
   * @returns Object map of productId to count
   */
  getBulkCounts: (productIds: string[]) => Promise<Record<string, number>>;
}

// ===========================================
// EXPORT API
// ===========================================

export interface ExportApi {
  csv: (options: ExportOptions) => Promise<ExportResult>;
  xlsx: (options: ExportOptions) => Promise<ExportResult>;
  checkPermission: () => Promise<{ allowed: boolean; reason?: string }>;
}

// ===========================================
// LICENSE API
// ===========================================

export interface LicenseApi {
  getStatus: () => Promise<LicenseStatus>;
  activate: (licenseKey: string) => Promise<LicenseActivationResult>;
  deactivate: () => Promise<{ success: boolean }>;
  getMachineId: () => Promise<string>;
  validate: () => Promise<LicenseStatus>;
}

export interface LicenseActivationResult {
  success: boolean;
  status?: LicenseStatus;
  error?: string;
}

// ===========================================
// APP API
// ===========================================

export interface AppApi {
  getState: () => Promise<AppState>;
  getVersion: () => Promise<string>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
}

// ===========================================
// SETTINGS API
// ===========================================

export interface SettingsApi {
  get: <T>(key: string) => Promise<T | null>;
  set: <T>(key: string, value: T) => Promise<void>;
  getColumns: () => Promise<ColumnConfig[]>;
  setColumns: (columns: ColumnConfig[]) => Promise<void>;
}

// ===========================================
// DIALOG API
// ===========================================

export interface DialogApi {
  saveFile: (options: SaveDialogOptions) => Promise<string | null>;
  openFile: (options: OpenDialogOptions) => Promise<string | null>;
  showMessage: (options: MessageDialogOptions) => Promise<number>;
}

export interface SaveDialogOptions {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}

export interface OpenDialogOptions {
  filters?: { name: string; extensions: string[] }[];
  title?: string;
  multiSelections?: boolean;
}

export interface MessageDialogOptions {
  type: 'none' | 'info' | 'error' | 'question' | 'warning';
  title: string;
  message: string;
  buttons?: string[];
  defaultId?: number;
}

// ===========================================
// COMBINED ELECTRON API
// ===========================================

export interface ElectronApi {
  database: DatabaseApi;
  import: ImportApi;
  export: ExportApi;
  license: LicenseApi;
  app: AppApi;
  settings: SettingsApi;
  dialog: DialogApi;
  operations: OperationsApi;
  supplier: SupplierApi;
  compatibility: CompatibilityApi;
}

// Declare global window type extension
declare global {
  interface Window {
    electronApi: ElectronApi;
  }
}
