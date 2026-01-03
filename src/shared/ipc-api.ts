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
// IMPORT API
// ===========================================

export interface ImportApi {
  parseClipboard: (rawText: string, options?: ImportParseOptions) => Promise<ImportPreview>;
  execute: (rows: CreatePriceEntry[]) => Promise<ImportResult>;
  getHistory: (limit?: number) => Promise<ImportLogEntry[]>;
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
}

// Declare global window type extension
declare global {
  interface Window {
    electronApi: ElectronApi;
  }
}
