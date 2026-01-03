/**
 * IPC Handlers
 * ============
 * Registers all IPC handlers for main process.
 * 
 * SECURITY PRINCIPLES:
 * 1. All inputs are validated using Zod schemas
 * 2. Permissions are checked before privileged operations
 * 3. Errors are sanitized before sending to renderer
 * 4. No sensitive data (keys, internal state) is exposed
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import {
  QueryParamsSchema,
  CreatePriceEntrySchema,
  ExportOptionsSchema,
  CreateSupplierSchema,
} from '../shared/types';
import {
  queryEntries,
  getEntry,
  createEntry,
  createEntriesBatch,
  getStats,
  getDistinctValues,
} from './services/database-service';
import {
  parseClipboardText,
  executeImport,
  getImportHistoryService,
  readCSVFile,
  parseCSV,
  validateCSVImport,
  getSuggestedMapping,
  getDefaultMapping,
  getExistingSuppliers,
  executeCSVImport,
  analyzeForDuplicates,
} from './services/import-service';
import {
  exportToCsv,
  exportToXlsx,
  checkExportPermission,
} from './services/export-service';
import {
  getLicenseStatus,
  activateLicense,
  deactivateLicense,
  getMachineIdForDisplay,
  validateLicense,
} from './services/license-service';
import {
  getOperations,
  getOperationById,
  abandonOperation,
  findIncompleteOperations,
  finalizePendingOperation,
  abandonPendingOperation,
  getOperationStats,
} from './services/operation-service';
import {
  createSupplier,
  listSuppliers,
  getSupplierById,
  deleteSupplier,
  validateSupplierInput,
  searchSuppliers,
  getSupplierPhonesByName,
} from './services/supplier-service';

// ===========================================
// ERROR HANDLING UTILITY
// ===========================================

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    // Don't expose stack traces in production
    return error.message;
  }
  return 'An unexpected error occurred';
}

function wrapHandler<T>(
  handler: () => Promise<T>
): () => Promise<{ success: true; data: T } | { success: false; error: string }> {
  return async () => {
    try {
      const data = await handler();
      return { success: true, data };
    } catch (error) {
      console.error('IPC Handler Error:', error);
      return { success: false, error: sanitizeError(error) };
    }
  };
}

// ===========================================
// REGISTER ALL HANDLERS
// ===========================================

export function registerIpcHandlers(mainWindow: BrowserWindow | null): void {
  // ===========================================
  // DATABASE HANDLERS
  // ===========================================

  ipcMain.handle(IPC_CHANNELS.DB_QUERY_ENTRIES, async (_event, params) => {
    try {
      const validatedParams = QueryParamsSchema.parse(params);
      return await queryEntries(validatedParams);
    } catch (error) {
      console.error('Query entries error:', error);
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.DB_GET_ENTRY, async (_event, id: string) => {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('Invalid entry ID');
      }
      return await getEntry(id);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_ENTRY, async (_event, data) => {
    try {
      const validatedData = CreatePriceEntrySchema.parse(data);
      return await createEntry(validatedData);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_ENTRIES_BATCH, async (_event, entries) => {
    try {
      if (!Array.isArray(entries)) {
        throw new Error('Entries must be an array');
      }
      const validatedEntries = entries.map((e) => CreatePriceEntrySchema.parse(e));
      const batchId = crypto.randomUUID();
      const result = await createEntriesBatch(validatedEntries, batchId);
      return { ...result, batchId };
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.DB_GET_STATS, async () => {
    try {
      return await getStats();
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.DB_GET_DISTINCT_VALUES, async (_event, column: string, search?: string) => {
    try {
      const validColumns = ['reference', 'brand', 'supplierName', 'designation'];
      if (!validColumns.includes(column)) {
        throw new Error('Invalid column');
      }
      return await getDistinctValues(column as any, search);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  // ===========================================
  // IMPORT HANDLERS
  // ===========================================

  ipcMain.handle(IPC_CHANNELS.IMPORT_PARSE_CLIPBOARD, async (_event, rawText: string, options) => {
    try {
      if (typeof rawText !== 'string') {
        throw new Error('Invalid input');
      }
      return parseClipboardText(rawText, options);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_EXECUTE, async (_event, rows) => {
    try {
      if (!Array.isArray(rows)) {
        throw new Error('Rows must be an array');
      }
      return await executeImport(rows);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_GET_HISTORY, async (_event, limit?: number) => {
    try {
      return await getImportHistoryService(limit);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  // ===========================================
  // CSV IMPORT HANDLERS (Two-Step Wizard)
  // ===========================================

  ipcMain.handle(IPC_CHANNELS.IMPORT_CSV_READ_FILE, async (_event, filePath: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid file path');
      }
      return await readCSVFile(filePath);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_CSV_PARSE, async (_event, content: string, options?: any) => {
    try {
      if (typeof content !== 'string') {
        throw new Error('Invalid content');
      }
      const parsedData = parseCSV(content, options);
      
      // Also return suggested mapping if headers are available
      const suggestedMapping = parsedData.hasHeader 
        ? getSuggestedMapping(parsedData.headers)
        : getDefaultMapping(parsedData.columnCount);
      
      return {
        parsedData,
        suggestedMapping,
      };
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_CSV_VALIDATE, async (_event, parsedData: any, mapping: any) => {
    try {
      if (!parsedData || !mapping) {
        throw new Error('Invalid validation parameters');
      }
      return validateCSVImport(parsedData, mapping);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_CSV_EXECUTE, async (_event, config: any) => {
    try {
      if (!config || !config.parsedData || !config.mapping || !config.supplier) {
        throw new Error('Invalid import configuration');
      }
      return await executeCSVImport(config);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_CSV_GET_SUPPLIERS, async () => {
    try {
      return await getExistingSuppliers();
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.IMPORT_CSV_ANALYZE_DUPLICATES, async (_event, parsedData: any, mapping: any, supplierName: string) => {
    try {
      if (!parsedData || !mapping || !supplierName) {
        throw new Error('Invalid parameters for duplicate analysis');
      }
      return await analyzeForDuplicates(parsedData, mapping, supplierName);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });
  // ===========================================
  // OPERATIONS LOG HANDLERS
  // ===========================================
  // These handlers support the Operations Log system for full auditability.
  // SECURITY: Abandon operations require a valid license.

  ipcMain.handle(IPC_CHANNELS.OPERATIONS_GET_LIST, async (_event, page?: number, pageSize?: number) => {
    try {
      return await getOperations(page ?? 1, pageSize ?? 20);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.OPERATIONS_GET_BY_ID, async (_event, operationId: string) => {
    try {
      if (!operationId || typeof operationId !== 'string') {
        throw new Error('Invalid operation ID');
      }
      return await getOperationById(operationId);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.OPERATIONS_ABANDON, async (_event, operationId: string, reason?: string) => {
    try {
      if (!operationId || typeof operationId !== 'string') {
        throw new Error('Invalid operation ID');
      }
      // License check is done inside abandonOperation
      return await abandonOperation({
        operationId,
        reason,
        abandonedBy: 'local',
      });
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.OPERATIONS_GET_INCOMPLETE, async () => {
    try {
      return await findIncompleteOperations();
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.OPERATIONS_FINALIZE_PENDING, async (_event, operationId: string) => {
    try {
      if (!operationId || typeof operationId !== 'string') {
        throw new Error('Invalid operation ID');
      }
      return await finalizePendingOperation(operationId);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.OPERATIONS_ABANDON_PENDING, async (_event, operationId: string, reason?: string) => {
    try {
      if (!operationId || typeof operationId !== 'string') {
        throw new Error('Invalid operation ID');
      }
      return await abandonPendingOperation(operationId, reason);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.OPERATIONS_GET_STATS, async () => {
    try {
      return await getOperationStats();
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  // ===========================================
  // SUPPLIER HANDLERS (CORE DOMAIN)
  // ===========================================
  // Supplier management for the normalized supplier entity.
  // See src/main/services/supplier-service.ts for implementation details.

  ipcMain.handle(IPC_CHANNELS.SUPPLIER_CREATE, async (_event, input) => {
    try {
      // Validate input shape with Zod
      const validatedInput = CreateSupplierSchema.parse(input);
      
      // Create supplier (includes comprehensive business validation)
      return await createSupplier(validatedInput, 'local');
    } catch (error) {
      // Handle Zod validation errors specially
      if (error instanceof Error && error.name === 'ZodError') {
        const zodError = error as any;
        const messages = zodError.errors?.map((e: any) => `${e.path.join('.')}: ${e.message}`).join('; ') || 'Invalid input format';
        console.error('[IPC] Zod validation error:', messages);
        return {
          success: false,
          errors: [{ field: 'validation', message: messages }],
        };
      }
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUPPLIER_GET_LIST, async (_event, params) => {
    try {
      return await listSuppliers(params || {});
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUPPLIER_GET_BY_ID, async (_event, id: string) => {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('Invalid supplier ID');
      }
      return await getSupplierById(id);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUPPLIER_DELETE, async (_event, id: string) => {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('Invalid supplier ID');
      }
      return await deleteSupplier(id);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUPPLIER_VALIDATE, async (_event, input) => {
    try {
      const errors = validateSupplierInput(input);
      return { isValid: errors.length === 0, errors };
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUPPLIER_SEARCH, async (_event, query: string, limit?: number) => {
    try {
      return await searchSuppliers(query || '', limit || 10);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.SUPPLIER_GET_PHONES_BY_NAME, async (_event, supplierName: string) => {
    try {
      if (!supplierName || typeof supplierName !== 'string') {
        return [];
      }
      return await getSupplierPhonesByName(supplierName);
    } catch (error) {
      console.error('Error getting supplier phones:', error);
      return [];
    }
  });

  // ===========================================
  // EXPORT HANDLERS
  // ===========================================

  ipcMain.handle(IPC_CHANNELS.EXPORT_CSV, async (_event, options) => {
    try {
      const validatedOptions = ExportOptionsSchema.parse(options);
      return await exportToCsv(validatedOptions, mainWindow);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_XLSX, async (_event, options) => {
    try {
      const validatedOptions = ExportOptionsSchema.parse(options);
      return await exportToXlsx(validatedOptions, mainWindow);
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXPORT_CHECK_PERMISSION, async () => {
    try {
      return await checkExportPermission();
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  // ===========================================
  // LICENSE HANDLERS
  // ===========================================

  ipcMain.handle(IPC_CHANNELS.LICENSE_GET_STATUS, async () => {
    try {
      return await getLicenseStatus();
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.LICENSE_ACTIVATE, async (_event, licenseKey: string) => {
    try {
      if (!licenseKey || typeof licenseKey !== 'string') {
        throw new Error('Invalid license key');
      }
      return await activateLicense(licenseKey.trim());
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.LICENSE_DEACTIVATE, async () => {
    try {
      return deactivateLicense();
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.LICENSE_GET_MACHINE_ID, async () => {
    try {
      return await getMachineIdForDisplay();
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  ipcMain.handle(IPC_CHANNELS.LICENSE_VALIDATE, async () => {
    try {
      return await validateLicense();
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  });

  // ===========================================
  // APP HANDLERS
  // ===========================================

  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, async () => {
    const { app } = await import('electron');
    return app.getVersion();
  });

  ipcMain.on(IPC_CHANNELS.APP_MINIMIZE, () => {
    mainWindow?.minimize();
  });

  ipcMain.on(IPC_CHANNELS.APP_MAXIMIZE, () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on(IPC_CHANNELS.APP_CLOSE, () => {
    mainWindow?.close();
  });

  // ===========================================
  // DIALOG HANDLERS
  // ===========================================

  ipcMain.handle(IPC_CHANNELS.DIALOG_SAVE_FILE, async (_event, options) => {
    const result = await dialog.showSaveDialog(mainWindow!, options);
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_FILE, async (_event, options) => {
    const result = await dialog.showOpenDialog(mainWindow!, options);
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG_SHOW_MESSAGE, async (_event, options) => {
    const result = await dialog.showMessageBox(mainWindow!, options);
    return result.response;
  });

  console.log('IPC handlers registered');
}

// Cleanup function
export function unregisterIpcHandlers(): void {
  Object.values(IPC_CHANNELS).forEach((channel) => {
    ipcMain.removeHandler(channel);
    ipcMain.removeAllListeners(channel);
  });
}
