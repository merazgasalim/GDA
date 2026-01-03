/**
 * Shared Types for Gestion des Arrivages
 * ======================================
 * These types are shared between main and renderer processes.
 * They define the data structures used across the IPC boundary.
 */

import { z } from 'zod';

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
