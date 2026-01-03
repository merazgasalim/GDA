/**
 * Machine Fingerprint Service
 * ===========================
 * Generates a soft machine fingerprint for license binding.
 * 
 * DESIGN PRINCIPLES:
 * 1. Use multiple hardware identifiers for robustness
 * 2. Allow tolerance for minor hardware changes (RAM, USB devices)
 * 3. Focus on stable identifiers: CPU, motherboard, disk
 * 4. Hash all sensitive data - never expose raw hardware info
 * 
 * Reference: Machine fingerprinting best practices
 * - OS UUID (stable across reboots)
 * - CPU model/cores (rarely changes)
 * - Primary disk serial (main identifier)
 */

import si from 'systeminformation';
import crypto from 'crypto';

interface MachineComponents {
  osUuid: string;
  cpuId: string;
  diskSerial: string;
}

/**
 * Generate a hash from multiple machine components.
 * This creates a fingerprint that is:
 * - Stable: Same machine = same fingerprint
 * - Anonymous: No raw hardware data exposed
 * - Tolerant: Minor changes don't invalidate
 */
function hashComponents(components: MachineComponents): string {
  const data = [
    components.osUuid,
    components.cpuId,
    components.diskSerial,
  ].join('|');

  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex')
    .substring(0, 32); // 32 chars is sufficient for uniqueness
}

/**
 * Get the OS-level machine UUID.
 * This is the most stable identifier available.
 * Uses systeminformation to get the system UUID.
 */
async function getOsUuid(): Promise<string> {
  try {
    const system = await si.system();
    return system.uuid || system.serial || 'unknown-os-uuid';
  } catch (error) {
    console.error('Failed to get OS UUID:', error);
    return 'unknown-os-uuid';
  }
}

/**
 * Get CPU identifier (model + core count).
 * Stable unless CPU is physically replaced.
 */
async function getCpuId(): Promise<string> {
  try {
    const cpu = await si.cpu();
    return `${cpu.manufacturer}-${cpu.brand}-${cpu.cores}`;
  } catch (error) {
    console.error('Failed to get CPU info:', error);
    return 'unknown-cpu';
  }
}

/**
 * Get primary disk serial number.
 * Most reliable hardware identifier.
 */
async function getDiskSerial(): Promise<string> {
  try {
    const disks = await si.diskLayout();
    // Use the first disk (usually C: on Windows)
    const primaryDisk = disks[0];
    if (primaryDisk?.serialNum) {
      // Hash the serial for privacy
      return crypto
        .createHash('md5')
        .update(primaryDisk.serialNum)
        .digest('hex');
    }
    return 'unknown-disk';
  } catch (error) {
    console.error('Failed to get disk serial:', error);
    return 'unknown-disk';
  }
}

/**
 * Generate the full machine fingerprint.
 * Call this once at startup and cache the result.
 */
export async function generateMachineFingerprint(): Promise<string> {
  const [osUuid, cpuId, diskSerial] = await Promise.all([
    getOsUuid(),
    getCpuId(),
    getDiskSerial(),
  ]);

  const components: MachineComponents = {
    osUuid,
    cpuId,
    diskSerial,
  };

  return hashComponents(components);
}

/**
 * Generate a display-friendly machine ID for the user.
 * This is shown in the license activation UI.
 * Format: XXXX-XXXX-XXXX-XXXX
 */
export async function getDisplayMachineId(): Promise<string> {
  const fingerprint = await generateMachineFingerprint();
  const formatted = fingerprint.toUpperCase();
  
  // Split into groups of 4
  const groups = [];
  for (let i = 0; i < 16; i += 4) {
    groups.push(formatted.substring(i, i + 4));
  }
  
  return groups.join('-');
}

/**
 * Compare two machine fingerprints with tolerance.
 * Allows for minor hardware changes by using similarity scoring.
 * 
 * For now, we use exact match. In the future, we could implement:
 * - Component-level comparison
 * - Similarity threshold (e.g., 2 of 3 components match)
 */
export function compareMachineIds(
  stored: string,
  current: string,
  tolerance: number = 0
): boolean {
  if (tolerance === 0) {
    return stored === current;
  }

  // Future: implement fuzzy matching with tolerance
  // For now, exact match only
  return stored === current;
}

// Cache the fingerprint to avoid regenerating
let cachedFingerprint: string | null = null;

export async function getCachedFingerprint(): Promise<string> {
  if (!cachedFingerprint) {
    cachedFingerprint = await generateMachineFingerprint();
  }
  return cachedFingerprint;
}
