/**
 * Incomplete Operations Dialog
 * ============================
 * Displayed on app startup when there are PENDING operations from a potential crash.
 * 
 * CRASH RECOVERY FLOW:
 * 1. App detects PENDING operations that never completed
 * 2. This dialog shows, asking user to resolve each incomplete operation
 * 3. User can either:
 *    - Finalize: Mark operation as COMPLETED (if data looks valid)
 *    - Abandon: Mark operation as ABANDONED and soft-delete related records
 * 4. App continues normally after all pending operations are resolved
 * 
 * WHY THIS MATTERS:
 * If the app crashes mid-import, data may be partially written. Without resolution,
 * this partial data would be invisible (PENDING operations are filtered out of queries).
 * The user must explicitly decide whether to keep or discard this data.
 */

import React, { useEffect, useState } from 'react';
import type { IncompleteOperation, OperationType } from '../../shared/types';

// ===========================================
// HELPER FUNCTIONS
// ===========================================

function formatOperationType(type: OperationType): string {
  const labels: Record<OperationType, string> = {
    IMPORT: 'Import',
    MANUAL_ADD: 'Ajout manuel',
    BULK_EDIT: 'Modification en masse',
    BULK_DELETE: 'Suppression en masse',
    SYSTEM_MIGRATE: 'Migration système',
  };
  return labels[type] || type;
}

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ===========================================
// INCOMPLETE OPERATIONS DIALOG
// ===========================================

interface IncompleteOperationsDialogProps {
  isOpen: boolean;
  onComplete: () => void;
}

export const IncompleteOperationsDialog: React.FC<IncompleteOperationsDialogProps> = ({
  isOpen,
  onComplete,
}) => {
  const [operations, setOperations] = useState<IncompleteOperation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch incomplete operations on mount
  useEffect(() => {
    if (isOpen) {
      fetchIncompleteOperations();
    }
  }, [isOpen]);

  const fetchIncompleteOperations = async () => {
    setIsLoading(true);
    try {
      const result = await window.electronApi.operations.getIncomplete();
      setOperations(result);
      
      // If no incomplete operations, auto-close
      if (result.length === 0) {
        onComplete();
      }
    } catch (err) {
      console.error('Failed to fetch incomplete operations:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinalize = async (operationId: string) => {
    setProcessingId(operationId);
    setError(null);
    try {
      const success = await window.electronApi.operations.finalizePending(operationId);
      if (success) {
        // Remove from list
        setOperations((ops) => ops.filter((op) => op.id !== operationId));
        
        // Check if all resolved
        if (operations.length === 1) {
          onComplete();
        }
      } else {
        setError('Échec de la finalisation');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la finalisation');
    } finally {
      setProcessingId(null);
    }
  };

  const handleAbandon = async (operationId: string) => {
    setProcessingId(operationId);
    setError(null);
    try {
      const result = await window.electronApi.operations.abandonPending(operationId, 'Résolution après crash');
      if (result.success) {
        // Remove from list
        setOperations((ops) => ops.filter((op) => op.id !== operationId));
        
        // Check if all resolved
        if (operations.length === 1) {
          onComplete();
        }
      } else {
        setError(result.error || 'Échec de l\'abandon');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'abandon');
    } finally {
      setProcessingId(null);
    }
  };

  if (!isOpen || (operations.length === 0 && !isLoading)) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-yellow-500 px-6 py-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Opérations incomplètes détectées
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {/* Explanation */}
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800 text-sm">
              <strong>⚠️ Attention:</strong> L'application a détecté des opérations qui n'ont pas été terminées
              correctement (peut-être suite à une fermeture inattendue).
            </p>
            <p className="text-yellow-700 text-sm mt-2">
              Veuillez décider du sort de chaque opération:
            </p>
            <ul className="text-yellow-700 text-sm mt-1 ml-4 list-disc">
              <li><strong>Conserver:</strong> Les données seront marquées comme valides et visibles</li>
              <li><strong>Abandonner:</strong> Les données seront masquées (non supprimées)</li>
            </ul>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <svg className="animate-spin w-8 h-8 text-yellow-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : (
            <div className="space-y-4">
              {operations.map((op) => (
                <div
                  key={op.id}
                  className="border border-gray-200 rounded-lg p-4 bg-gray-50"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-medium text-gray-900">
                        {formatOperationType(op.type)}
                      </h4>
                      <div className="text-sm text-gray-500 mt-1">
                        <span>Date: {formatDate(op.createdAt)}</span>
                        <span className="mx-2">•</span>
                        <span>{op.rowCount} ligne(s) trouvée(s)</span>
                      </div>
                      {op.description && (
                        <p className="text-sm text-gray-600 mt-1">{op.description}</p>
                      )}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleFinalize(op.id)}
                        disabled={processingId !== null}
                        className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        {processingId === op.id ? (
                          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        Conserver
                      </button>
                      <button
                        onClick={() => handleAbandon(op.id)}
                        disabled={processingId !== null}
                        className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        {processingId === op.id ? (
                          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                        Abandonner
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
