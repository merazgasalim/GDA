/**
 * CSV Parser Service
 * ==================
 * Production-grade CSV parsing for the import wizard.
 * 
 * FEATURES:
 * - Auto-detect delimiter (comma, semicolon, tab)
 * - Handle quoted fields with embedded delimiters
 * - Handle quoted fields with embedded quotes (escaped as "")
 * - Handle multiline quoted fields
 * - Normalize line endings (CRLF, LF, CR)
 * - Generate content hash for deduplication
 * - Validate field formats (price validation)
 * 
 * DESIGN PRINCIPLES:
 * 1. Defensive parsing - never throw, return errors gracefully
 * 2. Preserve original data - no implicit transformations
 * 3. Provide detailed error information for user feedback
 */

import * as crypto from 'crypto';
import {
  CSVParsedData,
  CSVColumnMapping,
  CSVValidationError,
  CSVImportPreview,
  CSVTargetField,
} from '../../shared/types';

// ===========================================
// CONSTANTS
// ===========================================

/** Supported delimiters in order of detection priority */
const DELIMITERS = ['\t', ';', ','] as const;

/** Maximum number of rows to analyze for delimiter detection */
const DETECTION_SAMPLE_SIZE = 10;

/** Maximum rows to preview in Step 2 */
export const PREVIEW_ROW_LIMIT = 20;

// ===========================================
// DELIMITER DETECTION
// ===========================================

/**
 * Detect the most likely delimiter used in the CSV content.
 * 
 * Strategy:
 * 1. Sample the first N lines
 * 2. For each delimiter, count occurrences per line
 * 3. Choose the delimiter with most consistent non-zero count
 * 
 * @param content - Raw CSV content
 * @returns Detected delimiter character
 */
export function detectDelimiter(content: string): string {
  // Normalize line endings and get sample lines
  const normalizedContent = content.replace(/\r\n|\r/g, '\n');
  const lines = normalizedContent
    .split('\n')
    .filter(line => line.trim().length > 0)
    .slice(0, DETECTION_SAMPLE_SIZE);

  if (lines.length === 0) {
    return ','; // Default fallback
  }

  // Score each delimiter based on consistency
  const scores: Record<string, number> = {};

  for (const delimiter of DELIMITERS) {
    const counts = lines.map(line => countDelimiterOccurrences(line, delimiter));
    
    // Filter out lines where delimiter wasn't found
    const nonZeroCounts = counts.filter(c => c > 0);
    
    if (nonZeroCounts.length === 0) {
      scores[delimiter] = 0;
      continue;
    }

    // Calculate consistency score:
    // - High score if all lines have same count
    // - Bonus for higher delimiter count (more columns)
    const avgCount = nonZeroCounts.reduce((a, b) => a + b, 0) / nonZeroCounts.length;
    const variance = nonZeroCounts.reduce((sum, c) => sum + Math.pow(c - avgCount, 2), 0) / nonZeroCounts.length;
    
    // Score = average count * consistency factor (lower variance = higher consistency)
    const consistencyFactor = 1 / (1 + variance);
    scores[delimiter] = avgCount * consistencyFactor * (nonZeroCounts.length / lines.length);
  }

  // Return delimiter with highest score
  const bestDelimiter = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)[0]?.[0] ?? ',';

  return bestDelimiter;
}

/**
 * Count delimiter occurrences in a line, respecting quoted fields.
 */
function countDelimiterOccurrences(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      // Check for escaped quote
      if (inQuotes && line[i + 1] === '"') {
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      count++;
    }
  }
  
  return count;
}

// ===========================================
// CSV PARSING
// ===========================================

/**
 * Parse CSV content into structured data.
 * 
 * Handles:
 * - Quoted fields with embedded delimiters
 * - Escaped quotes ("" inside quoted fields)
 * - Multiline quoted fields
 * - Variable column counts (fills with empty strings)
 * 
 * @param content - Raw CSV content
 * @param options - Parsing options
 * @returns Parsed CSV data structure
 */
