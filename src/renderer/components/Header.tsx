/**
 * Header Component
 * ================
 * Application header with search, import/export buttons, and license info.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useAppStore, selectCanExport, selectCanImport, selectIsReadOnly, selectHasActiveFilters } from '../store';
import { debounce } from 'lodash';

export const Header: React.FC = () => {
  const globalSearch = useAppStore((state) => state.globalSearch);
  const setGlobalSearch = useAppStore((state) => state.setGlobalSearch);
  const fetchEntries = useAppStore((state) => state.fetchEntries);
  const clearAllFilters = useAppStore((state) => state.clearAllFilters);
  const hasActiveFilters = useAppStore(selectHasActiveFilters);
  
  const openImportModal = useAppStore((state) => state.openImportModal);
  const openExportModal = useAppStore((state) => state.openExportModal);
  const openLicenseModal = useAppStore((state) => state.openLicenseModal);
  const openOperationsLog = useAppStore((state) => state.openOperationsLog);
  const setCurrentPage = useAppStore((state) => state.setCurrentPage);
  const toggleColumnSettings = useAppStore((state) => state.toggleColumnSettings);
  
  const canImport = useAppStore(selectCanImport);
  const canExport = useAppStore(selectCanExport);
  const isReadOnly = useAppStore(selectIsReadOnly);
  const licenseStatus = useAppStore((state) => state.licenseStatus);
  
  const [localSearch, setLocalSearch] = useState(globalSearch);

  // Debounced search
  const debouncedSearch = useCallback(
    debounce((value: string) => {
      setGlobalSearch(value);
      fetchEntries();
    }, 300),
    [setGlobalSearch, fetchEntries]
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setLocalSearch(value);
    debouncedSearch(value);
  };

  const handleClearSearch = () => {
    setLocalSearch('');
    setGlobalSearch('');
    fetchEntries();
  };

  useEffect(() => {
    setLocalSearch(globalSearch);
  }, [globalSearch]);

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        {/* Logo & Title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Gestion des Arrivages</h1>
            <p className="text-xs text-gray-500">Historique des prix - Pièces Auto</p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="flex-1 max-w-xl mx-8">
          <div className="relative">
            <input
              type="text"
              placeholder="Rechercher (référence, désignation, marque, fournisseur...)"
              value={localSearch}
              onChange={handleSearchChange}
              className="input pl-10 pr-10"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {localSearch && (
              <button
                onClick={handleClearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          
          {/* Active filters indicator */}
          {hasActiveFilters && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-gray-500">Filtres actifs</span>
              <button
                onClick={clearAllFilters}
                className="text-xs text-blue-600 hover:underline"
              >
                Tout effacer
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {/* Operations Log Button */}
          <button
            onClick={openOperationsLog}
            className="btn btn-secondary btn-sm"
            title="Historique des opérations"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
          </button>
          
          {/* Column Settings */}
          <button
            onClick={toggleColumnSettings}
            className="btn btn-secondary btn-sm"
            title="Colonnes"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
          </button>

          {/* Add Supplier Button */}
          <button
            onClick={() => setCurrentPage('suppliers')}
            className="btn btn-secondary"
            title="Gérer les fournisseurs"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            Fournisseurs
          </button>

          {/* Import Button */}
          <button
            onClick={openImportModal}
            disabled={isReadOnly && !canImport}
            className="btn btn-secondary"
            title={!canImport ? 'Licence requise pour importer' : 'Importer'}
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Importer
          </button>

          {/* Export Button */}
          <button
            onClick={openExportModal}
            className={`btn ${canExport ? 'btn-primary' : 'btn-secondary'}`}
            title={!canExport ? 'Licence requise pour exporter' : 'Exporter'}
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Exporter
            {!canExport && (
              <svg className="w-4 h-4 ml-1 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </button>

          {/* License Status */}
          <button
            onClick={openLicenseModal}
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium ${
              licenseStatus.isValid
                ? 'bg-green-50 text-green-700 hover:bg-green-100'
                : 'bg-red-50 text-red-700 hover:bg-red-100'
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                licenseStatus.isValid ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            {licenseStatus.isValid ? 'Licence active' : 'Non licencié'}
          </button>
        </div>
      </div>
    </header>
  );
};
