/**
 * Suppliers Page Component
 * ========================
 * Full page view for managing suppliers.
 * Displays a list of all suppliers with edit, delete, and add functionality.
 */

import React, { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import type { Supplier, SupplierQueryParams, PhoneChannel } from '../../shared/types';
import { useAppStore } from '../store';
import { AddSupplierModal } from './AddSupplierModal';
import { EditSupplierModal } from './EditSupplierModal';

// ===========================================
// CONSTANTS
// ===========================================

const CHANNEL_LABELS: Record<PhoneChannel, string> = {
  REGULAR: 'Tél',
  WHATSAPP: 'WhatsApp',
  VIBER: 'Viber',
  TELEGRAM: 'Telegram',
};

// ===========================================
// COMPONENT
// ===========================================

export const SuppliersPage: React.FC = () => {
  const setCurrentPage = useAppStore((state) => state.setCurrentPage);
  const refreshData = useAppStore((state) => state.refreshData);
  
  // Local state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPageNum, setCurrentPageNum] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalSuppliers, setTotalSuppliers] = useState(0);
  const pageSize = 20;
  
  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ===========================================
  // DATA FETCHING
  // ===========================================

  const fetchSuppliers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const params: SupplierQueryParams = {
        page: currentPageNum,
        pageSize,
        search: searchQuery || undefined,
        sortBy: 'name',
        sortDirection: 'asc',
      };
      
      const result = await window.electronApi.supplier.getList(params);
      setSuppliers(result.data);
      setTotalPages(result.totalPages);
      setTotalSuppliers(result.total);
    } catch (err) {
      console.error('[SuppliersPage] Failed to fetch suppliers:', err);
      setError(err instanceof Error ? err.message : 'Failed to load suppliers');
    } finally {
      setIsLoading(false);
    }
  }, [currentPageNum, searchQuery]);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers, refreshData]);

  // ===========================================
  // HANDLERS
  // ===========================================

  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value);
    setCurrentPageNum(1); // Reset to first page on search
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const success = await window.electronApi.supplier.delete(id);
      if (success) {
        toast.success('Fournisseur supprimé avec succès');
        fetchSuppliers();
      } else {
        toast.error('Fournisseur non trouvé');
      }
    } catch (err) {
      console.error('[SuppliersPage] Delete failed:', err);
      toast.error('Erreur lors de la suppression');
    } finally {
      setDeleteConfirmId(null);
    }
  }, [fetchSuppliers]);

  const handleBackToMain = useCallback(() => {
    setCurrentPage('main');
  }, [setCurrentPage]);

  const handleSupplierCreated = useCallback(async () => {
    setIsAddModalOpen(false);
    await fetchSuppliers();
  }, [fetchSuppliers]);

  const handleSupplierUpdated = useCallback(async () => {
    setEditingSupplier(null);
    await fetchSuppliers();
    // Refresh main data grid so updated supplier names are reflected
    try {
      await refreshData();
    } catch (err) {
      console.error('[SuppliersPage] Failed to refresh main data after supplier update:', err);
    }
  }, [fetchSuppliers]);

  // ===========================================
  // RENDER HELPERS
  // ===========================================

  const formatPhoneChannels = (channels: PhoneChannel[] | null): string => {
    if (!channels || channels.length === 0) return '';
    return channels.map(c => CHANNEL_LABELS[c] || c).join(', ');
  };

  const getPrimaryPhone = (supplier: Supplier): { value: string; channels: string } | null => {
    const phoneContacts = supplier.contacts.filter(c => c.type === 'PHONE');
    const primary = phoneContacts.find(c => c.isPrimary) || phoneContacts[0];
    if (!primary) return null;
    return {
      value: primary.value,
      channels: formatPhoneChannels(primary.channels),
    };
  };

  const getPrimaryEmail = (supplier: Supplier): string | null => {
    const emailContacts = supplier.contacts.filter(c => c.type === 'EMAIL');
    const primary = emailContacts.find(c => c.isPrimary) || emailContacts[0];
    return primary?.value || null;
  };

  // ===========================================
  // RENDER
  // ===========================================

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Back button and title */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleBackToMain}
              className="btn btn-secondary btn-sm flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Retour
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Gestion des Fournisseurs</h1>
              <p className="text-sm text-gray-500">{totalSuppliers} fournisseur{totalSuppliers !== 1 ? 's' : ''}</p>
            </div>
          </div>

          {/* Search and Add */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Rechercher un fournisseur..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="input pl-10 w-64"
              />
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="btn btn-primary flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Ajouter un fournisseur
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden p-6">
        <div className="h-full bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col">
          {/* Loading State */}
          {isLoading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="spinner w-8 h-8 mx-auto mb-2" />
                <p className="text-gray-500">Chargement...</p>
              </div>
            </div>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <svg className="w-12 h-12 mx-auto text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-gray-600 mb-2">{error}</p>
                <button onClick={fetchSuppliers} className="btn btn-primary btn-sm">
                  Réessayer
                </button>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && suppliers.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <p className="text-gray-500 mb-4">
                  {searchQuery ? 'Aucun fournisseur trouvé' : 'Aucun fournisseur enregistré'}
                </p>
                {!searchQuery && (
                  <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="btn btn-primary"
                  >
                    Ajouter votre premier fournisseur
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Suppliers Table */}
          {!isLoading && !error && suppliers.length > 0 && (
            <>
              <div className="flex-1 overflow-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Nom
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Adresse
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Téléphone
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Email
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Site Web
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {suppliers.map((supplier) => {
                      const primaryPhone = getPrimaryPhone(supplier);
                      const primaryEmail = getPrimaryEmail(supplier);
                      const phoneCount = supplier.contacts.filter(c => c.type === 'PHONE').length;
                      const emailCount = supplier.contacts.filter(c => c.type === 'EMAIL').length;
                      
                      return (
                        <tr key={supplier.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{supplier.name}</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm text-gray-500 max-w-xs truncate" title={supplier.address}>
                              {supplier.address}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {primaryPhone ? (
                              <div>
                                <div className="text-sm text-gray-900">{primaryPhone.value}</div>
                                <div className="text-xs text-gray-400">
                                  {primaryPhone.channels}
                                  {phoneCount > 1 && ` (+${phoneCount - 1})`}
                                </div>
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {primaryEmail ? (
                              <div>
                                <div className="text-sm text-gray-900">{primaryEmail}</div>
                                {emailCount > 1 && (
                                  <div className="text-xs text-gray-400">+{emailCount - 1} autre{emailCount > 2 ? 's' : ''}</div>
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {supplier.website ? (
                              <a
                                href={supplier.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:underline"
                              >
                                {new URL(supplier.website).hostname}
                              </a>
                            ) : (
                              <span className="text-sm text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => setEditingSupplier(supplier)}
                                className="p-2 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50"
                                title="Modifier"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(supplier.id)}
                                className="p-2 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50"
                                title="Supprimer"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                  <div className="text-sm text-gray-500">
                    Page {currentPageNum} sur {totalPages}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPageNum(p => Math.max(1, p - 1))}
                      disabled={currentPageNum === 1}
                      className="btn btn-secondary btn-sm"
                    >
                      Précédent
                    </button>
                    <button
                      onClick={() => setCurrentPageNum(p => Math.min(totalPages, p + 1))}
                      disabled={currentPageNum === totalPages}
                      className="btn btn-secondary btn-sm"
                    >
                      Suivant
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Confirmer la suppression</h3>
                <p className="text-sm text-gray-500">
                  Êtes-vous sûr de vouloir supprimer ce fournisseur ? Cette action est irréversible.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="btn btn-secondary"
              >
                Annuler
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="btn bg-red-600 hover:bg-red-700 text-white"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Supplier Modal */}
      <AddSupplierModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        refreshSuppliers={handleSupplierCreated}
      />

      {/* Edit Supplier Modal */}
      {editingSupplier && (
        <EditSupplierModal
          supplier={editingSupplier}
          onClose={() => setEditingSupplier(null)}
          onSaved={handleSupplierUpdated}
        />
      )}
    </div>
  );
};
