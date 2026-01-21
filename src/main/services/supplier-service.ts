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

import { db } from '../../shared/drizzle';
import { eq, and, or, inArray, like, asc, desc, sql } from 'drizzle-orm';
import { supplier, supplierContact, priceEntry, operationLog } from '../../shared/schema';
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
import { completeOperation, failOperation } from './operation-service';
import { assertOperationAttached } from '../../shared/operationService';

// ===========================================
// PRISMA CLIENT ACCESSOR
// ===========================================


// Drizzle ORM is initialized in shared/drizzle.ts and imported as db

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
  // db is imported from Drizzle
  
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
  
  // Step 3/4: Create operation and supplier+contacts inside a single transaction
  try {
    const supplierResult = await db.transaction(async (tx: any) => {
      // create operation inside transaction
      const opId = uuidv4();
      await tx.insert(operationLog).values({
        id: opId,
        operationType: 'SUPPLIER_CREATE',
        payloadSnapshot: JSON.stringify({
          name: normalized.name,
          address: normalized.address,
          website: normalized.website,
          phoneCount: normalized.phones.length,
          emailCount: normalized.emails?.length || 0,
        }),
        status: 'APPLIED',
        createdBy: createdBy ?? 'local',
        type: 'SUPPLIER_CREATE',
        legacyStatus: 'PENDING',
        metadata: JSON.stringify({ supplierName: normalized.name }),
        description: `Create supplier: ${normalized.name}`,
        rowCount: 0,
        createdAt: new Date().toISOString(),
      }).run();

      // Create supplier
      const supplierId = uuidv4();
      await tx.insert(supplier).values({ id: supplierId, name: normalized.name, address: normalized.address, website: normalized.website, operationId: opId, createdAt: new Date().toISOString() }).run();

      // Create contacts
      for (const phone of normalized.phones) {
        await tx.insert(supplierContact).values({ id: uuidv4(), supplierId, type: 'PHONE', channel: phone.channels.join(','), value: phone.value, isPrimary: phone.isPrimary || false, createdAt: new Date().toISOString() }).run();
      }
      for (const email of (normalized.emails || [])) {
        await tx.insert(supplierContact).values({ id: uuidv4(), supplierId, type: 'EMAIL', channel: null, value: email.value, isPrimary: email.isPrimary || false, createdAt: new Date().toISOString() }).run();
      }

      // update operation entityId
      await tx.update(operationLog).set({ entityId: supplierId }).where(eq(operationLog.id, opId)).run();

      const sup = await tx.select().from(supplier).where(eq(supplier.id, supplierId)).get();
      const contacts = await tx.select().from(supplierContact).where(eq(supplierContact.supplierId, supplierId)).all();
      return { ...sup, contacts };
    });

    if (!supplierResult) throw new Error('Supplier creation returned null');

    assertOperationAttached(supplierResult);
    await completeOperation({ operationId: supplierResult.operationId as string, rowCount: 1 + (supplierResult.contacts?.length ?? 0), metadata: { supplierId: supplierResult.id } });

    return { success: true, supplier: mapPrismaSupplierToDto(supplierResult), operationId: supplierResult.operationId ?? null };
  } catch (error) {
    if ((error as any)?.operationId) await failOperation((error as any).operationId, error instanceof Error ? error.message : 'Unknown error');
    console.error('[SupplierService] Supplier creation failed:', error);
    return { success: false, errors: [{ field: 'system', message: error instanceof Error ? error.message : 'Supplier creation failed' }] };
  }
}

/**
 * Get a supplier by ID with all contacts.
 * 
 * @param id - Supplier UUID
 * @returns Supplier or null if not found
 */
export async function getSupplierById(id: string): Promise<Supplier | null> {
  const sup = await db.select().from(supplier).where(eq(supplier.id, id)).get();
  if (!sup) return null;
  const contacts = await db.select().from(supplierContact).where(eq(supplierContact.supplierId, id)).all();
  return mapPrismaSupplierToDto({ ...sup, contacts });
}

/**
 * Update an existing supplier and replace its contacts.
 *
 * This performs validation and normalization, then updates the supplier
 * record and recreates its contacts inside a single transaction.
 *
 * @param id - Supplier UUID
 * @param input - Updated supplier payload
 */
