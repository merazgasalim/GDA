"use strict";
const electron = require("electron");
const IPC_CHANNELS = {
  // ===========================================
  // DATABASE OPERATIONS
  // ===========================================
  DB_QUERY_ENTRIES: "db:query-entries",
  DB_GET_ENTRY: "db:get-entry",
  DB_CREATE_ENTRY: "db:create-entry",
  DB_CREATE_ENTRIES_BATCH: "db:create-entries-batch",
  DB_GET_STATS: "db:get-stats",
  DB_GET_DISTINCT_VALUES: "db:get-distinct-values",
  // ===========================================
  // OPERATIONS LOG
  // ===========================================
  // The Operations Log system provides full auditability and safe abandonment.
  // See src/main/services/operation-service.ts for design rationale.
  OPERATIONS_GET_LIST: "operations:get-list",
  OPERATIONS_GET_BY_ID: "operations:get-by-id",
  OPERATIONS_ABANDON: "operations:abandon",
  OPERATIONS_GET_INCOMPLETE: "operations:get-incomplete",
  OPERATIONS_FINALIZE_PENDING: "operations:finalize-pending",
  OPERATIONS_ABANDON_PENDING: "operations:abandon-pending",
  OPERATIONS_GET_STATS: "operations:get-stats",
  // ===========================================
  // IMPORT OPERATIONS
  // ===========================================
  IMPORT_PARSE_CLIPBOARD: "import:parse-clipboard",
  IMPORT_EXECUTE: "import:execute",
  IMPORT_GET_HISTORY: "import:get-history",
  // CSV Import (Two-Step Wizard)
  IMPORT_CSV_READ_FILE: "import:csv-read-file",
  IMPORT_CSV_PARSE: "import:csv-parse",
  IMPORT_CSV_VALIDATE: "import:csv-validate",
  IMPORT_CSV_EXECUTE: "import:csv-execute",
  IMPORT_CSV_GET_SUPPLIERS: "import:csv-get-suppliers",
  IMPORT_CSV_ANALYZE_DUPLICATES: "import:csv-analyze-duplicates",
  // ===========================================
  // SUPPLIER OPERATIONS (CORE DOMAIN)
  // ===========================================
  // Supplier management for the normalized supplier entity.
  // See src/main/services/supplier-service.ts for implementation.
  SUPPLIER_CREATE: "supplier:create",
  SUPPLIER_GET_LIST: "supplier:get-list",
  SUPPLIER_GET_BY_ID: "supplier:get-by-id",
  SUPPLIER_UPDATE: "supplier:update",
  SUPPLIER_DELETE: "supplier:delete",
  SUPPLIER_VALIDATE: "supplier:validate",
  SUPPLIER_SEARCH: "supplier:search",
  SUPPLIER_GET_PHONES_BY_NAME: "supplier:get-phones-by-name",
  SUPPLIER_COUNT_ACTIVE_PRODUCTS: "supplier:count-active-products",
  // ===========================================
  // PRODUCT COMPATIBILITY (RENVOI / ÉQUIVALENCE)
  // ===========================================
  // Compatible References feature for auto spare parts.
  // See src/main/services/compatibility-service.ts for implementation.
  COMPATIBILITY_GET_FOR_PRODUCT: "compatibility:get-for-product",
  COMPATIBILITY_ADD: "compatibility:add",
  COMPATIBILITY_REMOVE: "compatibility:remove",
  COMPATIBILITY_SEARCH_PRODUCTS: "compatibility:search-products",
  COMPATIBILITY_GET_SUMMARY: "compatibility:get-summary",
  COMPATIBILITY_GET_FOR_SOURCES: "compatibility:get-for-sources",
  COMPATIBILITY_CHECK_EXISTS: "compatibility:check-exists",
  COMPATIBILITY_GET_BULK_COUNTS: "compatibility:get-bulk-counts",
  COMPATIBILITY_FIND_EXTERNAL: "compatibility:find-external",
  COMPATIBILITY_CONVERT_EXTERNAL: "compatibility:convert-external",
  // ===========================================
  // EXPORT OPERATIONS (LICENSE REQUIRED)
  // ===========================================
  EXPORT_CSV: "export:csv",
  EXPORT_XLSX: "export:xlsx",
  EXPORT_CHECK_PERMISSION: "export:check-permission",
  // ===========================================
  // LICENSE OPERATIONS
  // ===========================================
  LICENSE_GET_STATUS: "license:get-status",
  LICENSE_ACTIVATE: "license:activate",
  LICENSE_DEACTIVATE: "license:deactivate",
  LICENSE_GET_MACHINE_ID: "license:get-machine-id",
  LICENSE_VALIDATE: "license:validate",
  // ===========================================
  // APP OPERATIONS
  // ===========================================
  APP_GET_STATE: "app:get-state",
  APP_GET_VERSION: "app:get-version",
  APP_MINIMIZE: "app:minimize",
  APP_MAXIMIZE: "app:maximize",
  APP_CLOSE: "app:close",
  // ===========================================
  // SETTINGS
  // ===========================================
  SETTINGS_GET: "settings:get",
  SETTINGS_SET: "settings:set",
  SETTINGS_GET_COLUMNS: "settings:get-columns",
  SETTINGS_SET_COLUMNS: "settings:set-columns",
  // ===========================================
  // DIALOGS
  // ===========================================
  DIALOG_SAVE_FILE: "dialog:save-file",
  DIALOG_OPEN_FILE: "dialog:open-file",
  DIALOG_SHOW_MESSAGE: "dialog:show-message"
};
const electronApi = {
  // ===========================================
  // DATABASE API
  // ===========================================
  database: {
    queryEntries: (params) => electron.ipcRenderer.invoke(IPC_CHANNELS.DB_QUERY_ENTRIES, params),
    getEntry: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.DB_GET_ENTRY, id),
    createEntry: (entry) => electron.ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_ENTRY, entry),
    createEntriesBatch: (entries) => electron.ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_ENTRIES_BATCH, entries),
    getStats: () => electron.ipcRenderer.invoke(IPC_CHANNELS.DB_GET_STATS),
    getDistinctValues: (column, search) => electron.ipcRenderer.invoke(IPC_CHANNELS.DB_GET_DISTINCT_VALUES, column, search)
  },
  // ===========================================
  // IMPORT API
  // ===========================================
  import: {
    parseClipboard: (rawText, options) => electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_PARSE_CLIPBOARD, rawText, options),
    execute: (rows) => electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_EXECUTE, rows),
    getHistory: (limit) => electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_GET_HISTORY, limit),
    // CSV Import (Two-Step Wizard)
    csvReadFile: (filePath) => electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CSV_READ_FILE, filePath),
    csvParse: (content, options) => electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CSV_PARSE, content, options),
    csvValidate: (parsedData, mapping) => electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CSV_VALIDATE, parsedData, mapping),
    csvExecute: (config) => electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CSV_EXECUTE, config),
    csvGetSuppliers: () => electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CSV_GET_SUPPLIERS),
    csvAnalyzeDuplicates: (parsedData, mapping, supplierName) => electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CSV_ANALYZE_DUPLICATES, parsedData, mapping, supplierName)
  },
  // ===========================================
  // SUPPLIER API (CORE DOMAIN)
  // ===========================================
  supplier: {
    create: (input) => electron.ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_CREATE, input),
    getList: (params) => electron.ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_GET_LIST, params),
    update: (id, input) => electron.ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_UPDATE, id, input),
    getById: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_GET_BY_ID, id),
    delete: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_DELETE, id),
    validate: (input) => electron.ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_VALIDATE, input),
    search: (query, limit) => electron.ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_SEARCH, query, limit),
    getPhonesByName: (supplierName) => electron.ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_GET_PHONES_BY_NAME, supplierName),
    countActiveProductsBySupplierName: (supplierName) => electron.ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_COUNT_ACTIVE_PRODUCTS, supplierName)
  },
  // ===========================================
  // PRODUCT COMPATIBILITY API (RENVOI / ÉQUIVALENCE)
  // ===========================================
  // Compatible References feature for auto spare parts.
  // Explicit, searchable, auditable compatibility tracking.
  compatibility: {
    getForProduct: (params) => electron.ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_GET_FOR_PRODUCT, params),
    getForSources: (productIds) => electron.ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_GET_FOR_SOURCES, productIds),
    add: (input) => electron.ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_ADD, input),
    remove: (compatibilityId, reason) => electron.ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_REMOVE, compatibilityId, reason),
    searchProducts: (sourceProductId, query, limit) => electron.ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_SEARCH_PRODUCTS, sourceProductId, query, limit),
    getSummary: (productId) => electron.ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_GET_SUMMARY, productId),
    checkExists: (sourceProductId, targetProductId, relationType) => electron.ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_CHECK_EXISTS, sourceProductId, targetProductId, relationType),
    getBulkCounts: (productIds) => electron.ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_GET_BULK_COUNTS, productIds),
    findExternalMatch: (reference, brand) => electron.ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_FIND_EXTERNAL, reference, brand),
    convertExternal: (externalReferenceId, newProductId) => electron.ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_CONVERT_EXTERNAL, externalReferenceId, newProductId)
  },
  // ===========================================
  // EXPORT API
  // ===========================================
  export: {
    csv: (options) => electron.ipcRenderer.invoke(IPC_CHANNELS.EXPORT_CSV, options),
    xlsx: (options) => electron.ipcRenderer.invoke(IPC_CHANNELS.EXPORT_XLSX, options),
    checkPermission: () => electron.ipcRenderer.invoke(IPC_CHANNELS.EXPORT_CHECK_PERMISSION)
  },
  // ===========================================
  // LICENSE API
  // ===========================================
  license: {
    getStatus: () => electron.ipcRenderer.invoke(IPC_CHANNELS.LICENSE_GET_STATUS),
    activate: (licenseKey) => electron.ipcRenderer.invoke(IPC_CHANNELS.LICENSE_ACTIVATE, licenseKey),
    deactivate: () => electron.ipcRenderer.invoke(IPC_CHANNELS.LICENSE_DEACTIVATE),
    getMachineId: () => electron.ipcRenderer.invoke(IPC_CHANNELS.LICENSE_GET_MACHINE_ID),
    validate: () => electron.ipcRenderer.invoke(IPC_CHANNELS.LICENSE_VALIDATE)
  },
  // ===========================================
  // APP API
  // ===========================================
  app: {
    getState: () => electron.ipcRenderer.invoke(IPC_CHANNELS.APP_GET_STATE),
    getVersion: () => electron.ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
    minimize: () => electron.ipcRenderer.send(IPC_CHANNELS.APP_MINIMIZE),
    maximize: () => electron.ipcRenderer.send(IPC_CHANNELS.APP_MAXIMIZE),
    close: () => electron.ipcRenderer.send(IPC_CHANNELS.APP_CLOSE)
  },
  // ===========================================
  // SETTINGS API
  // ===========================================
  settings: {
    get: (key) => electron.ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, key),
    set: (key, value) => electron.ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
    getColumns: () => electron.ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_COLUMNS),
    setColumns: (columns) => electron.ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET_COLUMNS, columns)
  },
  // ===========================================
  // DIALOG API
  // ===========================================
  dialog: {
    saveFile: (options) => electron.ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, options),
    openFile: (options) => electron.ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE, options),
    showMessage: (options) => electron.ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SHOW_MESSAGE, options)
  },
  // ===========================================
  // OPERATIONS LOG API
  // ===========================================
  operations: {
    getList: (page, pageSize) => electron.ipcRenderer.invoke(IPC_CHANNELS.OPERATIONS_GET_LIST, page, pageSize),
    getById: (operationId) => electron.ipcRenderer.invoke(IPC_CHANNELS.OPERATIONS_GET_BY_ID, operationId),
    abandon: (operationId, reason) => electron.ipcRenderer.invoke(IPC_CHANNELS.OPERATIONS_ABANDON, operationId, reason),
    getIncomplete: () => electron.ipcRenderer.invoke(IPC_CHANNELS.OPERATIONS_GET_INCOMPLETE),
    finalizePending: (operationId) => electron.ipcRenderer.invoke(IPC_CHANNELS.OPERATIONS_FINALIZE_PENDING, operationId),
    abandonPending: (operationId, reason) => electron.ipcRenderer.invoke(IPC_CHANNELS.OPERATIONS_ABANDON_PENDING, operationId, reason),
    getStats: () => electron.ipcRenderer.invoke(IPC_CHANNELS.OPERATIONS_GET_STATS)
  }
};
electron.contextBridge.exposeInMainWorld("electronApi", electronApi);
