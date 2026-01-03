/**
 * Application Store
 * =================
 * Global state management using Zustand.
 * Manages license status, UI state, and cached data.
 */

import { create } from 'zustand';
import type {
  LicenseStatus,
  PriceEntry,
  QueryParams,
  PaginatedResult,
  ColumnConfig,
  ColumnFilter,
} from '../../shared/types';
import { DEFAULT_LICENSE_STATUS } from '../../shared/types';

// ===========================================
// STORE TYPES
// ===========================================

// Page navigation types
export type AppPage = 'main' | 'suppliers';

interface AppState {
  // License
  licenseStatus: LicenseStatus;
  isLicenseLoading: boolean;
  
  // Navigation
  currentPage: AppPage;
  
  // Data
  entries: PriceEntry[];
  totalEntries: number;
  currentPageNum: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  error: string | null;
  
  // Filters & Search
  globalSearch: string;
  columnFilters: ColumnFilter[];
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  
  // UI State
  columns: ColumnConfig[];
  selectedEntryId: string | null;
  isImportModalOpen: boolean;
  isLicenseModalOpen: boolean;
  isExportModalOpen: boolean;
  isColumnSettingsOpen: boolean;
  isOperationsLogOpen: boolean;
  isAddSupplierModalOpen: boolean;
  
  // Operations Log - Crash Recovery
  hasIncompleteOperations: boolean;
  incompleteOperationsResolved: boolean;
  
  // Stats
  stats: {
    totalEntries: number;
    uniqueReferences: number;
    uniqueSuppliers: number;
    uniqueBrands: number;
  } | null;
}

interface AppActions {
  // License
  setLicenseStatus: (status: LicenseStatus) => void;
  setLicenseLoading: (loading: boolean) => void;
  fetchLicenseStatus: () => Promise<void>;
  
  // Navigation
  setCurrentPage: (page: AppPage) => void;
  
