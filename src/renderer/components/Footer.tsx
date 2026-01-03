/**
 * Footer Component
 * ================
 * Status bar with pagination and stats.
 */

import React from 'react';
import { useAppStore } from '../store';

export const Footer: React.FC = () => {
  const totalEntries = useAppStore((state) => state.totalEntries);
  const currentPageNum = useAppStore((state) => state.currentPageNum);
  const pageSize = useAppStore((state) => state.pageSize);
  const totalPages = useAppStore((state) => state.totalPages);
  const setPage = useAppStore((state) => state.setPage);
  const setPageSize = useAppStore((state) => state.setPageSize);
  const stats = useAppStore((state) => state.stats);

  const startEntry = (currentPageNum - 1) * pageSize + 1;
  const endEntry = Math.min(currentPageNum * pageSize, totalEntries);

  const pageSizeOptions = [25, 50, 100, 200];

  return (
    <footer className="bg-white border-t border-gray-200 px-6 py-3">
      <div className="flex items-center justify-between">
        {/* Stats */}
        <div className="flex items-center gap-6 text-sm text-gray-600">
          {stats && (
            <>
              <span>
                <strong>{stats.totalEntries.toLocaleString()}</strong> entrées
              </span>
              <span className="text-gray-300">|</span>
              <span>
                <strong>{stats.uniqueReferences.toLocaleString()}</strong> références
              </span>
              <span className="text-gray-300">|</span>
              <span>
                <strong>{stats.uniqueSuppliers.toLocaleString()}</strong> fournisseurs
              </span>
              <span className="text-gray-300">|</span>
              <span>
                <strong>{stats.uniqueBrands.toLocaleString()}</strong> marques
              </span>
            </>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center gap-4">
          {/* Page Size Selector */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Par page:</label>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="input py-1 px-2 text-sm w-20"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          {/* Page Info */}
          <span className="text-sm text-gray-600">
            {totalEntries > 0 ? (
              <>
                {startEntry}-{endEntry} sur {totalEntries.toLocaleString()}
              </>
            ) : (
              '0 entrées'
            )}
          </span>

          {/* Page Navigation */}
          <div className="flex items-center gap-1">
            {/* First Page */}
            <button
              onClick={() => setPage(1)}
              disabled={currentPageNum === 1}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Première page"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>

            {/* Previous Page */}
            <button
              onClick={() => setPage(currentPageNum - 1)}
              disabled={currentPageNum === 1}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Page précédente"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* Page Number Input */}
            <div className="flex items-center gap-1 mx-2">
              <input
                type="number"
                min={1}
                max={totalPages || 1}
                value={currentPageNum}
                onChange={(e) => {
                  const page = parseInt(e.target.value);
                  if (page >= 1 && page <= totalPages) {
                    setPage(page);
                  }
                }}
                className="input py-1 px-2 text-sm w-16 text-center"
              />
              <span className="text-sm text-gray-600">/ {totalPages || 1}</span>
            </div>

            {/* Next Page */}
            <button
              onClick={() => setPage(currentPageNum + 1)}
              disabled={currentPageNum >= totalPages}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Page suivante"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* Last Page */}
            <button
              onClick={() => setPage(totalPages)}
              disabled={currentPageNum >= totalPages}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Dernière page"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
};
