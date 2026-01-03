/**
 * License Banner Component
 * ========================
 * Displays warning banner when license is invalid or expired.
 * Shows at the top of the application.
 */

import React from 'react';
import { useAppStore } from '../store';

export const LicenseBanner: React.FC = () => {
  const licenseStatus = useAppStore((state) => state.licenseStatus);
  const openLicenseModal = useAppStore((state) => state.openLicenseModal);

  if (licenseStatus.isValid && !licenseStatus.isExpired) {
    // Show warning if expiring soon (within 7 days)
    if (licenseStatus.daysRemaining && licenseStatus.daysRemaining <= 7) {
      return (
        <div className="bg-yellow-500 text-yellow-900 px-4 py-2 flex items-center justify-center gap-2 text-sm">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>
            Votre licence expire dans {licenseStatus.daysRemaining} jour{licenseStatus.daysRemaining > 1 ? 's' : ''}.
          </span>
          <button
            onClick={openLicenseModal}
            className="underline font-medium hover:no-underline"
          >
            Renouveler
          </button>
        </div>
      );
    }
    return null;
  }

  const isExpired = licenseStatus.isExpired && licenseStatus.licenseType;
  const bannerClass = isExpired
    ? 'bg-red-500 text-white'
    : 'bg-yellow-500 text-yellow-900';

  return (
    <div className={`${bannerClass} px-4 py-2 flex items-center justify-center gap-2 text-sm`}>
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <span>
        {isExpired
          ? 'Votre licence a expiré. L\'application est en mode lecture seule.'
          : 'Licence non activée. Veuillez activer votre licence pour débloquer toutes les fonctionnalités.'}
      </span>
      <button
        onClick={openLicenseModal}
        className="underline font-medium hover:no-underline ml-2"
      >
        {isExpired ? 'Renouveler' : 'Activer'}
      </button>
    </div>
  );
};
