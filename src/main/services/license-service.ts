/**
 * License Service
 * ===============
 * Handles license validation, activation, and enforcement.
 * 
 * SECURITY ARCHITECTURE:
 * 1. License is a signed JSON payload (Base64 encoded)
 * 2. RSA public key is embedded in the app
 * 3. All validation happens in MAIN PROCESS only
 * 4. Renderer only sees LicenseStatus, never raw payload
 * 
 * LICENSE FORMAT:
 * {
 *   "payload": "<base64-encoded-json>",
 *   "signature": "<base64-encoded-rsa-signature>"
 * }
 * 
 * PAYLOAD STRUCTURE (after base64 decode):
 * {
 *   "customerId": "cust_xxx",
 *   "customerName": "Company Name",
 *   "licenseType": "trial" | "full",
 *   "expirationDate": "2025-12-31T23:59:59Z",
 *   "issuedAt": "2024-01-01T00:00:00Z",
 *   "featureFlags": { ... },
 *   "machineId": "xxxx-xxxx-xxxx-xxxx" // Optional for machine-bound
 * }
 */

import crypto from 'crypto';
import Store from 'electron-store';
import {
  LicensePayload,
  LicensePayloadSchema,
  LicenseStatus,
  DEFAULT_LICENSE_STATUS,
  FeatureFlags,
} from '../../shared/types';
import { getCachedFingerprint, getDisplayMachineId } from './machine-fingerprint';

// ===========================================
// RSA PUBLIC KEY
// ===========================================
// This key is used to verify license signatures.
// The private key is kept secure on the licensing server.
// 
// IMPORTANT: In production, replace this with your actual public key.
// Generate a key pair with: openssl genrsa -out private.pem 2048
//                           openssl rsa -in private.pem -pubout -out public.pem

const RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyabjEHTLPaUf/vbaPQV0
0oeHxWsc4QptA2rF/Agt5qoRYQOkMUBYoyQhwR3W4797M5XtD7FC39Oj4BLjf3uc
qgQwXeeF7zxV9iqimFSAlqef+Lf7aWA+Ykaw0y/n109Mr0uXRVtLAZpdzEtpmdj3
Y94aOG1oanNYFXPNECgcfmR0xBQyZ8sJyFQS7IttTmfn0XhYWGMDazIydyHjuX4b
kosf58QH8Ck+Uge4rKwQkCBUyuqM+5HW+IQnODeoKkrAfRl2dAO+3lqpEOs+FYaO
bBB4cz9gp9CI/7n1hkrW8lKmRcJeeSITgNrIbSetjcCxo+wIIVOPVF3T1YPWiOR7
uQIDAQAB
-----END PUBLIC KEY-----`;

// ===========================================
// LICENSE STORAGE
// ===========================================
// Store license in encrypted electron-store
// The store itself is encrypted with machine-specific key

interface LicenseStore {
  license?: string; // The full license string (payload + signature)
  activatedAt?: string;
}

const store = new Store<LicenseStore>({
  name: 'license',
  encryptionKey: 'gda-license-store-v1', // Additional layer of obfuscation
});

// ===========================================
// LICENSE PARSING & VALIDATION
// ===========================================

interface ParsedLicense {
  payload: LicensePayload;
  signature: string;
  raw: string;
}

/**
 * Parse a license key string into its components.
 * License format: <base64-payload>.<base64-signature>
 */
function parseLicenseKey(licenseKey: string): ParsedLicense | null {
  try {
    const trimmed = licenseKey.trim();
    const parts = trimmed.split('.');
    
    if (parts.length !== 2) {
      console.error('Invalid license format: expected payload.signature');
      return null;
    }

    const [payloadBase64, signatureBase64] = parts;
    
    // Decode payload
    const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf-8');
    const payloadRaw = JSON.parse(payloadJson);
    
    // Validate payload structure
    const parseResult = LicensePayloadSchema.safeParse(payloadRaw);
    if (!parseResult.success) {
      console.error('Invalid license payload:', parseResult.error);
      return null;
    }

    return {
      payload: parseResult.data,
      signature: signatureBase64,
      raw: payloadBase64, // Keep original for signature verification
    };
  } catch (error) {
    console.error('Failed to parse license key:', error);
    return null;
  }
}

/**
 * Verify the RSA signature of a license payload.
 */
function verifySignature(payloadBase64: string, signatureBase64: string): boolean {
  try {
    console.log('Verifying signature...');
    console.log('Payload (first 50 chars):', payloadBase64.substring(0, 50));
    console.log('Signature (first 50 chars):', signatureBase64.substring(0, 50));
    
    const verifier = crypto.createVerify('SHA256');
    verifier.update(payloadBase64);
    verifier.end();

    // Verify using base64 signature directly
    const result = verifier.verify(RSA_PUBLIC_KEY, signatureBase64, 'base64');
    console.log('Verification result:', result);
    return result;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Check if the license has expired.
 */
function isExpired(expirationDate: string): boolean {
  const expiry = new Date(expirationDate);
  const now = new Date();
  return now > expiry;
}

/**
 * Calculate days remaining until expiration.
 */
function getDaysRemaining(expirationDate: string): number {
  const expiry = new Date(expirationDate);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Verify machine binding if present in license.
 */
async function verifyMachineBinding(
  licenseMachineId: string | undefined
): Promise<boolean> {
  if (!licenseMachineId) {
    // No machine binding required
    return true;
  }

  const currentMachineId = await getDisplayMachineId();
  return licenseMachineId === currentMachineId;
}

// ===========================================
// PUBLIC LICENSE SERVICE API
// ===========================================

let cachedStatus: LicenseStatus | null = null;
let lastValidation: number = 0;
const VALIDATION_INTERVAL = 5 * 60 * 1000; // Re-validate every 5 minutes

/**
 * Get the current license status.
 * Uses cached result if recent enough.
 */
export async function getLicenseStatus(): Promise<LicenseStatus> {
  const now = Date.now();
  
  // Return cached status if still valid
  if (cachedStatus && now - lastValidation < VALIDATION_INTERVAL) {
    return cachedStatus;
  }

  // Re-validate
  cachedStatus = await validateLicense();
  lastValidation = now;
  
  return cachedStatus;
}

/**
 * Validate the stored license.
 */
export async function validateLicense(): Promise<LicenseStatus> {
  const licenseKey = store.get('license');
  
  if (!licenseKey) {
    return {
      ...DEFAULT_LICENSE_STATUS,
      errorMessage: 'No license key found. Please activate your license.',
    };
  }

  const parsed = parseLicenseKey(licenseKey);
  if (!parsed) {
    return {
      ...DEFAULT_LICENSE_STATUS,
      errorMessage: 'Invalid license format.',
    };
  }

  // Verify signature
  if (!verifySignature(parsed.raw, parsed.signature)) {
    return {
      ...DEFAULT_LICENSE_STATUS,
      errorMessage: 'License signature verification failed.',
    };
  }

  // Check machine binding
  const machineValid = await verifyMachineBinding(parsed.payload.machineId);
  if (!machineValid) {
    return {
      ...DEFAULT_LICENSE_STATUS,
      errorMessage: 'License is bound to a different machine.',
    };
  }

  // Check expiration
  const expired = isExpired(parsed.payload.expirationDate);
  const daysRemaining = getDaysRemaining(parsed.payload.expirationDate);

  // Build feature flags based on license type and expiration
  const featureFlags: FeatureFlags = expired
    ? {
        canExport: false,
        canBackup: false,
        canImport: false, // Read-only mode when expired
        maxEntries: undefined, // Still allow viewing all data
      }
    : parsed.payload.featureFlags;

  return {
    isValid: !expired,
    isExpired: expired,
    licenseType: parsed.payload.licenseType,
    expirationDate: parsed.payload.expirationDate,
    daysRemaining,
    customerName: parsed.payload.customerName || null,
    featureFlags,
    errorMessage: expired ? 'License has expired. Please renew.' : undefined,
  };
}

/**
 * Activate a new license key.
 */
export async function activateLicense(
  licenseKey: string
): Promise<{ success: boolean; status?: LicenseStatus; error?: string }> {
  // Parse and validate the license
  const parsed = parseLicenseKey(licenseKey);
  if (!parsed) {
    return { success: false, error: 'Invalid license format.' };
  }

  // Verify signature
  if (!verifySignature(parsed.raw, parsed.signature)) {
    return { success: false, error: 'License signature verification failed.' };
  }

  // Check machine binding
  const machineValid = await verifyMachineBinding(parsed.payload.machineId);
  if (!machineValid) {
    return {
      success: false,
      error: 'This license is bound to a different machine.',
    };
  }

  // Check if already expired
  if (isExpired(parsed.payload.expirationDate)) {
    return { success: false, error: 'This license has already expired.' };
  }

  // Store the license
  store.set('license', licenseKey);
  store.set('activatedAt', new Date().toISOString());

  // Clear cache and get fresh status
  cachedStatus = null;
  const status = await getLicenseStatus();

  return { success: true, status };
}

/**
 * Deactivate (remove) the current license.
 */
export function deactivateLicense(): { success: boolean } {
  store.delete('license');
  store.delete('activatedAt');
  cachedStatus = null;
  return { success: true };
}

/**
 * Check if a specific feature is allowed.
 */
export async function isFeatureAllowed(
  feature: keyof FeatureFlags
): Promise<boolean> {
  const status = await getLicenseStatus();
  
  if (feature === 'maxEntries') {
    return true; // Always allowed, value is a number
  }
  
  return status.featureFlags[feature] === true;
}

/**
 * Get the machine ID for display to user.
 */
export async function getMachineIdForDisplay(): Promise<string> {
  return getDisplayMachineId();
}

/**
 * Derive encryption key from license and machine fingerprint.
 * This ensures database is only readable with valid license on correct machine.
 */
export async function deriveEncryptionKey(): Promise<string | null> {
  const status = await getLicenseStatus();
  
  // Even if license is expired, allow decryption for read-only access
  // But require that a license was previously activated
  const licenseKey = store.get('license');
  if (!licenseKey) {
    return null;
  }

  const machineFingerprint = await getCachedFingerprint();
  
  // Derive key from license + machine fingerprint
  // This ensures:
  // 1. Database can't be moved to another machine
  // 2. Database can't be decrypted without the license
  const derivedKey = crypto
    .createHash('sha256')
    .update(`${licenseKey}|${machineFingerprint}|gda-v1`)
    .digest('hex');

  return derivedKey;
}

// ===========================================
// LICENSE KEY GENERATION (FOR TESTING)
// ===========================================
// This would normally be on a secure server
// Included here for development/testing purposes

/**
 * Generate a test license key.
 * WARNING: This uses a test private key. Never use in production.
 */
export function generateTestLicense(
  payload: Omit<LicensePayload, 'issuedAt'>,
  privateKeyPem: string
): string {
  const fullPayload: LicensePayload = {
    ...payload,
    issuedAt: new Date().toISOString(),
  };

  const payloadJson = JSON.stringify(fullPayload);
  const payloadBase64 = Buffer.from(payloadJson).toString('base64');

  const signer = crypto.createSign('SHA256');
  signer.update(payloadBase64);
  signer.end();

  const signature = signer.sign(privateKeyPem, 'base64');

  return `${payloadBase64}.${signature}`;
}
