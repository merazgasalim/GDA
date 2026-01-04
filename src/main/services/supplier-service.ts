/**
 * Supplier Service
 * ================
 * Manages supplier entities - core domain objects for supply chain management.
 * 
 * DESIGN PRINCIPLES (Domain-Driven Design):
 * 
 * 1. SUPPLIER AS AGGREGATE ROOT
 *    - Supplier owns its contacts (SupplierContact entities)
 *    - All contact mutations go through the Supplier aggregate
 *    - Contacts cannot exist without a parent supplier
 * 
 * 2. VALIDATION RULES (HARD CONSTRAINTS)
 *    - name: required, min 2 chars, trimmed
 *    - address: required, min 5 chars
 *    - phones: at least one entry required, valid format
 *    - channel: required for phone contacts
 *    - emails: optional, valid format if present
 *    - website: optional, valid URL if present
 *    - No duplicate contact values within same supplier
 * 
 * 3. TRANSACTION SAFETY
 *    - All writes happen in a single Prisma transaction
 *    - Supplier + contacts created atomically
 *    - Rollback on any failure
 * 
 * 4. AUDIT TRAIL
 *    - Every supplier creation creates an OperationLog entry
 *    - Payload snapshot is stored for immutable history
 *    - linked via operationId for traceability
 * 
 * REFERENCES:
 * - Domain-Driven Design by Eric Evans
 * - Implementing DDD by Vaughn Vernon
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import {
  CreateSupplier,
  CreateSupplierResult,
  Supplier,
  SupplierContact,
  SupplierValidationError,
  SupplierListResult,
  SupplierQueryParams,
  PhoneChannel,
} from '../../shared/types';
import {
  validatePhoneNumber,
  validateEmail,
  validateUrl,
  validateRequiredText,
  findDuplicateContacts,
  normalizePhoneNumber,
  normalizeEmail,
  normalizeUrl,
} from '../../shared/validation';
import { createOperation, completeOperation, failOperation } from './operation-service';

// ===========================================
// PRISMA CLIENT ACCESSOR
// ===========================================

let prismaClient: PrismaClient | null = null;

/**
 * Set the Prisma client instance.
 * Called from database-service.ts during initialization.
 */
export function setSupplierServicePrisma(client: PrismaClient): void {
  prismaClient = client;
}

/**
 * Get the Prisma client, throwing if not initialized.
 */
function getPrisma(): PrismaClient {
  if (!prismaClient) {
    throw new Error('Supplier service not initialized. Call setSupplierServicePrisma first.');
  }
  return prismaClient;
}

// ===========================================
// VALIDATION
// ===========================================

/**
 * Comprehensive validation of supplier input.
 * 
 * This validates the full payload including:
 * - Basic info (name, address, website)
 * - Phone contacts (at least one required)
 * - Email contacts (optional)
 * - Duplicate detection
 * 
 * @param input - Supplier creation payload
 * @returns Array of validation errors (empty if valid)
 */
