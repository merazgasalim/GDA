/**
 * License Modal Component
 * =======================
 * Modal for license activation and status display.
 */

import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store';

export const LicenseModal: React.FC = () => {
  const isOpen = useAppStore((state) => state.isLicenseModalOpen);
  const licenseStatus = useAppStore((state) => state.licenseStatus);
  const closeLicenseModal = useAppStore((state) => state.closeLicenseModal);
  const fetchLicenseStatus = useAppStore((state) => state.fetchLicenseStatus);

  const [licenseKey, setLicenseKey] = useState('');
  const [machineId, setMachineId] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Fetch machine ID when modal opens
      window.electronApi.license.getMachineId().then(setMachineId);
      setError(null);
      setSuccess(null);
      setLicenseKey('');
    }
  }, [isOpen]);

  const handleActivate = async () => {
    if (!licenseKey.trim()) {
      setError('Veuillez entrer une clé de licence');
      return;
    }

    setIsActivating(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await window.electronApi.license.activate(licenseKey);
      
      if (result.success) {
        setSuccess('Licence activée avec succès!');
        await fetchLicenseStatus();
        setTimeout(() => {
          closeLicenseModal();
        }, 1500);
      } else {
        setError(result.error || 'Échec de l\'activation');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur d\'activation');
    } finally {
      setIsActivating(false);
    }
  };

  const handleDeactivate = async () => {
    const confirmed = await window.electronApi.dialog.showMessage({
      type: 'question',
      title: 'Désactiver la licence',
      message: 'Êtes-vous sûr de vouloir désactiver cette licence?',
      buttons: ['Annuler', 'Désactiver'],
      defaultId: 0,
    });

    if (confirmed === 1) {
      await window.electronApi.license.deactivate();
      await fetchLicenseStatus();
    }
  };

  const copyMachineId = () => {
    navigator.clipboard.writeText(machineId);
    setSuccess('ID machine copié!');
    setTimeout(() => setSuccess(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={closeLicenseModal}>
      <div className="modal-content max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="text-lg font-semibold text-gray-900">
            Gestion de la Licence
          </h2>
          <button
            onClick={closeLicenseModal}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-body space-y-6">
          {/* Current Status */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-medium text-gray-900">Statut actuel</h3>
            </div>
            <div className="card-body space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">État:</span>
                <span className={`badge ${licenseStatus.isValid ? 'badge-green' : 'badge-red'}`}>
                  {licenseStatus.isValid ? 'Valide' : licenseStatus.isExpired ? 'Expiré' : 'Non activé'}
                </span>
              </div>
              
              {licenseStatus.licenseType && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Type:</span>
                  <span className="font-medium">
                    {licenseStatus.licenseType === 'full' ? 'Complète' : 'Essai'}
                  </span>
                </div>
              )}
              
              {licenseStatus.customerName && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Client:</span>
                  <span className="font-medium">{licenseStatus.customerName}</span>
                </div>
              )}
              
              {licenseStatus.expirationDate && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Expiration:</span>
                  <span className="font-medium">
                    {new Date(licenseStatus.expirationDate).toLocaleDateString('fr-FR')}
                  </span>
                </div>
              )}
              
              {licenseStatus.daysRemaining !== null && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Jours restants:</span>
                  <span className={`font-medium ${licenseStatus.daysRemaining <= 7 ? 'text-red-600' : ''}`}>
                    {licenseStatus.daysRemaining}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Machine ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ID Machine
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={machineId}
                readOnly
                className="input font-mono text-sm bg-gray-50"
              />
              <button
                onClick={copyMachineId}
                className="btn btn-secondary btn-sm"
                title="Copier"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Communiquez cet ID lors de l'achat de votre licence
            </p>
          </div>

          {/* License Key Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Clé de Licence
            </label>
            <textarea
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="Collez votre clé de licence ici..."
              className="input font-mono text-sm h-24 resize-none"
            />
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}
          
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md text-sm">
              {success}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {licenseStatus.isValid && (
            <button
              onClick={handleDeactivate}
              className="btn btn-secondary"
            >
              Désactiver
            </button>
          )}
          <button
            onClick={closeLicenseModal}
            className="btn btn-secondary"
          >
            Fermer
          </button>
          <button
            onClick={handleActivate}
            disabled={isActivating || !licenseKey.trim()}
            className="btn btn-primary"
          >
            {isActivating ? (
              <>
                <div className="spinner w-4 h-4 mr-2" />
                Activation...
              </>
            ) : (
              'Activer'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
