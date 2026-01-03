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
  // IMPORT OPERATIONS
  // ===========================================
  IMPORT_PARSE_CLIPBOARD: 'import:parse-clipboard',
  IMPORT_PREVIEW: 'import:preview',
  IMPORT_EXECUTE: 'import:execute',
  IMPORT_GET_HISTORY: 'import:get-history',

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
