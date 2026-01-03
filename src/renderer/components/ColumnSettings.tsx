/**
 * Column Settings Panel
 * =====================
 * Panel for toggling column visibility.
 */

import React from 'react';
import { useAppStore } from '../store';

export const ColumnSettings: React.FC = () => {
  const isOpen = useAppStore((state) => state.isColumnSettingsOpen);
  const columns = useAppStore((state) => state.columns);
  const toggleColumnVisibility = useAppStore((state) => state.toggleColumnVisibility);
  const toggleColumnSettings = useAppStore((state) => state.toggleColumnSettings);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30"
        onClick={toggleColumnSettings}
      />
      
      {/* Panel */}
      <div className="absolute top-16 right-6 z-40 bg-white rounded-lg shadow-lg border border-gray-200 p-4 w-64 animate-slide-in">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-gray-900">Colonnes visibles</h3>
          <button
            onClick={toggleColumnSettings}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="space-y-2">
          {columns.map((column) => (
            <label
              key={column.id}
              className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
            >
              <input
                type="checkbox"
                checked={column.visible}
                onChange={() => toggleColumnVisibility(column.id)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">{column.header}</span>
            </label>
          ))}
        </div>
      </div>
    </>
  );
};
