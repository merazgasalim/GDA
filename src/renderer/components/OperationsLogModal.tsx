/**
 * Operations Log Modal
 * ====================
 * Displays the full history of data operations for auditability.
 * Allows users to view operation details and abandon completed operations.
 * 
 * DESIGN PRINCIPLES:
 * - Full transparency: Users can see all operations that modified their data
 * - Safe abandonment: Clear warnings before abandoning any operation
 * - Non-destructive: Abandoned data is soft-deleted, not permanently removed
 * 
 * COLUMNS DISPLAYED:
 * - Date: When the operation was performed
 * - Type: IMPORT, MANUAL_ADD, BULK_EDIT, etc.
 * - Row count: Number of records affected
 * - Status: COMPLETED, ABANDONED, PENDING, FAILED
 * - Source: Import source (clipboard, file name, etc.)
 * - Actions: Abandon button (only for COMPLETED operations)
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../store';
import type { OperationLogDisplay, OperationType, OperationStatus } from '../../shared/types';
import type { OperationListResult } from '../../shared/ipc-api';

// ===========================================
// HELPER FUNCTIONS
// ===========================================

/**
 * Format operation type for display (French labels)
 */
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

/**
 * Format operation status for display with color
 */
function getStatusBadge(status: OperationStatus): { label: string; className: string } {
  const badges: Record<OperationStatus, { label: string; className: string }> = {
    COMPLETED: { label: 'Terminé', className: 'bg-green-100 text-green-800' },
    ABANDONED: { label: 'Abandonné', className: 'bg-red-100 text-red-800' },
    PENDING: { label: 'En cours', className: 'bg-yellow-100 text-yellow-800' },
    FAILED: { label: 'Échoué', className: 'bg-red-100 text-red-800' },
  };
  return badges[status] || { label: status, className: 'bg-gray-100 text-gray-800' };
}

/**
 * Format date for display
 */
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

/**
 * Get source description from metadata
 */
function getSourceDescription(op: OperationLogDisplay): string {
  if (op.metadata?.source) {
    if (op.metadata.source === 'clipboard') {
      return 'Presse-papiers';
    }
    if (op.metadata.originalFilename) {
      return op.metadata.originalFilename;
    }
    return op.metadata.source;
  }
  if (op.description) {
    return op.description;
  }
  return '-';
}

// ===========================================
// ABANDON CONFIRMATION DIALOG
// ===========================================

interface AbandonConfirmDialogProps {
  operation: OperationLogDisplay;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

const AbandonConfirmDialog: React.FC<AbandonConfirmDialogProps> = ({
  operation,
  onConfirm,
  onCancel,
}) => {
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    setIsLoading(true);
    await onConfirm(reason);
    setIsLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-red-600 px-6 py-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Abandonner l'opération
          </h3>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800 text-sm font-medium mb-2">
              ⚠️ Attention: Cette action est irréversible!
            </p>
            <p className="text-yellow-700 text-sm">
              L'abandon de cette opération va masquer <strong>{operation.rowCount} enregistrement(s)</strong> de vos données.
              Les données ne seront pas supprimées mais ne seront plus visibles dans les recherches.
            </p>
          </div>

          <div className="mb-4">
            <h4 className="font-medium text-gray-900 mb-2">Détails de l'opération:</h4>
            <div className="bg-gray-50 p-3 rounded-lg text-sm">
              <div className="grid grid-cols-2 gap-2">
                <span className="text-gray-500">Type:</span>
                <span className="text-gray-900">{formatOperationType(operation.type)}</span>
                <span className="text-gray-500">Date:</span>
                <span className="text-gray-900">{formatDate(operation.createdAt)}</span>
                <span className="text-gray-500">Lignes:</span>
                <span className="text-gray-900">{operation.rowCount}</span>
                <span className="text-gray-500">Source:</span>
                <span className="text-gray-900">{getSourceDescription(operation)}</span>
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Raison de l'abandon (optionnel):
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Données importées par erreur..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
              rows={2}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
          >
            {isLoading && (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            Confirmer l'abandon
          </button>
        </div>
      </div>
    </div>
  );
};

// ===========================================
// OPERATIONS LOG MODAL
// ===========================================

export const OperationsLogModal: React.FC = () => {
  const isOpen = useAppStore((state) => state.isOperationsLogOpen);
  const closeModal = useAppStore((state) => state.closeOperationsLog);
  const licenseStatus = useAppStore((state) => state.licenseStatus);
  const refreshData = useAppStore((state) => state.refreshData);
  
  const [operations, setOperations] = useState<OperationLogDisplay[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [abandoningOperation, setAbandoningOperation] = useState<OperationLogDisplay | null>(null);

  const pageSize = 10;

  // Fetch operations
  const fetchOperations = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result: OperationListResult = await window.electronApi.operations.getList(page, pageSize);
      setOperations(result.data);
      setTotalPages(result.totalPages);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du chargement');
      console.error('Failed to fetch operations:', err);
    } finally {
      setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (isOpen) {
      fetchOperations();
    }
  }, [isOpen, fetchOperations]);

  // Handle abandon operation
  const handleAbandon = async (reason: string) => {
    if (!abandoningOperation) return;

    try {
      const result = await window.electronApi.operations.abandon(abandoningOperation.id, reason);
      if (result.success) {
        // Refresh operations list
        await fetchOperations();
        // Refresh main data grid to reflect changes
        await refreshData();
        setAbandoningOperation(null);
      } else {
        setError(result.error || 'Échec de l\'abandon');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'abandon');
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40">
        <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full mx-4 max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Historique des opérations</h2>
                <p className="text-sm text-gray-500">
                  {total} opération(s) au total
                </p>
              </div>
            </div>
            <button
              onClick={closeModal}
              className="text-gray-400 hover:text-gray-600 p-2"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-6">
            {/* Info banner */}
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-blue-800 text-sm">
                <strong>💡 Système d'audit:</strong> Ce journal enregistre toutes les modifications de données.
                L'abandon d'une opération masque les données associées sans les supprimer définitivement,
                préservant ainsi l'intégrité historique.
              </p>
            </div>

            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {error}
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <svg className="animate-spin w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            ) : operations.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p>Aucune opération enregistrée</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Date</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Type</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">Lignes</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Statut</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Source</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operations.map((op) => {
                      const statusBadge = getStatusBadge(op.status);
                      const canAbandon = op.status === 'COMPLETED' && licenseStatus.isValid;
                      
                      return (
                        <tr key={op.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 px-4 text-sm text-gray-900">
                            {formatDate(op.createdAt)}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-900">
                            {formatOperationType(op.type)}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-900 text-right font-mono">
                            {op.rowCount.toLocaleString()}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${statusBadge.className}`}>
                              {statusBadge.label}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-500 max-w-xs truncate">
                            {getSourceDescription(op)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {canAbandon ? (
                              <button
                                onClick={() => setAbandoningOperation(op)}
                                className="text-sm text-red-600 hover:text-red-800 font-medium"
                              >
                                Abandonner
                              </button>
                            ) : op.status === 'COMPLETED' && !licenseStatus.isValid ? (
                              <span className="text-xs text-gray-400">Licence requise</span>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between flex-shrink-0">
              <div className="text-sm text-gray-500">
                Page {page} sur {totalPages}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Précédent
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Suivant
                </button>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end flex-shrink-0">
            <button
              onClick={closeModal}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>

      {/* Abandon confirmation dialog */}
      {abandoningOperation && (
        <AbandonConfirmDialog
          operation={abandoningOperation}
          onConfirm={handleAbandon}
          onCancel={() => setAbandoningOperation(null)}
        />
      )}
    </>
  );
};
