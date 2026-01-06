/**
 * Add Compatibility Modal
 * =======================
 * Modal for adding new product compatibility relations.
 * 
 * FLOW:
 * 1. Search existing products (typeahead by reference, designation, brand)
 * 2. Select target product from results
 * 3. Choose relation type (Equivalent, Substitute, OEM Alternative)
 * 4. Optional note field
 * 5. Save creates ProductCompatibility record + OperationLog
 * 
 * DESIGN DECISIONS:
 * - Minimum 2 chars for search to avoid flooding
 * - Shows existing relation status on search results
 * - Clear feedback on success/error
 * - Cannot select same product as source
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { debounce } from 'lodash';
import type {
  CompatibilityRelationType,
  CompatibilitySearchResult,
} from '../../shared/types';
import {
  COMPATIBILITY_RELATION_LABELS,
  COMPATIBILITY_RELATION_DESCRIPTIONS,
} from '../../shared/types';

// ===========================================
// TYPES
// ===========================================

interface AddCompatibilityModalProps {
  isOpen: boolean;
  onClose: (added: boolean) => void;
  sourceProductId: string;
  sourceProductReference: string;
}

interface FormState {
  targetProduct: CompatibilitySearchResult | null;
  relationType: CompatibilityRelationType;
  note: string;
}

type TargetKind = 'INTERNAL' | 'EXTERNAL';

// ===========================================
// ICONS
// ===========================================

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const SearchIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const LinkIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
  </svg>
);

const ExclamationIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

// ===========================================
// CONSTANTS
// ===========================================

const RELATION_TYPES: CompatibilityRelationType[] = [
  'EQUIVALENT',
  'SUBSTITUTE',
  'OEM_ALTERNATIVE',
];

// ===========================================
// UTILITY FUNCTIONS
// ===========================================

function formatPrice(price: number): string {
  return new Intl.NumberFormat('fr-DZ', {
    style: 'currency',
    currency: 'DZD',
    minimumFractionDigits: 0,
  }).format(price);
}

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

// ===========================================
// COMPONENT
// ===========================================

export const AddCompatibilityModal: React.FC<AddCompatibilityModalProps> = ({
  isOpen,
  onClose,
  sourceProductId,
  sourceProductReference,
}) => {
  // Form state
  const [formState, setFormState] = useState<FormState>({
    targetProduct: null,
    relationType: 'EQUIVALENT',
    note: '',
  });
  const [targetKind, setTargetKind] = useState<TargetKind>('INTERNAL');

  // External form fields
  const [externalRef, setExternalRef] = useState({ reference: '', designation: '', brand: '', notes: '' });
  // Track touched state for external fields
  const [touchedExternal, setTouchedExternal] = useState<{ reference: boolean; designation: boolean; brand: boolean }>({ reference: false, designation: false, brand: false });

  // Reset touched state when modal opens or targetKind changes
  useEffect(() => {
    if (isOpen || targetKind === 'EXTERNAL') {
      setTouchedExternal({ reference: false, designation: false, brand: false });
    }
  }, [isOpen, targetKind]);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CompatibilitySearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  
  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setFormState({
        targetProduct: null,
        relationType: 'EQUIVALENT',
        note: '',
      });
      setSearchQuery('');
      setSearchResults([]);
      setShowResults(false);
      setError(null);
      setSuccess(false);
      
      // Focus search input
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Debounced search
  const performSearch = useCallback(
    debounce(async (query: string) => {
      if (query.length < 2) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }
      
      setIsSearching(true);
      
      try {
        const results = await window.electronApi.compatibility.searchProducts(
          sourceProductId,
          query,
          20
        );
        setSearchResults(results);
        setShowResults(true);
      } catch (err) {
        console.error('Search failed:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300),
    [sourceProductId]
  );

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setError(null);
    
    if (value.length >= 2) {
      setIsSearching(true);
      performSearch(value);
    } else {
      setSearchResults([]);
      setShowResults(false);
    }
  };

  // Handle product selection
  const handleSelectProduct = (product: CompatibilitySearchResult) => {
    if (product.hasExistingRelation) {
      setError(`Cette référence a déjà une relation de type "${COMPATIBILITY_RELATION_LABELS[product.existingRelationType!]}"`);
      return;
    }
    setTargetKind(product.targetType ?? 'INTERNAL');
    setFormState(prev => ({
      ...prev,
      targetProduct: product,
    }));
    setSearchQuery(product.reference);
    setShowResults(false);
    setError(null);
  };

  // Handle relation type change
  const handleRelationTypeChange = (type: CompatibilityRelationType) => {
    setFormState(prev => ({
      ...prev,
      relationType: type,
    }));
  };

  // Handle note change
  const handleNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFormState(prev => ({
      ...prev,
      note: e.target.value,
    }));
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (targetKind === 'INTERNAL' && !formState.targetProduct) {
      setError('Veuillez sélectionner une référence compatible');
      return;
    }

    if (targetKind === 'EXTERNAL') {
      // If user selected an existing external reference from search
      if (!formState.targetProduct) {
        // validate external form
        if (!externalRef.reference.trim() || !externalRef.designation.trim()) {
          setError('Référence et désignation sont requises pour une référence externe');
          return;
        }
      }
    }
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      const input: any = {
        sourceProductId,
        relationType: formState.relationType,
        note: formState.note.trim() || null,
      };

      if (targetKind === 'INTERNAL') {
        input.targetType = 'INTERNAL';
        input.targetProductId = formState.targetProduct!.id;
      } else {
        input.targetType = 'EXTERNAL';
        // Remove targetProductId if present (should not be sent for EXTERNAL)
        if ('targetProductId' in input) {
          delete input.targetProductId;
        }
        if (formState.targetProduct && formState.targetProduct.targetType === 'EXTERNAL') {
          input.externalReferenceId = formState.targetProduct.id;
        } else {
          input.externalReference = {
            reference: externalRef.reference.trim(),
            designation: externalRef.designation.trim(),
            brand: externalRef.brand.trim() || '-', // Send '-' if empty to satisfy min length
            notes: externalRef.notes.trim() || undefined,
          };
        }
      }

      const result = await window.electronApi.compatibility.add(input as any);
      
      if (result.success) {
        setSuccess(true);
        // Close modal after brief delay to show success
        setTimeout(() => {
          onClose(true);
        }, 1000);
      } else {
        setError(result.error ?? 'Échec de l\'ajout de la compatibilité');
      }
    } catch (err) {
      console.error('Failed to add compatibility:', err);
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose(false);
      }
    };
    
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, isSubmitting, onClose]);

  // Compute whether the submit button should be enabled
  const canSubmit = (() => {
    if (isSubmitting || success) return false;
    // Internal target requires a selected product
    if (targetKind === 'INTERNAL') {
      return !!formState.targetProduct;
    }
    // External target: either an existing external product selected OR
    // a new external form filled with required fields
    if (targetKind === 'EXTERNAL') {
      if (formState.targetProduct) return true;
      const ref = externalRef.reference.trim();
      const des = externalRef.designation.trim();
      return ref.length > 0 && des.length > 0;
    }
    return false;
  })();

  // Click outside results to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        resultsRef.current &&
        !resultsRef.current.contains(e.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(e.target as Node)
      ) {
        setShowResults(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={() => !isSubmitting && onClose(false)}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-lg transform rounded-lg bg-white shadow-xl transition-all">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <LinkIcon className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">
                Ajouter une compatibilité
              </h2>
            </div>
            <button
              onClick={() => !isSubmitting && onClose(false)}
              disabled={isSubmitting}
              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
            >
              <XIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <form onSubmit={handleSubmit}>
            <div className="px-6 py-4 space-y-4">
              {/* Source product info */}
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Produit source</p>
                <p className="text-sm font-medium text-gray-900">{sourceProductReference}</p>
              </div>

              {/* Search for target product */}
              <div>
                {/* Target type selector */}
                <div className="mb-3 flex gap-3">
                  <label className={`px-3 py-1 rounded-md cursor-pointer ${targetKind === 'INTERNAL' ? 'bg-blue-50 border border-blue-200' : 'bg-white border border-gray-200'}`}>
                    <input type="radio" name="targetKind" checked={targetKind === 'INTERNAL'} onChange={() => setTargetKind('INTERNAL')} className="mr-2" /> Produit existant
                  </label>
                  <label className={`px-3 py-1 rounded-md cursor-pointer ${targetKind === 'EXTERNAL' ? 'bg-yellow-50 border border-yellow-200' : 'bg-white border border-gray-200'}`}>
                    <input type="radio" name="targetKind" checked={targetKind === 'EXTERNAL'} onChange={() => setTargetKind('EXTERNAL')} className="mr-2" /> Référence externe
                  </label>
                </div>

                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {targetKind === 'INTERNAL' ? 'Rechercher une référence compatible' : 'Ajouter ou sélectionner une référence externe'}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    {isSearching ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                    ) : (
                      <SearchIcon className="w-4 h-4 text-gray-400" />
                    )}
                  </div>
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={handleSearchChange}
                    onFocus={() => searchResults.length > 0 && setShowResults(true)}
                    placeholder={targetKind === 'INTERNAL' ? 'Rechercher par référence, désignation ou marque...' : 'Rechercher une référence externe (référence ou marque)'}
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    disabled={isSubmitting || success}
                  />
                  
                  {/* Search results dropdown */}
                  {showResults && searchResults.length > 0 && (
                    <div
                      ref={resultsRef}
                      className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto"
                    >
                      {searchResults.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => handleSelectProduct(product)}
                          className={`w-full text-left px-4 py-2 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none ${
                            product.hasExistingRelation ? 'opacity-60' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {product.reference}
                              </p>
                              <p className="text-xs text-gray-500 truncate">
                                {product.designation} • {product.brand}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-600">
                                {product.price !== null && product.price !== undefined ? formatPrice(product.price) : 'N/A'}
                              </span>
                              {product.targetType === 'EXTERNAL' && (
                                <span className="text-xs text-yellow-700">Référence externe</span>
                              )}
                              {product.hasExistingRelation && (
                                <span className={getRelationTypeBadgeClasses(product.existingRelationType!)}>
                                  {COMPATIBILITY_RELATION_LABELS[product.existingRelationType!]}
                                </span>
                              )}
                            </div>
                          </div>
                          {product.hasExistingRelation && (
                            <p className="text-xs text-yellow-600 mt-1">
                              Relation existante
                            </p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {/* No results message */}
                  {showResults && searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg p-4 text-center">
                      <p className="text-sm text-gray-500">Aucune référence trouvée</p>
                    </div>
                  )}
                </div>
                
                {/* Selected product display */}
                {formState.targetProduct && (
                  <div className="mt-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-blue-900">
                          {formState.targetProduct.reference}
                        </p>
                        <p className="text-xs text-blue-700">
                          {formState.targetProduct.designation} • {formState.targetProduct.brand} • {formState.targetProduct.supplierName}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setFormState(prev => ({ ...prev, targetProduct: null }));
                          setSearchQuery('');
                        }}
                        className="text-blue-600 hover:text-blue-800"
                        disabled={isSubmitting || success}
                      >
                        <XIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* External reference inline form (when creating a new external ref) */}
                {targetKind === 'EXTERNAL' && !formState.targetProduct && (
                  <div className="mt-2 p-3 bg-yellow-50 rounded-lg border border-yellow-200 space-y-2">
                    <div>
                      <label className="block text-xs text-gray-700">Référence</label>
                      <input
                        value={externalRef.reference}
                        onChange={e => {
                          setExternalRef((prev: typeof externalRef) => ({ ...prev, reference: e.target.value }));
                          setTouchedExternal((prev: typeof touchedExternal) => ({ ...prev, reference: true }));
                        }}
                        placeholder="Référence externe"
                        className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        disabled={isSubmitting || success}
                      />
                      {touchedExternal.reference && !externalRef.reference.trim() && (
                        <span className="text-xs text-red-600">Champ requis</span>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700">Désignation</label>
                      <input
                        value={externalRef.designation}
                        onChange={e => {
                          setExternalRef((prev: typeof externalRef) => ({ ...prev, designation: e.target.value }));
                          setTouchedExternal((prev: typeof touchedExternal) => ({ ...prev, designation: true }));
                        }}
                        placeholder="Désignation"
                        className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        disabled={isSubmitting || success}
                      />
                      {touchedExternal.designation && !externalRef.designation.trim() && (
                        <span className="text-xs text-red-600">Champ requis</span>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700">Marque <span className="text-gray-400">(optionnel)</span></label>
                      <input
                        value={externalRef.brand}
                        onChange={e => {
                          setExternalRef((prev: typeof externalRef) => ({ ...prev, brand: e.target.value }));
                          setTouchedExternal((prev: typeof touchedExternal) => ({ ...prev, brand: true }));
                        }}
                        placeholder="Marque (optionnel)"
                        className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        disabled={isSubmitting || success}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700">Notes (optionnel)</label>
                      <input
                        value={externalRef.notes}
                        onChange={e => setExternalRef((prev: typeof externalRef) => ({ ...prev, notes: e.target.value }))}
                        placeholder="Notes"
                        className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        disabled={isSubmitting || success}
                      />
                    </div>
                  </div>
                )}

              </div>

              {/* Relation type selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Type de relation
                </label>
                <div className="space-y-2">
                  {RELATION_TYPES.map((type) => (
                    <label
                      key={type}
                      className={`flex items-start p-3 border rounded-lg cursor-pointer transition-colors ${
                        formState.relationType === type
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="relationType"
                        value={type}
                        checked={formState.relationType === type}
                        onChange={() => handleRelationTypeChange(type)}
                        disabled={isSubmitting || success}
                        className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                      />
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">
                          {COMPATIBILITY_RELATION_LABELS[type]}
                        </p>
                        <p className="text-xs text-gray-500">
                          {COMPATIBILITY_RELATION_DESCRIPTIONS[type]}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Note field */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Note (optionnel)
                </label>
                <textarea
                  value={formState.note}
                  onChange={handleNoteChange}
                  placeholder="Ex: Même montage, marque différente"
                  rows={2}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={isSubmitting || success}
                />
              </div>

              {/* Error message */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-800 rounded-lg">
                  <ExclamationIcon className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm">{error}</p>
                </div>
              )}

              {/* Success message */}
              {success && (
                <div className="flex items-center gap-2 p-3 bg-green-50 text-green-800 rounded-lg">
                  <CheckIcon className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm">Compatibilité ajoutée avec succès!</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                type="button"
                onClick={() => onClose(false)}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 transition-colors"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Enregistrement...
                  </>
                ) : success ? (
                  <>
                    <CheckIcon className="w-4 h-4" />
                    Ajouté!
                  </>
                ) : (
                  <>
                    <LinkIcon className="w-4 h-4" />
                    Ajouter la compatibilité
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddCompatibilityModal;