export async function updateSupplier(
  id: string,
  input: CreateSupplier
): Promise<CreateSupplierResult> {
  // db is imported from Drizzle

  // Validation
  const validationErrors = validateSupplierInput(input);
  if (validationErrors.length > 0) {
    return { success: false, errors: validationErrors };
  }

  // Normalize input
  const normalized = normalizeSupplierInput(input);

  try {
    const supplierResult = await db.transaction(async (tx: any) => {
      const existing = await tx.select().from(supplier).where(eq(supplier.id, id)).get();
      if (!existing) throw new Error('Supplier not found');
      const oldName = existing.name;

      await tx.update(supplier).set({ name: normalized.name, address: normalized.address, website: normalized.website }).where(eq(supplier.id, id)).run();
      await tx.update(priceEntry).set({ supplierName: normalized.name }).where(eq(priceEntry.supplierName, oldName)).run();

      await tx.delete(supplierContact).where(eq(supplierContact.supplierId, id)).run();
      for (const phone of normalized.phones) {
        await tx.insert(supplierContact).values({ id: uuidv4(), supplierId: id, type: 'PHONE', channel: phone.channels.join(','), value: phone.value, isPrimary: phone.isPrimary || false, createdAt: new Date().toISOString() }).run();
      }
      for (const email of (normalized.emails || [])) {
        await tx.insert(supplierContact).values({ id: uuidv4(), supplierId: id, type: 'EMAIL', channel: null, value: email.value, isPrimary: email.isPrimary || false, createdAt: new Date().toISOString() }).run();
      }

      const sup = await tx.select().from(supplier).where(eq(supplier.id, id)).get();
      const contacts = await tx.select().from(supplierContact).where(eq(supplierContact.supplierId, id)).all();
      return { ...sup, contacts };
    });

    if (!supplierResult) return { success: false, errors: [{ field: 'system', message: 'Supplier update failed' }] };
    return { success: true, supplier: mapPrismaSupplierToDto(supplierResult) };
  } catch (error) {
    if ((error as any)?.code === 'P2025') return { success: false, errors: [{ field: 'system', message: 'Supplier not found' }] };
    console.error('[SupplierService] Supplier update failed:', error);
    return { success: false, errors: [{ field: 'system', message: error instanceof Error ? error.message : 'Supplier update failed' }] };
  }
}

/**
 * List suppliers with pagination and search.
 * 
 * @param params - Query parameters
 * @returns Paginated supplier list
 */