  // Data
  setEntries: (result: PaginatedResult<PriceEntry>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  fetchEntries: () => Promise<void>;
  refreshData: () => Promise<void>;
  
  // Pagination
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  
  // Filters & Search
  setGlobalSearch: (search: string) => void;
  setColumnFilter: (filter: ColumnFilter) => void;
  removeColumnFilter: (column: string) => void;
  clearAllFilters: () => void;
  
  // Sorting
  setSorting: (column: string, direction: 'asc' | 'desc') => void;
  toggleSort: (column: string) => void;
  
  // UI State
  setColumns: (columns: ColumnConfig[]) => void;
  toggleColumnVisibility: (columnId: string) => void;
  setSelectedEntry: (id: string | null) => void;
  openImportModal: () => void;
  closeImportModal: () => void;
  openLicenseModal: () => void;
  closeLicenseModal: () => void;
  openExportModal: () => void;
  closeExportModal: () => void;
  toggleColumnSettings: () => void;
  openOperationsLog: () => void;
  closeOperationsLog: () => void;
  openAddSupplierModal: () => void;
  closeAddSupplierModal: () => void;
  setHasIncompleteOperations: (has: boolean) => void;
  setIncompleteOperationsResolved: (resolved: boolean) => void;
  
  // Stats
  fetchStats: () => Promise<void>;
  
  // Suppliers
  refreshSuppliers: () => Promise<void>;
}

// ===========================================
// INITIAL STATE
// ===========================================

const initialState: AppState = {
  licenseStatus: DEFAULT_LICENSE_STATUS,
  isLicenseLoading: true,
  
  // Navigation
  currentPage: 'main',
  
  entries: [],
  totalEntries: 0,
  currentPageNum: 1,
  pageSize: 50,
  totalPages: 0,
  isLoading: false,
  error: null,
  
  globalSearch: '',
  columnFilters: [],
  sortColumn: 'entryDate',
  sortDirection: 'desc',
  
  columns: [
    { id: 'reference', header: 'Référence', accessorKey: 'reference', visible: true, sortable: true, filterable: true },
    { id: 'designation', header: 'Désignation', accessorKey: 'designation', visible: true, sortable: true, filterable: true },
    { id: 'brand', header: 'Marque', accessorKey: 'brand', visible: true, sortable: true, filterable: true },
    { id: 'supplierName', header: 'Fournisseur', accessorKey: 'supplierName', visible: true, sortable: true, filterable: true },
    { id: 'price', header: 'Prix', accessorKey: 'price', visible: true, sortable: true, filterable: true, width: 100 },
    { id: 'entryDate', header: 'Date', accessorKey: 'entryDate', visible: true, sortable: true, filterable: true },
  ],
  selectedEntryId: null,
  isImportModalOpen: false,
  isLicenseModalOpen: false,
  isExportModalOpen: false,
  isColumnSettingsOpen: false,
  isOperationsLogOpen: false,
  isAddSupplierModalOpen: false,
  
  // Operations Log - Crash Recovery
  hasIncompleteOperations: false,
  incompleteOperationsResolved: false,
  
  stats: null,
};

// ===========================================
// STORE CREATION
// ===========================================

export const useAppStore = create<AppState & AppActions>((set, get) => ({
  ...initialState,

  // ===========================================
  // LICENSE ACTIONS
  // ===========================================
  
  setLicenseStatus: (status) => set({ licenseStatus: status }),
  
  setLicenseLoading: (loading) => set({ isLicenseLoading: loading }),
  
  fetchLicenseStatus: async () => {
    set({ isLicenseLoading: true });
    try {
      const status = await window.electronApi.license.getStatus();
      set({ licenseStatus: status, isLicenseLoading: false });
    } catch (error) {
      console.error('Failed to fetch license status:', error);
      set({ isLicenseLoading: false });
    }
  },

  // ===========================================
  // DATA ACTIONS
  // ===========================================
  
  setEntries: (result) => set({
    entries: result.data,
    totalEntries: result.total,
    currentPageNum: result.page,
    totalPages: result.totalPages,
  }),
  
  setLoading: (loading) => set({ isLoading: loading }),
  
  setError: (error) => set({ error }),
  
  fetchEntries: async () => {
    const state = get();
    set({ isLoading: true, error: null });
    
    try {
      const params: QueryParams = {
        page: state.currentPageNum,
        pageSize: state.pageSize,
        sortColumn: state.sortColumn || undefined,
        sortDirection: state.sortDirection,
        globalSearch: state.globalSearch || undefined,
        filters: state.columnFilters.length > 0 ? state.columnFilters : undefined,
      };
      
      const result = await window.electronApi.database.queryEntries(params);
      set({
        entries: result.data,
        totalEntries: result.total,
        totalPages: result.totalPages,
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to fetch entries:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to load data',
        isLoading: false,
      });
    }
  },
  
  refreshData: async () => {
    await get().fetchEntries();
    await get().fetchStats();
  },

  // ===========================================
  // PAGINATION ACTIONS
  // ===========================================
  
  // Navigation
  setCurrentPage: (page) => set({ currentPage: page }),
  
  setPage: (pageNum) => {
    set({ currentPageNum: pageNum });
    get().fetchEntries();
  },
  
  setPageSize: (size) => {
    set({ pageSize: size, currentPageNum: 1 });
    get().fetchEntries();
  },

  // ===========================================
  // FILTER & SEARCH ACTIONS
  // ===========================================
  
  setGlobalSearch: (search) => {
    set({ globalSearch: search, currentPageNum: 1 });
    // Debounce would be applied in the component
  },
  
  setColumnFilter: (filter) => {
    const filters = get().columnFilters;
    const existingIndex = filters.findIndex((f) => f.column === filter.column);
    
    if (existingIndex >= 0) {
      const newFilters = [...filters];
      if (filter.value) {
        newFilters[existingIndex] = filter;
      } else {
        newFilters.splice(existingIndex, 1);
      }
      set({ columnFilters: newFilters, currentPageNum: 1 });
    } else if (filter.value) {
      set({ columnFilters: [...filters, filter], currentPageNum: 1 });
    }
  },
  
  removeColumnFilter: (column) => {
    set({
      columnFilters: get().columnFilters.filter((f) => f.column !== column),
      currentPageNum: 1,
    });
  },
  
  clearAllFilters: () => {
    set({ columnFilters: [], globalSearch: '', currentPageNum: 1 });
    get().fetchEntries();
  },

  // ===========================================
  // SORTING ACTIONS
  // ===========================================
  
  setSorting: (column, direction) => {
    set({ sortColumn: column, sortDirection: direction });
    get().fetchEntries();
  },
  
  toggleSort: (column) => {
    const state = get();
    if (state.sortColumn === column) {
      set({ sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc' });
    } else {
      set({ sortColumn: column, sortDirection: 'asc' });
    }
    get().fetchEntries();
  },

  // ===========================================
  // UI STATE ACTIONS
  // ===========================================
  
  setColumns: (columns) => set({ columns }),
  
  toggleColumnVisibility: (columnId) => {
    const columns = get().columns.map((col) =>
      col.id === columnId ? { ...col, visible: !col.visible } : col
    );
    set({ columns });
  },
  
  setSelectedEntry: (id) => set({ selectedEntryId: id }),
  
  openImportModal: () => set({ isImportModalOpen: true }),
  closeImportModal: () => set({ isImportModalOpen: false }),
  
  openLicenseModal: () => set({ isLicenseModalOpen: true }),
  closeLicenseModal: () => set({ isLicenseModalOpen: false }),
  
  openExportModal: () => set({ isExportModalOpen: true }),
  closeExportModal: () => set({ isExportModalOpen: false }),
  
  toggleColumnSettings: () => set({ isColumnSettingsOpen: !get().isColumnSettingsOpen }),
  
  // Operations Log Modal
  openOperationsLog: () => set({ isOperationsLogOpen: true }),
  closeOperationsLog: () => set({ isOperationsLogOpen: false }),
  
  // Add Supplier Modal
  openAddSupplierModal: () => set({ isAddSupplierModalOpen: true }),
  closeAddSupplierModal: () => set({ isAddSupplierModalOpen: false }),
  
  // Incomplete Operations Dialog
  setHasIncompleteOperations: (has) => set({ hasIncompleteOperations: has }),
  setIncompleteOperationsResolved: (resolved) => set({ incompleteOperationsResolved: resolved }),

  // ===========================================
  // STATS ACTIONS
  // ===========================================
  
  fetchStats: async () => {
    try {
      const stats = await window.electronApi.database.getStats();
      set({
        stats: {
          totalEntries: stats.totalEntries,
          uniqueReferences: stats.uniqueReferences,
          uniqueSuppliers: stats.uniqueSuppliers,
          uniqueBrands: stats.uniqueBrands,
        },
      });
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  },
  
  // ===========================================
  // SUPPLIER ACTIONS
  // ===========================================
  
  refreshSuppliers: async () => {
    // Currently a placeholder - can be extended to manage a suppliers list
    // For now, this is called after supplier creation to refresh any dependent data
    console.log('[AppStore] Refreshing suppliers...');
    // Optionally refresh stats which includes supplier count
    try {
      const stats = await window.electronApi.database.getStats();
      set({
        stats: {
          totalEntries: stats.totalEntries,
          uniqueReferences: stats.uniqueReferences,
          uniqueSuppliers: stats.uniqueSuppliers,
          uniqueBrands: stats.uniqueBrands,
        },
      });
    } catch (error) {
      console.error('Failed to refresh supplier data:', error);
    }
  },
}));

// ===========================================
// SELECTORS
// ===========================================

export const selectIsReadOnly = (state: AppState) =>
  !state.licenseStatus.isValid || state.licenseStatus.isExpired;

export const selectCanExport = (state: AppState) =>
  state.licenseStatus.featureFlags.canExport;

export const selectCanImport = (state: AppState) =>
  state.licenseStatus.featureFlags.canImport;

export const selectVisibleColumns = (state: AppState) =>
  state.columns.filter((col) => col.visible);

export const selectHasActiveFilters = (state: AppState) =>
  state.globalSearch !== '' || state.columnFilters.length > 0;
