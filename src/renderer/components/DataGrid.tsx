/**
 * Data Grid Component
 * ===================
 * Main data display component with filtering, sorting, and pagination.
 * 
 * FEATURES:
 * - Column-level filters under headers
 * - Global search
 * - Sorting per column
 * - Pagination
 * - Keyboard navigation
 * - Fast rendering with virtualization
 * - Clickable supplier name to view details
 * - Clickable reference to view product details and compatibilities
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore, selectVisibleColumns } from '../store';
import type { PriceEntry, ColumnConfig } from '../../shared/types';
import { debounce } from 'lodash';
import { SupplierInfoModal } from './SupplierInfoModal';
import { ProductDetailModal } from './ProductDetailModal';

// ===========================================
// COLUMN FILTER COMPONENT
// ===========================================

interface ColumnFilterProps {
  column: ColumnConfig;
  value: string;
  onChange: (value: string) => void;
}

const ColumnFilterInput: React.FC<ColumnFilterProps> = ({ column: _column, value, onChange }) => {
  const [localValue, setLocalValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const fetchEntries = useAppStore((state) => state.fetchEntries);
  
  const debouncedUpdate = useCallback(
    debounce((val: string) => {
      onChange(val);
      // Don't call fetchEntries here - let it happen from an effect watching the filters
    }, 800),
    [onChange]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    debouncedUpdate(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Apply filter immediately on Enter
    if (e.key === 'Enter') {
      debouncedUpdate.cancel();
      onChange(localValue);
      fetchEntries();
    }
    
    // Prevent ALL keys from bubbling to parent handlers
    e.stopPropagation();
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  useEffect(() => {
    // Only sync from parent when not actively typing
    if (!isFocused) {
      setLocalValue(value);
    }
  }, [value, isFocused]);

  return (
    <input
      type="text"
      className="column-filter-input"
      placeholder={`Filtrer...`}
      value={localValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  );
};

// ===========================================
// SUPPLIER NAME CELL COMPONENT
// ===========================================

interface SupplierNameCellProps {
  supplierName: string;
  onSupplierClick: (name: string) => void;
}

const SupplierNameCell: React.FC<SupplierNameCellProps> = ({ supplierName, onSupplierClick }) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row selection
    onSupplierClick(supplierName);
  };

  return (
    <button
      onClick={handleClick}
      className="text-left text-blue-600 hover:text-blue-800 hover:underline focus:outline-none focus:underline"
    >
      {supplierName}
    </button>
  );
};

// ===========================================
// REFERENCE CELL COMPONENT (CLICKABLE TO VIEW DETAILS)
// ===========================================

interface ReferenceCellProps {
  reference: string;
  productId: string;
  compatibilityCount?: number;
  onReferenceClick: (productId: string) => void;
}

const ReferenceCell: React.FC<ReferenceCellProps> = ({ reference, productId, compatibilityCount, onReferenceClick }) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row selection
    onReferenceClick(productId);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        className="text-left font-medium text-gray-900 hover:text-blue-600 hover:underline focus:outline-none focus:underline"
        title="Cliquez pour voir les détails et les références compatibles"
      >
        {reference}
      </button>
      {compatibilityCount && compatibilityCount > 0 && (
        <span 
          className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded-full"
          title={`${compatibilityCount} référence${compatibilityCount > 1 ? 's' : ''} compatible${compatibilityCount > 1 ? 's' : ''}`}
        >
          <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          {compatibilityCount}
        </span>
      )}
    </div>
  );
};

// ===========================================
// TABLE ROW COMPONENT
// ===========================================

interface TableRowProps {
  entry: PriceEntry;
  columns: ColumnConfig[];
  isSelected: boolean;
  compatibilityCount?: number;
  onSelect: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSupplierClick: (supplierName: string) => void;
  onReferenceClick: (productId: string) => void;
}

const TableRow: React.FC<TableRowProps> = ({
  entry,
  columns,
  isSelected,
  compatibilityCount,
  onSelect,
  onKeyDown,
  onSupplierClick,
  onReferenceClick,
}) => {
  const formatValue = (column: ColumnConfig, value: any): string => {
    if (value === null || value === undefined) return '-';
    
    if (column.accessorKey === 'price') {
      return `${Number(value).toFixed(2)}`;
    }
    
    if (column.accessorKey === 'entryDate' || column.accessorKey === 'arrivageDate') {
      return new Date(value).toLocaleDateString('fr-FR');
    }
    
    return String(value);
  };

  const renderCellContent = (column: ColumnConfig) => {
    const value = entry[column.accessorKey];

    // Special handling for supplier name column - make it clickable
    if (column.accessorKey === 'supplierName') {
      return (
        <SupplierNameCell
          supplierName={value as string}
          onSupplierClick={onSupplierClick}
        />
      );
    }
    
    // Special handling for reference column - make it clickable to view details/compatibilities
    if (column.accessorKey === 'reference') {
      return (
        <ReferenceCell
          reference={value as string}
          productId={entry.id}
          compatibilityCount={compatibilityCount}
          onReferenceClick={onReferenceClick}
        />
      );
    }

    return formatValue(column, value);
  };

  return (
    <tr
      className={`cursor-pointer ${isSelected ? 'selected' : ''}`}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      {columns.map((column) => (
        <td
          key={column.id}
          className={column.accessorKey === 'price' ? 'price text-right font-mono' : ''}
          style={column.width ? { width: column.width } : undefined}
        >
          {renderCellContent(column)}
        </td>
      ))}
    </tr>
  );
};

// ===========================================
// MAIN DATA GRID COMPONENT
// ===========================================

export const DataGrid: React.FC = () => {
  const entries = useAppStore((state) => state.entries);
  const isLoading = useAppStore((state) => state.isLoading);
  const error = useAppStore((state) => state.error);
  const columns = useAppStore(selectVisibleColumns);
  const columnFilters = useAppStore((state) => state.columnFilters);
  const sortColumn = useAppStore((state) => state.sortColumn);
  const sortDirection = useAppStore((state) => state.sortDirection);
  const selectedEntryId = useAppStore((state) => state.selectedEntryId);
  const globalSearch = useAppStore((state) => state.globalSearch);
  const stats = useAppStore((state) => state.stats);
  
  const setColumnFilter = useAppStore((state) => state.setColumnFilter);
  const toggleSort = useAppStore((state) => state.toggleSort);
  const setSelectedEntry = useAppStore((state) => state.setSelectedEntry);
  const fetchEntries = useAppStore((state) => state.fetchEntries);

  const tableRef = useRef<HTMLTableElement>(null);
  
  // Auto-fetch when filters or sort changes
  useEffect(() => {
    fetchEntries();
  }, [columnFilters, sortColumn, sortDirection, fetchEntries]);

  // Supplier info modal state
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [selectedSupplierName, setSelectedSupplierName] = useState<string>('');
  
  // Product detail modal state (for viewing compatibilities)
  const [productDetailModalOpen, setProductDetailModalOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  
  // Compatibility counts for all visible products
  const [compatibilityCounts, setCompatibilityCounts] = useState<Record<string, number>>({});

  // Compatibility counts for all visible products
  const fetchCompatibilityCounts = useCallback(async () => {
    if (entries.length === 0) {
      setCompatibilityCounts({});
      return;
    }

    try {
      const productIds = entries.map(entry => entry.id);
      const counts = await window.electronApi.compatibility.getBulkCounts(productIds);
      setCompatibilityCounts(counts);
    } catch (err) {
      console.error('Failed to fetch compatibility counts:', err);
      // Don't show error to user, just silently fail
      setCompatibilityCounts({});
    }
  }, [entries]);

  // Fetch when entries change
  useEffect(() => {
    fetchCompatibilityCounts();
  }, [fetchCompatibilityCounts]);

  // Listen for compatibility changes from other parts of the UI
  useEffect(() => {
    const handler = (_e: Event) => {
      fetchCompatibilityCounts();
    };

    window.addEventListener('compatibility:changed', handler);
    return () => window.removeEventListener('compatibility:changed', handler);
  }, [fetchCompatibilityCounts]);

  // Listen for supplier changes (rename/add) and refresh entries
  useEffect(() => {
    const handler = (_e: Event) => {
      fetchEntries();
    };

    window.addEventListener('supplier:changed', handler);
    return () => window.removeEventListener('supplier:changed', handler);
  }, [fetchEntries]);

  // Handle supplier name click
  const handleSupplierClick = useCallback((supplierName: string) => {
    setSelectedSupplierName(supplierName);
    setSupplierModalOpen(true);
  }, []);

  // Close supplier modal
  const closeSupplierModal = useCallback(() => {
    setSupplierModalOpen(false);
    setSelectedSupplierName('');
  }, []);
  
  // Handle reference click (opens product detail with compatibilities)
  const handleReferenceClick = useCallback((productId: string) => {
    setSelectedProductId(productId);
    setProductDetailModalOpen(true);
  }, []);
  
  // Close product detail modal
  const closeProductDetailModal = useCallback(() => {
    setProductDetailModalOpen(false);
    setSelectedProductId(null);
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowDown' && index < entries.length - 1) {
      e.preventDefault();
      setSelectedEntry(entries[index + 1].id);
    } else if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault();
      setSelectedEntry(entries[index - 1].id);
    } else if (e.key === 'Enter') {
      // Open product detail view
      e.preventDefault();
      handleReferenceClick(entries[index].id);
    }
  }, [entries, setSelectedEntry, handleReferenceClick]);

  // Get filter value for a column
  const getFilterValue = (columnId: string): string => {
    const filter = columnFilters.find((f) => f.column === columnId);
    return filter?.value || '';
  };

  // Handle column filter change
  const handleFilterChange = (columnId: string, value: string) => {
    setColumnFilter({ column: columnId, value, operator: 'contains' });
    // fetchEntries is now called from within ColumnFilterInput after debounce
  };

  // Render sort indicator
  const renderSortIndicator = (columnId: string) => {
    if (sortColumn !== columnId) {
      return (
        <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }

    return sortDirection === 'asc' ? (
      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  // Loading state
  if (isLoading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="spinner w-8 h-8" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-600">
        <svg className="w-12 h-12 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p className="text-lg font-medium">Erreur de chargement</p>
        <p className="text-sm text-gray-600 mt-1">{error}</p>
        <button
          onClick={fetchEntries}
          className="btn btn-primary mt-4"
        >
          Réessayer
        </button>
      </div>
    );
  }

  // Empty state
  if (entries.length === 0) {
    // Check if database is truly empty (no filters applied)
    const hasFilters = columnFilters.length > 0 || (globalSearch && globalSearch.trim().length > 0);
    const databaseIsEmpty = !stats || stats.totalEntries === 0;
    
    // Show import message only if database is truly empty
    if (databaseIsEmpty && !hasFilters) {
      return (
        <div className="empty-state">
          <svg className="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="empty-state-title">Aucune donnée</p>
          <p className="empty-state-description">
            Commencez par importer vos données depuis Excel en cliquant sur le bouton "Importer".
          </p>
        </div>
      );
    }
    
    // Otherwise show table with "no results" message (filters are active)
    // Will be rendered below with the table structure
  }

  return (
    <div className="flex flex-col h-full">
      {/* Table Container */}
      <div className="flex-1 overflow-auto border border-gray-200 rounded-lg">
        <table ref={tableRef} className="data-grid">
          <thead>
            {/* Column Headers */}
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id}
                  style={column.width ? { width: column.width } : undefined}
                  className={column.sortable ? 'cursor-pointer select-none' : ''}
                  onClick={() => column.sortable && toggleSort(column.accessorKey)}
                >
                  <div className="flex items-center gap-1">
                    <span>{column.header}</span>
                    {column.sortable && renderSortIndicator(column.accessorKey)}
                  </div>
                </th>
              ))}
            </tr>
            {/* Filter Row */}
            <tr className="bg-gray-50">
              {columns.map((column) => (
                <th key={`filter-${column.id}`} className="px-2 py-1 font-normal">
                  {column.filterable && (
                    <ColumnFilterInput
                      column={column}
                      value={getFilterValue(column.accessorKey)}
                      onChange={(value) => handleFilterChange(column.accessorKey, value)}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-8 text-gray-500">
                  <svg className="w-12 h-12 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <p className="text-sm font-medium">Aucun résultat trouvé</p>
                  <p className="text-xs text-gray-400 mt-1">Essayez de modifier vos filtres de recherche</p>
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => (
                <TableRow
                  key={entry.id}
                  entry={entry}
                  columns={columns}
                  isSelected={entry.id === selectedEntryId}
                  compatibilityCount={compatibilityCounts[entry.id]}
                  onSelect={() => setSelectedEntry(entry.id)}
                  onKeyDown={(e) => handleKeyDown(e, index)}
                  onSupplierClick={handleSupplierClick}
                  onReferenceClick={handleReferenceClick}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Loading Overlay */}
      {isLoading && entries.length > 0 && (
        <div className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center">
          <div className="spinner w-8 h-8" />
        </div>
      )}

      {/* Supplier Info Modal */}
      <SupplierInfoModal
        supplierName={selectedSupplierName}
        isOpen={supplierModalOpen}
        onClose={closeSupplierModal}
      />
      
      {/* Product Detail Modal (with Compatible References) */}
      <ProductDetailModal
        isOpen={productDetailModalOpen}
        onClose={closeProductDetailModal}
        productId={selectedProductId}
      />
    </div>
  );
};
