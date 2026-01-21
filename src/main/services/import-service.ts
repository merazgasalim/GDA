/**
 * Import Service
 * ==============
 * Handles Excel/CSV import via copy-paste and CSV file import.
 * 
 * DESIGN PRINCIPLES:
 * 1. COPY-PASTE ONLY - No file upload (legacy mode)
 * 2. CSV FILE IMPORT - Two-step wizard (new mode)
 * 3. Defensive parsing - Handle messy data gracefully
 * 4. Preview before commit - User sees parsed data first
 * 5. Flexible column mapping - Support various formats
 * 
 * SUPPORTED FORMATS:
 * - Tab-separated values (Excel copy-paste)
 * - Comma-separated values
 * - Semicolon-separated values
 * - Variable column counts (missing columns = null)
 */

import fs from 'fs/promises';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import type {
  CreatePriceEntry,
  ImportPreview,
  ImportError,
  ImportResult,
  ImportRow,
  CSVParsedData,
  CSVColumnMapping,
  CSVImportConfig,
  CSVImportResult,
  CSVImportPreview,
  CSVFileReadResult,
  DuplicateAnalysisResult,
  DuplicateInfo,
  IntraCsvDuplicate,
} from '../../shared/types';
import {
  getImportHistory,
  createEntriesBatchWithOperation,
  getDistinctValues,
  findDuplicateReferences,
  deactivateAndInsertEntries,
} from './database-service';
import { isFeatureAllowed } from './license-service';
import {
  createOperation,
  completeOperation,
  failOperation,
} from './operation-service';
import { listSuppliers } from './supplier-service';
import {
  parseCSVContent,
  validateCSVMapping,
  suggestColumnMapping,
  createDefaultMapping as createCSVDefaultMapping,
} from './csv-parser';

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
    .replace(/[€$£DZD\s]/gi, '')
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
  const arrivageDateStr = getValue('arrivageDate');
  const arrivageDate = arrivageDateStr ? parseDate(arrivageDateStr) || undefined : undefined;

  return {
    reference,
    designation,
    brand,
    supplierName,
    supplierPhone,
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
    price: row.price,
    currency: 'DZD', // Default currency
    arrivageDate: row.arrivageDate ? new Date(row.arrivageDate) : null,
    entryDate: row.arrivageDate ? new Date(row.arrivageDate) : new Date(),
    notes: row.notes || null,
  };
}

/**
 * Execute the import - save rows to database.
 * 
 * OPERATIONS LOG INTEGRATION:
 * This function now follows the Operations Log write path:
 * 1. Create operation in PENDING status BEFORE any data writes
 * 2. Insert all records with the operationId
 * 3. Mark operation as COMPLETED only after all writes succeed
 * 
 * If the app crashes mid-import:
 * - Operation remains in PENDING status
 * - User is prompted on next startup to finalize or abandon
 * - Data is invisible until resolved (defensive query pattern)
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

  let operationId: string | null = null;
  
  try {
    // STEP 1: Create operation in PENDING status BEFORE any data writes
    // This is CRITICAL - if we crash after this, we can detect the incomplete operation
    operationId = await createOperation({
      type: 'IMPORT',
      description: `Import de ${rows.length} ligne(s) depuis le presse-papiers`,
      metadata: {
        source: 'clipboard',
        rowCount: rows.length,
      },
      createdBy: 'local',
    });
    
    const entries = rows.map(importRowToEntry);

    // STEP 2: Insert all records with the operationId
    // Note: createEntriesBatchWithOperation handles attaching the operationId
    const result = await createEntriesBatchWithOperation(entries, operationId);
    
    // STEP 3: Mark operation as COMPLETED
    // Only called after ALL writes succeed
    await completeOperation({
      operationId,
      rowCount: result.count,
      metadata: {
        importedAt: new Date().toISOString(),
      },
    });
    
    return {
      success: true,
      batchId: operationId, // Now returning operationId as batchId for backwards compatibility
      importedCount: result.count,
      errors: [],
    };
  } catch (error) {
    // If operation was created, mark it as FAILED
    if (operationId) {
      try {
        await failOperation(operationId, error instanceof Error ? error.message : 'Unknown error');
      } catch (failError) {
        console.error('[ImportService] Failed to mark operation as failed:', failError);
      }
    }
    
    return {
      success: false,
      batchId: operationId || '',
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

// ===========================================
// CSV FILE IMPORT (TWO-STEP WIZARD)
// ===========================================

/**
 * Read a CSV or Excel file from disk.
 * 
 * @param filePath - Absolute path to the file
 * @returns File content and metadata
 */
