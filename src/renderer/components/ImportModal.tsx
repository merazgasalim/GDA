/**
 * Import Modal Component
 * ======================
 * Handles Excel data import via copy-paste.
 * 
 * WORKFLOW:
 * 1. User pastes data into textarea
 * 2. Data is parsed and validated
 * 3. Preview is shown with errors highlighted
 * 4. User confirms import
 * 5. Data is saved to database
 */

import React, { useState, useCallback } from 'react';
import { useAppStore, selectCanImport } from '../store';
import type { ImportPreview } from '../../shared/types';

export const ImportModal: React.FC = () => {
  const isOpen = useAppStore((state) => state.isImportModalOpen);
  const closeImportModal = useAppStore((state) => state.closeImportModal);
  const canImport = useAppStore(selectCanImport);
  const refreshData = useAppStore((state) => state.refreshData);
  const openLicenseModal = useAppStore((state) => state.openLicenseModal);

  const [rawText, setRawText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleParse = useCallback(async () => {
    if (!rawText.trim()) return;

    setIsParsing(true);
    setPreview(null);
    setImportResult(null);

    try {
      const result = await window.electronApi.import.parseClipboard(rawText);
      setPreview(result);
    } catch (error) {
      setImportResult({
        success: false,
        message: error instanceof Error ? error.message : 'Erreur de parsing',
      });
    } finally {
      setIsParsing(false);
    }
  }, [rawText]);

  const handleImport = useCallback(async () => {
    if (!preview || preview.rows.length === 0) return;

    setIsImporting(true);
    setImportResult(null);

    try {
      const result = await window.electronApi.import.execute(preview.rows as any);
      
      if (result.success) {
        setImportResult({
          success: true,
          message: `${result.importedCount} entrées importées avec succès!`,
        });
        await refreshData();
        // Clear form after success
        setTimeout(() => {
          setRawText('');
          setPreview(null);
          closeImportModal();
        }, 2000);
      } else {
        setImportResult({
          success: false,
          message: result.errors[0]?.message || 'Erreur d\'importation',
        });
      }
    } catch (error) {
      setImportResult({
        success: false,
        message: error instanceof Error ? error.message : 'Erreur d\'importation',
      });
    } finally {
      setIsImporting(false);
    }
  }, [preview, refreshData, closeImportModal]);

  const handleClose = () => {
    setRawText('');
    setPreview(null);
    setImportResult(null);
    closeImportModal();
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setRawText(text);
    } catch (error) {
      console.error('Failed to read clipboard:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="text-lg font-semibold text-gray-900">
            Importer des données
          </h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-body space-y-4">
          {!canImport ? (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded-md">
              <p className="font-medium">Licence requise</p>
              <p className="text-sm mt-1">
                L'importation nécessite une licence valide.{' '}
                <button
                  onClick={() => {
                    handleClose();
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
              {/* Instructions */}
              <div className="bg-blue-50 border border-blue-200 text-blue-800 p-4 rounded-md text-sm">
                <p className="font-medium mb-2">Instructions:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Copiez les données depuis Excel (sélectionnez les cellules, Ctrl+C)</li>
                  <li>Collez-les dans la zone ci-dessous (Ctrl+V)</li>
                  <li>Cliquez sur "Analyser" pour prévisualiser</li>
                  <li>Vérifiez les données et confirmez l'import</li>
                </ol>
                <p className="mt-2 text-xs">
                  Colonnes attendues: Référence, Désignation, Marque, Fournisseur, Téléphone, Réf. Constructeur, Prix, Date
                </p>
              </div>

              {/* Paste Area */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Données à importer
                  </label>
                  <button
                    onClick={handlePaste}
                    className="btn btn-secondary btn-sm"
                  >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    Coller
                  </button>
                </div>
                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="Collez vos données Excel ici..."
                  className="input font-mono text-xs h-40 resize-none"
                />
              </div>

              {/* Parse Button */}
              {!preview && (
                <div className="flex justify-end">
                  <button
                    onClick={handleParse}
                    disabled={isParsing || !rawText.trim()}
                    className="btn btn-primary"
                  >
                    {isParsing ? (
                      <>
                        <div className="spinner w-4 h-4 mr-2" />
                        Analyse...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                        </svg>
                        Analyser
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Preview */}
              {preview && (
                <div className="space-y-4">
                  {/* Stats */}
                  <div className="flex gap-4">
                    <div className="badge badge-blue">
                      Total: {preview.totalParsed} lignes
                    </div>
                    <div className="badge badge-green">
                      Valides: {preview.validCount}
                    </div>
                    {preview.invalidCount > 0 && (
                      <div className="badge badge-red">
                        Erreurs: {preview.invalidCount}
                      </div>
                    )}
                  </div>

                  {/* Errors */}
                  {preview.errors.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-md p-3 max-h-32 overflow-y-auto">
                      <p className="font-medium text-red-800 text-sm mb-2">Erreurs détectées:</p>
                      <ul className="text-xs text-red-700 space-y-1">
                        {preview.errors.slice(0, 10).map((err, i) => (
                          <li key={i}>
                            Ligne {err.row}: {err.message}
                            {err.column && ` (${err.column})`}
                          </li>
                        ))}
                        {preview.errors.length > 10 && (
                          <li>... et {preview.errors.length - 10} autres erreurs</li>
                        )}
                      </ul>
                    </div>
                  )}

                  {/* Preview Table */}
                  {preview.rows.length > 0 && (
                    <div className="border border-gray-200 rounded-md overflow-hidden">
                      <div className="max-h-64 overflow-auto">
                        <table className="data-grid text-xs">
                          <thead>
                            <tr>
                              <th>Réf.</th>
                              <th>Désignation</th>
                              <th>Marque</th>
                              <th>Fournisseur</th>
                              <th>Prix</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.rows.slice(0, 20).map((row, i) => (
                              <tr key={i}>
                                <td className="font-mono">{row.reference}</td>
                                <td>{row.designation}</td>
                                <td>{row.brand}</td>
                                <td>{row.supplierName}</td>
                                <td className="text-right font-mono">
                                  {row.price.toFixed(2)} MAD
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {preview.rows.length > 20 && (
                        <div className="bg-gray-50 px-4 py-2 text-xs text-gray-500 text-center">
                          Affichage de 20 sur {preview.rows.length} lignes
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Result Message */}
              {importResult && (
                <div
                  className={`p-4 rounded-md ${
                    importResult.success
                      ? 'bg-green-50 border border-green-200 text-green-800'
                      : 'bg-red-50 border border-red-200 text-red-800'
                  }`}
                >
                  {importResult.message}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          {preview && (
            <button
              onClick={() => setPreview(null)}
              className="btn btn-secondary"
            >
              Modifier
            </button>
          )}
          <button onClick={handleClose} className="btn btn-secondary">
            Annuler
          </button>
          {preview && preview.rows.length > 0 && canImport && (
            <button
              onClick={handleImport}
              disabled={isImporting}
              className="btn btn-success"
            >
              {isImporting ? (
                <>
                  <div className="spinner w-4 h-4 mr-2" />
                  Importation...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Importer {preview.validCount} entrées
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
