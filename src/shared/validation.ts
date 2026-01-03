/**
 * Validation Utilities
 * ====================
 * Reusable validation functions for form inputs.
 * These are designed to be used in both main and renderer processes.
 * 
 * DESIGN PRINCIPLES:
 * 1. Pure functions - no side effects
 * 2. Return structured results for UI feedback
 * 3. Support both strict and lenient modes
 * 4. Internationalization-ready (error messages can be keyed)
 */

// ===========================================
// VALIDATION RESULT TYPE
// ===========================================

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  normalizedValue?: string; // Cleaned/normalized version of the input
}

// ===========================================
// PHONE VALIDATION
// ===========================================

/**
 * Phone number validation patterns.
 * 
 * Supported formats:
 * - International: +213 612345678, +1 (555) 123-4567
 * - Local: 0612345678, 06 12 34 56 78
 * - With separators: 06.12.34.56.78, 06-12-34-56-78
 * 
 * We're lenient on format but ensure the number contains
 * only valid phone characters and has a reasonable length.
 */

// International format: starts with + followed by digits
const INTERNATIONAL_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

// Local format: digits only, 6-15 digits
const LOCAL_PHONE_REGEX = /^[0-9]{6,15}$/;

// Allowed characters in phone input (before normalization)
const PHONE_INPUT_REGEX = /^[\d\s\-().+]+$/;

/**
 * Normalize a phone number by removing all non-digit characters
 * except the leading + for international numbers.
 */
export function normalizePhoneNumber(phone: string): string {
  const trimmed = phone.trim();
  
  // Preserve leading + for international numbers
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/\D/g, '');
  }
  
  return trimmed.replace(/\D/g, '');
}

/**
 * Validate a phone number.
 * 
 * @param phone - The phone number to validate
 * @param strict - If true, only accept clean international or local format
 * @returns Validation result with normalized value
 * 
 * @example
 * validatePhoneNumber('+213 612 345 678') // { isValid: true, normalizedValue: '+213612345678' }
 * validatePhoneNumber('06 12 34 56 78')   // { isValid: true, normalizedValue: '0612345678' }
 * validatePhoneNumber('abc123')            // { isValid: false, error: 'Invalid phone format' }
 */
export function validatePhoneNumber(phone: string, strict: boolean = false): ValidationResult {
  const trimmed = phone.trim();
  
  // Empty check
  if (!trimmed) {
    return { isValid: false, error: 'Phone number is required' };
  }
  
  // Check for invalid characters
  if (!PHONE_INPUT_REGEX.test(trimmed)) {
    return { isValid: false, error: 'Phone number contains invalid characters' };
  }
  
  // Normalize
  const normalized = normalizePhoneNumber(trimmed);
  
  // Length check (minimum 6 digits for short codes, max 15 for international)
  const digitCount = normalized.replace(/\D/g, '').length;
  if (digitCount < 6) {
    return { isValid: false, error: 'Phone number is too short (minimum 6 digits)' };
  }
  if (digitCount > 15) {
    return { isValid: false, error: 'Phone number is too long (maximum 15 digits)' };
  }
  
  // Strict mode: must match exact format
  if (strict) {
    if (!INTERNATIONAL_PHONE_REGEX.test(normalized) && !LOCAL_PHONE_REGEX.test(normalized)) {
      return { isValid: false, error: 'Phone number must be in international (+XX...) or local format' };
    }
  }
  
  return { isValid: true, normalizedValue: normalized };
}

// ===========================================
// EMAIL VALIDATION
// ===========================================

/**
 * RFC 5322 compliant email regex (simplified but comprehensive).
 * 
 * This pattern handles:
 * - Standard emails: user@example.com
 * - Subdomains: user@mail.example.com
 * - Plus addressing: user+tag@example.com
 * - Internationalized domains: user@例え.jp (after punycode)
 * 
 * Note: For full RFC 5322 compliance, use a dedicated library.
 * This regex covers 99.9% of real-world email addresses.
 */
const EMAIL_REGEX = /^(?:[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}|(?:\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-zA-Z0-9-]*[a-zA-Z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\]))$/;

// Simpler pattern for quick validation
const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalize an email address.
 * - Trim whitespace
 * - Convert to lowercase (emails are case-insensitive per RFC)
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Validate an email address.
 * 
 * @param email - The email address to validate
 * @param strict - If true, use full RFC 5322 pattern; otherwise use simple pattern
 * @returns Validation result with normalized value
 * 
 * @example
 * validateEmail('user@example.com')     // { isValid: true, normalizedValue: 'user@example.com' }
 * validateEmail('User@EXAMPLE.COM')     // { isValid: true, normalizedValue: 'user@example.com' }
 * validateEmail('invalid-email')        // { isValid: false, error: 'Invalid email format' }
 */
export function validateEmail(email: string, strict: boolean = false): ValidationResult {
  const trimmed = email.trim();
  
  // Empty is valid (emails are optional)
  if (!trimmed) {
    return { isValid: true, normalizedValue: '' };
  }
  
  // Length check (RFC 5321 limits: local part 64, domain 255, total 320)
  if (trimmed.length > 320) {
    return { isValid: false, error: 'Email address is too long' };
  }
  
  // Normalize
  const normalized = normalizeEmail(trimmed);
  
  // Pattern check
  const pattern = strict ? EMAIL_REGEX : SIMPLE_EMAIL_REGEX;
  if (!pattern.test(normalized)) {
    return { isValid: false, error: 'Invalid email format' };
  }
  
  return { isValid: true, normalizedValue: normalized };
}