export async function readCSVFile(filePath: string): Promise<CSVFileReadResult> {
  try {
    const filename = filePath.split(/[/\\]/).pop() || 'unknown';
    const extension = filename.split('.').pop()?.toLowerCase() || '';

    // Handle Excel files
    if (extension === 'xlsx' || extension === 'xls') {
      const content = await readExcelFileAsCSV(filePath);
      return {
        success: true,
        content,
        filename,
      };
    }

    // Handle CSV/TXT files
    const content = await fs.readFile(filePath, 'utf-8');
    
    return {
      success: true,
      content,
      filename,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read file',
    };
  }
}

/**
 * Read an Excel file and convert to CSV-like string.
 * 
 * @param filePath - Absolute path to the Excel file
 * @returns CSV-formatted string content
 */
async function readExcelFileAsCSV(filePath: string): Promise<string> {
  const extension = filePath.split('.').pop()?.toLowerCase() || '';
  
  // Use SheetJS (xlsx) for .xls files as ExcelJS doesn't support legacy format well
  if (extension === 'xls') {
    return readXlsFileAsCSV(filePath);
  }
  
  // Use ExcelJS for .xlsx files
  return readXlsxFileAsCSV(filePath);
}

/**
 * Read legacy .xls file using SheetJS library.
 */
async function readXlsFileAsCSV(filePath: string): Promise<string> {
  try {
    const buffer = await fs.readFile(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error('Le fichier Excel ne contient aucune feuille de calcul');
    }
    
    const worksheet = workbook.Sheets[firstSheetName];
    if (!worksheet) {
      throw new Error('Impossible de lire la feuille de calcul');
    }
    
    // Convert to CSV with semicolon delimiter
    const csvContent = XLSX.utils.sheet_to_csv(worksheet, { FS: ';' });
    
    if (!csvContent || csvContent.trim().length === 0) {
      throw new Error('Le fichier Excel est vide ou ne contient pas de données lisibles');
    }
    
    return csvContent;
  } catch (error) {
    console.error('[ImportService] XLS read error:', error);
    throw new Error(`Impossible de lire le fichier .xls: ${error instanceof Error ? error.message : 'format non supporté'}`);
  }
}

/**
 * Read .xlsx file using ExcelJS library.
 */
async function readXlsxFileAsCSV(filePath: string): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  
  try {
    await workbook.xlsx.readFile(filePath);
  } catch (readError) {
    console.error('[ImportService] Excel read error:', readError);
    throw new Error(`Impossible de lire le fichier Excel: ${readError instanceof Error ? readError.message : 'format non supporté'}`);
  }

  // Try multiple ways to get a worksheet
  let worksheet: ExcelJS.Worksheet | undefined = workbook.worksheets[0];
  
  // If worksheets array is empty, try getWorksheet by index (1-based)
  if (!worksheet && workbook.worksheets.length > 0) {
    worksheet = workbook.getWorksheet(1);
  }
  
  // Try to find any worksheet by name
  if (!worksheet) {
    for (const ws of workbook.worksheets) {
      if (ws) {
        worksheet = ws;
        break;
      }
    }
  }
  
  if (!worksheet) {
    console.error('[ImportService] No worksheet found. Worksheets array length:', workbook.worksheets.length);
    throw new Error('Le fichier Excel ne contient aucune feuille de calcul lisible. Essayez de ré-enregistrer le fichier au format .xlsx');
  }

  const rows: string[] = [];
  let maxColCount = 0;

  // First pass: determine max column count
  worksheet.eachRow((row) => {
    if (row.cellCount > maxColCount) {
      maxColCount = row.cellCount;
    }
  });

  // If no columns found, try using actualColumnCount
  if (maxColCount === 0) {
    maxColCount = worksheet.columnCount || 10; // fallback to 10 columns
  }

  // Second pass: extract data
  worksheet.eachRow((row, _rowNumber) => {
    const cells: string[] = [];
    
    // Iterate through all columns up to max
    for (let colNumber = 1; colNumber <= maxColCount; colNumber++) {
      const cell = row.getCell(colNumber);
      let value = '';
      
      if (cell.value !== null && cell.value !== undefined) {
        if (typeof cell.value === 'object') {
          // Handle rich text, formulas, dates, etc.
          if (cell.value instanceof Date) {
            value = cell.value.toISOString().split('T')[0];
          } else if ('text' in cell.value) {
            value = String(cell.value.text);
          } else if ('result' in cell.value) {
            value = String(cell.value.result);
          } else if ('richText' in cell.value && Array.isArray(cell.value.richText)) {
            value = cell.value.richText.map((rt: { text: string }) => rt.text).join('');
          } else {
            value = String(cell.value);
          }
        } else {
          value = String(cell.value);
        }
      }
      
      // Escape semicolons and quotes for CSV format
      if (value.includes(';') || value.includes('"') || value.includes('\n')) {
        value = '"' + value.replace(/"/g, '""') + '"';
      }
      
      cells.push(value);
    }
    
    rows.push(cells.join(';'));
  });

  if (rows.length === 0) {
    throw new Error('Le fichier Excel est vide ou ne contient pas de données lisibles');
  }

  return rows.join('\n');
}

