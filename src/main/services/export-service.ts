/**
 * Export Service
 * ==============
 * Handles CSV and XLSX export operations.
 * 
 * SECURITY: Export REQUIRES valid license.
 * This is a key monetization control point.
 * 
 * SUPPORTED FORMATS:
 * - CSV: Simple comma-separated values
 * - XLSX: Full Excel format with formatting
 */

import ExcelJS from 'exceljs';
import { dialog, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import {
  ExportOptions,
  ExportResult,
  PriceEntry,
  ColumnFilter,
} from '../../shared/types';
import { getAllEntriesForExport } from './database-service';
import { isFeatureAllowed, getLicenseStatus } from './license-service';

// ===========================================
// EXPORT PERMISSION CHECK
// ===========================================

/**
 * Check if export is allowed under current license.
 */
export async function checkExportPermission(): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const canExport = await isFeatureAllowed('canExport');
  
  if (!canExport) {
    const status = await getLicenseStatus();
    
    if (!status.isValid) {
      return {
        allowed: false,
        reason: 'Export requires a valid license. Please activate your license.',
      };
    }
    
    if (status.isExpired) {
      return {
        allowed: false,
        reason: 'Your license has expired. Please renew to enable export.',
      };
    }
    
    return {
      allowed: false,
      reason: 'Export is not included in your license type.',
    };
  }

  return { allowed: true };
}

// ===========================================
// CSV EXPORT
// ===========================================

/**
 * Format a date for export.
 */
function formatDate(date: Date | string | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('fr-FR');
}

/**
 * Escape a value for CSV (handle commas, quotes, newlines).
 */
function escapeCsvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  
  const str = String(value);
  
  // If contains special characters, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  
  return str;
}

/**
 * Convert entries to CSV string.
 */
function entriesToCsv(entries: PriceEntry[]): string {
  const headers = [
    'Référence',
    'Désignation',
    'Marque',
    'Fournisseur',
    'Téléphone',
    'Réf. Constructeur',
    'Prix',
    'Date',
    'Notes',
  ];

  const rows = entries.map((entry) => [
    escapeCsvValue(entry.reference),
    escapeCsvValue(entry.designation),
    escapeCsvValue(entry.brand),
    escapeCsvValue(entry.supplierName),
    escapeCsvValue(entry.supplierPhone),
    escapeCsvValue(entry.constructorRef),
    escapeCsvValue(entry.price),
    escapeCsvValue(formatDate(entry.entryDate)),
    escapeCsvValue(entry.notes),
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Export data to CSV file.
 */
export async function exportToCsv(
  options: ExportOptions,
  mainWindow: BrowserWindow | null
): Promise<ExportResult> {
  // Check permission
  const permission = await checkExportPermission();
  if (!permission.allowed) {
    return {
      success: false,
      error: permission.reason,
    };
  }

  try {
    // Get data
    const entries = await getAllEntriesForExport(
      options.filters,
      options.globalSearch
    );

    if (entries.length === 0) {
      return {
        success: false,
        error: 'No data to export',
      };
    }

    // Show save dialog
    const defaultFilename = options.filename || `export_${Date.now()}.csv`;
    const result = await dialog.showSaveDialog(mainWindow || BrowserWindow.getFocusedWindow()!, {
      defaultPath: defaultFilename,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      title: 'Exporter en CSV',
    });

    if (result.canceled || !result.filePath) {
      return {
        success: false,
        error: 'Export cancelled',
      };
    }

    // Generate CSV
    const csv = entriesToCsv(entries);
    
    // Write file with BOM for Excel compatibility
    const bom = '\ufeff';
    fs.writeFileSync(result.filePath, bom + csv, 'utf-8');

    return {
      success: true,
      filePath: result.filePath,
      rowCount: entries.length,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed',
    };
  }
}

// ===========================================
// XLSX EXPORT
// ===========================================

/**
 * Export data to XLSX file with formatting.
 */
export async function exportToXlsx(
  options: ExportOptions,
  mainWindow: BrowserWindow | null
): Promise<ExportResult> {
  // Check permission
  const permission = await checkExportPermission();
  if (!permission.allowed) {
    return {
      success: false,
      error: permission.reason,
    };
  }

  try {
    // Get data
    const entries = await getAllEntriesForExport(
      options.filters,
      options.globalSearch
    );

    if (entries.length === 0) {
      return {
        success: false,
        error: 'No data to export',
      };
    }

    // Show save dialog
    const defaultFilename = options.filename || `export_${Date.now()}.xlsx`;
    const result = await dialog.showSaveDialog(mainWindow || BrowserWindow.getFocusedWindow()!, {
      defaultPath: defaultFilename,
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
      title: 'Exporter en Excel',
    });

    if (result.canceled || !result.filePath) {
      return {
        success: false,
        error: 'Export cancelled',
      };
    }

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Gestion des Arrivages';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Données', {
      views: [{ state: 'frozen', ySplit: 1 }], // Freeze header row
    });

    // Define columns
    worksheet.columns = [
      { header: 'Référence', key: 'reference', width: 15 },
      { header: 'Désignation', key: 'designation', width: 30 },
      { header: 'Marque', key: 'brand', width: 15 },
      { header: 'Fournisseur', key: 'supplierName', width: 20 },
      { header: 'Téléphone', key: 'supplierPhone', width: 15 },
      { header: 'Réf. Constructeur', key: 'constructorRef', width: 18 },
      { header: 'Prix', key: 'price', width: 12 },
      { header: 'Date', key: 'entryDate', width: 12 },
      { header: 'Notes', key: 'notes', width: 25 },
    ];

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2563EB' }, // Primary blue
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25;

    // Add data
    entries.forEach((entry) => {
      worksheet.addRow({
        reference: entry.reference,
        designation: entry.designation,
        brand: entry.brand,
        supplierName: entry.supplierName,
        supplierPhone: entry.supplierPhone || '',
        constructorRef: entry.constructorRef || '',
        price: entry.price,
        entryDate: formatDate(entry.entryDate),
        notes: entry.notes || '',
      });
    });

    // Format price column
    worksheet.getColumn('price').numFmt = '#,##0.00 "MAD"';
    worksheet.getColumn('price').alignment = { horizontal: 'right' };

    // Add alternating row colors
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1 && rowNumber % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF3F4F6' }, // Light gray
        };
      }
    });

    // Add auto-filter
    worksheet.autoFilter = {
      from: 'A1',
      to: `I${entries.length + 1}`,
    };

    // Write file
    await workbook.xlsx.writeFile(result.filePath);

    return {
      success: true,
      filePath: result.filePath,
      rowCount: entries.length,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed',
    };
  }
}
