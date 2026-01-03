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
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore, selectVisibleColumns } from '../store';
import type { PriceEntry, ColumnConfig } from '../../shared/types';
import { debounce } from 'lodash';
import { SupplierInfoModal } from './SupplierInfoModal';

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
  
  const debouncedOnChange = useCallback(
    debounce((val: string) => onChange(val), 300),
    [onChange]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    debouncedOnChange(newValue);
  };

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <input
      type="text"
      className="column-filter-input"
      placeholder={`Filtrer...`}
      value={localValue}
      onChange={handleChange}
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
// TABLE ROW COMPONENT
// ===========================================

interface TableRowProps {
  entry: PriceEntry;
  columns: ColumnConfig[];
  isSelected: boolean;
  onSelect: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSupplierClick: (supplierName: string) => void;
}

const TableRow: React.FC<TableRowProps> = ({
  entry,
  columns,
  isSelected,
  onSelect,
  onKeyDown,
  onSupplierClick,
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
  
  const setColumnFilter = useAppStore((state) => state.setColumnFilter);
  const toggleSort = useAppStore((state) => state.toggleSort);
  const setSelectedEntry = useAppStore((state) => state.setSelectedEntry);
  const fetchEntries = useAppStore((state) => state.fetchEntries);

  const tableRef = useRef<HTMLTableElement>(null);

  // Supplier info modal state
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [selectedSupplierName, setSelectedSupplierName] = useState<string>('');

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

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowDown' && index < entries.length - 1) {
      e.preventDefault();
      setSelectedEntry(entries[index + 1].id);
    } else if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault();
      setSelectedEntry(entries[index - 1].id);
    } else if (e.key === 'Enter') {
      // Could open detail view
    }
  }, [entries, setSelectedEntry]);

  // Get filter value for a column
  const getFilterValue = (columnId: string): string => {
    const filter = columnFilters.find((f) => f.column === columnId);
    return filter?.value || '';
  };

  // Handle column filter change
  const handleFilterChange = (columnId: string, value: string) => {
    setColumnFilter({ column: columnId, value, operator: 'contains' });
    fetchEntries();
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
            {entries.map((entry, index) => (
              <TableRow
                key={entry.id}
                entry={entry}
                columns={columns}
                isSelected={entry.id === selectedEntryId}
                onSelect={() => setSelectedEntry(entry.id)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                onSupplierClick={handleSupplierClick}
              />
            ))}
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
    </div>
  );
};
