/**
 * CSV Import Wizard Component
 * ===========================
 * A production-grade two-step wizard for importing CSV data.
 * 
 * STEP 1: CSV Input
 * - Select CSV file OR paste CSV content
 * - Option: "First row as label"
 * - Preview detected format
 * - Parse and validate basic structure
 * 
 * STEP 2: Field Mapping + Context
 * - Select/create supplier
 * - Set import date
 * - Map CSV columns to target fields
 * - Preview data with mapping applied
 * - Execute import
 * 
 * DESIGN PRINCIPLES:
 * 1. No database writes until final confirmation
 * 2. Clear validation feedback
 * 3. Recoverable errors (can go back and fix)
 * 4. Full integration with Operations Log
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppStore, selectCanImport } from '../store';
import type {
  CSVParsedData,
  CSVColumnMapping,
  CSVImportPreview,
  CSVTargetField,
  CSVSupplierInfo,
  CSVImportResult,
  DuplicateAnalysisResult,
  DuplicateStrategy,
} from '../../shared/types';
import { CSV_TARGET_FIELD_LABELS } from '../../shared/types';
import DuplicateStrategyModal from './DuplicateStrategyModal';
import AddSupplierModal from './AddSupplierModal';

// ===========================================
// TYPES
// ===========================================

type WizardStep = 1 | 2;

interface WizardState {
  step: WizardStep;
  // Step 1 state
  csvContent: string;
  hasHeader: boolean;
  parsedData: CSVParsedData | null;
  suggestedMapping: CSVColumnMapping | null;
  parseError: string | null;
  filename: string | null;
  // Step 2 state
  mapping: CSVColumnMapping;
  validation: CSVImportPreview | null;
  supplier: CSVSupplierInfo;
  importDate: string;
  existingSuppliers: string[];
  isAddingNewSupplier: boolean;
  newSupplierName: string;
  newSupplierPhone: string;
  // Duplicate detection state
  duplicateAnalysis: DuplicateAnalysisResult | null;
  showDuplicateModal: boolean;
  isAnalyzingDuplicates: boolean;
  // Add Supplier Modal state
  showAddSupplierModal: boolean;
  // UI state
  isParsing: boolean;
  isValidating: boolean;
  isImporting: boolean;
  importResult: CSVImportResult | null;
}

const initialState: WizardState = {
  step: 1,
  csvContent: '',
  hasHeader: true,
  parsedData: null,
  suggestedMapping: null,
  parseError: null,
  filename: null,
  mapping: {},
  validation: null,
  supplier: { name: '', isNew: false },
  importDate: new Date().toISOString().split('T')[0],
  existingSuppliers: [],
  isAddingNewSupplier: false,
  newSupplierName: '',
  newSupplierPhone: '',
  duplicateAnalysis: null,
  showDuplicateModal: false,
  isAnalyzingDuplicates: false,
  showAddSupplierModal: false,
  isParsing: false,
  isValidating: false,
  isImporting: false,
  importResult: null,
};

// ===========================================
// CONSTANTS
// ===========================================

const TARGET_FIELDS: CSVTargetField[] = [
  '--none--',
  'reference',
  'designation',
  'brand',
  'price',
];

const PREVIEW_ROW_LIMIT = 20;

// ===========================================
// MAIN COMPONENT
// ===========================================

export const CSVImportWizard: React.FC = () => {
  const isOpen = useAppStore((state) => state.isImportModalOpen);
  const closeImportModal = useAppStore((state) => state.closeImportModal);
  const canImport = useAppStore(selectCanImport);
  const refreshData = useAppStore((state) => state.refreshData);
  const openLicenseModal = useAppStore((state) => state.openLicenseModal);

  const [state, setState] = useState<WizardState>(initialState);

  // ===========================================
  // LIFECYCLE
  // ===========================================

  // Load existing suppliers when modal opens or when entering step 2
  useEffect(() => {
    if (isOpen) {
      loadSuppliers();
    }
  }, [isOpen]);

  // Also reload suppliers when entering step 2
  useEffect(() => {
    if (state.step === 2) {
      loadSuppliers();
    }
  }, [state.step]);

  // Auto-parse CSV content when it changes (debounced)
  useEffect(() => {
    if (!state.csvContent.trim() || state.step !== 1) {
      // Clear parsed data if content is empty
      if (!state.csvContent.trim() && state.parsedData) {
        setState(prev => ({ ...prev, parsedData: null, suggestedMapping: null }));
      }
      return;
    }

    // Debounce parsing to avoid excessive calls while typing
    const timeoutId = setTimeout(async () => {
      setState(prev => ({ ...prev, isParsing: true, parseError: null }));

      try {
        const result = await window.electronApi.import.csvParse(state.csvContent, {
          hasHeader: state.hasHeader,
          filename: state.filename || undefined,
        });

        if (result.parsedData.totalRows === 0) {
          setState(prev => ({
            ...prev,
            parsedData: null,
            parseError: 'Aucune donnée trouvée dans le fichier CSV',
            isParsing: false,
          }));
          return;
        }

        setState(prev => ({
          ...prev,
          parsedData: result.parsedData,
          suggestedMapping: result.suggestedMapping,
          mapping: result.suggestedMapping,
          parseError: null,
          isParsing: false,
        }));
      } catch (error) {
        setState(prev => ({
          ...prev,
          parseError: error instanceof Error ? error.message : 'Erreur de parsing',
          isParsing: false,
        }));
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [state.csvContent, state.hasHeader, state.step, state.filename]);

  const loadSuppliers = async () => {
    try {
      const suppliers = await window.electronApi.import.csvGetSuppliers();
      setState(prev => ({ ...prev, existingSuppliers: suppliers || [] }));
    } catch (error) {
      console.error('[CSVImportWizard] Failed to load suppliers:', error);
      setState(prev => ({ ...prev, existingSuppliers: [] }));
    }
  };

  // ===========================================
  // STEP 1: CSV INPUT HANDLERS
  // ===========================================

  const handleFileSelect = async () => {
    try {
      const filePath = await window.electronApi.dialog.openFile({
        title: 'Sélectionner un fichier',
        filters: [
          { name: 'Fichiers données', extensions: ['csv', 'xlsx', 'xls', 'txt'] },
          { name: 'Fichiers CSV', extensions: ['csv', 'txt'] },
          { name: 'Fichiers Excel', extensions: ['xlsx', 'xls'] },
          { name: 'Tous les fichiers', extensions: ['*'] },
        ],
      });

      if (filePath) {
        setState(prev => ({ ...prev, isParsing: true, parseError: null }));
        
        const result = await window.electronApi.import.csvReadFile(filePath);
        
        if (result.success && result.content) {
          setState(prev => ({
            ...prev,
            csvContent: result.content!,
            filename: result.filename || null,
            isParsing: false,
          }));
        } else {
          setState(prev => ({
            ...prev,
            parseError: result.error || 'Échec de lecture du fichier',
            isParsing: false,
          }));
        }
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        parseError: error instanceof Error ? error.message : 'Erreur inconnue',
        isParsing: false,
      }));
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setState(prev => ({ 
        ...prev, 
        csvContent: text, 
        filename: null,
        parseError: null,
      }));
    } catch (error) {
      console.error('Failed to read clipboard:', error);
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setState(prev => ({ 
      ...prev, 
      csvContent: e.target.value,
      parseError: null,
    }));
  };

  const handleHeaderToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    setState(prev => ({ ...prev, hasHeader: e.target.checked }));
  };

  const handleReset = () => {
    setState(initialState);
    loadSuppliers();
  };

  const handleGoToStep2 = async () => {
    if (!state.parsedData || !state.mapping) return;

    setState(prev => ({ ...prev, isValidating: true }));

    try {
      const validation = await window.electronApi.import.csvValidate(
        state.parsedData,
        state.mapping
      );

      setState(prev => ({
        ...prev,
        step: 2,
        validation,
        isValidating: false,
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        parseError: error instanceof Error ? error.message : 'Erreur de validation',
        isValidating: false,
      }));
    }
  };

  // ===========================================
  // STEP 2: MAPPING HANDLERS
  // ===========================================

  const handleMappingChange = async (columnIndex: number, field: CSVTargetField) => {
    // Create new mapping, ensuring each field is only mapped once
    const newMapping = { ...state.mapping };
    
    // If this field is already mapped elsewhere, remove that mapping
    if (field !== '--none--') {
      for (const [idx, mappedField] of Object.entries(newMapping)) {
        if (mappedField === field && parseInt(idx) !== columnIndex) {
          newMapping[parseInt(idx)] = '--none--';
        }
      }
    }
    
    newMapping[columnIndex] = field;

    // Re-validate with new mapping
    if (state.parsedData) {
      try {
        const validation = await window.electronApi.import.csvValidate(
          state.parsedData,
          newMapping
        );
        setState(prev => ({ ...prev, mapping: newMapping, validation }));
      } catch (error) {
        setState(prev => ({ ...prev, mapping: newMapping }));
      }
    } else {
      setState(prev => ({ ...prev, mapping: newMapping }));
    }
  };

  const handleSupplierChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    
    if (value === '__add_new__') {
      // Open the AddSupplierModal instead of inline form
      setState(prev => ({
        ...prev,
        showAddSupplierModal: true,
      }));
    } else {
      setState(prev => ({
        ...prev,
        isAddingNewSupplier: false,
        supplier: { name: value, isNew: false },
      }));
    }
  };

  // Callback when supplier is created via AddSupplierModal
  const handleSupplierCreated = useCallback(async () => {
    // Refresh suppliers list
    await loadSuppliers();
    // Close the modal
    setState(prev => ({ ...prev, showAddSupplierModal: false }));
  }, []);

  // Close AddSupplierModal without action
  const handleCloseAddSupplierModal = useCallback(() => {
    setState(prev => ({ ...prev, showAddSupplierModal: false }));
  }, []);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setState(prev => ({ ...prev, importDate: e.target.value }));
  };

  const handleBack = () => {
    setState(prev => ({ ...prev, step: 1, importResult: null, duplicateAnalysis: null }));
  };

  /**
   * Handle import execution with duplicate detection
   * Flow:
   * 1. Analyze for duplicates
   * 2. If duplicates found -> show modal for strategy selection
   * 3. User selects strategy -> execute import with strategy
   * 4. If no duplicates -> execute import directly
   */
  const handleExecuteImport = async () => {
    if (!state.parsedData || !state.supplier.name.trim()) {
      return;
    }

    // Step 1: Analyze for duplicates
    setState(prev => ({ ...prev, isAnalyzingDuplicates: true }));

    try {
      const analysis = await window.electronApi.import.csvAnalyzeDuplicates(
        state.parsedData,
        state.mapping,
        state.supplier.name
      );

      // If duplicates detected, show modal for user decision
      if (analysis.summary.duplicateCount > 0) {
        setState(prev => ({
          ...prev,
          duplicateAnalysis: analysis,
          showDuplicateModal: true,
          isAnalyzingDuplicates: false,
        }));
        return; // Wait for user to select strategy
      }

      // No duplicates - proceed with import directly
      await executeImportWithStrategy(null);
    } catch (error) {
      setState(prev => ({
        ...prev,
        isAnalyzingDuplicates: false,
        importResult: {
          success: false,
          operationId: '',
          importedCount: 0,
          updatedCount: 0,
          errors: [{
            rowIndex: -1,
            columnIndex: -1,
            field: 'reference',
            value: '',
            message: error instanceof Error ? error.message : 'Erreur d\'analyse des doublons',
          }],
          skippedCount: 0,
        },
      }));
    }
  };

  /**
   * Handle strategy selection from duplicate modal
   */
  const handleDuplicateStrategySelect = async (strategy: DuplicateStrategy) => {
    setState(prev => ({ ...prev, showDuplicateModal: false }));

    if (strategy === 'abort') {
      // User chose to abort - just close the modal, stay on step 2
      setState(prev => ({ ...prev, duplicateAnalysis: null }));
      return;
    }

    // Execute import with selected strategy
    await executeImportWithStrategy(strategy);
  };

  /**
   * Execute the actual import with optional duplicate strategy
   */
  const executeImportWithStrategy = async (strategy: DuplicateStrategy | null) => {
    if (!state.parsedData) return;

    setState(prev => ({ ...prev, isImporting: true }));

    try {
      const result = await window.electronApi.import.csvExecute({
        parsedData: state.parsedData,
        mapping: state.mapping,
        supplier: state.supplier,
        importDate: state.importDate,
        duplicateStrategy: strategy || undefined,
      });

      setState(prev => ({ 
        ...prev, 
        importResult: result, 
        isImporting: false,
        duplicateAnalysis: null,
      }));

      if (result.success) {
        await refreshData();
        // Auto-close after success
        setTimeout(() => {
          handleClose();
        }, 2500);
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        isImporting: false,
        duplicateAnalysis: null,
        importResult: {
          success: false,
          operationId: '',
          importedCount: 0,
          updatedCount: 0,
          errors: [{
            rowIndex: -1,
            columnIndex: -1,
            field: 'reference',
            value: '',
            message: error instanceof Error ? error.message : 'Erreur d\'import',
          }],
          skippedCount: 0,
        },
      }));
    }
  };

  /**
   * Close duplicate modal without action
   */
  const handleCloseDuplicateModal = () => {
    setState(prev => ({ 
      ...prev, 
      showDuplicateModal: false, 
      duplicateAnalysis: null,
      isAnalyzingDuplicates: false,
    }));
  };

  // ===========================================
  // CLOSE HANDLER
  // ===========================================

  const handleClose = () => {
    setState(initialState);
    closeImportModal();
  };

  // ===========================================
  // COMPUTED VALUES
  // ===========================================

  const canProceedToStep2 = useMemo(() => {
    return state.parsedData !== null && state.parsedData.totalRows > 0;
  }, [state.parsedData]);

  const canExecuteImport = useMemo(() => {
    return (
      state.validation !== null &&
      state.validation.validRowCount > 0 &&
      state.supplier.name.trim() !== '' &&
      Object.values(state.mapping).includes('reference')
    );
  }, [state.validation, state.supplier, state.mapping]);

  const previewRows = useMemo(() => {
    if (!state.parsedData) return [];
    return state.parsedData.rows.slice(0, PREVIEW_ROW_LIMIT);
  }, [state.parsedData]);

  // ===========================================
  // RENDER
  // ===========================================

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div 
        className="modal-content max-w-5xl max-h-[90vh] overflow-hidden flex flex-col" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">
            CSV Import – Étape {state.step}
          </h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="modal-body flex-1 overflow-y-auto">
          {!canImport ? (
            <LicenseRequired onActivate={() => { handleClose(); openLicenseModal(); }} />
          ) : state.step === 1 ? (
            <Step1CSVInput
              state={state}
              onFileSelect={handleFileSelect}
              onPaste={handlePaste}
              onContentChange={handleContentChange}
              onHeaderToggle={handleHeaderToggle}
            />
          ) : (
            <Step2FieldMapping
              state={state}
              previewRows={previewRows}
              onMappingChange={handleMappingChange}
              onSupplierChange={handleSupplierChange}
              onDateChange={handleDateChange}
            />
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer border-t border-gray-200 flex-shrink-0">
          {state.step === 1 ? (
            <Step1Footer
              state={state}
              canProceed={canProceedToStep2}
              onReset={handleReset}
              onProceed={handleGoToStep2}
              onClose={handleClose}
            />
          ) : (
            <Step2Footer
              state={state}
              canExecute={canExecuteImport}
              onBack={handleBack}
              onExecute={handleExecuteImport}
              onClose={handleClose}
            />
          )}
        </div>
      </div>

      {/* Duplicate Strategy Modal - shown when duplicates are detected */}
      {state.duplicateAnalysis && (
        <DuplicateStrategyModal
          isOpen={state.showDuplicateModal}
          analysis={state.duplicateAnalysis}
          supplierName={state.supplier.name}
          onStrategySelect={handleDuplicateStrategySelect}
          onClose={handleCloseDuplicateModal}
        />
      )}

      {/* Add Supplier Modal */}
      <AddSupplierModal
        isOpen={state.showAddSupplierModal}
        onClose={handleCloseAddSupplierModal}
        refreshSuppliers={handleSupplierCreated}
      />
    </div>
  );
};

