import { useState } from 'react';
import { useAppStore } from '../store';

interface LicenseDialogProps {
  show: boolean;
  onClose: () => void;
}

export function LicenseDialog({ show, onClose }: LicenseDialogProps) {
  const [licenseKey, setLicenseKey] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const licenseStatus = useAppStore((state) => state.licenseStatus);
  const fetchLicenseStatus = useAppStore((state) => state.fetchLicenseStatus);

  const handleActivate = async () => {
    if (!licenseKey.trim()) {
      setError('Veuillez entrer une clé de licence');
      return;
    }

    setIsActivating(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await window.electronApi.license.activate(licenseKey.trim());
      if (result.success) {
        setSuccess(true);
        setLicenseKey('');
        await fetchLicenseStatus();
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setError(result.error || 'Échec de l\'activation');
      }
    } catch (err) {
      setError('Erreur lors de l\'activation');
    } finally {
      setIsActivating(false);
    }
  };

  const handleDeactivate = async () => {
    try {
      await window.electronApi.license.deactivate();
      await fetchLicenseStatus();
    } catch (err) {
      setError('Erreur lors de la désactivation');
    }
  };

  if (!show) {
    return null;
  }

  const isValid = licenseStatus?.isValid;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50" 
        onClick={onClose}
      />
      
      {/* Dialog */}
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Gestion de la Licence
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Current Status */}
        <div className="mb-6 p-4 rounded-lg bg-gray-50 dark:bg-gray-700">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Statut actuel
          </h3>
          {isValid && licenseStatus ? (
            <div className="space-y-1 text-sm">
              <p className="text-green-600 dark:text-green-400 font-medium">
                ✓ Licence active
              </p>
              <p className="text-gray-600 dark:text-gray-400">
                Client: {licenseStatus.customerName || 'N/A'}
              </p>
              <p className="text-gray-600 dark:text-gray-400">
                Type: {licenseStatus.licenseType || 'N/A'}
              </p>
              <p className="text-gray-600 dark:text-gray-400">
                Expire: {licenseStatus.expirationDate 
                  ? new Date(licenseStatus.expirationDate).toLocaleDateString('fr-FR') 
                  : 'N/A'}
              </p>
              {licenseStatus.daysRemaining !== null && (
                <p className="text-gray-600 dark:text-gray-400">
                  Jours restants: {licenseStatus.daysRemaining}
                </p>
              )}
            </div>
          ) : (
            <p className="text-red-600 dark:text-red-400 font-medium">
              ✗ Aucune licence active
            </p>
          )}
        </div>

        {/* Activation Form */}
        {!isValid && (
          <div className="space-y-4">
            <div>
              <label 
                htmlFor="license-key" 
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Clé de licence
              </label>
              <textarea
                id="license-key"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="Collez votre clé de licence ici..."
                className="w-full h-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                         focus:ring-2 focus:ring-blue-500 focus:border-transparent
                         placeholder-gray-400 dark:placeholder-gray-500
                         resize-none font-mono text-xs"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-sm">
                ✓ Licence activée avec succès!
              </div>
            )}

            <button
              onClick={handleActivate}
              disabled={isActivating || !licenseKey.trim()}
              className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400
                       text-white font-medium rounded-lg transition-colors
                       disabled:cursor-not-allowed"
            >
              {isActivating ? 'Activation...' : 'Activer la licence'}
            </button>
          </div>
        )}

        {/* Deactivate Button (when license is valid) */}
        {isValid && (
          <button
            onClick={handleDeactivate}
            className="w-full py-2 px-4 bg-red-600 hover:bg-red-700
                     text-white font-medium rounded-lg transition-colors"
          >
            Désactiver la licence
          </button>
        )}

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Contactez le support si vous avez des problèmes d'activation
          </p>
        </div>
      </div>
    </div>
  );
}