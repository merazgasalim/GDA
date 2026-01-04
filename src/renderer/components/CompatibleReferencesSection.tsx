/**
 * Compatible References Section
 * =============================
 * Displays and manages compatible/interchangeable product references.
 * 
 * DESIGN PRINCIPLES:
 * 1. Explicit display - clearly shows compatibility relations
 * 2. Non-ambiguous - labels distinguish primary vs compatible refs
 * 3. Auditable - shows who added each relation and when
 * 4. Searchable - integrates with product search
 * 
 * FEATURES:
 * - Table view of compatible references
 * - Add new compatibility modal trigger
 * - Remove compatibility (soft-delete)
 * - View product details on click
 * - Relation type badges
 * 
 * UX RULES:
 * - Never auto-redirect silently
 * - Always show when a reference is a compatibility result
 * - Clear icons/labels to differentiate
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  CompatibilityWithDetails,
  CompatibilitySummary,
  CompatibilityRelationType,
} from '../../shared/types';
import {
  COMPATIBILITY_RELATION_LABELS,
  COMPATIBILITY_RELATION_DESCRIPTIONS,
} from '../../shared/types';
import { AddCompatibilityModal } from './AddCompatibilityModal';

// ===========================================
// TYPES
// ===========================================

interface CompatibleReferencesSectionProps {
  /** The product ID to show compatibilities for */
  productId: string;
  /** The product's reference for display */
  productReference: string;
  /** Whether to include incoming relations (where this product is target) */
  includeIncoming?: boolean;
  /** Callback when user clicks on a compatible product */
  onProductClick?: (productId: string) => void;
  /** Whether the section is read-only (no add/remove) */
  readOnly?: boolean;
}

// ===========================================
// UTILITY FUNCTIONS
// ===========================================

/**
 * Get CSS classes for relation type badge
 */
function getRelationTypeBadgeClasses(type: CompatibilityRelationType): string {
  const baseClasses = 'px-2 py-0.5 text-xs font-medium rounded-full';
  switch (type) {
    case 'EQUIVALENT':
      return `${baseClasses} bg-green-100 text-green-800`;
    case 'SUBSTITUTE':
      return `${baseClasses} bg-blue-100 text-blue-800`;
    case 'OEM_ALTERNATIVE':
      return `${baseClasses} bg-purple-100 text-purple-800`;
    default:
      return `${baseClasses} bg-gray-100 text-gray-800`;
  }
}

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date));
}

/**
 * Format price for display
 */
function formatPrice(price: number | null): string {
  if (price === null) return 'N/A';
  return new Intl.NumberFormat('fr-DZ', {
    style: 'currency',
    currency: 'DZD',
    minimumFractionDigits: 0,
  }).format(price);
}

// ===========================================
// ICONS
// ===========================================

const PlusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const LinkIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
  </svg>
);

const ArrowRightIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
  </svg>
);

const ArrowLeftIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
);

const InfoIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

// ===========================================
// COMPONENT
// ===========================================

