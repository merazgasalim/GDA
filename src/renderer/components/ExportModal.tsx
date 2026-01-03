/**
 * Export Modal Component
 * ======================
 * Handles CSV and XLSX export with license check.
 */

import React, { useState, useEffect } from 'react';
import { useAppStore, selectCanExport, selectHasActiveFilters } from '../store';
import type { ExportFormat } from '../../shared/types';

export const ExportModal: React.FC = () => {
  const isOpen = useAppStore((state) => state.isExportModalOpen);
  const closeExportModal = useAppStore((state) => state.closeExportModal);
  const canExport = useAppStore(selectCanExport);
  const hasActiveFilters = useAppStore(selectHasActiveFilters);
  const globalSearch = useAppStore((state) => state.globalSearch);
  const columnFilters = useAppStore((state) => state.columnFilters);
  const totalEntries = useAppStore((state) => state.totalEntries);
  const openLicenseModal = useAppStore((state) => state.openLicenseModal);

  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [exportFiltered, setExportFiltered] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setResult(null);
    }
  }, [isOpen]);

  const handleExport = async () => {
    setIsExporting(true);
    setResult(null);

    try {
      const options = {
        format,
        filters: exportFiltered ? columnFilters : undefined,
        globalSearch: exportFiltered ? globalSearch : undefined,
      };

      const exportFn = format === 'csv'
        ? window.electronApi.export.csv
        : window.electronApi.export.xlsx;

      const exportResult = await exportFn(options);

      if (exportResult.success) {
        setResult({
          success: true,
          message: `${exportResult.rowCount} entrées exportées vers ${exportResult.filePath}`,
        });
        setTimeout(closeExportModal, 2000);
      } else {
        setResult({
          success: false,
          message: exportResult.error || 'Erreur d\'exportation',
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'Erreur d\'exportation',
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={closeExportModal}>
      <div className="modal-content max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="text-lg font-semibold text-gray-900">
            Exporter les données
          </h2>
          <button onClick={closeExportModal} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-body space-y-4">
          {!canExport ? (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded-md">
              <p className="font-medium">Licence requise</p>
              <p className="text-sm mt-1">
                L'exportation nécessite une licence valide.{' '}
                <button
                  onClick={() => {
                    closeExportModal();
                    openLicenseModal();
                  }}
                  className="underline hover:no-underline"
                >
                  Activer ma licence
                </button>
              </p>
            </div>
          ) : (
            <>
              {/* Format Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Format
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="format"
                      value="xlsx"
                      checked={format === 'xlsx'}
                      onChange={() => setFormat('xlsx')}
                      className="mr-2"
                    />
                    <span className="text-sm">Excel (.xlsx)</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="format"
                      value="csv"
                      checked={format === 'csv'}
                      onChange={() => setFormat('csv')}
                      className="mr-2"
                    />
                    <span className="text-sm">CSV (.csv)</span>
                  </label>
                </div>
              </div>

              {/* Filter Option */}
              {hasActiveFilters && (
                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={exportFiltered}
                      onChange={(e) => setExportFiltered(e.target.checked)}
                      className="mr-2"
                    />
                    <span className="text-sm">
                      Appliquer les filtres actuels ({totalEntries} entrées)
                    </span>
                  </label>
                </div>
              )}

              {/* Summary */}
              <div className="bg-gray-50 p-4 rounded-md">
                <p className="text-sm text-gray-600">
                  {exportFiltered && hasActiveFilters
                    ? `Export des ${totalEntries} entrées filtrées`
                    : 'Export de toutes les entrées'}
                  {' '}au format {format === 'xlsx' ? 'Excel' : 'CSV'}
                </p>
              </div>

              {/* Result */}
              {result && (
                <div
                  className={`p-4 rounded-md ${
                    result.success
                      ? 'bg-green-50 border border-green-200 text-green-800'
                      : 'bg-red-50 border border-red-200 text-red-800'
                  }`}
                >
                  {result.message}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={closeExportModal} className="btn btn-secondary">
            Annuler
          </button>
          {canExport && (
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="btn btn-primary"
            >
              {isExporting ? (
                <>
                  <div className="spinner w-4 h-4 mr-2" />
                  Exportation...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Exporter
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
