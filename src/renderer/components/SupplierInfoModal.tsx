/**
 * Supplier Info Modal
 * ===================
 * Modal displaying detailed supplier information.
 * Shows name, address, phone numbers, emails, and website.
 */

import React, { useEffect, useState } from 'react';
import type { Supplier } from '../../shared/types';

// ===========================================
// TYPES
// ===========================================

interface SupplierInfoModalProps {
  supplierName: string;
  isOpen: boolean;
  onClose: () => void;
}

// ===========================================
// HELPER FUNCTIONS
// ===========================================

/**
 * Get channel display icon and label.
 */
function getChannelDisplay(channel: string): { icon: string; label: string } {
  switch (channel) {
    case 'WHATSAPP':
      return { icon: '📱', label: 'WhatsApp' };
    case 'VIBER':
      return { icon: '💬', label: 'Viber' };
    case 'TELEGRAM':
      return { icon: '✈️', label: 'Telegram' };
    case 'REGULAR':
    default:
      return { icon: '📞', label: 'Standard' };
  }
}

/**
 * Format phone channels for display.
 */
function formatChannels(channels: string[] | null): string {
  if (!channels || channels.length === 0) return '';
  return channels.map(ch => getChannelDisplay(ch).label).join(', ');
}

// ===========================================
// COMPONENT
// ===========================================

export const SupplierInfoModal: React.FC<SupplierInfoModalProps> = ({
  supplierName,
  isOpen,
  onClose,
}) => {
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch supplier data when modal opens
  useEffect(() => {
    if (!isOpen || !supplierName) return;

    const fetchSupplier = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        // Search for supplier by name
        const suppliers = await window.electronApi.supplier.search(supplierName, 1);
        
        if (suppliers && suppliers.length > 0) {
          // Find exact match
          const exactMatch = suppliers.find(
            s => s.name.toLowerCase() === supplierName.toLowerCase()
          );
          setSupplier(exactMatch || suppliers[0]);
        } else {
          setSupplier(null);
        }
      } catch (err) {
        console.error('Error fetching supplier:', err);
        setError('Impossible de charger les informations du fournisseur');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSupplier();
  }, [isOpen, supplierName]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Separate contacts by type
  const phoneContacts = supplier?.contacts.filter(c => c.type === 'PHONE') || [];
  const emailContacts = supplier?.contacts.filter(c => c.type === 'EMAIL') || [];

  // Sort so primary contacts come first
  const sortedPhones = [...phoneContacts].sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    return 0;
  });

  const sortedEmails = [...emailContacts].sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    return 0;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">
            Informations Fournisseur
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="Fermer"
          >
            <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="spinner w-8 h-8" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <svg className="w-12 h-12 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-gray-600">{error}</p>
            </div>
          ) : !supplier ? (
            <div className="text-center py-8">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <p className="text-lg font-medium text-gray-700 mb-2">{supplierName}</p>
              <p className="text-gray-500 text-sm">
                Ce fournisseur n'est pas encore enregistré dans la base de données.
              </p>
              <p className="text-gray-400 text-xs mt-2">
                Vous pouvez l'ajouter depuis la page "Fournisseurs".
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Name */}
              <div>
                <h3 className="text-2xl font-bold text-gray-800 mb-1">
                  {supplier.name}
                </h3>
              </div>

              {/* Address */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-sm font-medium text-gray-500">Adresse</span>
                </div>
                <p className="text-gray-700 ml-7">{supplier.address}</p>
              </div>

              {/* Phone Numbers */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  <span className="text-sm font-medium text-gray-500">Téléphone</span>
                </div>
                {sortedPhones.length > 0 ? (
                  <div className="space-y-2 ml-7">
                    {sortedPhones.map((phone) => (
                      <div
                        key={phone.id}
                        className={`flex items-center gap-3 p-2 rounded-lg ${
                          phone.isPrimary ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'
                        }`}
                      >
                        <span className="font-medium text-gray-800">{phone.value}</span>
                        {phone.isPrimary && (
                          <span className="text-xs px-2 py-0.5 bg-blue-500 text-white rounded-full">
                            Principal
                          </span>
                        )}
                        {phone.channels && phone.channels.length > 0 && (
                          <span className="text-xs text-gray-500">
                            {formatChannels(phone.channels)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm ml-7 italic">Aucun numéro enregistré</p>
                )}
              </div>

              {/* Emails */}
              {sortedEmails.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm font-medium text-gray-500">Email</span>
                  </div>
                  <div className="space-y-2 ml-7">
                    {sortedEmails.map((email) => (
                      <div
                        key={email.id}
                        className={`flex items-center gap-3 p-2 rounded-lg ${
                          email.isPrimary ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'
                        }`}
                      >
                        <a
                          href={`mailto:${email.value}`}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {email.value}
                        </a>
                        {email.isPrimary && (
                          <span className="text-xs px-2 py-0.5 bg-blue-500 text-white rounded-full">
                            Principal
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Website */}
              {supplier.website && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                    <span className="text-sm font-medium text-gray-500">Site Web</span>
                  </div>
                  <a
                    href={supplier.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline ml-7 flex items-center gap-1"
                  >
                    {supplier.website}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="w-full btn btn-secondary"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
