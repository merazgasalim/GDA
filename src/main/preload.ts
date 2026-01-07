/**
 * Preload Script
 * ==============
 * Exposes a safe, typed API to the renderer process.
 * 
 * SECURITY PRINCIPLES (Electron Best Practices):
 * 1. contextIsolation: true - Renderer can't access Node.js
 * 2. nodeIntegration: false - No require() in renderer
 * 3. Only whitelisted APIs are exposed via contextBridge
 * 4. All exposed functions are wrappers around IPC
 * 
 * Reference: https://www.electronjs.org/docs/latest/tutorial/security
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type {
  QueryParams,
  CreatePriceEntry,
  ExportOptions,
} from '../shared/types';
import type { ElectronApi, ImportParseOptions } from '../shared/ipc-api';

// ===========================================
// API IMPLEMENTATION
// ===========================================

const electronApi: ElectronApi = {
  // ===========================================
  // DATABASE API
  // ===========================================
  database: {
    queryEntries: (params: QueryParams) =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_QUERY_ENTRIES, params),
    
    getEntry: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_GET_ENTRY, id),
    
    createEntry: (entry: CreatePriceEntry) =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_ENTRY, entry),
    
    createEntriesBatch: (entries: CreatePriceEntry[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_ENTRIES_BATCH, entries),
    
    getStats: () =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_GET_STATS),
    
    getDistinctValues: (column: string, search?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_GET_DISTINCT_VALUES, column, search),
  },

  // ===========================================
  // IMPORT API
  // ===========================================
  import: {
    parseClipboard: (rawText: string, options?: ImportParseOptions) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMPORT_PARSE_CLIPBOARD, rawText, options),
    
    execute: (rows: CreatePriceEntry[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMPORT_EXECUTE, rows),
    
    getHistory: (limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMPORT_GET_HISTORY, limit),
    
    // CSV Import (Two-Step Wizard)
    csvReadFile: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CSV_READ_FILE, filePath),
    
    csvParse: (content: string, options?: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CSV_PARSE, content, options),
    
    csvValidate: (parsedData: any, mapping: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CSV_VALIDATE, parsedData, mapping),
    
    csvExecute: (config: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CSV_EXECUTE, config),
    
    csvGetSuppliers: () =>
      ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CSV_GET_SUPPLIERS),
    
    csvAnalyzeDuplicates: (parsedData: any, mapping: any, supplierName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CSV_ANALYZE_DUPLICATES, parsedData, mapping, supplierName),
  },

  // ===========================================
  // SUPPLIER API (CORE DOMAIN)
  // ===========================================
  supplier: {
    create: (input: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_CREATE, input),
    
    getList: (params?: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_GET_LIST, params),
    
    update: (id: string, input: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_UPDATE, id, input),
    
    getById: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_GET_BY_ID, id),
    
    delete: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_DELETE, id),
    
    validate: (input: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_VALIDATE, input),
    
    search: (query: string, limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_SEARCH, query, limit),
    
    getPhonesByName: (supplierName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_GET_PHONES_BY_NAME, supplierName),
    countActiveProductsBySupplierName: (supplierName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUPPLIER_COUNT_ACTIVE_PRODUCTS, supplierName),
  },

  // ===========================================
  // PRODUCT COMPATIBILITY API (RENVOI / ÉQUIVALENCE)
  // ===========================================
  // Compatible References feature for auto spare parts.
  // Explicit, searchable, auditable compatibility tracking.
  compatibility: {
    getForProduct: (params: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_GET_FOR_PRODUCT, params),
    
    add: (input: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_ADD, input),
    
    remove: (compatibilityId: string, reason?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_REMOVE, compatibilityId, reason),
    
    searchProducts: (sourceProductId: string, query: string, limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_SEARCH_PRODUCTS, sourceProductId, query, limit),
    
    getSummary: (productId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_GET_SUMMARY, productId),
    
    checkExists: (sourceProductId: string, targetProductId: string, relationType?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_CHECK_EXISTS, sourceProductId, targetProductId, relationType),
    
    getBulkCounts: (productIds: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_GET_BULK_COUNTS, productIds),
    findExternalMatch: (reference: string, brand: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_FIND_EXTERNAL, reference, brand),
    convertExternal: (externalReferenceId: string, newProductId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.COMPATIBILITY_CONVERT_EXTERNAL, externalReferenceId, newProductId),
  },

  // ===========================================
  // EXPORT API
  // ===========================================
  export: {
    csv: (options: ExportOptions) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXPORT_CSV, options),
    
    xlsx: (options: ExportOptions) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXPORT_XLSX, options),
    
    checkPermission: () =>
      ipcRenderer.invoke(IPC_CHANNELS.EXPORT_CHECK_PERMISSION),
  },

  // ===========================================
  // LICENSE API
  // ===========================================
  license: {
    getStatus: () =>
      ipcRenderer.invoke(IPC_CHANNELS.LICENSE_GET_STATUS),
    
    activate: (licenseKey: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.LICENSE_ACTIVATE, licenseKey),
    
    deactivate: () =>
      ipcRenderer.invoke(IPC_CHANNELS.LICENSE_DEACTIVATE),
    
    getMachineId: () =>
      ipcRenderer.invoke(IPC_CHANNELS.LICENSE_GET_MACHINE_ID),
    
    validate: () =>
      ipcRenderer.invoke(IPC_CHANNELS.LICENSE_VALIDATE),
  },

  // ===========================================
  // APP API
  // ===========================================
  app: {
    getState: () =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_GET_STATE),
    
    getVersion: () =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
    
    minimize: () =>
      ipcRenderer.send(IPC_CHANNELS.APP_MINIMIZE),
    
    maximize: () =>
      ipcRenderer.send(IPC_CHANNELS.APP_MAXIMIZE),
    
    close: () =>
      ipcRenderer.send(IPC_CHANNELS.APP_CLOSE),
  },

  // ===========================================
  // SETTINGS API
  // ===========================================
  settings: {
    get: (key: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, key),
    
    set: (key: string, value: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
    
    getColumns: () =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_COLUMNS),
    
    setColumns: (columns: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET_COLUMNS, columns),
  },

  // ===========================================
  // DIALOG API
  // ===========================================
  dialog: {
    saveFile: (options: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, options),
    
    openFile: (options: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE, options),
    
    showMessage: (options: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SHOW_MESSAGE, options),
  },

  // ===========================================
  // OPERATIONS LOG API
  // ===========================================
  operations: {
    getList: (page?: number, pageSize?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPERATIONS_GET_LIST, page, pageSize),
    
    getById: (operationId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPERATIONS_GET_BY_ID, operationId),
    
    abandon: (operationId: string, reason?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPERATIONS_ABANDON, operationId, reason),
    
    getIncomplete: () =>
      ipcRenderer.invoke(IPC_CHANNELS.OPERATIONS_GET_INCOMPLETE),
    
    finalizePending: (operationId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPERATIONS_FINALIZE_PENDING, operationId),
    
    abandonPending: (operationId: string, reason?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPERATIONS_ABANDON_PENDING, operationId, reason),
    
    getStats: () =>
      ipcRenderer.invoke(IPC_CHANNELS.OPERATIONS_GET_STATS),
  },
};

// ===========================================
// EXPOSE TO RENDERER
// ===========================================

// contextBridge.exposeInMainWorld creates a secure bridge
// The renderer can access window.electronApi but cannot:
// - Access Node.js APIs
// - Modify the exposed API
// - Access IPC directly
contextBridge.exposeInMainWorld('electronApi', electronApi);