// ===========================================
// SUB-COMPONENTS
// ===========================================

const LicenseRequired: React.FC<{ onActivate: () => void }> = ({ onActivate }) => (
  <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded-md">
    <p className="font-medium">Licence requise</p>
    <p className="text-sm mt-1">
      L'importation nécessite une licence valide.{' '}
      <button onClick={onActivate} className="underline hover:no-underline">
        Activer ma licence
      </button>
    </p>
  </div>
);

// ===========================================
// STEP 1 COMPONENT
// ===========================================

interface Step1Props {
  state: WizardState;
  onFileSelect: () => void;
  onPaste: () => void;
  onContentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onHeaderToggle: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const Step1CSVInput: React.FC<Step1Props> = ({
  state,
  onFileSelect,
  onPaste,
  onContentChange,
  onHeaderToggle,
}) => (
  <div className="space-y-4">
    {/* Instructions */}
    <div className="bg-blue-50 border border-blue-200 text-blue-800 p-4 rounded-md text-sm">
      <p className="font-medium mb-2">Instructions:</p>
      <ol className="list-decimal list-inside space-y-1">
        <li>Sélectionnez un fichier CSV ou collez le contenu CSV ci-dessous</li>
        <li>Cochez "Première ligne comme en-tête" si votre CSV a des en-têtes</li>
        <li>Cliquez sur "Importer" pour analyser les données</li>
      </ol>
    </div>

    {/* File selector */}
    <div className="flex items-center gap-4">
      <button
        onClick={onFileSelect}
        disabled={state.isParsing}
        className="btn btn-secondary"
      >
        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        Choisir un fichier
      </button>
      
      {state.filename && (
        <span className="text-sm text-gray-600">
          Fichier: <span className="font-medium">{state.filename}</span>
        </span>
      )}
    </div>

    {/* Textarea for paste */}
    <div>
      <div className="flex justify-between items-center mb-2">
        <label className="block text-sm font-medium text-gray-700">
          Ou collez le contenu CSV:
        </label>
        <button onClick={onPaste} className="btn btn-secondary btn-sm">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          Coller
        </button>
      </div>
      <textarea
        value={state.csvContent}
        onChange={onContentChange}
        placeholder="Collez vos données CSV ici..."
        className="input font-mono text-xs h-40 resize-none w-full"
        disabled={state.isParsing}
      />
    </div>

    {/* First row as header checkbox */}
    <div className="flex items-center">
      <input
        type="checkbox"
        id="hasHeader"
        checked={state.hasHeader}
        onChange={onHeaderToggle}
        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
      />
      <label htmlFor="hasHeader" className="ml-2 text-sm text-gray-700">
        Première ligne comme en-tête
      </label>
    </div>

    {/* Parse error */}
    {state.parseError && (
      <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-md text-sm">
        <p className="font-medium">Erreur:</p>
        <p>{state.parseError}</p>
      </div>
    )}

    {/* Parse result preview */}
    {state.parsedData && (
      <div className="space-y-3">
        <div className="flex gap-4">
          <div className="badge badge-blue">
            Lignes: {state.parsedData.totalRows}
          </div>
          <div className="badge badge-green">
            Colonnes: {state.parsedData.columnCount}
          </div>
          <div className="badge badge-gray">
            Délimiteur: {state.parsedData.delimiter === '\t' ? 'Tab' : state.parsedData.delimiter}
          </div>
        </div>

        {/* Preview table */}
        <div className="border border-gray-200 rounded-md overflow-hidden">
          <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 border-b">
            Aperçu des données (5 premières lignes)
          </div>
          <div className="max-h-40 overflow-auto">
            <table className="data-grid text-xs">
              <thead>
                <tr>
                  {state.parsedData.headers.map((header, i) => (
                    <th key={i} className="whitespace-nowrap">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.parsedData.rows.slice(0, 5).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="max-w-[200px] truncate">
                        {cell || <span className="text-gray-400 italic">vide</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )}
  </div>
);

// ===========================================
// STEP 2 COMPONENT
// ===========================================

interface Step2Props {
  state: WizardState;
  previewRows: string[][];
  onMappingChange: (columnIndex: number, field: CSVTargetField) => void;
  onSupplierChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const Step2FieldMapping: React.FC<Step2Props> = ({
  state,
  previewRows,
  onMappingChange,
  onSupplierChange,
  onDateChange,
}) => (
  <div className="space-y-4">
    {/* Import result message */}
    {state.importResult && (
      <div
        className={`p-4 rounded-md ${
          state.importResult.success
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-800'
        }`}
      >
        {state.importResult.success ? (
          <div>
            <p className="font-medium">
              ✓ Import réussi!
            </p>
            <div className="text-sm mt-1 space-y-1">
              <p>{state.importResult.importedCount} entrées importées</p>
              {state.importResult.updatedCount !== undefined && state.importResult.updatedCount > 0 && (
                <p className="text-blue-600">
                  {state.importResult.updatedCount} prix mis à jour (historique conservé)
                </p>
              )}
              {state.importResult.skippedCount > 0 && (
                <p className="text-gray-600">
                  {state.importResult.skippedCount} lignes ignorées
                </p>
              )}
              {state.importResult.strategyUsed && (
                <p className="text-xs text-gray-500 mt-2">
                  Stratégie: {state.importResult.strategyUsed === 'skip' ? 'Doublons ignorés' : 
                             state.importResult.strategyUsed === 'update' ? 'Prix mis à jour' : 
                             state.importResult.strategyUsed}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div>
            <p className="font-medium">Erreur d'importation</p>
            {state.importResult.errors.map((err, i) => (
              <p key={i} className="text-sm mt-1">{err.message}</p>
            ))}
          </div>
        )}
      </div>
    )}

    {/* Top controls: Supplier + Date */}
    <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-md">
      {/* Supplier selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Fournisseur <span className="text-red-500">*</span>
        </label>
        <div className="space-y-2">
          <select
            value={state.supplier.name || ''}
            onChange={onSupplierChange}
            className="input text-sm"
          >
            <option value="">-- Sélectionner --</option>
            {state.existingSuppliers.length > 0 ? (
              state.existingSuppliers.map((s, idx) => (
                <option key={`${String(s ?? '')}-${idx}`} value={s ?? ''}>{s ?? '(inconnu)'}</option>
              ))
            ) : (
              <option value="" disabled>Aucun fournisseur existant</option>
            )}
            <option value="__add_new__">+ Ajouter Fournisseur</option>
          </select>
          {state.supplier.name && (
            <div className="text-xs text-gray-600">
              Fournisseur: <span className="font-medium">{state.supplier.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Date picker */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Date d'arrivage
        </label>
        <input
          type="date"
          value={state.importDate}
          onChange={onDateChange}
          className="input text-sm"
        />
      </div>
    </div>

    {/* Validation summary */}
    {state.validation && (
      <div className="flex gap-4">
        <div className="badge badge-green">
          Valides: {state.validation.validRowCount}
        </div>
        {state.validation.invalidRowCount > 0 && (
          <div className="badge badge-red">
            Erreurs: {state.validation.invalidRowCount}
          </div>
        )}
        {!Object.values(state.mapping).includes('reference') && (
          <div className="badge badge-yellow">
            ⚠ "Reference" doit être mappé
          </div>
        )}
      </div>
    )}

    {/* Mapping table */}
    {state.parsedData && (
      <div className="border border-gray-200 rounded-md overflow-hidden">
        <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 border-b">
          Configuration du mapping ({state.parsedData.totalRows} lignes)
        </div>
        <div className="max-h-[40vh] overflow-auto">
          <table className="data-grid text-xs w-full">
            <thead className="sticky top-0 bg-white z-10">
              <tr>
                {state.parsedData.headers.map((header, i) => (
                  <th key={i} className="min-w-[150px]">
                    <div className="space-y-1">
                      <div className="text-gray-600 font-normal text-xs truncate" title={header}>
                        {header}
                      </div>
                      <select
                        value={state.mapping[i] || '--none--'}
                        onChange={(e) => onMappingChange(i, e.target.value as CSVTargetField)}
                        className={`w-full text-xs p-1 border rounded ${
                          state.mapping[i] && state.mapping[i] !== '--none--'
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-300'
                        }`}
                      >
                        {TARGET_FIELDS.map((field) => (
                          <option key={field} value={field}>
                            {CSV_TARGET_FIELD_LABELS[field]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, rowIndex) => {
                // Check if this row has errors
                const rowErrors = state.validation?.validationErrors.filter(
                  (e) => e.rowIndex === rowIndex
                ) || [];
                const hasError = rowErrors.length > 0;

                return (
                  <tr key={rowIndex} className={hasError ? 'bg-red-50' : ''}>
                    {row.map((cell, cellIndex) => {
                      const cellError = rowErrors.find((e) => e.columnIndex === cellIndex);
                      return (
                        <td
                          key={cellIndex}
                          className={`max-w-[200px] truncate ${
                            cellError ? 'text-red-600 font-medium' : ''
                          }`}
                          title={cellError ? cellError.message : cell}
                        >
                          {cell || <span className="text-gray-400 italic">vide</span>}
                          {cellError && (
                            <span className="ml-1 text-red-500">⚠</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {state.parsedData.totalRows > PREVIEW_ROW_LIMIT && (
          <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500 text-center border-t">
            Affichage de {PREVIEW_ROW_LIMIT} sur {state.parsedData.totalRows} lignes
          </div>
        )}
      </div>
    )}

    {/* Validation errors detail */}
    {state.validation && state.validation.validationErrors.length > 0 && (
      <div className="bg-red-50 border border-red-200 rounded-md p-3 max-h-48 overflow-y-auto">
        <p className="font-medium text-red-800 text-sm mb-2">
          Erreurs de validation ({state.validation.validationErrors.length}):
        </p>
        <div className="space-y-2">
          {state.validation.validationErrors.slice(0, 10).map((err, i) => {
            const rowData = state.parsedData?.rows[err.rowIndex];
            return (
              <details key={i} className="text-xs">
                <summary className="text-red-700 cursor-pointer hover:text-red-900">
                  <span className="font-medium">Ligne {err.rowIndex + 1}</span> – {CSV_TARGET_FIELD_LABELS[err.field]}: {err.message}
                </summary>
                {rowData && (
                  <div className="mt-1 ml-4 p-2 bg-white rounded border border-red-100 text-gray-700">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                      {state.parsedData?.headers.map((header, colIdx) => (
                        <div key={colIdx} className="flex">
                          <span className="text-gray-500 truncate max-w-[80px]" title={header}>{header}:</span>
                          <span className="ml-1 font-mono truncate" title={rowData[colIdx] || '(vide)'}>
                            {rowData[colIdx] || <span className="text-gray-400 italic">(vide)</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </details>
            );
          })}
          {state.validation.validationErrors.length > 10 && (
            <p className="text-xs text-red-600 italic">
              ... et {state.validation.validationErrors.length - 10} autres erreurs
            </p>
          )}
        </div>
      </div>
    )}

    {/* Footer text */}
    <div className="text-sm text-gray-500 italic">
      Les lignes importées seront ajoutées à la base de données existante.
    </div>
  </div>
);

// ===========================================
// FOOTER COMPONENTS
// ===========================================

interface Step1FooterProps {
  state: WizardState;
  canProceed: boolean;
  onReset: () => void;
  onProceed: () => void;
  onClose: () => void;
}

const Step1Footer: React.FC<Step1FooterProps> = ({
  state,
  canProceed,
  onReset,
  onProceed,
  onClose,
}) => (
  <>
    <button onClick={onReset} className="btn btn-secondary">
      Réinitialiser
    </button>
    <div className="flex-1" />
    <button onClick={onClose} className="btn btn-secondary">
      Annuler
    </button>
    <button
      onClick={onProceed}
      disabled={!canProceed || state.isParsing || state.isValidating}
      className="btn btn-primary"
    >
      {state.isParsing ? (
        <>
          <div className="spinner w-4 h-4 mr-2" />
          Analyse...
        </>
      ) : state.isValidating ? (
        <>
          <div className="spinner w-4 h-4 mr-2" />
          Validation...
        </>
      ) : (
        'Suivant'
      )}
    </button>
  </>
);

interface Step2FooterProps {
  state: WizardState;
  canExecute: boolean;
  onBack: () => void;
  onExecute: () => void;
  onClose: () => void;
}

const Step2Footer: React.FC<Step2FooterProps> = ({
  state,
  canExecute,
  onBack,
  onExecute,
  onClose,
}) => {
  const isProcessing = state.isImporting || state.isAnalyzingDuplicates;
  
  return (
    <>
      <button onClick={onBack} className="btn btn-secondary" disabled={isProcessing}>
        Retour
      </button>
      <div className="flex-1" />
      <button onClick={onClose} className="btn btn-secondary" disabled={isProcessing}>
        Annuler
      </button>
      <button
        onClick={onExecute}
        disabled={!canExecute || isProcessing || state.importResult?.success}
        className="btn btn-success"
      >
        {state.isAnalyzingDuplicates ? (
          <>
            <div className="spinner w-4 h-4 mr-2" />
            Analyse des doublons...
          </>
        ) : state.isImporting ? (
          <>
            <div className="spinner w-4 h-4 mr-2" />
            Importation...
          </>
        ) : state.importResult?.success ? (
          '✓ Importé'
        ) : (
          <>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Importer
          </>
        )}
      </button>
    </>
  );
};

export default CSVImportWizard;