export const CompatibleReferencesSection: React.FC<CompatibleReferencesSectionProps> = ({
  productId,
  productReference,
  includeIncoming = true,
  onProductClick,
  readOnly = false,
}) => {
  // State
  const [compatibilities, setCompatibilities] = useState<CompatibilityWithDetails[]>([]);
  const [summary, setSummary] = useState<CompatibilitySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Fetch compatibilities
  const fetchCompatibilities = useCallback(async () => {
    if (!productId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const [compats, sum] = await Promise.all([
        window.electronApi.compatibility.getForProduct({
          productId,
          includeIncoming,
          includeInactive: false,
        }),
        window.electronApi.compatibility.getSummary(productId),
      ]);
      
      setCompatibilities(compats);
      setSummary(sum);
    } catch (err) {
      console.error('Failed to fetch compatibilities:', err);
      setError(err instanceof Error ? err.message : 'Failed to load compatibilities');
    } finally {
      setIsLoading(false);
    }
  }, [productId, includeIncoming]);

  // Initial fetch
  useEffect(() => {
    fetchCompatibilities();
  }, [fetchCompatibilities]);

  // Handle remove compatibility
  const handleRemove = async (compatibilityId: string, reference: string) => {
    const confirmed = await window.electronApi.dialog.showMessage({
      type: 'question',
      title: 'Supprimer la compatibilité',
      message: `Voulez-vous vraiment supprimer la compatibilité avec "${reference}" ?\n\nCette action est réversible (l'historique est conservé).`,
      buttons: ['Annuler', 'Supprimer'],
      defaultId: 0,
    });
    
    if (confirmed !== 1) return;
    
    setRemovingId(compatibilityId);
    
    try {
      const result = await window.electronApi.compatibility.remove(compatibilityId);
      
      if (result.success) {
        // Refresh list
        await fetchCompatibilities();
      } else {
        setError(result.error ?? 'Failed to remove compatibility');
      }
    } catch (err) {
      console.error('Failed to remove compatibility:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove compatibility');
    } finally {
      setRemovingId(null);
    }
  };

  // Handle add modal close
  const handleAddModalClose = (added: boolean) => {
    setIsAddModalOpen(false);
    if (added) {
      fetchCompatibilities();
    }
  };

  // Determine if relation is incoming (this product is target)
  const isIncoming = (compat: CompatibilityWithDetails) => 
    compat.targetProductId === productId;

  // ===========================================
  // RENDER
  // ===========================================

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LinkIcon className="w-5 h-5 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">
            Références Compatibles
          </h3>
          {summary && (summary.outgoingCount > 0 || summary.incomingCount > 0) && (
            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded-full">
              {summary.outgoingCount + summary.incomingCount}
            </span>
          )}
        </div>
        
        {!readOnly && (
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            Ajouter
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-sm text-red-600">{error}</p>
            <button
              onClick={fetchCompatibilities}
              className="mt-2 text-sm text-blue-600 hover:underline"
            >
              Réessayer
            </button>
          </div>
        ) : compatibilities.length === 0 ? (
          <div className="text-center py-8">
            <LinkIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-sm text-gray-500">
              Aucune référence compatible définie.
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Cliquez sur "Ajouter" pour définir des compatibilités.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary badges */}
            {summary && (
              <div className="flex flex-wrap gap-2 pb-3 border-b border-gray-100">
                {summary.byType.EQUIVALENT > 0 && (
                  <span className={getRelationTypeBadgeClasses('EQUIVALENT')}>
                    {summary.byType.EQUIVALENT} Équivalent{summary.byType.EQUIVALENT > 1 ? 's' : ''}
                  </span>
                )}
                {summary.byType.SUBSTITUTE > 0 && (
                  <span className={getRelationTypeBadgeClasses('SUBSTITUTE')}>
                    {summary.byType.SUBSTITUTE} Substitut{summary.byType.SUBSTITUTE > 1 ? 's' : ''}
                  </span>
                )}
                {summary.byType.OEM_ALTERNATIVE > 0 && (
                  <span className={getRelationTypeBadgeClasses('OEM_ALTERNATIVE')}>
                    {summary.byType.OEM_ALTERNATIVE} Alternative{summary.byType.OEM_ALTERNATIVE > 1 ? 's' : ''} OEM
                  </span>
                )}
                {summary.incomingCount > 0 && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
                    {summary.incomingCount} référence{summary.incomingCount > 1 ? 's' : ''} entrante{summary.incomingCount > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            )}

            {/* Compatibilities table */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Direction
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Référence
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Désignation
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Marque
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Prix
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Fournisseur
                    </th>
                    {!readOnly && (
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {compatibilities.map((compat) => {
                    const incoming = isIncoming(compat);
                    
                    return (
                      <tr
                        key={compat.id}
                        className={`hover:bg-gray-50 ${
                          incoming ? 'bg-yellow-50/50' : ''
                        }`}
                      >
                        {/* Direction indicator */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-1" title={
                            incoming
                              ? `${compat.reference} → ${productReference}`
                              : `${productReference} → ${compat.reference}`
                          }>
                            {incoming ? (
                              <>
                                <ArrowLeftIcon className="w-4 h-4 text-yellow-600" />
                                <span className="text-xs text-yellow-700">Entrant</span>
                              </>
                            ) : (
                              <>
                                <ArrowRightIcon className="w-4 h-4 text-green-600" />
                                <span className="text-xs text-green-700">Sortant</span>
                              </>
                            )}
                          </div>
                        </td>
                        
                        {/* Reference */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <button
                            onClick={() => onProductClick?.(
                              incoming ? compat.sourceProductId : compat.targetProductId
                            )}
                            className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {compat.reference}
                          </button>
                        </td>
                        
                        {/* Designation */}
                        <td className="px-3 py-2">
                          <div className="text-sm text-gray-900 max-w-xs truncate" title={compat.designation}>
                            {compat.designation}
                          </div>
                        </td>
                        
                        {/* Brand */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="text-sm text-gray-900">{compat.brand}</span>
                        </td>
                        
                        {/* Relation type */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span
                            className={getRelationTypeBadgeClasses(compat.relationType)}
                            title={`${COMPATIBILITY_RELATION_DESCRIPTIONS[compat.relationType]}\nAjouté le ${formatDate(compat.createdAt)} par ${compat.createdBy}`}
                          >
                            {COMPATIBILITY_RELATION_LABELS[compat.relationType]}
                          </span>
                        </td>
                        
                        {/* Price */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="text-sm text-gray-900">
                            {formatPrice(compat.price)}
                          </span>
                        </td>
                        
                        {/* Supplier */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="text-sm text-gray-500">{compat.supplierName}</span>
                        </td>
                        
                        {/* Actions */}
                        {!readOnly && (
                          <td className="px-3 py-2 whitespace-nowrap text-right">
                            {/* Only allow removal of outgoing relations */}
                            {!incoming && (
                              <button
                                onClick={() => handleRemove(compat.id, compat.reference)}
                                disabled={removingId === compat.id}
                                className="inline-flex items-center p-1 text-gray-400 hover:text-red-600 disabled:opacity-50 transition-colors"
                                title="Supprimer cette compatibilité"
                              >
                                {removingId === compat.id ? (
                                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600" />
                                ) : (
                                  <TrashIcon className="w-4 h-4" />
                                )}
                              </button>
                            )}
                            {incoming && (
                              <span
                                className="text-xs text-gray-400"
                                title="Les relations entrantes doivent être supprimées depuis le produit source"
                              >
                                —
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Note about compatibility */}
            <div className="flex items-start gap-2 p-3 bg-gray-50 rounded-md text-xs text-gray-600">
              <InfoIcon className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-700 mb-1">À propos des compatibilités</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>La compatibilité est <strong>directionnelle</strong> : A → B ne signifie pas B → A</li>
                  <li>Les stocks et prix ne sont <strong>pas fusionnés</strong></li>
                  <li>Chaque relation est <strong>traçable</strong> (audit)</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Compatibility Modal */}
      <AddCompatibilityModal
        isOpen={isAddModalOpen}
        onClose={handleAddModalClose}
        sourceProductId={productId}
        sourceProductReference={productReference}
      />
    </div>
  );
};

export default CompatibleReferencesSection;
