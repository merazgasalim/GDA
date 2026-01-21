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
import type { PriceEntry, ColumnConfig, CompatibilityWithDetails } from '../../shared/types';
import { COMPATIBILITY_RELATION_LABELS } from '../../shared/types';
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

  // Date columns: show from/to inputs
  const dateColumns = new Set(['entryDate', 'arrivageDate', 'abandonedAt', 'createdAt']);

  const lastFocusedRef = useRef<HTMLInputElement | null>(null);
  const lastFocusedColumnRef = useRef<string | null>(null);
  const fromRef = useRef<HTMLInputElement | null>(null);
  const toRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLInputElement | null>(null);

  // Debug instrumentation removed
  useEffect(() => {
    return () => {};
  }, [_column.accessorKey]);

  // Stable debounced updater: store latest onChange in a ref and keep a single debounced fn
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const debouncedRef = useRef<any>(null);
  if (!debouncedRef.current) {
    debouncedRef.current = debounce((val: string) => {
      try { onChangeRef.current(val); } catch {}
      // Restore focus to the last-focused input after update. Use the column accessor
      // to find the newly rendered input element (handles remounts). Use double
      // requestAnimationFrame to ensure the DOM has been updated by React.
      try {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          try {
            const col = lastFocusedColumnRef.current;
            if (col) {
              const el = document.querySelector(`input[data-filter-column="${col}"]`) as HTMLInputElement | null;
              if (el) {
                el.focus();
              }
            } else {
              if (lastFocusedRef.current) {
                lastFocusedRef.current.focus();
              }
            }
          } catch (err) { console.warn('[DBG] focus restore failed', err); }
        }));
      } catch (err) { console.warn('[DBG] focus restore outer failed', err); }
      // Don't call fetchEntries here - let it happen from an effect watching the filters
    }, 800);
  }

  // If column is date type, expect value to be JSON string { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' }
  const isDateColumn = dateColumns.has(_column.accessorKey);

  // Local state for date range
  const [fromDate, setFromDate] = useState<string | undefined>(() => {
    try {
      const parsed = value ? JSON.parse(value) : null;
      return parsed && parsed.from ? parsed.from : undefined;
    } catch {
      return undefined;
    }
  });
  const [toDate, setToDate] = useState<string | undefined>(() => {
    try {
      const parsed = value ? JSON.parse(value) : null;
      return parsed && parsed.to ? parsed.to : undefined;
    } catch {
      return undefined;
    }
  });

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(value);
      try {
        const parsed = value ? JSON.parse(value) : null;
        const parsedFrom = parsed && parsed.from ? parsed.from : undefined;
        const parsedTo = parsed && parsed.to ? parsed.to : undefined;
        // Only update local date state if it differs from current local values
        if (parsed && (parsedFrom !== fromDate || parsedTo !== toDate)) {
          setFromDate(parsedFrom);
          setToDate(parsedTo);
        }
      } catch {
        // Ignore invalid JSON and avoid clobbering local inputs
      }
    }
  }, [value, isFocused, fromDate, toDate]);

  const emitRange = (from?: string, to?: string) => {
    // Only emit a date-range filter when both endpoints are provided.
    if (from && to) {
      const payload = JSON.stringify({ from, to });
      debouncedRef.current(payload);
    } else {
      // Cancel any pending update; do not clear the filter yet (avoid partial clears)
      debouncedRef.current.cancel?.();
    }
  };

  const handleDateChange = (which: 'from' | 'to') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value || undefined;
    // Compute new values to avoid stale state in emitRange
    const newFrom = which === 'from' ? v : fromDate;
    const newTo = which === 'to' ? v : toDate;
    if (which === 'from') setFromDate(v);
    else setToDate(v);
    emitRange(newFrom, newTo);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    const minChars = 2;
    const trimmed = newValue.trim();
    // Price field: only emit when input is a valid number (avoid partial '.' or ',')
    if (_column.accessorKey === 'price') {
      const parsed = Number(trimmed.replace(',', '.'));
      if (trimmed === '') {
        debouncedRef.current('');
      } else if (!Number.isNaN(parsed)) {
        debouncedRef.current(trimmed);
      } else {
        // don't emit for invalid/partial numeric input
        debouncedRef.current.cancel?.();
      }
      return;
    }

    // For text fields, require a minimum length to avoid showing 'no results' on first keystrokes
    if (trimmed === '') {
      debouncedRef.current('');
    } else if (trimmed.length >= minChars) {
      debouncedRef.current(trimmed);
    } else {
      debouncedRef.current.cancel?.();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Apply filter immediately on Enter
    if (e.key === 'Enter') {
      debouncedRef.current.cancel?.();
      if (isDateColumn) {
        if (fromDate && toDate) {
          const payload = JSON.stringify({ from: fromDate, to: toDate });
          onChange(payload);
        } else {
          // ensure no partial filter is sent
          onChange('');
        }
      } else {
        onChange(localValue);
      }
      fetchEntries();
    }

    // Prevent ALL keys from bubbling to parent handlers
    e.stopPropagation();
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    lastFocusedRef.current = e.target as HTMLInputElement;
    lastFocusedColumnRef.current = _column.accessorKey;
    // Store globally so parent can restore focus after data refreshes
    try { (window as any).__lastFocusedFilterColumn = _column.accessorKey; } catch {}
  };
  const handleBlur = () => {
    // Flush any pending debounced update so store receives the latest range
    // before we clear focus and potentially resync from props.
    try { debouncedRef.current.flush?.(); } catch {}
    setIsFocused(false);
  };

  if (isDateColumn) {
    return (
      <div className="flex gap-1 items-center">
        <input
          type="date"
          className="column-filter-input"
          value={fromDate || ''}
          data-filter-column={_column.accessorKey}
          onChange={handleDateChange('from')}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          ref={(el) => { fromRef.current = el; }}
          placeholder="From"
        />
        <span className="text-xs text-gray-400">—</span>
        <input
          type="date"
          className="column-filter-input"
          value={toDate || ''}
          data-filter-column={_column.accessorKey}
          onChange={handleDateChange('to')}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          ref={(el) => { toRef.current = el; }}
          placeholder="To"
        />
      </div>
    );
  }

  return (
    <input
      type="text"
      className="column-filter-input"
      placeholder={`Filtrer...`}
      value={localValue}
      onChange={handleTextChange}
      onKeyDown={handleKeyDown}
      onFocus={(e) => { handleFocus(e); textRef.current = e.target as HTMLInputElement; }}
      onBlur={handleBlur}
      ref={(el) => { textRef.current = el; }}
      data-filter-column={_column.accessorKey}
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
    try { console.log('[DBG] ReferenceCell clicked', { reference, productId }); } catch {}
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
      // If entryDate is missing, fall back to createdAt for display so users
      // still see a meaningful date even for legacy rows that lack entryDate.
      const v = value ?? (column.accessorKey === 'entryDate' ? (entry as any).createdAt : null);
      if (!v) return '-';
      return new Date(v).toLocaleDateString('fr-FR');
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

  // Whether to include compatible products in the search results (from store)
  const includeCompatible = useAppStore((s) => (s as any).includeCompatible);
  // Compatible results fetched for the current visible direct results
  const [compatibleResults, setCompatibleResults] = useState<any[]>([]);

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

  // Fetch compatible results grouped by source for the visible direct results
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!includeCompatible) {
        setCompatibleResults([]);
        return;
      }

      if (!globalSearch || globalSearch.trim().length < 2) {
        // Only fetch compatibles for meaningful search queries
        setCompatibleResults([]);
        return;
      }

      if (entries.length === 0) {
        setCompatibleResults([]);
        return;
      }

      try {
        const ids = entries.map(e => e.id);
        const results = await window.electronApi.compatibility.getForSources(ids);
        if (!cancelled) setCompatibleResults(results || []);
      } catch (err) {
        console.error('Failed to fetch compatible results:', err);
        if (!cancelled) setCompatibleResults([]);
      }
    })();
    return () => { cancelled = true; };
  }, [entries, includeCompatible, globalSearch]);

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
    // Only set filters when meaningful. Date-range JSON is accepted by the backend
    // but the ColumnFilter operator enum doesn't include 'range', so we keep the
    // operator as the default ('contains') and only send a value when valid.
    try {
      const parsed = value ? JSON.parse(value) : null;
      if (parsed && (parsed.from || parsed.to)) {
        // Only set when both endpoints are present; otherwise remove the filter
        if (parsed.from && parsed.to) {
          setColumnFilter({ column: columnId, value, operator: 'contains' });
        } else {
          // clear partial range
          setColumnFilter({ column: columnId, value: '', operator: 'contains' });
        }
        return;
      }
    } catch {
      // not JSON - fall through
    }

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
  // NOTE: avoid unmounting the table (and its filter inputs) during initial loading
  // because that causes filter inputs to be unmounted/remounted and lose focus.
  // We'll render the table header and filters always, and show a spinner in
  // the table body when there are no entries and loading is in progress.

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
    // Do not show the import/empty-page when we're currently loading results;
    // that would replace the table and unmount filters during a fetch.
    if (!isLoading && databaseIsEmpty && !hasFilters) {
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
              // If we're currently loading, show a centered spinner inside the table
              // instead of unmounting the header/filters. Otherwise show the no-results
              // message.
              (isLoading) ? (
                <tr>
                  <td colSpan={columns.length} className="text-center py-8 text-gray-500">
                    <div className="spinner w-8 h-8 mx-auto" />
                  </td>
                </tr>
              ) : (
                <tr>
                  <td colSpan={columns.length} className="text-center py-8 text-gray-500">
                    <svg className="w-12 h-12 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <p className="text-sm font-medium">Aucun résultat trouvé</p>
                    <p className="text-xs text-gray-400 mt-1">Essayez de modifier vos filtres de recherche</p>
                  </td>
                </tr>
              )
            ) : (
              entries.map((entry, index) => (
                <TableRow
                  key={entry.id ?? `entry-${index}`}
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

      {/* Compatible Products Section (distinct from main table) */}
      {includeCompatible && compatibleResults.length > 0 && (
        <div className="mt-4 p-4 bg-gray-50 rounded-md border border-gray-100">
          <div className="flex items-center mb-3">
            <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <h3 className="font-semibold">Compatible Products</h3>
          </div>

          {/* Group by sourceProductId */}
          {(() => {
            const map = compatibleResults.reduce((m: Map<string, CompatibilityWithDetails[]>, item: CompatibilityWithDetails) => {
              const key = item.sourceProductId;
              if (!m.has(key)) m.set(key, [] as CompatibilityWithDetails[]);
              m.get(key)!.push(item);
              return m;
            }, new Map<string, CompatibilityWithDetails[]>());
            return (Array.from(map.entries()) as [string, CompatibilityWithDetails[]][]).map(([sourceId, items]) => (
            <div key={sourceId} className="mb-4">
              <div className="text-sm text-gray-500 mb-2">Compatible with: <button className="text-blue-600 hover:underline" onClick={(e) => { e.stopPropagation(); setSelectedEntry(sourceId); }}>{sourceId}</button></div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {items.map((it: CompatibilityWithDetails) => (
                  <div
                    key={it.id}
                    className="p-3 rounded-md bg-white shadow-sm flex items-start gap-3 cursor-pointer"
                    title={`Relation: ${it.relationType}. Source: ${it.sourceProductId}. Note: ${it.note ?? ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (it.targetType === 'INTERNAL' && it.targetProductId) {
                        setSelectedEntry(it.targetProductId);
                        setSelectedProductId(it.targetProductId);
                        setProductDetailModalOpen(true);
                      }
                    }}
                  >
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-gray-900">{it.reference} {it.brand ? `- ${it.brand}` : ''}</div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">Compatible</span>
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-800 rounded-full">{COMPATIBILITY_RELATION_LABELS[it.relationType] || it.relationType}</span>
                        </div>
                      </div>
                      <div className="text-sm text-gray-500 mt-1">{it.designation}</div>
                      <div className="text-xs text-gray-400 mt-1">{it.targetType === 'EXTERNAL' ? 'External reference — not stocked' : `Supplier: ${it.supplierName ?? '-'}`}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-mono">{it.targetType === 'EXTERNAL' ? '-' : (it.price != null ? Number(it.price).toFixed(2) : '-')}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ));
            })()}
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && entries.length > 0 && (
        <div
          className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center pointer-events-none"
          aria-hidden="true"
          tabIndex={-1}
        >
          <div className="spinner w-8 h-8" aria-hidden="true" tabIndex={-1} />
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
