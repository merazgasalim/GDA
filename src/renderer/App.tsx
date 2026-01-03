/**
 * Main Application Component
 * ==========================
 * Root component that assembles the full UI.
 * 
 * OPERATIONS LOG INTEGRATION:
 * On startup, we check for incomplete operations (PENDING status).
 * These indicate a potential crash during a previous session.
 * The user must resolve these before proceeding normally.
 */

import React, { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { useAppStore } from './store';
import {
  LicenseBanner,
  LicenseModal,
  CSVImportWizard,
  ExportModal,
  DataGrid,
  Header,
  Footer,
  ColumnSettings,
  OperationsLogModal,
  IncompleteOperationsDialog,
} from './components';

export const App: React.FC = () => {
  const fetchLicenseStatus = useAppStore((state) => state.fetchLicenseStatus);
  const fetchEntries = useAppStore((state) => state.fetchEntries);
  const fetchStats = useAppStore((state) => state.fetchStats);
  const isLicenseLoading = useAppStore((state) => state.isLicenseLoading);
  
  // Incomplete operations state for crash recovery
  const [showIncompleteOperations, setShowIncompleteOperations] = useState(false);
  const [incompleteOperationsChecked, setIncompleteOperationsChecked] = useState(false);

  // Initialize app on mount
  useEffect(() => {
    const initialize = async () => {
      await fetchLicenseStatus();
      
      // Check for incomplete operations before loading data
      // This is critical for data integrity after a crash
      try {
        const incompleteOps = await window.electronApi.operations.getIncomplete();
        if (incompleteOps.length > 0) {
          console.log(`[App] Found ${incompleteOps.length} incomplete operations, prompting user`);
          setShowIncompleteOperations(true);
        } else {
          setIncompleteOperationsChecked(true);
        }
      } catch (error) {
        console.error('[App] Failed to check incomplete operations:', error);
        setIncompleteOperationsChecked(true);
      }
    };
    
    initialize();

    // Set up periodic license validation
    const licenseCheckInterval = setInterval(() => {
      fetchLicenseStatus();
    }, 5 * 60 * 1000); // Check every 5 minutes

    return () => {
      clearInterval(licenseCheckInterval);
    };
  }, [fetchLicenseStatus]);
  
  // Fetch data after incomplete operations are resolved
  useEffect(() => {
    if (incompleteOperationsChecked && !isLicenseLoading) {
      Promise.all([fetchEntries(), fetchStats()]);
    }
  }, [incompleteOperationsChecked, isLicenseLoading, fetchEntries, fetchStats]);
  
  // Handle incomplete operations resolution
  const handleIncompleteOperationsResolved = () => {
    setShowIncompleteOperations(false);
    setIncompleteOperationsChecked(true);
  };

  // Show loading screen while initializing
  if (isLicenseLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="spinner w-12 h-12 mx-auto mb-4" />
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* License Warning Banner */}
      <LicenseBanner />

      {/* Main Layout */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <Header />

        {/* Main Content */}
        <main className="flex-1 overflow-hidden p-6 relative">
          <div className="h-full bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col">
            <DataGrid />
          </div>
          
          {/* Column Settings Panel (positioned relative to main) */}
          <ColumnSettings />
        </main>

        {/* Footer */}
        <Footer />
      </div>

      {/* Modals */}
      <LicenseModal />
      <CSVImportWizard />
      <ExportModal />
      <OperationsLogModal />
      
      {/* Incomplete Operations Dialog (Crash Recovery) */}
      <IncompleteOperationsDialog
        isOpen={showIncompleteOperations}
        onComplete={handleIncompleteOperationsResolved}
      />

      {/* Toast Notifications */}
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#363636',
            color: '#fff',
          },
          success: {
            iconTheme: {
              primary: '#22c55e',
              secondary: '#fff',
            },
          },
          error: {
            iconTheme: {
              primary: '#ef4444',
              secondary: '#fff',
            },
          },
        }}
      />
    </div>
  );
};

export default App;
