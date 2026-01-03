/**
 * Import Service
 * ==============
 * Handles Excel/CSV import via copy-paste.
 * 
 * DESIGN PRINCIPLES:
 * 1. COPY-PASTE ONLY - No file upload
 * 2. Defensive parsing - Handle messy data gracefully
 * 3. Preview before commit - User sees parsed data first
 * 4. Flexible column mapping - Support various formats
 * 
 * SUPPORTED FORMATS:
 * - Tab-separated values (Excel copy-paste)
 * - Comma-separated values
 * - Semicolon-separated values
 * - Variable column counts (missing columns = null)
 */

import { v4 as uuidv4 } from 'uuid';
import {
  CreatePriceEntry,
  ImportPreview,
  ImportError,
  ImportResult,
  ImportRow,
} from '../../shared/types';
import { createEntriesBatch, getImportHistory } from './database-service';
import { isFeatureAllowed } from './license-service';

// ===========================================
// COLUMN MAPPING
// ===========================================

/**
 * Default column order expected from Excel paste.
 * This matches the typical export format from suppliers.
 */
const DEFAULT_COLUMN_ORDER = [
  'reference',
  'designation',
  'brand',
  'supplierName',
  'supplierPhone',
  'constructorRef',
  'price',
  'arrivageDate',
] as const;

type ColumnName = (typeof DEFAULT_COLUMN_ORDER)[number];

interface ColumnMapping {
  [index: number]: ColumnName;
}

// ===========================================
// PARSING UTILITIES
// ===========================================

/**
 * Detect the delimiter used in the pasted text.
 * Priority: Tab > Semicolon > Comma
 */
function detectDelimiter(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return '\t';

  const firstLine = lines[0];
  
  // Count occurrences of each delimiter
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;

  // Tab is most common from Excel
  if (tabCount >= semiCount && tabCount >= commaCount && tabCount > 0) {
    return '\t';
  }
  // Semicolon is common in European locales
  if (semiCount >= commaCount && semiCount > 0) {
    return ';';
  }
  // Comma is fallback
  if (commaCount > 0) {
    return ',';
  }

  return '\t'; // Default to tab
}

/**
 * Clean and normalize a cell value.
 */
function cleanValue(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, '') // Remove quotes
    .replace(/\s+/g, ' '); // Normalize whitespace
}

/**
 * Parse a price string into a number.
 * Handles various formats: "123.45", "123,45", "1 234.56", etc.
 */