/**
 * Parse CSV content (from file or pasted text).
 * This is Step 1 of the import wizard.
 * 
 * @param content - Raw CSV content
 * @param options - Parsing options
 * @returns Parsed CSV data structure
 */
export function parseCSV(
  content: string,
  options: {
    delimiter?: string;
    hasHeader?: boolean;
    filename?: string;
  } = {}
): CSVParsedData {
  return parseCSVContent(content, options);
}

/**
 * Validate CSV mapping and return preview with errors.
 * This supports Step 2 of the import wizard.
 * 
 * @param parsedData - Parsed CSV data from Step 1
 * @param mapping - Column mapping from user
 * @returns Validation preview with errors
 */
export function validateCSVImport(
  parsedData: CSVParsedData,
  mapping: CSVColumnMapping
): CSVImportPreview {
  return validateCSVMapping(parsedData, mapping);
}

/**
 * Get suggested column mapping based on headers.
 * 
 * @param headers - CSV headers
 * @returns Suggested mapping
 */
export function getSuggestedMapping(headers: string[]): CSVColumnMapping {
  if (headers.length === 0) {
    return {};
  }
  return suggestColumnMapping(headers);
}

/**
 * Get default (empty) column mapping.
 * 
 * @param columnCount - Number of columns
 * @returns Default mapping (all --none--)
 */
export function getDefaultMapping(columnCount: number): CSVColumnMapping {
  return createCSVDefaultMapping(columnCount);
}

/**
 * Get list of existing suppliers from both sources:
 * 1. Supplier table (new normalized suppliers)
 * 2. PriceEntry.supplierName (legacy imports)
 * 
 * Results are merged and deduplicated.
 * 
 * @returns List of unique supplier names
 */
export async function getExistingSuppliers(): Promise<string[]> {
  try {
    // Get suppliers from new Supplier table via supplier service
    const supplierResult = await listSuppliers({ pageSize: 1000 });
    const supplierNames = supplierResult.data.map((s: { name: string }) => s.name);
    
    // Get suppliers from legacy PriceEntry table
    const legacySuppliers = await getDistinctValues('supplierName');
    
    // Merge and deduplicate
    const allSuppliers = [...new Set([...supplierNames, ...legacySuppliers])];
    allSuppliers.sort((a, b) => a.localeCompare(b));
    
    return allSuppliers;
  } catch (error) {
    console.error('[ImportService] getExistingSuppliers failed:', error);
    return [];
  }
}

// ===========================================
// DUPLICATE DETECTION (PRE-IMPORT ANALYSIS)
// ===========================================