// ===========================================
// URL VALIDATION
// ===========================================

/**
 * URL validation pattern.
 * 
 * Supports:
 * - HTTP and HTTPS protocols
 * - With or without www
 * - Ports: example.com:8080
 * - Paths: example.com/path/to/page
 * - Query strings: example.com?query=value
 * - Fragments: example.com#section
 */
const URL_REGEX = /^https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,63}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)$/;

// Simpler pattern that's more lenient
const SIMPLE_URL_REGEX = /^https?:\/\/.+\..+/;

/**
 * Normalize a URL.
 * - Trim whitespace
 * - Add https:// if no protocol specified
 * - Remove trailing slash for consistency
 */
export function normalizeUrl(url: string): string {
  let trimmed = url.trim();
  
  // Add https:// if no protocol
  if (trimmed && !trimmed.match(/^https?:\/\//i)) {
    trimmed = 'https://' + trimmed;
  }
  
  // Remove trailing slash
  if (trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1);
  }
  
  return trimmed;
}

/**
 * Validate a URL.
 * 
 * @param url - The URL to validate
 * @param strict - If true, use strict pattern; otherwise be lenient
 * @returns Validation result with normalized value
 * 
 * @example
 * validateUrl('https://example.com')  // { isValid: true }
 * validateUrl('example.com')          // { isValid: true, normalizedValue: 'https://example.com' }
 * validateUrl('not a url')            // { isValid: false, error: 'Invalid URL format' }
 */
export function validateUrl(url: string, strict: boolean = false): ValidationResult {
  const trimmed = url.trim();
  
  // Empty is valid (URLs are optional)
  if (!trimmed) {
    return { isValid: true, normalizedValue: '' };
  }
  
  // Normalize
  const normalized = normalizeUrl(trimmed);
  
  // Try native URL parsing first (most reliable)
  try {
    const urlObj = new URL(normalized);
    
    // Must be http or https
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { isValid: false, error: 'URL must use HTTP or HTTPS protocol' };
    }
    
    // Must have a valid hostname
    if (!urlObj.hostname || !urlObj.hostname.includes('.')) {
      return { isValid: false, error: 'URL must have a valid domain name' };
    }
    
    return { isValid: true, normalizedValue: normalized };
  } catch {
    // Fallback to regex
    const pattern = strict ? URL_REGEX : SIMPLE_URL_REGEX;
    if (!pattern.test(normalized)) {
      return { isValid: false, error: 'Invalid URL format' };
    }
    
    return { isValid: true, normalizedValue: normalized };
  }
}

// ===========================================
// TEXT VALIDATION
// ===========================================

/**
 * Validate a required text field.
 * 
 * @param text - The text to validate
 * @param fieldName - Name of the field for error messages
 * @param minLength - Minimum required length (default: 1)
 * @param maxLength - Maximum allowed length (default: 500)
 * @returns Validation result with normalized value
 */
export function validateRequiredText(
  text: string,
  fieldName: string,
  minLength: number = 1,
  maxLength: number = 500
): ValidationResult {
  const trimmed = text.trim();
  
  if (!trimmed) {
    return { isValid: false, error: `${fieldName} is required` };
  }
  
  if (trimmed.length < minLength) {
    return { isValid: false, error: `${fieldName} must be at least ${minLength} characters` };
  }
  
  if (trimmed.length > maxLength) {
    return { isValid: false, error: `${fieldName} must be at most ${maxLength} characters` };
  }
  
  return { isValid: true, normalizedValue: trimmed };
}

// ===========================================
// COMPOSITE VALIDATORS
// ===========================================

/**
 * Validate a supplier contact based on its type.
 * 
 * @param type - Contact type (PHONE or EMAIL)
 * @param value - Contact value
 * @param channel - Phone channel (only for PHONE type)
 * @returns Validation result
 */
export function validateSupplierContact(
  type: 'PHONE' | 'EMAIL',
  value: string,
  channel?: string | null
): ValidationResult {
  if (type === 'PHONE') {
    // Phone must have a value
    const phoneResult = validatePhoneNumber(value);
    if (!phoneResult.isValid) {
      return phoneResult;
    }
    
    // Phone must have a channel
    if (!channel) {
      return { isValid: false, error: 'Phone channel is required' };
    }
    
    const validChannels = ['REGULAR', 'WHATSAPP', 'VIBER', 'TELEGRAM'];
    if (!validChannels.includes(channel)) {
      return { isValid: false, error: 'Invalid phone channel' };
    }
    
    return phoneResult;
  }
  
  if (type === 'EMAIL') {
    // Email can be empty (optional)
    if (!value.trim()) {
      return { isValid: false, error: 'Email value is required if adding an email contact' };
    }
    
    return validateEmail(value);
  }
  
  return { isValid: false, error: 'Invalid contact type' };
}

/**
 * Check for duplicate values in an array of contacts.
 * 
 * @param contacts - Array of contact values
 * @returns Array of duplicate values found
 */
export function findDuplicateContacts(contacts: string[]): string[] {
  const normalized = contacts.map(c => c.trim().toLowerCase());
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  
  for (const value of normalized) {
    if (value && seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  
  return Array.from(duplicates);
}