export async function listSuppliers(params: SupplierQueryParams = {}): Promise<SupplierListResult> {
  const {
    page = 1,
    pageSize = 20,
    search,
    sortBy = 'name',
    sortDirection = 'asc',
  } = params;
  const offset = (page - 1) * pageSize;
  // Drizzle ORM: build where clause for search
  let whereExpr: any = undefined;
  if (search) {
    whereExpr = or(like(supplier.name, `%${search}%`), like(supplier.address, `%${search}%`));
  }

  const totalRow = await db.select({ c: sql`count(*)` }).from(supplier).where(whereExpr).get();
  const total = Number(totalRow?.c ?? 0);

  const sortColumn = sortBy === 'createdAt' ? supplier.createdAt : supplier.name;
  const suppliers = await db.select().from(supplier).where(whereExpr).orderBy(sortDirection === 'asc' ? asc(sortColumn) : desc(sortColumn)).limit(pageSize).offset(offset).all();

  // Fetch contacts for all suppliers
  const ids = suppliers.map((s: any) => s.id);
  const contacts = ids.length ? await db.select().from(supplierContact).where(inArray(supplierContact.supplierId, ids)).all() : [];
  const contactsMap = new Map<string, any[]>();
  for (const c of contacts) {
    const key = String(c.supplierId);
    const arr = contactsMap.get(key) ?? [];
    arr.push(c);
    contactsMap.set(key, arr);
  }

    const dtoSuppliers = suppliers.map((s: any) => mapPrismaSupplierToDto({ ...s, contacts: contactsMap.get(s.id) ?? [] }));
  return { data: dtoSuppliers, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/**
 * Search suppliers by name (for autocomplete).
 * 
 * @param query - Search query
 * @param limit - Max results
 * @returns Array of matching suppliers
 */
export async function searchSuppliers(query: string, limit: number = 10): Promise<Supplier[]> {
  const rows = await db.select().from(supplier).where(like(supplier.name, `%${query}%`)).orderBy(asc(supplier.name)).limit(limit).all();
  const ids = rows.map((r: any) => r.id);
  const contacts = ids.length ? await db.select().from(supplierContact).where(inArray(supplierContact.supplierId, ids)).all() : [];
  const contactsMap = new Map<string, any[]>();
  for (const c of contacts) {
    const key = String(c.supplierId);
    const arr = contactsMap.get(key) ?? [];
    arr.push(c);
    contactsMap.set(key, arr);
  }
    return rows.map((r: any) => mapPrismaSupplierToDto({ ...r, contacts: contactsMap.get(r.id) ?? [] }));
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
  // db is imported from Drizzle
  
  // Find supplier by exact name match (case-insensitive via contains)
  const sup = await db.select().from(supplier).where(eq(supplier.name, supplierName)).get();
  if (!sup) return [];
  const phones = await db.select().from(supplierContact).where(and(eq(supplierContact.supplierId, sup.id), eq(supplierContact.type, 'PHONE'))).orderBy(desc(supplierContact.createdAt)).all();
    return phones.map((contact: any) => ({ value: contact.value ?? '', isPrimary: !!contact.isPrimary, channels: contact.channel ? contact.channel.split(',') : null }));
}

/**
 * Count active PriceEntry rows that reference a given supplier name.
 * Used by the UI to determine whether a supplier can be safely abandoned.
 *
 * @param supplierName - Supplier display name
 * @returns Number of active products referencing this supplier
 */
export async function getActiveProductsCountBySupplierName(supplierName: string): Promise<number> {
  // db is imported from Drizzle
  if (!supplierName || supplierName.trim().length === 0) return 0;
  const row = await db.select({ c: sql`count(*)` }).from(priceEntry).where(and(eq(priceEntry.supplierName, supplierName), eq(priceEntry.isActive, true))).get();
  return Number(row?.c ?? 0);
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
  // db is imported from Drizzle
  
  try {
    // Contacts are deleted via cascade (onDelete: Cascade in schema)
    const res: any = await db.delete(supplier).where(eq(supplier.id, id)).run();
    return (res?.changes ?? 0) > 0;
  } catch (error) {
    // P2025: Record not found
    if (error && (error as any).code === 'P2025') {
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
    createdAt: supplier.createdAt ? new Date(supplier.createdAt) : new Date(0),
    updatedAt: supplier.updatedAt ? new Date(supplier.updatedAt) : new Date(),
    operationId: supplier.operationId,
    contacts: supplier.contacts.map((contact: any): SupplierContact => ({
      id: contact.id,
      supplierId: contact.supplierId,
      type: contact.type,
      // Parse comma-separated channel string back to array
      channels: contact.channel ? contact.channel.split(',') as PhoneChannel[] : null,
      value: contact.value,
      isPrimary: contact.isPrimary,
      createdAt: contact.createdAt ? new Date(contact.createdAt) : new Date(0),
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
  // db is imported from Drizzle
  
  // Get the contact being deleted
  const deletedContact = await db.select().from(supplierContact).where(eq(supplierContact.id, deletedContactId)).get();
  
  // Only handle if it was a primary phone
  if (!deletedContact || deletedContact.type !== 'PHONE' || !deletedContact.isPrimary) {
    return;
  }
  
  // Find another phone to make primary
  const otherPhone = await db.select().from(supplierContact).where(and(eq(supplierContact.supplierId, supplierId), eq(supplierContact.type, 'PHONE'), sql`${supplierContact.id} != ${deletedContactId}`)).orderBy(asc(supplierContact.createdAt)).limit(1).get();
  if (otherPhone) {
    await db.update(supplierContact).set({ isPrimary: true }).where(eq(supplierContact.id, otherPhone.id)).run();
  }
}