export function validateSupplierInput(input: CreateSupplier): SupplierValidationError[] {
  const errors: SupplierValidationError[] = [];
  
  // ===========================================
  // Basic Info Validation
  // ===========================================
  
  // Name: required, min 2 chars
  const nameResult = validateRequiredText(input.name, 'Name', 2, 200);
  if (!nameResult.isValid && nameResult.error) {
    errors.push({ field: 'name', message: nameResult.error });
  }
  
  // Address: required, min 5 chars
  const addressResult = validateRequiredText(input.address, 'Address', 5, 500);
  if (!addressResult.isValid && addressResult.error) {
    errors.push({ field: 'address', message: addressResult.error });
  }
  
  // Website: optional, must be valid URL if present
  if (input.website && input.website.trim()) {
    const websiteResult = validateUrl(input.website);
    if (!websiteResult.isValid && websiteResult.error) {
      errors.push({ field: 'website', message: websiteResult.error });
    }
  }
  
  // ===========================================
  // Phone Validation
  // ===========================================
  
  // At least one phone is required
  if (!input.phones || input.phones.length === 0) {
    errors.push({ field: 'phones', message: 'At least one phone number is required' });
  } else {
    // Validate each phone
    input.phones.forEach((phone, index) => {
      // Value required
      if (!phone.value || !phone.value.trim()) {
        errors.push({
          field: 'phones',
          message: 'Phone number cannot be empty',
          index,
        });
      } else {
        // Valid phone format
        const phoneResult = validatePhoneNumber(phone.value);
        if (!phoneResult.isValid && phoneResult.error) {
          errors.push({
            field: 'phones',
            message: phoneResult.error,
            index,
          });
        }
      }
      
      // At least one channel required for phones
      if (!phone.channels || phone.channels.length === 0) {
        errors.push({
          field: 'phones',
          message: 'At least one channel is required for phone contacts',
          index,
        });
      }
    });
    
    // Check for duplicate phone values
    const phoneValues = input.phones.map(p => normalizePhoneNumber(p.value));
    const duplicatePhones = findDuplicateContacts(phoneValues);
    if (duplicatePhones.length > 0) {
      errors.push({
        field: 'phones',
        message: `Duplicate phone numbers: ${duplicatePhones.join(', ')}`,
      });
    }
    
    // Check for multiple primary phones
    const primaryPhones = input.phones.filter(p => p.isPrimary);
    if (primaryPhones.length > 1) {
      errors.push({
        field: 'phones',
        message: 'Only one phone can be marked as primary',
      });
    }
  }
  
  // ===========================================
  // Email Validation
  // ===========================================
  
  if (input.emails && input.emails.length > 0) {
    input.emails.forEach((email, index) => {
      // Value required if entry exists
      if (!email.value || !email.value.trim()) {
        errors.push({
          field: 'emails',
          message: 'Email address cannot be empty',
          index,
        });
      } else {
        // Valid email format
        const emailResult = validateEmail(email.value);
        if (!emailResult.isValid && emailResult.error) {
          errors.push({
            field: 'emails',
            message: emailResult.error,
            index,
          });
        }
      }
    });
    
    // Check for duplicate email values
    const emailValues = input.emails.map(e => normalizeEmail(e.value));
    const duplicateEmails = findDuplicateContacts(emailValues);
    if (duplicateEmails.length > 0) {
      errors.push({
        field: 'emails',
        message: `Duplicate email addresses: ${duplicateEmails.join(', ')}`,
      });
    }
  }
  
  // ===========================================
  // Cross-field Validation
  // ===========================================
  
  // No overlap between phone and email values (edge case)
  const allPhoneValues = (input.phones || []).map(p => normalizePhoneNumber(p.value).toLowerCase());
  const allEmailValues = (input.emails || []).map(e => normalizeEmail(e.value));
  const phoneEmailOverlap = allPhoneValues.filter(p => allEmailValues.includes(p));
  if (phoneEmailOverlap.length > 0) {
    errors.push({
      field: 'contacts',
      message: 'Same value cannot be both phone and email',
    });
  }
  
  return errors;
}

// ===========================================
// NORMALIZATION
// ===========================================

/**
 * Normalize supplier input before persistence.
 * 
 * This:
 * - Trims all text fields
 * - Normalizes phone numbers
 * - Normalizes email addresses
 * - Normalizes URLs
 * - Ensures at least one phone is primary
 * 
 * @param input - Raw supplier input
 * @returns Normalized input
 */
export function normalizeSupplierInput(input: CreateSupplier): CreateSupplier {
  const normalized = {
    ...input,
    name: input.name.trim(),
    address: input.address.trim(),
    website: input.website?.trim() ? normalizeUrl(input.website) : null,
    phones: input.phones.map(phone => ({
      ...phone,
      value: normalizePhoneNumber(phone.value),
    })),
    emails: (input.emails || []).map(email => ({
      ...email,
      value: normalizeEmail(email.value),
    })).filter(e => e.value), // Remove empty emails
  };
  
  // Ensure at least one phone is primary
  const hasPrimary = normalized.phones.some(p => p.isPrimary);
  if (!hasPrimary && normalized.phones.length > 0) {
    normalized.phones[0].isPrimary = true;
  }
  
  return normalized;
}

// ===========================================
// CRUD OPERATIONS
// ===========================================

/**
 * Create a new supplier with contacts.
 * 
 * TRANSACTION FLOW:
 * 1. Validate input
 * 2. Create OperationLog (PENDING)
 * 3. Create Supplier
 * 4. Create Contacts
 * 5. Complete OperationLog
 * 6. Return result
 * 
 * If any step fails, the transaction rolls back.
 * 
 * @param input - Supplier creation payload
 * @param createdBy - User/system identifier for audit
 * @returns Creation result with supplier or errors
 */
