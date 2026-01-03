/**
 * Edit Supplier Modal
 * ===================
 * Modal for editing an existing supplier.
 * Reuses validation logic from AddSupplierModal.
 */

import React, { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import type {
  PhoneChannel,
  Supplier,
  CreateSupplier,
  SupplierValidationError,
} from '../../shared/types';

// ===========================================
// LOCAL TYPES
// ===========================================

interface PhoneEntry {
  id: string;
  value: string;
  channels: PhoneChannel[];
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
  phones?: string;
  emails?: string;
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
  return `edit_entry_${++entryIdCounter}_${Date.now()}`;
}

function createEmptyPhone(isPrimary: boolean = false): PhoneEntry {
  return {
    id: generateEntryId(),
    value: '',
    channels: ['REGULAR'],
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

function isValidPhoneFormat(value: string): boolean {
  if (!value.trim()) return false;
  const cleaned = value.replace(/[\s\-().]/g, '');
  return /^\+?[0-9]{6,15}$/.test(cleaned);
}

function isValidEmailFormat(value: string): boolean {
  if (!value.trim()) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidUrlFormat(value: string): boolean {
  if (!value.trim()) return true;
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

interface EditSupplierModalProps {
  supplier: Supplier;
  onClose: () => void;
  onSaved: () => void;
}

// ===========================================
// COMPONENT
// ===========================================

export const EditSupplierModal: React.FC<EditSupplierModalProps> = ({
  supplier,
  onClose,
  onSaved,
}) => {
  // Initialize form state from supplier
  const [formState, setFormState] = useState<FormState>(() => {
    const phones = supplier.contacts
      .filter(c => c.type === 'PHONE')
      .map(c => ({
        id: c.id,
        value: c.value,
        channels: c.channels || ['REGULAR'],
        isPrimary: c.isPrimary,
      }));
    
    const emails = supplier.contacts
      .filter(c => c.type === 'EMAIL')
      .map(c => ({
        id: c.id,
        value: c.value,
        isPrimary: c.isPrimary,
      }));
    
    return {
      name: supplier.name,
      address: supplier.address,
      website: supplier.website || '',
      phones: phones.length > 0 ? phones : [createEmptyPhone(true)],
      emails,
    };
  });
  
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  
  // ===========================================
  // FIELD HANDLERS
  // ===========================================
  
  const handleNameChange = useCallback((value: string) => {
    setFormState(prev => ({ ...prev, name: value }));
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
      if (prev.phones.length <= 1) return prev;
      
      const newPhones = prev.phones.filter(p => p.id !== id);
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
          if (updates.isPrimary) {
            return { ...p, isPrimary: false };
          }
          return p;
        }
        const updated = { ...p, ...updates };
        if (updates.value !== undefined) {
          updated.error = updated.value.trim() && !isValidPhoneFormat(updated.value)
            ? 'Format invalide'
            : undefined;
        }
        return updated;
      }),
    }));
  }, []);

  const togglePhoneChannel = useCallback((id: string, channel: PhoneChannel) => {
    setFormState(prev => ({
      ...prev,
      phones: prev.phones.map(p => {
        if (p.id !== id) return p;
        const hasChannel = p.channels.includes(channel);
        let newChannels: PhoneChannel[];
        if (hasChannel) {
          newChannels = p.channels.filter(c => c !== channel);
          if (newChannels.length === 0) {
            newChannels = [channel];
          }
        } else {
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
    
    if (!formState.name.trim()) {
      errors.name = 'Le nom est requis';
      isValid = false;
    } else if (formState.name.trim().length < 2) {
      errors.name = 'Le nom doit contenir au moins 2 caractères';
      isValid = false;
    }
    
    if (!formState.address.trim()) {
      errors.address = 'L\'adresse est requise';
      isValid = false;
    } else if (formState.address.trim().length < 5) {
      errors.address = 'L\'adresse doit contenir au moins 5 caractères';
      isValid = false;
    }
    
    if (formState.website.trim() && !isValidUrlFormat(formState.website)) {
      errors.website = 'URL invalide';
      isValid = false;
    }
    
    const validPhones = formState.phones.filter(p => p.value.trim());
    if (validPhones.length === 0) {
      errors.phones = 'Au moins un numéro de téléphone est requis';
      isValid = false;
    }
    
    const phoneWithErrors = formState.phones.some(
      p => p.value.trim() && !isValidPhoneFormat(p.value)
    );
    if (phoneWithErrors) {
      errors.phones = 'Un ou plusieurs numéros de téléphone sont invalides';
      isValid = false;
    }
    
    const phonesWithoutChannel = formState.phones.some(
      p => p.value.trim() && p.channels.length === 0
    );
    if (phonesWithoutChannel) {
      errors.phones = 'Chaque téléphone doit avoir au moins un canal';
      isValid = false;
    }
    
    const phoneValues = formState.phones
      .map(p => p.value.trim().replace(/[\s\-().]/g, '').toLowerCase())
      .filter(Boolean);
    const uniquePhones = new Set(phoneValues);
    if (uniquePhones.size !== phoneValues.length) {
      errors.phones = 'Numéros de téléphone en double';
      isValid = false;
    }
    
    const emailWithErrors = formState.emails.some(
      e => e.value.trim() && !isValidEmailFormat(e.value)
    );
    if (emailWithErrors) {
      errors.emails = 'Un ou plusieurs emails sont invalides';
      isValid = false;
    }
    
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
    if (!validateForm()) {
      return;
    }
    
    setIsSubmitting(true);
    setSubmitResult(null);
    
    try {
      // For edit, we delete and recreate the supplier
      // This is a simplified approach - a proper update API would be better
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
      
      // Delete old supplier first
      await window.electronApi.supplier.delete(supplier.id);
      
      // Create new one with updated data
      const result = await window.electronApi.supplier.create(payload);
      
      if (result.success) {
        toast.success('Fournisseur mis à jour avec succès');
        onSaved();
      } else {
        const errorMessages = result.errors
          ?.map((e: SupplierValidationError) => e.message)
          .join(', ') || 'Erreur de mise à jour';
        
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
  }, [formState, validateForm, supplier.id, onSaved]);
  
  // ===========================================
  // RENDER
  // ===========================================
  
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-semibold text-gray-900">
            Modifier le fournisseur
          </h2>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-6">
          {/* Result message */}
          {submitResult && !submitResult.success && (
            <div className="p-4 rounded-md bg-red-50 border border-red-200 text-red-800">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nom <span className="text-red-500">*</span>
              </label>
              <input
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Adresse <span className="text-red-500">*</span>
              </label>
              <textarea
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Site web
              </label>
              <input
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
                Ajouter
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
                    
                    {/* Channel toggles */}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {PHONE_CHANNELS.map((channel) => (
                        <button
                          key={channel.value}
                          type="button"
                          onClick={() => togglePhoneChannel(phone.id, channel.value)}
                          className={`px-2 py-1 text-xs rounded-full transition-colors ${
                            phone.channels.includes(channel.value)
                              ? 'bg-blue-100 text-blue-700 border border-blue-300'
                              : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
                          }`}
                          disabled={isSubmitting}
                        >
                          {channel.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {/* Primary toggle */}
                  <button
                    type="button"
                    onClick={() => updatePhone(phone.id, { isPrimary: true })}
                    className={`p-2 rounded-md transition-colors ${
                      phone.isPrimary
                        ? 'text-yellow-600 bg-yellow-50'
                        : 'text-gray-400 hover:text-yellow-600 hover:bg-yellow-50'
                    }`}
                    title={phone.isPrimary ? 'Principal' : 'Définir comme principal'}
                    disabled={isSubmitting}
                  >
                    <svg className="w-5 h-5" fill={phone.isPrimary ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                  </button>
                  
                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={() => removePhone(phone.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                    disabled={isSubmitting || formState.phones.length === 1}
                    title={formState.phones.length === 1 ? 'Au moins un téléphone requis' : 'Supprimer'}
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
                Ajouter
              </button>
            </div>
            
            {formErrors.emails && (
              <p className="mb-2 text-sm text-red-600">{formErrors.emails}</p>
            )}
            
            {formState.emails.length === 0 ? (
              <p className="text-sm text-gray-500 italic">Aucun email ajouté</p>
            ) : (
              <div className="space-y-3">
                {formState.emails.map((email) => (
                  <div 
                    key={email.id}
                    className="flex items-center gap-2 p-3 bg-gray-50 rounded-md"
                  >
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
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
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
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary"
            disabled={isSubmitting}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn btn-primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Enregistrement...
              </>
            ) : (
              'Enregistrer'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
