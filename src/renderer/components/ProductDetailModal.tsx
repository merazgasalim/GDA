/**
 * Product Detail Modal
 * ====================
 * Shows full details of a product including compatibility relations.
 * 
 * This modal is triggered when:
 * - User clicks on a product reference in the data grid
 * - User clicks on a compatible reference
 * 
 * FEATURES:
 * - Full product information display
 * - Compatible References section
 * - Price history (future enhancement)
 * - Navigation to related products
 */

import React, { useState, useEffect } from 'react';
import type { PriceEntry } from '../../shared/types';
import { CompatibleReferencesSection } from './CompatibleReferencesSection';

// ===========================================
// TYPES
// ===========================================

interface ProductDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  productId: string | null;
}

// ===========================================
// ICONS
// ===========================================

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const CubeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
  </svg>
);

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

function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date));
}

// ===========================================
// COMPONENT
// ===========================================

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  isOpen,
  onClose,
  productId,
}) => {
  // State
  const [product, setProduct] = useState<PriceEntry | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Stack for navigation history (allows going back to previous product)
  const [navigationStack, setNavigationStack] = useState<string[]>([]);
  const [currentProductId, setCurrentProductId] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // Load product when modal opens or product changes
  useEffect(() => {
    if (isOpen && productId) {
      setCurrentProductId(productId);
      setNavigationStack([]);
    }
  }, [isOpen, productId]);

  // Fetch product details
  useEffect(() => {
    if (!currentProductId) {
      setProduct(null);
      return;
    }
    
    const fetchProduct = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const entry = await window.electronApi.database.getEntry(currentProductId);
        if (entry) {
          setProduct(entry);
          return;
        }

        // Fallbacks: try several looser searches by reference
        try {
          const ref = String(currentProductId).trim();
          // 1) exact match on reference
          let params = { page: 1, pageSize: 1, filters: [{ column: 'reference', value: ref, operator: 'equals' }] } as any;
          let res = await window.electronApi.database.queryEntries(params);
          if (res && Array.isArray(res.data) && res.data.length > 0) {
            setProduct(res.data[0] as any);
            return;
          }

          // 2) contains match on reference
          params = { page: 1, pageSize: 1, filters: [{ column: 'reference', value: ref, operator: 'contains' }] } as any;
          res = await window.electronApi.database.queryEntries(params);
          if (res && Array.isArray(res.data) && res.data.length > 0) {
            setProduct(res.data[0] as any);
            return;
          }

          // 3) global search (search across several fields)
          params = { page: 1, pageSize: 1, globalSearch: ref } as any;
          res = await window.electronApi.database.queryEntries(params);
          if (res && Array.isArray(res.data) && res.data.length > 0) {
            setProduct(res.data[0] as any);
            return;
          }

          // no fallback hits
        } catch (fbErr) {
          console.warn('ProductDetailModal: fallback lookup failed', fbErr);
        }

        // If still not found, set null so UI shows "Produit non trouvé"
        setProduct(null);
      } catch (err) {
        console.error('Failed to fetch product:', err);
        setError(err instanceof Error ? err.message : 'Failed to load product');
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchProduct();
  }, [currentProductId]);

  // allow manual retry when clicking retry button even if id hasn't changed
  useEffect(() => {
    if (!currentProductId) return;
    // trigger fetch when retryKey changes
    const fetchNow = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const entry = await window.electronApi.database.getEntry(currentProductId);
        if (entry) {
          setProduct(entry);
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    };
    fetchNow();
  }, [retryKey]);

  // Handle navigation to a compatible product
  const handleProductClick = (newProductId: string) => {
    if (currentProductId) {
      setNavigationStack(prev => [...prev, currentProductId]);
    }
    setCurrentProductId(newProductId);
  };

  // Handle back navigation
  const handleBack = () => {
    if (navigationStack.length > 0) {
      const prevProductId = navigationStack[navigationStack.length - 1];
      setNavigationStack(prev => prev.slice(0, -1));
      setCurrentProductId(prevProductId);
    }
  };

  // Handle close
  const handleClose = () => {
    setProduct(null);
    setCurrentProductId(null);
    setNavigationStack([]);
    onClose();
  };

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };
    
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-3xl transform rounded-lg bg-white shadow-xl transition-all max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center gap-2">
              {navigationStack.length > 0 && (
                <button
                  onClick={handleBack}
                  className="p-1 text-gray-400 hover:text-gray-600 mr-2"
                  title="Retour"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              <CubeIcon className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">
                Détails du Produit
              </h2>
              {navigationStack.length > 0 && (
                <span className="text-xs text-gray-500">
                  (navigation: {navigationStack.length + 1})
                </span>
              )}
            </div>
            <button
              onClick={handleClose}
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <XIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              </div>
            ) : error ? (
              <div className="text-center py-12">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            ) : product ? (
              <>
                {/* Product Information */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">
                    Informations Produit
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-500">Référence</p>
                      <p className="text-sm font-medium text-gray-900">{product.reference}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Marque</p>
                      <p className="text-sm text-gray-900">{product.brand}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs text-gray-500">Désignation</p>
                      <p className="text-sm text-gray-900">{product.designation}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Prix</p>
                      <p className="text-lg font-semibold text-green-600">
                        {formatPrice(product.price)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Date</p>
                      <p className="text-sm text-gray-900">{formatDate(product.entryDate)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Fournisseur</p>
                      <p className="text-sm text-gray-900">{product.supplierName}</p>
                    </div>
                    {product.supplierPhone && (
                      <div>
                        <p className="text-xs text-gray-500">Téléphone</p>
                        <p className="text-sm text-gray-900">{product.supplierPhone}</p>
                      </div>
                    )}
                    {product.notes && (
                      <div className="col-span-2">
                        <p className="text-xs text-gray-500">Notes</p>
                        <p className="text-sm text-gray-900">{product.notes}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Compatible References Section */}
                <CompatibleReferencesSection
                  productId={product.id}
                  productReference={product.reference}
                  includeIncoming={true}
                  onProductClick={handleProductClick}
                  readOnly={false}
                />
              </>
            ) : (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm text-gray-500">Produit non trouvé</p>
                <div className="text-xs text-gray-400">Attempted id: <span className="text-xs text-gray-600">{String(currentProductId)}</span></div>
                <div className="text-xs text-gray-400">Preload API: <span className="text-xs text-gray-600">{(window as any).electronApi ? 'available' : 'missing'}</span></div>
                {error && <div className="text-xs text-red-600">Error: {error}</div>}
                <div className="mt-2">
                  <button
                    onClick={() => setRetryKey(k => k + 1)}
                    className="px-3 py-1 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Réessayer
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end px-6 py-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetailModal;