export async function createSupplier(
  input: CreateSupplier,
  createdBy: string = 'local'
): Promise<CreateSupplierResult> {
  const db = getPrisma();
  
  // Step 1: Validate
  const validationErrors = validateSupplierInput(input);
  if (validationErrors.length > 0) {
    return {
      success: false,
      errors: validationErrors,
    };
  }
  
  // Step 2: Normalize
  const normalized = normalizeSupplierInput(input);
  
  // Step 3: Create operation for audit trail
  let operationId: string;
  try {
    operationId = await createOperation({
      type: 'SUPPLIER_CREATE',
      description: `Create supplier: ${normalized.name}`,
      metadata: {
        supplierName: normalized.name,
        // Store sanitized snapshot (no sensitive data)
        snapshot: {
          name: normalized.name,
          address: normalized.address,
          website: normalized.website,
          phoneCount: normalized.phones.length,
          emailCount: normalized.emails?.length || 0,
        },
      },
      createdBy,
    });
  } catch (error) {
    console.error('[SupplierService] Failed to create operation:', error);
    return {
      success: false,
      errors: [{ field: 'system', message: 'Failed to initialize audit trail' }],
    };
  }
  
  try {
    // Step 4: Create supplier and contacts in transaction
    const supplier = await db.$transaction(async (tx) => {
      // Create supplier
      const supplierId = uuidv4();
      const createdSupplier = await tx.supplier.create({
        data: {
          id: supplierId,
          name: normalized.name,
          address: normalized.address,
          website: normalized.website,
          operationId,
        },
      });
      
      // Create phone contacts
      for (const phone of normalized.phones) {
        await tx.supplierContact.create({
          data: {
            id: uuidv4(),
            supplierId,
            type: 'PHONE',
            // Store channels as comma-separated string (e.g., "REGULAR,WHATSAPP")
            channel: phone.channels.join(','),
            value: phone.value,
            isPrimary: phone.isPrimary || false,
          },
        });
      }
      
      // Create email contacts
      for (const email of (normalized.emails || [])) {
        await tx.supplierContact.create({
          data: {
            id: uuidv4(),
            supplierId,
            type: 'EMAIL',
            channel: null,
            value: email.value,
            isPrimary: email.isPrimary || false,
          },
        });
      }
      
      // Fetch complete supplier with contacts
      const completeSupplier = await tx.supplier.findUnique({
        where: { id: supplierId },
        include: { contacts: true },
      });
      
      return completeSupplier;
    });
    
    if (!supplier) {
      throw new Error('Supplier creation returned null');
    }
    
    // Step 5: Complete operation
    await completeOperation({
      operationId,
      rowCount: 1 + supplier.contacts.length, // Supplier + contacts
      metadata: {
        supplierId: supplier.id,
      },
    });
    
    // Step 6: Return result
    return {
      success: true,
      supplier: mapPrismaSupplierToDto(supplier),
      operationId,
    };
  } catch (error) {
    // Mark operation as failed
    await failOperation(operationId, error instanceof Error ? error.message : 'Unknown error');
    
    console.error('[SupplierService] Supplier creation failed:', error);
    return {
      success: false,
      errors: [{ 
        field: 'system', 
        message: error instanceof Error ? error.message : 'Supplier creation failed',
      }],
    };
  }
}

/**
 * Get a supplier by ID with all contacts.
 * 
 * @param id - Supplier UUID
 * @returns Supplier or null if not found
 */
export async function getSupplierById(id: string): Promise<Supplier | null> {
  const db = getPrisma();
  
  const supplier = await db.supplier.findUnique({
    where: { id },
    include: { contacts: true },
  });
  
  if (!supplier) return null;
  
  return mapPrismaSupplierToDto(supplier);
}

/**
 * List suppliers with pagination and search.
 * 
 * @param params - Query parameters
 * @returns Paginated supplier list
 */
