/**
 * IPC Channel Definitions
 * =======================
 * Centralized IPC channel names to ensure type safety
 * and prevent typos across main and renderer processes.
 * 
 * SECURITY NOTE: All IPC handlers in main process MUST:
 * 1. Validate input using Zod schemas
 * 2. Check license permissions before privileged operations
 * 3. Never expose sensitive data (keys, full license payload)
 */

export const IPC_CHANNELS = {
  // ===========================================
  // DATABASE OPERATIONS
  // ===========================================
  DB_QUERY_ENTRIES: 'db:query-entries',
  DB_GET_ENTRY: 'db:get-entry',
  DB_CREATE_ENTRY: 'db:create-entry',
  DB_CREATE_ENTRIES_BATCH: 'db:create-entries-batch',
  DB_GET_STATS: 'db:get-stats',
  DB_GET_DISTINCT_VALUES: 'db:get-distinct-values',

  // ===========================================
  // OPERATIONS LOG
  // ===========================================
  // The Operations Log system provides full auditability and safe abandonment.
  // See src/main/services/operation-service.ts for design rationale.
  OPERATIONS_GET_LIST: 'operations:get-list',
  OPERATIONS_GET_BY_ID: 'operations:get-by-id',
  OPERATIONS_ABANDON: 'operations:abandon',
  OPERATIONS_GET_INCOMPLETE: 'operations:get-incomplete',
  OPERATIONS_FINALIZE_PENDING: 'operations:finalize-pending',
  OPERATIONS_ABANDON_PENDING: 'operations:abandon-pending',
  OPERATIONS_GET_STATS: 'operations:get-stats',

  // ===========================================
  // IMPORT OPERATIONS
  // ===========================================
  IMPORT_PARSE_CLIPBOARD: 'import:parse-clipboard',
  IMPORT_PREVIEW: 'import:preview',
  IMPORT_EXECUTE: 'import:execute',
  IMPORT_GET_HISTORY: 'import:get-history',
  
  // CSV Import (Two-Step Wizard)
  IMPORT_CSV_READ_FILE: 'import:csv-read-file',
  IMPORT_CSV_PARSE: 'import:csv-parse',
  IMPORT_CSV_VALIDATE: 'import:csv-validate',
  IMPORT_CSV_EXECUTE: 'import:csv-execute',
  IMPORT_CSV_GET_SUPPLIERS: 'import:csv-get-suppliers',
  IMPORT_CSV_ANALYZE_DUPLICATES: 'import:csv-analyze-duplicates',

  // ===========================================
  // SUPPLIER OPERATIONS (CORE DOMAIN)
  // ===========================================
  // Supplier management for the normalized supplier entity.
  // See src/main/services/supplier-service.ts for implementation.
  SUPPLIER_CREATE: 'supplier:create',
  SUPPLIER_GET_LIST: 'supplier:get-list',
  SUPPLIER_GET_BY_ID: 'supplier:get-by-id',
  SUPPLIER_UPDATE: 'supplier:update',
  SUPPLIER_DELETE: 'supplier:delete',
  SUPPLIER_VALIDATE: 'supplier:validate',
  SUPPLIER_SEARCH: 'supplier:search',
  SUPPLIER_GET_PHONES_BY_NAME: 'supplier:get-phones-by-name',
  SUPPLIER_COUNT_ACTIVE_PRODUCTS: 'supplier:count-active-products',

  // ===========================================
  // PRODUCT COMPATIBILITY (RENVOI / ÉQUIVALENCE)
  // ===========================================
  // Compatible References feature for auto spare parts.
  // See src/main/services/compatibility-service.ts for implementation.
  COMPATIBILITY_GET_FOR_PRODUCT: 'compatibility:get-for-product',
  COMPATIBILITY_ADD: 'compatibility:add',
  COMPATIBILITY_REMOVE: 'compatibility:remove',
  COMPATIBILITY_SEARCH_PRODUCTS: 'compatibility:search-products',
  COMPATIBILITY_GET_SUMMARY: 'compatibility:get-summary',
  COMPATIBILITY_GET_FOR_SOURCES: 'compatibility:get-for-sources',
  COMPATIBILITY_CHECK_EXISTS: 'compatibility:check-exists',
  COMPATIBILITY_GET_BULK_COUNTS: 'compatibility:get-bulk-counts',
  COMPATIBILITY_FIND_EXTERNAL: 'compatibility:find-external',
  COMPATIBILITY_CONVERT_EXTERNAL: 'compatibility:convert-external',

  // ===========================================
  // EXPORT OPERATIONS (LICENSE REQUIRED)
  // ===========================================
  EXPORT_CSV: 'export:csv',
  EXPORT_XLSX: 'export:xlsx',
  EXPORT_CHECK_PERMISSION: 'export:check-permission',

  // ===========================================
  // LICENSE OPERATIONS
  // ===========================================
  LICENSE_GET_STATUS: 'license:get-status',
  LICENSE_ACTIVATE: 'license:activate',
  LICENSE_DEACTIVATE: 'license:deactivate',
  LICENSE_GET_MACHINE_ID: 'license:get-machine-id',
  LICENSE_VALIDATE: 'license:validate',

  // ===========================================
  // APP OPERATIONS
  // ===========================================
  APP_GET_STATE: 'app:get-state',
  APP_GET_VERSION: 'app:get-version',
  APP_MINIMIZE: 'app:minimize',
  APP_MAXIMIZE: 'app:maximize',
  APP_CLOSE: 'app:close',

  // ===========================================
  // SETTINGS
  // ===========================================
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_COLUMNS: 'settings:get-columns',
  SETTINGS_SET_COLUMNS: 'settings:set-columns',

  // ===========================================
  // DIALOGS
  // ===========================================
  DIALOG_SAVE_FILE: 'dialog:save-file',
  DIALOG_OPEN_FILE: 'dialog:open-file',
  DIALOG_SHOW_MESSAGE: 'dialog:show-message',
} as const;

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
