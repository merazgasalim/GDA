import { useState, useEffect } from 'react';
import { useAppStore } from '../store';
import { LicenseDialog } from './LicenseDialog';

export function LicenseStatusBar() {
  const [showDialog, setShowDialog] = useState(false);
  const licenseStatus = useAppStore((state) => state.licenseStatus);
  const isLicenseLoading = useAppStore((state) => state.isLicenseLoading);
  const fetchLicenseStatus = useAppStore((state) => state.fetchLicenseStatus);

  useEffect(() => {
    fetchLicenseStatus();
  }, [fetchLicenseStatus]);

  const isValid = licenseStatus?.isValid;
  const daysRemaining = licenseStatus?.daysRemaining;

  const getStatusColor = () => {
    if (!isValid) return 'bg-red-500';
    if (daysRemaining !== undefined && daysRemaining !== null && daysRemaining <= 7) return 'bg-yellow-500';
    if (daysRemaining !== undefined && daysRemaining !== null && daysRemaining <= 30) return 'bg-orange-500';
    return 'bg-green-500';
  };

  const getStatusText = () => {
    if (isLicenseLoading) return 'Vérification...';
    if (!isValid) return 'Licence invalide';
    if (daysRemaining !== undefined && daysRemaining !== null && daysRemaining <= 0) return 'Licence expirée';
    if (daysRemaining !== undefined && daysRemaining !== null) return `${daysRemaining} jours restants`;
    return 'Licence active';
  };

  return (
    <>
      <div 
        className="flex items-center gap-2 px-3 py-1 rounded-full cursor-pointer hover:opacity-80 transition-opacity"
        onClick={() => setShowDialog(true)}
        title="Cliquez pour gérer la licence"
      >
        <span className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {getStatusText()}
        </span>
        <button
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline ml-1"
          onClick={(e) => {
            e.stopPropagation();
            setShowDialog(true);
          }}
        >
          {isValid ? 'Détails' : 'Activer'}
        </button>
      </div>

      <LicenseDialog 
        show={showDialog} 
        onClose={() => setShowDialog(false)} 
      />
    </>
  );
}