/**
 * Analyze parsed CSV data for duplicates BEFORE any database writes.
 * 
 * CRITICAL DESIGN DECISION: No writes during analysis.
 * This function performs read-only analysis to detect:
 * 1. Rows that would create new entries
 * 2. Rows that match existing active records (duplicates)
 * 3. Rows that are invalid (missing required fields)
 * 4. References that appear multiple times within the CSV itself
 * 
 * DUPLICATE IDENTIFICATION LOGIC:
 * A row is considered a potential duplicate if ALL apply:
 * - reference matches existing record (case-insensitive, trimmed)
 * - supplierName matches (since same ref can exist from different suppliers)
 * - existing record has isActive = true
 * - existing record's operation.status = COMPLETED (implied by isActive)
 * 
 * WHY THIS MATTERS:
 * - Same Reference ≠ same product if supplier differs
 * - Same Reference + Supplier MAY be same product
 * - Price changes are NOT duplicates, they are updates
 * 
 * @param parsedData - Parsed CSV data from Step 1
 * @param mapping - Column mapping from user
 * @param supplierName - The supplier name for this import
 * @returns Analysis result with categorized rows
 */
export async function analyzeForDuplicates(
  parsedData: CSVParsedData,
  mapping: CSVColumnMapping,
  supplierName: string
): Promise<DuplicateAnalysisResult> {
  // Find the reference column index
  const referenceColIndex = Object.entries(mapping).find(
    ([, field]) => field === 'reference'
  )?.[0];

  const priceColIndex = Object.entries(mapping).find(
    ([, field]) => field === 'price'
  )?.[0];

  // If no reference column mapped, all rows are invalid
  if (referenceColIndex === undefined) {
    return {
      newRows: [],
      duplicateRows: [],
      invalidRows: Array.from({ length: parsedData.rows.length }, (_, i) => i),
      intraCsvDuplicates: [],
      summary: {
        totalRows: parsedData.rows.length,
        newCount: 0,
        duplicateCount: 0,
        invalidCount: parsedData.rows.length,
        intraCsvDuplicateCount: 0,
      },
      requiresStrategySelection: false,
    };
  }

  // Phase 1: Categorize rows and detect intra-CSV duplicates
  const referenceToRows = new Map<string, number[]>(); // normalized reference -> row indices
  const validRows: Array<{ rowIndex: number; reference: string; originalReference: string; price: number | null }> = [];
  const invalidRows: number[] = [];

  for (let rowIndex = 0; rowIndex < parsedData.rows.length; rowIndex++) {
    const row = parsedData.rows[rowIndex];
    const rawReference = row[parseInt(referenceColIndex)]?.trim() || '';
    
    // Validate: reference is required
    if (!rawReference) {
      invalidRows.push(rowIndex);
      continue;
    }

    // Normalize reference for comparison (case-insensitive)
    const normalizedRef = rawReference.toLowerCase();
    
    // Parse price if mapped
    let price: number | null = null;
    if (priceColIndex !== undefined) {
      const priceStr = row[parseInt(priceColIndex)]?.trim() || '';
      price = parsePrice(priceStr);
    }

    // Keep both original and normalized for proper DB querying
    validRows.push({ rowIndex, reference: normalizedRef, originalReference: rawReference, price });

    // Track for intra-CSV duplicate detection
    const existing = referenceToRows.get(normalizedRef) || [];
    existing.push(rowIndex);
    referenceToRows.set(normalizedRef, existing);
  }

  // Phase 2: Identify intra-CSV duplicates
  const intraCsvDuplicates: IntraCsvDuplicate[] = [];
  for (const [reference, rowIndices] of referenceToRows.entries()) {
    if (rowIndices.length > 1) {
      intraCsvDuplicates.push({ reference, rowIndices });
    }
  }

  // Phase 3: Check against database for external duplicates
  // IMPORTANT: Pass ORIGINAL (non-normalized) values to findDuplicateReferences
  // because SQLite IN clause is case-sensitive. The function will normalize internally.
  const pairsToCheck = validRows.map(v => ({
    reference: v.originalReference,  // Use original casing for DB query
    supplierName: supplierName.trim(),  // Use original casing
  }));

  const existingEntriesMap = await findDuplicateReferences(pairsToCheck);

  // Phase 4: Categorize as NEW or DUPLICATE
  const newRows: number[] = [];
  const duplicateRows: DuplicateInfo[] = [];
  const normalizedSupplier = supplierName.trim().toLowerCase();

  try {
    for (const validRow of validRows) {
      const key = `${validRow.reference}|${normalizedSupplier}`;
      // Defensive: existingEntriesMap should be a Map, but guard against unexpected shapes
      const existingEntry = (existingEntriesMap && typeof (existingEntriesMap as any).get === 'function')
        ? (existingEntriesMap as any).get(key)
        : undefined;

      if (existingEntry) {
        duplicateRows.push({
          rowIndex: validRow.rowIndex,
          reference: validRow.reference,
          existingEntryId: existingEntry?.id ?? null,
          existingPrice: existingEntry?.price ?? null,
          newPrice: validRow.price,
          existingDate: existingEntry?.entryDate ?? null,
        });
      } else {
        // Log unexpected missing map entries prominently for debugging in dev
        try {
          console.error('[ImportService] analyzeForDuplicates: no existing entry for key', key, 'mapSize=', existingEntriesMap && typeof (existingEntriesMap as any).size !== 'undefined' ? (existingEntriesMap as any).size : 'unknown');
          console.error('[ImportService] existingEntriesMap (sample):', existingEntriesMap && typeof (existingEntriesMap as any).get === 'function' ? Array.from((existingEntriesMap as any).entries()).slice(0,5) : existingEntriesMap);
        } catch (e) {
          // ignore logging failures
        }
        newRows.push(validRow.rowIndex);
      }
    }
  } catch (err) {
    console.error('[ImportService] analyzeForDuplicates: unexpected error iterating validRows', err, { validRowsLength: validRows.length, existingEntriesMapType: typeof existingEntriesMap });
    // Fail-safe: treat everything as new to avoid blocking import
    return {
      newRows: validRows.map(v => v.rowIndex),
      duplicateRows: [],
      invalidRows,
      intraCsvDuplicates,
      summary: {
        totalRows: parsedData.rows.length,
        newCount: validRows.length,
        duplicateCount: 0,
        invalidCount: invalidRows.length,
        intraCsvDuplicateCount: intraCsvDuplicates.reduce((sum, d) => sum + d.rowIndices.length, 0),
      },
      requiresStrategySelection: false,
    } as DuplicateAnalysisResult;
  }

  const result: DuplicateAnalysisResult = {
    newRows,
    duplicateRows,
    invalidRows,
    intraCsvDuplicates,
    summary: {
      totalRows: parsedData.rows.length,
      newCount: newRows.length,
      duplicateCount: duplicateRows.length,
      invalidCount: invalidRows.length,
      intraCsvDuplicateCount: intraCsvDuplicates.reduce((sum, d) => sum + d.rowIndices.length, 0),
    },
    // User must choose a strategy if there are any duplicates
    requiresStrategySelection: duplicateRows.length > 0,
  };

  return result;
}