export async function listSuppliers(params: SupplierQueryParams = {}): Promise<SupplierListResult> {
  const db = getPrisma();
  
  const {
    page = 1,
    pageSize = 20,
    search,
    sortBy = 'name',
    sortDirection = 'asc',
  } = params;
  
  const skip = (page - 1) * pageSize;
  
  // Build where clause
  const where: Prisma.SupplierWhereInput = {};
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { address: { contains: search } },
      { contacts: { some: { value: { contains: search } } } },
    ];
  }
  
  // Execute query
  const [suppliers, total] = await Promise.all([
    db.supplier.findMany({
      where,
      include: { contacts: true },
      skip,
      take: pageSize,
      orderBy: { [sortBy]: sortDirection },
    }),
    db.supplier.count({ where }),
  ]);
  
  return {
    data: suppliers.map(mapPrismaSupplierToDto),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Search suppliers by name (for autocomplete).
 * 
 * @param query - Search query
 * @param limit - Max results
 * @returns Array of matching suppliers
 */
export async function searchSuppliers(query: string, limit: number = 10): Promise<Supplier[]> {
  const db = getPrisma();
  
  const suppliers = await db.supplier.findMany({
    where: {
      name: { contains: query },
    },
    include: { contacts: true },
    take: limit,
    orderBy: { name: 'asc' },
  });
  
  return suppliers.map(mapPrismaSupplierToDto);
}

/**
 * Get phone numbers for a supplier by name.
 * Used to show additional phone numbers in the data grid.
 * 
 * @param supplierName - Name of the supplier to look up
 * @returns Array of phone numbers with primary flag, or empty array if not found
 */
export async function getSupplierPhonesByName(
  supplierName: string
): Promise<Array<{ value: string; isPrimary: boolean; channels: string[] | null }>> {
  const db = getPrisma();
  
  // Find supplier by exact name match (case-insensitive via contains)
  const supplier = await db.supplier.findFirst({
    where: {
      name: { equals: supplierName },
    },
    include: {
      contacts: {
        where: { type: 'PHONE' },
        orderBy: [
          { isPrimary: 'desc' }, // Primary first
          { createdAt: 'asc' },
        ],
      },
    },
  });
  
  if (!supplier) {
    return [];
  }
  
  return supplier.contacts.map((contact) => ({
    value: contact.value,
    isPrimary: contact.isPrimary,
    channels: contact.channel ? contact.channel.split(',') : null,
  }));
}

/**
 * Delete a supplier and all its contacts.
 * 
 * Note: This is a hard delete. In production, consider soft-delete
 * by adding an `isActive` flag similar to PriceEntry.
 * 
 * @param id - Supplier UUID
 * @returns True if deleted, false if not found
 */
export async function deleteSupplier(id: string): Promise<boolean> {
  const db = getPrisma();
  
  try {
    // Contacts are deleted via cascade (onDelete: Cascade in schema)
    await db.supplier.delete({
      where: { id },
    });
    return true;
  } catch (error) {
    // P2025: Record not found
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return false;
    }
    throw error;
  }
}

// ===========================================
// HELPER FUNCTIONS
// ===========================================

/**
 * Map Prisma Supplier model to DTO.
 * 
 * This converts Prisma types to our shared types,
 * ensuring type safety across the IPC boundary.
 */
function mapPrismaSupplierToDto(supplier: any): Supplier {
  return {
    id: supplier.id,
    name: supplier.name,
    address: supplier.address,
    website: supplier.website,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
    operationId: supplier.operationId,
    contacts: supplier.contacts.map((contact: any): SupplierContact => ({
      id: contact.id,
      supplierId: contact.supplierId,
      type: contact.type,
      // Parse comma-separated channel string back to array
      channels: contact.channel ? contact.channel.split(',') as PhoneChannel[] : null,
      value: contact.value,
      isPrimary: contact.isPrimary,
      createdAt: contact.createdAt,
    })),
  };
}

// ===========================================
// EDGE CASE HANDLERS
// ===========================================

/**
 * Handle deletion of primary phone contact.
 * 
 * When the primary phone is deleted, auto-assign another phone as primary.
 * Called when updating supplier contacts.
 * 
 * @param supplierId - Supplier UUID
 * @param deletedContactId - ID of the contact being deleted
 */
export async function handlePrimaryPhoneDeletion(
  supplierId: string,
  deletedContactId: string
): Promise<void> {
  const db = getPrisma();
  
  // Get the contact being deleted
  const deletedContact = await db.supplierContact.findUnique({
    where: { id: deletedContactId },
  });
  
  // Only handle if it was a primary phone
  if (!deletedContact || deletedContact.type !== 'PHONE' || !deletedContact.isPrimary) {
    return;
  }
  
  // Find another phone to make primary
  const otherPhone = await db.supplierContact.findFirst({
    where: {
      supplierId,
      type: 'PHONE',
      id: { not: deletedContactId },
    },
    orderBy: { createdAt: 'asc' },
  });
  
  if (otherPhone) {
    await db.supplierContact.update({
      where: { id: otherPhone.id },
      data: { isPrimary: true },
    });
  }
}
