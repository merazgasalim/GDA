/**
 * Duplicate Strategy Modal
 * ========================
 * Modal dialog for selecting how to handle duplicate references during import.
 * 
 * CRITICAL DESIGN:
 * - NO default selection - user MUST explicitly choose
 * - NO auto-continue - prevents accidental data modifications
 * - Clear explanation of what each option does
 * 
 * This modal appears ONLY when duplicates are detected, BEFORE any database writes.
 */

import React, { useState } from 'react';
import { DuplicateStrategy, DuplicateAnalysisResult } from '../../shared/types';

interface DuplicateStrategyModalProps {
  isOpen: boolean;
  analysis: DuplicateAnalysisResult;
  supplierName: string;
  onStrategySelect: (strategy: DuplicateStrategy) => void;
  onClose: () => void;
}

const DuplicateStrategyModal: React.FC<DuplicateStrategyModalProps> = ({
  isOpen,
  analysis,
  supplierName,
  onStrategySelect,
  onClose,
}) => {
  // No default selection - user must explicitly choose
  const [selectedStrategy, setSelectedStrategy] = useState<DuplicateStrategy | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (selectedStrategy) {
      onStrategySelect(selectedStrategy);
    }
  };

  const formatPrice = (price: number | null): string => {
    if (price === null) return 'N/A';
    return price.toLocaleString('fr-DZ', { 
      style: 'currency', 
      currency: 'DZD',
      minimumFractionDigits: 2,
    });
  };

  const formatDate = (date: Date): string => {
    return new Date(date).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal-content max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header border-b border-gray-200 bg-amber-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
                />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Références en double détectées
              </h2>
              <p className="text-sm text-amber-700">
                Action requise avant l'import
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="modal-body flex-1 overflow-y-auto space-y-4">
          {/* Summary */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-green-600">{analysis.summary.newCount}</div>
                <div className="text-xs text-gray-600">Nouvelles références</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-amber-600">{analysis.summary.duplicateCount}</div>
                <div className="text-xs text-gray-600">Références existantes</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">{analysis.summary.invalidCount}</div>
                <div className="text-xs text-gray-600">Lignes invalides</div>
              </div>
            </div>
          </div>

          {/* Explanation */}
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-800">
            <p className="font-medium mb-1">Qu'est-ce qu'un doublon?</p>
            <p>
              Une référence est considérée comme un doublon si elle existe déjà dans la base 
              pour le fournisseur <span className="font-semibold">{supplierName}</span>.
              Les prix différents ne sont pas des doublons, ce sont des mises à jour.
            </p>
          </div>

          {/* Duplicate details (collapsible) */}
          {analysis.duplicateRows.length > 0 && (
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="w-full px-4 py-2 bg-gray-50 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 flex justify-between items-center"
              >
                <span>Voir les doublons détectés ({analysis.duplicateRows.length})</span>
                <svg 
                  className={`w-5 h-5 transition-transform ${showDetails ? 'rotate-180' : ''}`} 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {showDetails && (
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">Référence</th>
                        <th className="px-3 py-2 text-right">Prix existant</th>
                        <th className="px-3 py-2 text-right">Nouveau prix</th>
                        <th className="px-3 py-2 text-center">Date existante</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {analysis.duplicateRows.slice(0, 50).map((dup, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-mono">{dup.reference}</td>
                          <td className="px-3 py-2 text-right">{formatPrice(dup.existingPrice)}</td>
                          <td className="px-3 py-2 text-right">
                            {dup.newPrice !== null && dup.newPrice !== dup.existingPrice ? (
                              <span className={dup.newPrice > dup.existingPrice ? 'text-red-600' : 'text-green-600'}>
                                {formatPrice(dup.newPrice)}
                              </span>
                            ) : (
                              formatPrice(dup.newPrice)
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">{formatDate(dup.existingDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {analysis.duplicateRows.length > 50 && (
                    <div className="px-3 py-2 text-xs text-gray-500 text-center bg-gray-50">
                      ... et {analysis.duplicateRows.length - 50} autres doublons
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Intra-CSV duplicates warning */}
          {analysis.intraCsvDuplicates.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
              <p className="text-sm font-medium text-yellow-800 mb-1">
                ⚠️ Doublons dans le fichier CSV ({analysis.intraCsvDuplicates.length} références)
              </p>
              <p className="text-xs text-yellow-700">
                Certaines références apparaissent plusieurs fois dans votre fichier CSV. 
                Seule la dernière occurrence de chaque référence sera importée.
              </p>
            </div>
          )}

          {/* Strategy selection */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">
              Choisissez comment traiter les {analysis.summary.duplicateCount} référence(s) en double:
            </p>

            {/* Option 1: Skip */}
            <label 
              className={`block border rounded-lg p-4 cursor-pointer transition-all ${
                selectedStrategy === 'skip' 
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' 
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="strategy"
                  value="skip"
                  checked={selectedStrategy === 'skip'}
                  onChange={() => setSelectedStrategy('skip')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">Ignorer les doublons</div>
                  <p className="text-sm text-gray-600 mt-1">
                    N'importer que les <span className="font-semibold text-green-600">{analysis.summary.newCount}</span> nouvelles références.
                    Les {analysis.summary.duplicateCount} doublons seront ignorés et les prix existants conservés.
                  </p>
                  <div className="mt-2 text-xs text-gray-500 bg-gray-100 rounded px-2 py-1 inline-block">
                    Résultat: {analysis.summary.newCount} lignes importées, {analysis.summary.duplicateCount} ignorées
                  </div>
                </div>
              </div>
            </label>

            {/* Option 2: Update */}
            <label 
              className={`block border rounded-lg p-4 cursor-pointer transition-all ${
                selectedStrategy === 'update' 
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' 
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="strategy"
                  value="update"
                  checked={selectedStrategy === 'update'}
                  onChange={() => setSelectedStrategy('update')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">Mettre à jour les prix</div>
                  <p className="text-sm text-gray-600 mt-1">
                    Importer toutes les lignes. Les anciens prix seront archivés (historique conservé) 
                    et remplacés par les nouveaux prix.
                  </p>
                  <div className="mt-2 text-xs text-gray-500 bg-gray-100 rounded px-2 py-1 inline-block">
                    Résultat: {analysis.summary.newCount + analysis.summary.duplicateCount} lignes importées, 
                    {analysis.summary.duplicateCount} prix mis à jour
                  </div>
                </div>
              </div>
            </label>

            {/* Option 3: Abort */}
            <label 
              className={`block border rounded-lg p-4 cursor-pointer transition-all ${
                selectedStrategy === 'abort' 
                  ? 'border-red-500 bg-red-50 ring-2 ring-red-200' 
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="strategy"
                  value="abort"
                  checked={selectedStrategy === 'abort'}
                  onChange={() => setSelectedStrategy('abort')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">Annuler l'import</div>
                  <p className="text-sm text-gray-600 mt-1">
                    Ne rien importer. Vous serez renvoyé à l'étape de mapping pour modifier 
                    votre fichier ou vos paramètres.
                  </p>
                  <div className="mt-2 text-xs text-gray-500 bg-gray-100 rounded px-2 py-1 inline-block">
                    Résultat: Aucune modification
                  </div>
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer border-t border-gray-200 flex justify-between">
          <button onClick={onClose} className="btn btn-secondary">
            Retour
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedStrategy}
            className={`btn ${
              selectedStrategy === 'abort' 
                ? 'btn-secondary' 
                : selectedStrategy === 'update'
                ? 'btn-warning'
                : 'btn-primary'
            }`}
          >
            {!selectedStrategy ? (
              'Sélectionnez une option'
            ) : selectedStrategy === 'abort' ? (
              'Annuler l\'import'
            ) : selectedStrategy === 'update' ? (
              <>
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" 
                  />
                </svg>
                Mettre à jour et continuer
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M13 5l7 7-7 7M5 5l7 7-7 7" 
                  />
                </svg>
                Ignorer les doublons et continuer
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DuplicateStrategyModal;