function parsePrice(value: string): number | null {
  if (!value) return null;

  // Remove currency symbols and spaces
  let cleaned = value
    .replace(/[€$£MAD\s]/gi, '')
    .trim();

  // Handle European format (1.234,56 -> 1234.56)
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // If comma comes after period, it's decimal separator
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    // Single comma might be decimal separator
    cleaned = cleaned.replace(',', '.');
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Parse a date string into ISO format.
 * Handles: DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY, etc.
 */
function parseDate(value: string): string | null {
  if (!value) return null;

  const cleaned = value.trim();
  
  // Try ISO format first
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  // Try DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(cleaned);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  // Try MM/DD/YYYY (US format)
  const mmddyyyy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(cleaned);
  if (mmddyyyy) {
    const [, month, day, year] = mmddyyyy;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return null;
}

// ===========================================
// MAIN PARSING FUNCTION
// ===========================================

/**
 * Parse raw clipboard text into import rows.
 */
export function parseClipboardText(
  rawText: string,
  options: {
    delimiter?: string;
    hasHeader?: boolean;
    columnMapping?: ColumnMapping;
  } = {}
): ImportPreview {
  const errors: ImportError[] = [];
  const rows: ImportRow[] = [];

  if (!rawText || !rawText.trim()) {
    return {
      rows: [],
      errors: [{ row: 0, message: 'No data provided' }],
      totalParsed: 0,
      validCount: 0,
      invalidCount: 0,
    };
  }

  const delimiter = options.delimiter || detectDelimiter(rawText);
  const lines = rawText.split('\n').filter((l) => l.trim());
  const startIndex = options.hasHeader ? 1 : 0;
  const mapping = options.columnMapping || createDefaultMapping();

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const rowNum = i + 1;

    try {
      const cells = line.split(delimiter).map(cleanValue);
      const row = parseRow(cells, mapping, rowNum, errors);
      
      if (row) {
        rows.push(row);
      }
    } catch (error) {
      errors.push({
        row: rowNum,
        message: error instanceof Error ? error.message : 'Parse error',
        rawData: line.substring(0, 100),
      });
    }
  }

  return {
    rows,
    errors,
    totalParsed: lines.length - startIndex,
    validCount: rows.length,
    invalidCount: lines.length - startIndex - rows.length,
  };
}

/**
 * Create default column mapping (0-indexed).
 */
function createDefaultMapping(): ColumnMapping {
  const mapping: ColumnMapping = {};
  DEFAULT_COLUMN_ORDER.forEach((col, index) => {
    mapping[index] = col;
  });
  return mapping;
}

/**
 * Parse a single row of cells into an ImportRow.
 */
function parseRow(
  cells: string[],
  mapping: ColumnMapping,
  rowNum: number,
  errors: ImportError[]
): ImportRow | null {
  const getValue = (colName: ColumnName): string => {
    const index = Object.entries(mapping).find(([, v]) => v === colName)?.[0];
    if (index === undefined) return '';
    return cells[parseInt(index)] || '';
  };

  // Required fields
  const reference = getValue('reference');
  const designation = getValue('designation');
  const brand = getValue('brand');
  const supplierName = getValue('supplierName');
  const priceStr = getValue('price');

  // Validate required fields
  if (!reference) {
    errors.push({ row: rowNum, column: 'reference', message: 'Reference is required' });
    return null;
  }
  if (!designation) {
    errors.push({ row: rowNum, column: 'designation', message: 'Designation is required' });
    return null;
  }
  if (!brand) {
    errors.push({ row: rowNum, column: 'brand', message: 'Brand is required' });
    return null;
  }
  if (!supplierName) {
    errors.push({ row: rowNum, column: 'supplierName', message: 'Supplier name is required' });
    return null;
  }

  // Parse price
  const price = parsePrice(priceStr);
  if (price === null || price <= 0) {
    errors.push({ row: rowNum, column: 'price', message: 'Invalid price value' });
    return null;
  }

  // Optional fields
  const supplierPhone = getValue('supplierPhone') || undefined;
  const constructorRef = getValue('constructorRef') || undefined;
  const arrivageDateStr = getValue('arrivageDate');
  const arrivageDate = arrivageDateStr ? parseDate(arrivageDateStr) || undefined : undefined;

  return {
    reference,
    designation,
    brand,
    supplierName,
    supplierPhone,
    constructorRef,
    price,
    arrivageDate,
  };
}

// ===========================================
// IMPORT EXECUTION
// ===========================================

/**
 * Convert ImportRow to CreatePriceEntry.
 */
function importRowToEntry(row: ImportRow): CreatePriceEntry {
  return {
    reference: row.reference,
    designation: row.designation,
    brand: row.brand,
    supplierName: row.supplierName,
    supplierPhone: row.supplierPhone || null,
    constructorRef: row.constructorRef || null,
    price: row.price,
    currency: 'MAD', // Default currency
    arrivageDate: row.arrivageDate ? new Date(row.arrivageDate) : null,
    notes: row.notes || null,
  };
}

/**
 * Execute the import - save rows to database.
 */
export async function executeImport(
  rows: ImportRow[]
): Promise<ImportResult> {
  // Check license permission
  const canImport = await isFeatureAllowed('canImport');
  if (!canImport) {
    return {
      success: false,
      batchId: '',
      importedCount: 0,
      errors: [{ row: 0, message: 'Import not allowed - license required or expired' }],
    };
  }

  if (rows.length === 0) {
    return {
      success: false,
      batchId: '',
      importedCount: 0,
      errors: [{ row: 0, message: 'No rows to import' }],
    };
  }

  const batchId = uuidv4();
  const entries = rows.map(importRowToEntry);

  try {
    const result = await createEntriesBatch(entries, batchId);
    
    return {
      success: true,
      batchId,
      importedCount: result.count,
      errors: [],
    };
  } catch (error) {
    return {
      success: false,
      batchId,
      importedCount: 0,
      errors: [{
        row: 0,
        message: error instanceof Error ? error.message : 'Database error',
      }],
    };
  }
}

/**
 * Get import history for display.
 */
export async function getImportHistoryService(limit: number = 20) {
  return getImportHistory(limit);
}