export function parseCSVContent(
  content: string,
  options: {
    delimiter?: string;
    hasHeader?: boolean;
    filename?: string;
  } = {}
): CSVParsedData {
  // Normalize line endings
  const normalizedContent = content.replace(/\r\n|\r/g, '\n').trim();
  
  if (!normalizedContent) {
    return createEmptyResult(options.filename);
  }

  // Auto-detect delimiter if not provided
  const delimiter = options.delimiter ?? detectDelimiter(normalizedContent);
  const hasHeader = options.hasHeader ?? false;

  // Parse all rows
  const allRows = parseAllRows(normalizedContent, delimiter);
  
  if (allRows.length === 0) {
    return createEmptyResult(options.filename);
  }

  // Determine maximum column count
  const columnCount = Math.max(...allRows.map(row => row.length));

  // Normalize row lengths (fill missing columns with empty strings)
  const normalizedRows = allRows.map(row => {
    while (row.length < columnCount) {
      row.push('');
    }
    return row;
  });

  // Extract headers if applicable
  const headers = hasHeader 
    ? normalizedRows[0].map(h => h.trim())
    : normalizedRows[0].map((_, i) => `Column ${i + 1}`);

  // Data rows (excluding header if applicable)
  const dataRows = hasHeader ? normalizedRows.slice(1) : normalizedRows;

  // Generate content hash for deduplication
  const contentHash = generateContentHash(normalizedContent);

  return {
    headers,
    rows: dataRows,
    delimiter,
    hasHeader,
    totalRows: dataRows.length,
    columnCount,
    contentHash,
    filename: options.filename,
  };
}

/**
 * Parse all rows from CSV content.
 */
