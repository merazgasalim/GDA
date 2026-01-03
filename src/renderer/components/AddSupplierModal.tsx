/**
 * Add Supplier Modal
 * ==================
 * Full-featured modal for creating new suppliers with strong validation.
 * 
 * DESIGN PRINCIPLES:
 * 1. Real-time validation with inline error feedback
 * 2. Dynamic phone/email lists with add/remove
 * 3. Cannot remove last phone entry (at least one required)
 * 4. Clean, non-cluttered desktop UX
 * 5. Primary phone auto-selection when only one exists
 * 
 * VALIDATION RULES:
 * - Name: required, min 2 chars
 * - Address: required, min 5 chars
 * - Website: optional, valid URL format
 * - Phones: at least one required, valid format, channel required
 * - Emails: optional, valid format if present
 * - No duplicate values within same supplier
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../store';
import type {
  PhoneChannel,
  CreateSupplier,
  SupplierValidationError,
} from '../../shared/types';

// ===========================================
// LOCAL TYPES
// ===========================================

interface PhoneEntry {
  id: string; // Local temp ID for React keys
  value: string;
  channels: PhoneChannel[]; // Multiple channels allowed (e.g., Regular + WhatsApp)
  isPrimary: boolean;
  error?: string;
}

interface EmailEntry {
  id: string;
  value: string;
  isPrimary: boolean;
  error?: string;
}

interface FormState {
  name: string;
  address: string;
  website: string;
  phones: PhoneEntry[];
  emails: EmailEntry[];
}

interface FormErrors {
  name?: string;
  address?: string;
  website?: string;
  phones?: string; // General phones error
  emails?: string; // General emails error
}

// ===========================================
// CONSTANTS
// ===========================================

const PHONE_CHANNELS: { value: PhoneChannel; label: string }[] = [
  { value: 'REGULAR', label: 'Régulier' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'VIBER', label: 'Viber' },
  { value: 'TELEGRAM', label: 'Telegram' },
];

// ===========================================
// UTILITY FUNCTIONS
// ===========================================

let entryIdCounter = 0;
function generateEntryId(): string {
  return `entry_${++entryIdCounter}_${Date.now()}`;
}

function createEmptyPhone(isPrimary: boolean = false): PhoneEntry {
  return {
    id: generateEntryId(),
    value: '',
    channels: ['REGULAR'], // Default to Regular
    isPrimary,
  };
}

function createEmptyEmail(): EmailEntry {
  return {
    id: generateEntryId(),
    value: '',
    isPrimary: false,
  };
}

// Local validation helpers (for real-time feedback)
function isValidPhoneFormat(value: string): boolean {
  if (!value.trim()) return false;
  const cleaned = value.replace(/[\s\-().]/g, '');
  // Allow + at start, then digits, 6-15 total digits
  return /^\+?[0-9]{6,15}$/.test(cleaned);
}

function isValidEmailFormat(value: string): boolean {
  if (!value.trim()) return true; // Empty is valid (optional)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidUrlFormat(value: string): boolean {
  if (!value.trim()) return true; // Empty is valid (optional)
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

// ===========================================
// COMPONENT PROPS
// ===========================================

interface AddSupplierModalProps {
  /** Override isOpen state (for standalone use outside global store) */
  isOpen?: boolean;
  /** Override close callback (for standalone use) */
  onClose?: () => void;
  /** Override refresh callback (for standalone use) */
  refreshSuppliers?: () => Promise<void>;
}

// ===========================================
// COMPONENT
// ===========================================