/**
 * Execute CSV import with the full configuration.
 * This is the final step of the import wizard.
 * 
 * OPERATIONS LOG INTEGRATION:
 * This function follows the Operations Log write path:
 * 1. Create operation in PENDING status BEFORE any data writes
 * 2. Insert all records with the operationId
 * 3. Mark operation as COMPLETED only after all writes succeed
 * 
 * DUPLICATE HANDLING:
 * If duplicates were detected, config.duplicateStrategy MUST be set.
 * - 'skip': Only insert new rows, skip duplicates
 * - 'update': Deactivate existing entries, insert new ones (preserves history)
 * - 'abort': Should never reach here (UI should prevent)
 * 
 * WHY NO DESTRUCTIVE OVERWRITE:
 * - Hard delete destroys pricing history needed for auditing
 * - UPDATE in place loses original prices, preventing trend analysis
 * - This soft-delete + insert pattern preserves full audit trail
 * 
 * @param config - Complete import configuration from wizard
 * @param duplicateAnalysis - Optional pre-computed analysis result
 * @returns Import result
 */
export async function executeCSVImport(
  config: CSVImportConfig,
  duplicateAnalysis?: DuplicateAnalysisResult
): Promise<CSVImportResult> {
  // Check license permission
  const canImport = await isFeatureAllowed('canImport');
  if (!canImport) {
    return {
      success: false,
      operationId: '',
      importedCount: 0,
      errors: [{
        rowIndex: -1,
        columnIndex: -1,
        field: 'reference',
        value: '',
        message: 'Import not allowed - license required or expired',
      }],
      skippedCount: 0,
      updatedCount: 0,
    };
  }

  const { parsedData, mapping, supplier, importDate, duplicateStrategy } = config;

  // Validate the mapping first
  const validation = validateCSVMapping(parsedData, mapping);
  
  if (validation.validRowCount === 0) {
    return {
      success: false,
      operationId: '',
      importedCount: 0,
      errors: validation.validationErrors,
      skippedCount: validation.invalidRowCount,
      updatedCount: 0,
    };
  }

  // If we don't have a duplicate analysis, run it now
  const analysis = duplicateAnalysis || await analyzeForDuplicates(
    parsedData,
    mapping,
    supplier.name
  );

  // If duplicates exist and no strategy selected, abort
  if (analysis.requiresStrategySelection && !duplicateStrategy) {
    return {
      success: false,
      operationId: '',
      importedCount: 0,
      errors: [{
        rowIndex: -1,
        columnIndex: -1,
        field: 'reference',
        value: '',
        message: 'Duplicates detected but no strategy selected. User must choose: skip, update, or abort.',
      }],
      skippedCount: 0,
      updatedCount: 0,
    };
  }

  // If strategy is abort, don't proceed
  if (duplicateStrategy === 'abort') {
    return {
      success: false,
      operationId: '',
      importedCount: 0,
      errors: [],
      skippedCount: 0,
      updatedCount: 0,
      strategyUsed: 'abort',
    };
  }

  let operationId: string | null = null;

  try {
    // Determine which rows to process based on strategy
    const rowsToImport = new Set<number>();
    const duplicateRowsToUpdate = new Map<number, string>(); // rowIndex -> existingEntryId

    // All new rows are always imported
    for (const rowIndex of analysis.newRows) {
      rowsToImport.add(rowIndex);
    }

    // Handle duplicates based on strategy
    if (duplicateStrategy === 'update') {
      // Update strategy: deactivate existing, insert new
      for (const dup of analysis.duplicateRows) {
        rowsToImport.add(dup.rowIndex);
        duplicateRowsToUpdate.set(dup.rowIndex, dup.existingEntryId);
      }
    }
    // Skip strategy: duplicates are not added to rowsToImport

    // Calculate counts for metadata
    const skippedDuplicateCount = duplicateStrategy === 'skip' ? analysis.duplicateRows.length : 0;
    const updatedCount = duplicateStrategy === 'update' ? analysis.duplicateRows.length : 0;

    // STEP 1: Create operation in PENDING status BEFORE any data writes
    operationId = await createOperation({
      type: 'IMPORT',
      description: `Import CSV: ${parsedData.filename || 'pasted content'} - ${rowsToImport.size} ligne(s)`,
      metadata: {
        source: parsedData.filename ? 'file' : 'clipboard',
        originalFilename: parsedData.filename,
        fileHash: parsedData.contentHash,
        rowCount: rowsToImport.size,
        supplier: supplier.name,
        importDate,
        mapping: JSON.stringify(mapping),
        // Duplicate handling metadata (immutable for audit)
        duplicateStrategy: duplicateStrategy || 'none',
        duplicateCount: analysis.duplicateRows.length,
        skippedDuplicateCount,
        updatedCount,
        // Store IDs of deactivated entries for potential reactivation on abandon
        deactivatedEntryIds: duplicateStrategy === 'update' 
          ? analysis.duplicateRows.map(d => d.existingEntryId)
          : [],
      },
      createdBy: 'local',
    });

    // Find column indices for mapped fields
    const fieldColumns: Partial<Record<string, number>> = {};
    for (const [colIndex, field] of Object.entries(mapping)) {
      if (field !== '--none--') {
        fieldColumns[field] = parseInt(colIndex);
      }
    }

    // Build entries from rows to import
    const entries: CreatePriceEntry[] = [];
    const skippedRows: number[] = [];

    // Create a set of invalid row indices
    const invalidRowIndices = new Set(validation.validationErrors.map(e => e.rowIndex));

    for (let rowIndex = 0; rowIndex < parsedData.rows.length; rowIndex++) {
      // Skip rows with validation errors
      if (invalidRowIndices.has(rowIndex)) {
        skippedRows.push(rowIndex);
        continue;
      }

      // Skip rows not in our import set
      if (!rowsToImport.has(rowIndex)) {
        skippedRows.push(rowIndex);
        continue;
      }

      const row = parsedData.rows[rowIndex];

      // Extract values based on mapping
      const reference = fieldColumns.reference !== undefined 
        ? row[fieldColumns.reference]?.trim() || '' 
        : '';
      
      const designation = fieldColumns.designation !== undefined 
        ? row[fieldColumns.designation]?.trim() || '' 
        : '';
      
      const brand = fieldColumns.brand !== undefined 
        ? row[fieldColumns.brand]?.trim() || '' 
        : '';
      
      const priceValue = fieldColumns.price !== undefined 
        ? row[fieldColumns.price]?.trim() || '' 
        : '';
      
      const price = parsePrice(priceValue) || 0;

      // Skip if essential fields are missing
      if (!reference) {
        skippedRows.push(rowIndex);
        continue;
      }

      entries.push({
        reference,
        designation: designation || reference,
        brand: brand || 'N/A',
        supplierName: supplier.name,
        supplierPhone: supplier.phone || null,
        price: price || 0,
        currency: 'DZD',
        arrivageDate: importDate ? new Date(importDate) : null,
        entryDate: importDate ? new Date(importDate) : new Date(),
        notes: null,
      });
    }

    if (entries.length === 0) {
      if (operationId) {
        await failOperation(operationId, 'No valid rows to import');
      }
      return {
        success: false,
        operationId: operationId || '',
        importedCount: 0,
        errors: [{
          rowIndex: -1,
          columnIndex: -1,
          field: 'reference',
          value: '',
          message: 'No valid rows to import after validation',
        }],
        skippedCount: skippedRows.length,
        updatedCount: 0,
      };
    }

    // STEP 2: Execute the appropriate write strategy
    let result: { insertedCount: number; deactivatedCount: number };

    if (duplicateStrategy === 'update' && duplicateRowsToUpdate.size > 0) {
      // UPDATE STRATEGY: Deactivate existing entries, then insert new ones
      // This preserves full price history - old prices remain in DB but inactive
      const entriesToDeactivate = [...new Set(analysis.duplicateRows.map(d => d.existingEntryId))];
      
      result = await deactivateAndInsertEntries(
        entriesToDeactivate,
        entries,
        operationId
      );
    } else {
      // SKIP STRATEGY or no duplicates: Just insert new entries
      const insertResult = await createEntriesBatchWithOperation(entries, operationId);
      result = { insertedCount: insertResult.count, deactivatedCount: 0 };
    }

    // STEP 3: Mark operation as COMPLETED
    await completeOperation({
      operationId,
      rowCount: result.insertedCount,
      metadata: {
        importedAt: new Date().toISOString(),
        skippedRows: skippedRows.length,
        deactivatedCount: result.deactivatedCount,
      },
    });

    return {
      success: true,
      operationId,
      importedCount: result.insertedCount,
      errors: [],
      skippedCount: skippedRows.length + skippedDuplicateCount,
      updatedCount: result.deactivatedCount,
      strategyUsed: duplicateStrategy,
    };

  } catch (error) {
    // If operation was created, mark it as FAILED
    if (operationId) {
      try {
        await failOperation(operationId, error instanceof Error ? error.message : 'Unknown error');
      } catch (failError) {
        console.error('[ImportService] Failed to mark operation as failed:', failError);
      }
    }

    return {
      success: false,
      operationId: operationId || '',
      importedCount: 0,
      errors: [{
        rowIndex: -1,
        columnIndex: -1,
        field: 'reference',
        value: '',
        message: error instanceof Error ? error.message : 'Database error',
      }],
      skippedCount: 0,
      updatedCount: 0,
    };
  }
}