function parseAllRows(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    
    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote
        if (content[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        // Any character inside quotes
        currentField += char;
        i++;
        continue;
      }
    }

    // Not in quotes
    if (char === '"') {
      // Start of quoted field (should be at start of field)
      inQuotes = true;
      i++;
    } else if (char === delimiter) {
      // End of field
      currentRow.push(currentField.trim());
      currentField = '';
      i++;
    } else if (char === '\n') {
      // End of row
      currentRow.push(currentField.trim());
      if (currentRow.some(cell => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
      i++;
    } else {
      // Regular character
      currentField += char;
      i++;
    }
  }

  // Don't forget the last field/row
  currentRow.push(currentField.trim());
  if (currentRow.some(cell => cell.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Create an empty result structure.
 */
function createEmptyResult(filename?: string): CSVParsedData {
  return {
    headers: [],
    rows: [],
    delimiter: ',',
    hasHeader: false,
    totalRows: 0,
    columnCount: 0,
    contentHash: generateContentHash(''),
    filename,
  };
}

/**
 * Generate SHA-256 hash of content for deduplication.
 */
function generateContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

// ===========================================
// VALIDATION
// ===========================================

/**
 * Validate a CSV import preview based on current mapping.
 * 
 * Validation rules:
 * - Reference is required (if mapped)
 * - Price must be a valid positive number (if mapped)
 * - At least Reference must be mapped
 * 
 * @param parsedData - Parsed CSV data
 * @param mapping - Current column mapping
 * @returns Validation result with errors and counts
 */
export function validateCSVMapping(
  parsedData: CSVParsedData,
  mapping: CSVColumnMapping
): CSVImportPreview {
  const errors: CSVValidationError[] = [];
  let validRowCount = 0;
  let invalidRowCount = 0;

  // Check if Reference is mapped
  const referenceMapped = Object.values(mapping).includes('reference');
  if (!referenceMapped) {
    // All rows are invalid if reference is not mapped
    return {
      parsedData,
      mapping,
      validationErrors: [{
        rowIndex: -1,
        columnIndex: -1,
        field: 'reference',
        value: '',
        message: 'Reference field must be mapped',
      }],
      validRowCount: 0,
      invalidRowCount: parsedData.totalRows,
    };
  }

  // Find column indices for each mapped field
  const fieldColumns: Partial<Record<Exclude<CSVTargetField, '--none--'>, number>> = {};
  for (const [colIndex, field] of Object.entries(mapping)) {
    if (field !== '--none--') {
      fieldColumns[field as Exclude<CSVTargetField, '--none--'>] = parseInt(colIndex);
    }
  }

  // Validate each row
  for (let rowIndex = 0; rowIndex < parsedData.rows.length; rowIndex++) {
    const row = parsedData.rows[rowIndex];
    let rowHasError = false;

    // Validate Reference (required, non-empty)
    if (fieldColumns.reference !== undefined) {
      const value = row[fieldColumns.reference] || '';
      if (!value.trim()) {
        errors.push({
          rowIndex,
          columnIndex: fieldColumns.reference,
          field: 'reference',
          value,
          message: 'Reference cannot be empty',
        });
        rowHasError = true;
      }
    }

    // Validate Price (must be valid number if provided and mapped)
    if (fieldColumns.price !== undefined) {
      const value = row[fieldColumns.price] || '';
      if (value.trim()) {
        const parsedPrice = parsePrice(value);
        if (parsedPrice === null || parsedPrice <= 0) {
          errors.push({
            rowIndex,
            columnIndex: fieldColumns.price,
            field: 'price',
            value,
            message: 'Price must be a valid positive number',
          });
          rowHasError = true;
        }
      }
    }

    // Validate Designation (should not be empty if mapped)
    if (fieldColumns.designation !== undefined) {
      const value = row[fieldColumns.designation] || '';
      if (!value.trim()) {
        errors.push({
          rowIndex,
          columnIndex: fieldColumns.designation,
          field: 'designation',
          value,
          message: 'Designation cannot be empty',
        });
        rowHasError = true;
      }
    }

    if (rowHasError) {
      invalidRowCount++;
    } else {
      validRowCount++;
    }
  }

  return {
    parsedData,
    mapping,
    validationErrors: errors,
    validRowCount,
    invalidRowCount,
  };
}

/**
 * Parse a price string into a number.
 * Handles various formats:
 * - "123.45" (US format)
 * - "123,45" (European format)
 * - "1 234.56" (with spaces)
 * - "1.234,56" (European with thousand separator)
 * - "$123.45" or "123.45 DZD" (with currency)
 * 
 * @param value - Price string to parse
 * @returns Parsed number or null if invalid
 */
export function parsePrice(value: string): number | null {
  if (!value || !value.trim()) {
    return null;
  }

  // Remove currency symbols and spaces
  let cleaned = value
    .replace(/[€$£DZD\s]/gi, '')
    .replace(/\u00A0/g, '') // Non-breaking space
    .trim();

  // Handle European format (1.234,56 -> 1234.56)
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // If comma comes after period, comma is decimal separator
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // Period is decimal separator, comma is thousand separator
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    // Single comma - could be decimal separator or thousand separator
    // Check position: if 3 digits after comma, it's a thousand separator
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length === 3 && /^\d+$/.test(parts[1])) {
      // Likely thousand separator
      cleaned = cleaned.replace(',', '');
    } else {
      // Likely decimal separator
      cleaned = cleaned.replace(',', '.');
    }
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Create a default column mapping (all columns to --none--).
 */
export function createDefaultMapping(columnCount: number): CSVColumnMapping {
  const mapping: CSVColumnMapping = {};
  for (let i = 0; i < columnCount; i++) {
    mapping[i] = '--none--';
  }
  return mapping;
}

/**
 * Auto-suggest column mapping based on header names.
 * 
 * Matches headers to target fields using fuzzy matching.
 */
export function suggestColumnMapping(headers: string[]): CSVColumnMapping {
  const mapping: CSVColumnMapping = {};
  const usedFields = new Set<CSVTargetField>();

  const patterns: Array<{ field: CSVTargetField; patterns: RegExp[] }> = [
    { 
      field: 'reference', 
      patterns: [/^ref/i, /référence/i, /reference/i, /code/i, /^art/i, /article/i] 
    },
    { 
      field: 'designation', 
      patterns: [/désign/i, /design/i, /description/i, /libellé/i, /label/i, /^nom$/i, /name/i] 
    },
    { 
      field: 'brand', 
      patterns: [/marque/i, /brand/i, /fabricant/i, /manufacturer/i] 
    },
    { 
      field: 'price', 
      patterns: [/prix/i, /price/i, /tarif/i, /montant/i, /coût/i, /cost/i, /^pu$/i, /^p\.u/i] 
    },
  ];

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    let matched = false;

    for (const { field, patterns: fieldPatterns } of patterns) {
      if (usedFields.has(field)) continue;

      for (const pattern of fieldPatterns) {
        if (pattern.test(header)) {
          mapping[i] = field;
          usedFields.add(field);
          matched = true;
          break;
        }
      }

      if (matched) break;
    }

    if (!matched) {
      mapping[i] = '--none--';
    }
  }

  // Fill remaining columns with --none--
  for (let i = 0; i < headers.length; i++) {
    if (mapping[i] === undefined) {
      mapping[i] = '--none--';
    }
  }

  return mapping;
}

// ===========================================
// EXPORT FOR SERVICE
// ===========================================

export default {
  detectDelimiter,
  parseCSVContent,
  validateCSVMapping,
  parsePrice,
  createDefaultMapping,
  suggestColumnMapping,
  PREVIEW_ROW_LIMIT,
};