const AddSupplierModal: React.FC<AddSupplierModalProps> = ({
  isOpen: propIsOpen,
  onClose: propOnClose,
  refreshSuppliers: propRefreshSuppliers,
}) => {
  // Use props if provided, otherwise fall back to global store
  const storeIsOpen = useAppStore((state) => state.isAddSupplierModalOpen);
  const storeCloseModal = useAppStore((state) => state.closeAddSupplierModal);
  const storeRefreshSuppliers = useAppStore((state) => state.refreshSuppliers);
  
  const isOpen = propIsOpen ?? storeIsOpen;
  const closeModal = propOnClose ?? storeCloseModal;
  const refreshSuppliers = propRefreshSuppliers ?? storeRefreshSuppliers;
  
  // Form state
  const [formState, setFormState] = useState<FormState>({
    name: '',
    address: '',
    website: '',
    phones: [createEmptyPhone(true)], // Start with one primary phone
    emails: [],
  });
  
  // Error state
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  
  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormState({
        name: '',
        address: '',
        website: '',
        phones: [createEmptyPhone(true)],
        emails: [],
      });
      setFormErrors({});
      setSubmitResult(null);
    }
  }, [isOpen]);
  
  // ===========================================
  // FIELD HANDLERS
  // ===========================================
  
  const handleNameChange = useCallback((value: string) => {
    setFormState(prev => ({ ...prev, name: value }));
    // Clear error on change
    if (value.trim().length >= 2) {
      setFormErrors(prev => ({ ...prev, name: undefined }));
    }
  }, []);
  
  const handleAddressChange = useCallback((value: string) => {
    setFormState(prev => ({ ...prev, address: value }));
    if (value.trim().length >= 5) {
      setFormErrors(prev => ({ ...prev, address: undefined }));
    }
  }, []);
  
  const handleWebsiteChange = useCallback((value: string) => {
    setFormState(prev => ({ ...prev, website: value }));
    if (!value.trim() || isValidUrlFormat(value)) {
      setFormErrors(prev => ({ ...prev, website: undefined }));
    }
  }, []);
  
  // ===========================================
  // PHONE HANDLERS
  // ===========================================
  
  const addPhone = useCallback(() => {
    setFormState(prev => ({
      ...prev,
      phones: [...prev.phones, createEmptyPhone(false)],
    }));
  }, []);
  
  const removePhone = useCallback((id: string) => {
    setFormState(prev => {
      // Cannot remove if only one phone
      if (prev.phones.length <= 1) return prev;
      
      const newPhones = prev.phones.filter(p => p.id !== id);
      
      // If we removed the primary phone, make the first one primary
      const removedPhone = prev.phones.find(p => p.id === id);
      if (removedPhone?.isPrimary && newPhones.length > 0) {
        newPhones[0].isPrimary = true;
      }
      
      return { ...prev, phones: newPhones };
    });
  }, []);
  
  const updatePhone = useCallback((id: string, updates: Partial<PhoneEntry>) => {
    setFormState(prev => ({
      ...prev,
      phones: prev.phones.map(p => {
        if (p.id !== id) {
          // If setting new primary, unset others
          if (updates.isPrimary) {
            return { ...p, isPrimary: false };
          }
          return p;
        }
        const updated = { ...p, ...updates };
        // Validate on change
        if (updates.value !== undefined) {
          updated.error = updated.value.trim() && !isValidPhoneFormat(updated.value)
            ? 'Format invalide'
            : undefined;
        }
        return updated;
      }),
    }));
  }, []);

  // Toggle a channel for a phone entry
  const togglePhoneChannel = useCallback((id: string, channel: PhoneChannel) => {
    setFormState(prev => ({
      ...prev,
      phones: prev.phones.map(p => {
        if (p.id !== id) return p;
        const hasChannel = p.channels.includes(channel);
        let newChannels: PhoneChannel[];
        if (hasChannel) {
          // Remove channel, but ensure at least one remains
          newChannels = p.channels.filter(c => c !== channel);
          if (newChannels.length === 0) {
            newChannels = [channel]; // Keep at least one
          }
        } else {
          // Add channel
          newChannels = [...p.channels, channel];
        }
        return { ...p, channels: newChannels };
      }),
    }));
  }, []);
  
  // ===========================================
  // EMAIL HANDLERS
  // ===========================================
  
  const addEmail = useCallback(() => {
    setFormState(prev => ({
      ...prev,
      emails: [...prev.emails, createEmptyEmail()],
    }));
  }, []);
  
  const removeEmail = useCallback((id: string) => {
    setFormState(prev => ({
      ...prev,
      emails: prev.emails.filter(e => e.id !== id),
    }));
  }, []);
  
  const updateEmail = useCallback((id: string, updates: Partial<EmailEntry>) => {
    setFormState(prev => ({
      ...prev,
      emails: prev.emails.map(e => {
        if (e.id !== id) return e;
        const updated = { ...e, ...updates };
        // Validate on change
        if (updates.value !== undefined) {
          updated.error = updated.value.trim() && !isValidEmailFormat(updated.value)
            ? 'Format invalide'
            : undefined;
        }
        return updated;
      }),
    }));
  }, []);
  
  // ===========================================
  // VALIDATION
  // ===========================================
  
  const validateForm = useCallback((): boolean => {
    const errors: FormErrors = {};
    let isValid = true;
    
    // Name validation
    if (!formState.name.trim()) {
      errors.name = 'Le nom est requis';
      isValid = false;
    } else if (formState.name.trim().length < 2) {
      errors.name = 'Le nom doit contenir au moins 2 caractères';
      isValid = false;
    }
    
    // Address validation
    if (!formState.address.trim()) {
      errors.address = 'L\'adresse est requise';
      isValid = false;
    } else if (formState.address.trim().length < 5) {
      errors.address = 'L\'adresse doit contenir au moins 5 caractères';
      isValid = false;
    }
    
    // Website validation
    if (formState.website.trim() && !isValidUrlFormat(formState.website)) {
      errors.website = 'URL invalide';
      isValid = false;
    }
    
    // Phone validation
    const validPhones = formState.phones.filter(p => p.value.trim());
    if (validPhones.length === 0) {
      errors.phones = 'Au moins un numéro de téléphone est requis';
      isValid = false;
    }
    
    // Check for invalid phone formats
    const phoneWithErrors = formState.phones.some(
      p => p.value.trim() && !isValidPhoneFormat(p.value)
    );
    if (phoneWithErrors) {
      errors.phones = 'Un ou plusieurs numéros de téléphone sont invalides';
      isValid = false;
    }
    
    // Check that all phones have at least one channel
    const phonesWithoutChannel = formState.phones.some(
      p => p.value.trim() && p.channels.length === 0
    );
    if (phonesWithoutChannel) {
      errors.phones = 'Chaque téléphone doit avoir au moins un canal';
      isValid = false;
    }
    
    // Check for duplicate phones
    const phoneValues = formState.phones
      .map(p => p.value.trim().replace(/[\s\-().]/g, '').toLowerCase())
      .filter(Boolean);
    const uniquePhones = new Set(phoneValues);
    if (uniquePhones.size !== phoneValues.length) {
      errors.phones = 'Numéros de téléphone en double';
      isValid = false;
    }
    
    // Email validation - check for invalid formats
    const emailWithErrors = formState.emails.some(
      e => e.value.trim() && !isValidEmailFormat(e.value)
    );
    if (emailWithErrors) {
      errors.emails = 'Un ou plusieurs emails sont invalides';
      isValid = false;
    }
    
    // Check for duplicate emails
    const emailValues = formState.emails
      .map(e => e.value.trim().toLowerCase())
      .filter(Boolean);
    const uniqueEmails = new Set(emailValues);
    if (uniqueEmails.size !== emailValues.length) {
      errors.emails = 'Adresses email en double';
      isValid = false;
    }
    
    setFormErrors(errors);
    return isValid;
  }, [formState]);
  
  // ===========================================
  // SUBMIT
  // ===========================================
  
  const handleSubmit = useCallback(async () => {
    // Validate form
    if (!validateForm()) {
      return;
    }
    
    setIsSubmitting(true);
    setSubmitResult(null);
    
    try {
      // Build the payload
      const payload: CreateSupplier = {
        name: formState.name.trim(),
        address: formState.address.trim(),
        website: formState.website.trim() || null,
        phones: formState.phones
          .filter(p => p.value.trim())
          .map(p => ({
            type: 'PHONE' as const,
            channels: p.channels,
            value: p.value.trim(),
            isPrimary: p.isPrimary,
          })),
        emails: formState.emails
          .filter(e => e.value.trim())
          .map(e => ({
            type: 'EMAIL' as const,
            channels: null,
            value: e.value.trim(),
            isPrimary: e.isPrimary,
          })),
      };
      
      // Call API
      const result = await window.electronApi.supplier.create(payload);
      
      if (result.success) {
        setSubmitResult({
          success: true,
          message: 'Fournisseur créé avec succès!',
        });
        
        // Refresh supplier list
        if (refreshSuppliers) {
          await refreshSuppliers();
        }
        
        // Close modal after short delay
        setTimeout(() => {
          closeModal();
        }, 1500);
      } else {
        // Handle validation errors from server
        const errorMessages = result.errors
          ?.map((e: SupplierValidationError) => e.message)
          .join(', ') || 'Erreur de création';
        
        setSubmitResult({
          success: false,
          message: errorMessages,
        });
      }
    } catch (error) {
      setSubmitResult({
        success: false,
        message: error instanceof Error ? error.message : 'Erreur inattendue',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [formState, validateForm, closeModal, refreshSuppliers]);
  
  // ===========================================
  // RENDER
  // ===========================================
  
  if (!isOpen) return null;
  
  return (
    <div 
      className="modal-overlay" 
      onClick={closeModal}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div 
        className="modal-content max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header sticky top-0 bg-white z-10">
          <h2 id="modal-title" className="text-lg font-semibold text-gray-900">
            Ajouter un fournisseur
          </h2>
          <button 
            onClick={closeModal} 
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Fermer"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="modal-body space-y-6">
          {/* Result message */}
          {submitResult && (
            <div className={`p-4 rounded-md ${
              submitResult.success 
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              <p className="text-sm font-medium">{submitResult.message}</p>
            </div>
          )}
          
          {/* === SECTION 1: Basic Info === */}
          <section>
            <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
              <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded mr-2">1</span>
              Informations générales
            </h3>
            
            {/* Name */}
            <div className="mb-4">
              <label htmlFor="supplier-name" className="block text-sm font-medium text-gray-700 mb-1">
                Nom <span className="text-red-500">*</span>
              </label>
              <input
                id="supplier-name"
                type="text"
                value={formState.name}
                onChange={(e) => handleNameChange(e.target.value)}
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 ${
                  formErrors.name ? 'border-red-300 bg-red-50' : 'border-gray-300'
                }`}
                placeholder="Nom du fournisseur"
                disabled={isSubmitting}
              />
              {formErrors.name && (
                <p className="mt-1 text-sm text-red-600">{formErrors.name}</p>
              )}
            </div>
            
            {/* Address */}
            <div className="mb-4">
              <label htmlFor="supplier-address" className="block text-sm font-medium text-gray-700 mb-1">
                Adresse <span className="text-red-500">*</span>
              </label>
              <textarea
                id="supplier-address"
                value={formState.address}
                onChange={(e) => handleAddressChange(e.target.value)}
                rows={2}
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 ${
                  formErrors.address ? 'border-red-300 bg-red-50' : 'border-gray-300'
                }`}
                placeholder="Adresse complète"
                disabled={isSubmitting}
              />
              {formErrors.address && (
                <p className="mt-1 text-sm text-red-600">{formErrors.address}</p>
              )}
            </div>
            
            {/* Website */}
            <div>
              <label htmlFor="supplier-website" className="block text-sm font-medium text-gray-700 mb-1">
                Site web
              </label>
              <input
                id="supplier-website"
                type="url"
                value={formState.website}
                onChange={(e) => handleWebsiteChange(e.target.value)}
                className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 ${
                  formErrors.website ? 'border-red-300 bg-red-50' : 'border-gray-300'
                }`}
                placeholder="https://example.com"
                disabled={isSubmitting}
              />
              {formErrors.website && (
                <p className="mt-1 text-sm text-red-600">{formErrors.website}</p>
              )}
            </div>
          </section>
          
          {/* === SECTION 2: Phone Numbers === */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-700 flex items-center">
                <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded mr-2">2</span>
                Téléphones <span className="text-red-500 ml-1">*</span>
              </h3>
              <button
                type="button"
                onClick={addPhone}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center"
                disabled={isSubmitting}
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Ajouter un téléphone
              </button>
            </div>
            
            {formErrors.phones && (
              <p className="mb-2 text-sm text-red-600">{formErrors.phones}</p>
            )}
            
            <div className="space-y-3">
              {formState.phones.map((phone) => (
                <div 
                  key={phone.id}
                  className="flex items-start gap-2 p-3 bg-gray-50 rounded-md"
                >
                  {/* Phone number input */}
                  <div className="flex-1">
                    <input
                      type="tel"
                      value={phone.value}
                      onChange={(e) => updatePhone(phone.id, { value: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm ${
                        phone.error ? 'border-red-300 bg-red-50' : 'border-gray-300'
                      }`}
                      placeholder="+213 6XX XXX XXX"
                      disabled={isSubmitting}
                    />
                    {phone.error && (
                      <p className="mt-1 text-xs text-red-600">{phone.error}</p>
                    )}
                  </div>
                  
                  {/* Channel multi-select checkboxes */}
                  <div className="flex flex-wrap gap-2">
                    {PHONE_CHANNELS.map(ch => (
                      <label 
                        key={ch.value}
                        className={`flex items-center px-2 py-1 rounded-md text-xs cursor-pointer transition-colors ${
                          phone.channels.includes(ch.value)
                            ? 'bg-blue-100 text-blue-800 border border-blue-300'
                            : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={phone.channels.includes(ch.value)}
                          onChange={() => togglePhoneChannel(phone.id, ch.value)}
                          className="sr-only"
                          disabled={isSubmitting}
                        />
                        {ch.label}
                      </label>
                    ))}
                  </div>
                  
                  {/* Primary checkbox */}
                  <label className="flex items-center text-sm text-gray-600 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={phone.isPrimary}
                      onChange={(e) => updatePhone(phone.id, { isPrimary: e.target.checked })}
                      className="mr-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      disabled={isSubmitting || formState.phones.length === 1}
                    />
                    Principal
                  </label>
                  
                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={() => removePhone(phone.id)}
                    className={`p-2 rounded-md ${
                      formState.phones.length > 1
                        ? 'text-red-500 hover:bg-red-50 hover:text-red-700'
                        : 'text-gray-300 cursor-not-allowed'
                    }`}
                    disabled={formState.phones.length <= 1 || isSubmitting}
                    title={formState.phones.length <= 1 ? 'Au moins un téléphone requis' : 'Supprimer'}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </section>
          
          {/* === SECTION 3: Emails === */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-700 flex items-center">
                <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded mr-2">3</span>
                Emails
              </h3>
              <button
                type="button"
                onClick={addEmail}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center"
                disabled={isSubmitting}
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Ajouter un email
              </button>
            </div>
            
            {formErrors.emails && (
              <p className="mb-2 text-sm text-red-600">{formErrors.emails}</p>
            )}
            
            {formState.emails.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                Aucun email ajouté (optionnel)
              </p>
            ) : (
              <div className="space-y-3">
                {formState.emails.map((email) => (
                  <div 
                    key={email.id}
                    className="flex items-start gap-2 p-3 bg-gray-50 rounded-md"
                  >
                    {/* Email input */}
                    <div className="flex-1">
                      <input
                        type="email"
                        value={email.value}
                        onChange={(e) => updateEmail(email.id, { value: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm ${
                          email.error ? 'border-red-300 bg-red-50' : 'border-gray-300'
                        }`}
                        placeholder="email@example.com"
                        disabled={isSubmitting}
                      />
                      {email.error && (
                        <p className="mt-1 text-xs text-red-600">{email.error}</p>
                      )}
                    </div>
                    
                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={() => removeEmail(email.id)}
                      className="p-2 text-red-500 hover:bg-red-50 hover:text-red-700 rounded-md"
                      disabled={isSubmitting}
                      title="Supprimer"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="modal-footer sticky bottom-0 bg-white border-t border-gray-200 pt-4">
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              disabled={isSubmitting}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={`px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                isSubmitting
                  ? 'bg-blue-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isSubmitting ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Création...
                </span>
              ) : (
                'Créer le fournisseur'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddSupplierModal;
export { AddSupplierModal };
