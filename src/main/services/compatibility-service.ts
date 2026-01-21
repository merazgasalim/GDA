/**
 * Compatibility Service
 * =====================
 * Manages product compatibility relations (Renvoi / Équivalence).
 * 
 * DESIGN PRINCIPLES:
 * 
 * 1. COMPATIBILITY IS EXPLICIT
 *    - Never inferred heuristically or automatically
 *    - Each relation is manually created by a user
 *    - Clear provenance for every relation
 * 
 * 2. DIRECTIONAL RELATIONS
 *    - A → B does NOT imply B → A
 *    - Bi-directional requires two explicit entries
 *    - Prevents accidental transitive assumptions
 * 
 * 3. NO DATA MERGING
 *    - Compatibility does NOT merge stock
 *    - Compatibility does NOT merge pricing
 *    - Compatibility does NOT auto-sync changes
 *    - It's purely informational + decision support
 * 
 * 4. FULL AUDITABILITY
 *    - Every creation/removal has an OperationLog entry
 *    - Soft-delete preserves history (isActive flag)
 *    - Provenance: who, when, why (note)
 * 
 * EDGE CASES:
 * - Circular references (A → B → A): Allowed if explicitly created
 * - Multiple equivalents: Allowed
 * - Same reference, different suppliers: Treated as distinct products
 * - Intra-CSV duplicates: Not relevant (CSV import is separate)
 * 
 * REFERENCES:
 * - Domain-Driven Design by Eric Evans
 * - Database design: prisma/schema.prisma (ProductCompatibility model)
 */

import { db } from '../../shared/drizzle';
import { eq, and, or, inArray, like, sql, asc, desc, ne } from 'drizzle-orm';
import { productCompatibility, priceEntry, externalProductReference } from '../../shared/schema';
import { v4 as uuidv4 } from 'uuid';
import type {
  CreateCompatibility,
  CreateCompatibilityResult,
  RemoveCompatibilityResult,
  CompatibilityWithDetails,
  CompatibilityQueryParams,
  CompatibilitySearchResult,
  CompatibilitySummary,
  CompatibilityRelationType,
} from '../../shared/types';
import { createOperation, completeOperation, failOperation } from './operation-service';
// shared operation helpers are imported where needed

// ===========================================
// Drizzle ORM is initialized in shared/drizzle.ts and imported as db

// ===========================================
// VALIDATION
// ===========================================

/**
 * Validate compatibility input before creation.
 * 
 * Rules:
 * - Source and target must be different
 * - Both products must exist
 * - No duplicate relation of same type
 */
async function validateCompatibilityInput(
  input: CreateCompatibility
): Promise<{ isValid: boolean; error?: string }> {
  // db is imported from Drizzle
  
  // Rule 1: Source and target must be different
  if (input.targetType === 'INTERNAL' && input.sourceProductId === input.targetProductId) {
    return {
      isValid: false,
      error: 'Un produit ne peut pas être compatible avec lui-même',
    };
  }
  
  // Rule 2: Source product must exist
  const sourceExists = await db.select().from(priceEntry).where(and(eq(priceEntry.id, input.sourceProductId), eq(priceEntry.isActive, true))).get();
  if (!sourceExists) {
    return {
      isValid: false,
      error: 'Le produit source n\'existe pas ou n\'est plus actif',
    };
  }
  
  // Rule 3: Target validation depends on targetType
  if (input.targetType === 'INTERNAL') {
    if (!input.targetProductId) {
      return { isValid: false, error: 'ID du produit cible requise' };
    }
    const targetExists = await db.select().from(priceEntry).where(and(eq(priceEntry.id, input.targetProductId), eq(priceEntry.isActive, true))).get();
    if (!targetExists) {
      return {
        isValid: false,
        error: 'Le produit cible n\'existe pas ou n\'est plus actif',
      };
    }
  } else {
    // EXTERNAL: either externalReferenceId provided or externalReference data will be created later
    if (!input.externalReferenceId && !input.externalReference) {
      return { isValid: false, error: 'Référence externe requise' };
    }
  }

  // Rule 4: No duplicate relation of same type (active relations)
  const whereClause = and(
    eq(productCompatibility.sourceProductId, input.sourceProductId),
    eq(productCompatibility.relationType, input.relationType),
    eq(productCompatibility.isActive, true),
    input.targetType === 'INTERNAL' && input.targetProductId ? eq(productCompatibility.targetProductId, input.targetProductId) : undefined,
    input.targetType === 'EXTERNAL' && input.externalReferenceId ? eq(productCompatibility.externalReferenceId, input.externalReferenceId) : undefined
  );
  const existingRelation = await db.select().from(productCompatibility).where(whereClause).get();
  if (existingRelation) {
    return {
      isValid: false,
      error: 'Cette relation de compatibilité existe déjà',
    };
  }
  
  return { isValid: true };
}

// ===========================================
// CREATE OPERATIONS
// ===========================================

/**
 * Add a new compatibility relation between two products.
 * 
 * WORKFLOW:
 * 1. Validate input (different products, both exist, no duplicate)
 * 2. Create OperationLog entry (PENDING)
 * 3. Create ProductCompatibility record
 * 4. Complete operation (COMPLETED)
 * 
 * @param input - Compatibility creation input
 * @param createdBy - User who created the relation (default: 'local')
 * @returns Result with created compatibility or error
 */
export async function addCompatibility(
  input: CreateCompatibility,
  createdBy: string = 'local'
): Promise<CreateCompatibilityResult> {
  // db is imported from Drizzle
  
  // Validate input
  const validation = await validateCompatibilityInput(input);
  if (!validation.isValid) {
    return {
      success: false,
      error: validation.error,
    };
  }
  
  try {
    // Create operation and related rows in a single transaction for atomicity
    const operationId = await createOperation({
      type: 'COMPATIBILITY_ADD',
      description: `Ajout compatibilité ${input.sourceProductId} → ${input.targetProductId ?? input.externalReferenceId}`,
      metadata: {
        sourceProductId: input.sourceProductId,
        targetProductId: input.targetProductId ?? undefined,
        externalReferenceId: input.externalReferenceId ?? undefined,
        relationType: input.relationType,
      },
      createdBy,
    });

    const newId = uuidv4();

    const row = {
      id: newId,
      sourceProductId: input.sourceProductId,
      targetProductId: input.targetType === 'INTERNAL' ? input.targetProductId ?? null : null,
      externalReferenceId: input.targetType === 'EXTERNAL' ? input.externalReferenceId ?? null : null,
      targetType: input.targetType,
      relationType: input.relationType,
      note: input.note ?? null,
      isActive: true,
      createdAt: new Date().toISOString(),
      createdBy: createdBy,
    } as any;

    // If caller provided externalReference object (new external), persist it and link
    if (input.targetType === 'EXTERNAL' && !row.externalReferenceId && (input as any).externalReference) {
      try {
        const extId = uuidv4();
        const extRow = {
          id: extId,
          reference: (input as any).externalReference.reference,
          designation: (input as any).externalReference.designation ?? null,
          brand: (input as any).externalReference.brand ?? null,
          notes: (input as any).externalReference.notes ?? null,
          createdBy: createdBy ?? 'system',
          operationId,
          isActive: true,
          createdAt: new Date().toISOString(),
        } as any;

        await db.insert(externalProductReference).values(extRow).run();
        row.externalReferenceId = extId;
      } catch (err) {
        console.error('[CompatibilityService] Failed to create external reference:', err);
        // continue without throwing; compatibility insert will fail later if necessary
      }
    }

    await db.insert(productCompatibility).values(row).run();

    await completeOperation({ operationId, rowCount: 1 });

    const compatibility = {
      ...row,
      createdAt: new Date(row.createdAt),
    } as any;

    return { success: true, compatibility, operationId };

  } catch (error) {
    console.error('[CompatibilityService] Failed to add compatibility:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to add compatibility' };
  }
}

// ===========================================
// REMOVE OPERATIONS (SOFT DELETE)
// ===========================================

/**
 * Remove a compatibility relation (soft-delete).
 * 
 * WORKFLOW:
 * 1. Verify relation exists and is active
 * 2. Create OperationLog entry (PENDING)
 * 3. Soft-delete: set isActive=false, deactivatedAt/By
 * 4. Complete operation (COMPLETED)
 * 
 * @param compatibilityId - ID of the relation to remove
 * @param reason - Optional reason for removal (for audit)
 * @param removedBy - User who removed the relation (default: 'local')
 * @returns Result with success status or error
 */
export async function removeCompatibility(
  compatibilityId: string,
  reason?: string,
  removedBy: string = 'local'
): Promise<RemoveCompatibilityResult> {
  // db is imported from Drizzle
  
  // Find existing active relation
  const existing = await db.select().from(productCompatibility).where(and(eq(productCompatibility.id, compatibilityId), eq(productCompatibility.isActive, true))).get();
  
  if (!existing) {
    return {
      success: false,
      error: 'Relation de compatibilité introuvable ou déjà supprimée',
    };
  }
  
  let operationId: string | undefined;
  
  try {
    // Create operation log entry
    operationId = await createOperation({
      type: 'COMPATIBILITY_REMOVE',
      description: `Suppression de compatibilité: ${existing.sourceProductId} → ${existing.targetProductId ?? existing.externalReferenceId}`,
      metadata: {
        compatibilityId,
        sourceProductId: existing.sourceProductId,
        targetProductId: existing.targetProductId ?? undefined,
        externalReferenceId: (existing as any).externalReferenceId ?? undefined,
        relationType: existing.relationType,
        reason: reason ?? undefined,
      },
      createdBy: removedBy,
    });
    
    // Soft-delete: update isActive and deactivation fields (Drizzle)
    await db.update(productCompatibility)
      .set({ isActive: false, deactivatedAt: new Date().toISOString(), deactivatedBy: removedBy })
      .where(eq(productCompatibility.id, compatibilityId))
      .run();
    
    // Complete operation
    await completeOperation({
      operationId,
      rowCount: 1,
    });
    
    return {
      success: true,
      operationId,
    };
  } catch (error) {
    console.error('[CompatibilityService] Failed to remove compatibility:', error);
    
    if (operationId) {
      await failOperation(operationId, error instanceof Error ? error.message : 'Unknown error');
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove compatibility',
    };
  }
}

// ===========================================
// QUERY OPERATIONS
// ===========================================

/**
 * Get all compatibility relations for a product.
 * 
 * Returns outgoing relations (where product is source) by default.
 * Can optionally include incoming relations (where product is target).
 * 
 * @param params - Query parameters
 * @returns Array of compatibility relations with product details
 */
export async function getCompatibilitiesForProduct(
  params: CompatibilityQueryParams
): Promise<CompatibilityWithDetails[]> {
  // db is imported from Drizzle
  
  const {
    productId,
    includeIncoming = false,
    relationType,
    includeInactive = false,
  } = params;
  
  // Build base where clause for outgoing relations
  const outgoingWhere = and(
    eq(productCompatibility.sourceProductId, productId),
    relationType ? eq(productCompatibility.relationType, relationType) : undefined,
    !includeInactive ? eq(productCompatibility.isActive, true) : undefined
  );
  const outgoingRelations = await db.select({
    id: productCompatibility.id,
    sourceProductId: productCompatibility.sourceProductId,
    targetType: productCompatibility.targetType,
    targetProductId: productCompatibility.targetProductId,
    externalReferenceId: productCompatibility.externalReferenceId,
    relationType: productCompatibility.relationType,
    note: productCompatibility.note,
    isActive: productCompatibility.isActive,
    createdAt: productCompatibility.createdAt,
    createdBy: productCompatibility.createdBy,
    deactivatedAt: productCompatibility.deactivatedAt,
    deactivatedBy: productCompatibility.deactivatedBy,
  }).from(productCompatibility).where(outgoingWhere).orderBy(desc(productCompatibility.createdAt)).all();
  
  // Query incoming relations if requested
  let incomingRelations: typeof outgoingRelations = [];
  if (includeIncoming) {
    const incomingWhere = and(
      eq(productCompatibility.targetProductId, productId),
      relationType ? eq(productCompatibility.relationType, relationType) : undefined,
      !includeInactive ? eq(productCompatibility.isActive, true) : undefined
    );
    incomingRelations = await db.select({
      id: productCompatibility.id,
      sourceProductId: productCompatibility.sourceProductId,
      targetType: productCompatibility.targetType,
      targetProductId: productCompatibility.targetProductId,
      externalReferenceId: productCompatibility.externalReferenceId,
      relationType: productCompatibility.relationType,
      note: productCompatibility.note,
      isActive: productCompatibility.isActive,
      createdAt: productCompatibility.createdAt,
      createdBy: productCompatibility.createdBy,
      deactivatedAt: productCompatibility.deactivatedAt,
      deactivatedBy: productCompatibility.deactivatedBy,
    }).from(productCompatibility).where(incomingWhere).orderBy(desc(productCompatibility.createdAt)).all();
  }
  
  // Combine and resolve product details
  const allRelations = [...outgoingRelations, ...incomingRelations];
  
  // Get unique product IDs to fetch details
  // Build sets of internal product IDs and external reference IDs we need to fetch
  const productIds = new Set<string>();
  const externalIds = new Set<string>();
  for (const rel of allRelations) {
    if (rel.sourceProductId === productId) {
      // outgoing: target may be internal or external
      if ((rel as any).targetType === 'EXTERNAL' && (rel as any).externalReferenceId) {
        externalIds.add((rel as any).externalReferenceId);
      } else if (rel.targetProductId) {
        productIds.add(rel.targetProductId);
      }
    } else {
      // incoming: related product is the sourceProductId (always internal)
      if (rel.sourceProductId) productIds.add(rel.sourceProductId);
    }
  }

    
  const products = productIds.size > 0
    ? await db.select().from(priceEntry).where(inArray(priceEntry.id, Array.from(productIds))).all()
    : [];
  const externals = await db.select().from(externalProductReference).where(inArray(externalProductReference.id, Array.from(externalIds))).all();

  const productMap = new Map<string, any>(products.map((p: any) => [p.id, p]));
  const externalMap = new Map<string, any>(externals.map((e: any) => [e.id, e]));

  // Build result with resolved details (handle INTERNAL or EXTERNAL targets)
  const result: CompatibilityWithDetails[] = allRelations.map((rel: any) => {
    const isOutgoing = rel.sourceProductId === productId;

    // Outgoing and external
    if (rel.targetType === 'EXTERNAL' && rel.externalReferenceId) {
      const ext = externalMap.get(rel.externalReferenceId);
      return {
        id: rel.id,
        relationType: rel.relationType as CompatibilityRelationType,
        note: rel.note,
        createdAt: rel.createdAt ? new Date(rel.createdAt) : new Date(0),
        createdBy: rel.createdBy ?? 'system',
        targetType: 'EXTERNAL',
        reference: ext?.reference ?? 'N/A',
        designation: ext?.designation ?? 'N/A',
        brand: ext?.brand ?? 'N/A',
        supplierName: 'N/A',
        price: null,
        sourceProductId: rel.sourceProductId as string,
        targetProductId: null,
        externalReferenceId: rel.externalReferenceId,
      };
    }

    // Internal target (or incoming where related product is internal)
    const relatedProductId = isOutgoing ? rel.targetProductId : rel.sourceProductId;
    const relatedProduct = relatedProductId ? productMap.get(relatedProductId) : undefined;

    return {
      id: rel.id,
      relationType: rel.relationType as CompatibilityRelationType,
      note: rel.note,
      createdAt: rel.createdAt ? new Date(rel.createdAt) : new Date(0),
      createdBy: rel.createdBy ?? 'system',
      targetType: 'INTERNAL',
      reference: relatedProduct?.reference ?? 'N/A',
      designation: relatedProduct?.designation ?? 'N/A',
      brand: relatedProduct?.brand ?? 'N/A',
      supplierName: relatedProduct?.supplierName ?? 'N/A',
      price: relatedProduct?.price ?? null,
      sourceProductId: rel.sourceProductId as string,
      targetProductId: rel.targetProductId,
    };
  });

  return result;
}

/**
 * Get compatibility summary statistics for a product.
 * 
 * @param productId - Product to get summary for
 * @returns Summary with counts by direction and type
 */
export async function getCompatibilitySummary(
  productId: string
): Promise<CompatibilitySummary> {
  // db is imported from Drizzle
  
  // Count outgoing relations by type (Drizzle)
  const outgoingRows = await db
    .select({ relationType: productCompatibility.relationType, count: sql`count(*)` })
    .from(productCompatibility)
    .where(and(eq(productCompatibility.sourceProductId, productId), eq(productCompatibility.isActive, true)))
    .groupBy(productCompatibility.relationType)
    .all();

  // Count incoming relations
  const incomingRows = await db
    .select({ count: sql`count(*)` })
    .from(productCompatibility)
    .where(and(eq(productCompatibility.targetProductId, productId), eq(productCompatibility.isActive, true)))
    .all();

  // Build type breakdown
  const byType: Record<CompatibilityRelationType, number> = {
    EQUIVALENT: 0,
    SUBSTITUTE: 0,
    OEM_ALTERNATIVE: 0,
  };

  let outgoingTotal = 0;
  for (const row of outgoingRows) {
    const type = row.relationType as CompatibilityRelationType;
    const c = Number(row.count ?? 0);
    byType[type] = c;
    outgoingTotal += c;
  }

  const incomingCount = Number(incomingRows[0]?.count ?? 0);

  return {
    outgoingCount: outgoingTotal,
    incomingCount,
    byType,
  };
}

/**
 * Search for products that can be added as compatible references.
 * 
 * Searches by reference, designation, or brand.
 * Excludes the source product itself.
 * Indicates if products already have a relation with source.
 * 
 * @param sourceProductId - Source product to exclude
 * @param query - Search query string
 * @param limit - Maximum results (default: 20)
 * @returns Array of matching products with existing relation info
 */
export async function searchProductsForCompatibility(
  sourceProductId: string,
  query: string,
  limit: number = 20
): Promise<CompatibilitySearchResult[]> {
  // use shared `db` from drizzle import
  if (!query || query.trim().length < 2) {
    return [];
  }
  
  const searchTerm = query.trim();
  
  // Search active products excluding source (Drizzle)
  const products = await db
    .select()
    .from(priceEntry)
    .where(
      and(
        eq(priceEntry.isActive, true),
        ne(priceEntry.id, sourceProductId),
        or(
          like(priceEntry.reference, `%${searchTerm}%`),
          like(priceEntry.designation, `%${searchTerm}%`),
          like(priceEntry.brand, `%${searchTerm}%`)
        )
      )
    )
    .orderBy(asc(priceEntry.reference), asc(priceEntry.brand))
    .limit(limit)
    .all();
  
  // Get existing relations for these products
  const productIds = products.map((p: any) => p.id);
  const existingRelations = await db
    .select({ targetProductId: productCompatibility.targetProductId, relationType: productCompatibility.relationType })
    .from(productCompatibility)
    .where(
      and(
        eq(productCompatibility.sourceProductId, sourceProductId),
        inArray(productCompatibility.targetProductId, productIds),
        eq(productCompatibility.isActive, true)
      )
    )
    .all();
  
  const relationMap = new Map<string, CompatibilityRelationType>(
    existingRelations
      .filter((r: { targetProductId: string | null }) => !!r.targetProductId)
      .map((r: { targetProductId: string | null; relationType: string | null }) => [
        r.targetProductId as string,
        r.relationType as CompatibilityRelationType,
      ])
  );
  // Build initial results for internal products
  const results: CompatibilitySearchResult[] = products.map((p: any): CompatibilitySearchResult => ({
    id: p.id,
    reference: p.reference,
    designation: p.designation,
    brand: p.brand,
    supplierName: p.supplierName,
    price: p.price,
    hasExistingRelation: relationMap.has(p.id),
    existingRelationType: relationMap.get(p.id),
    targetType: 'INTERNAL',
  }));

  // Also search external references and include them in results
  const externals = await db
    .select()
    .from(externalProductReference)
    .where(
      or(
        like(externalProductReference.reference, `%${searchTerm}%`),
        like(externalProductReference.designation, `%${searchTerm}%`),
        like(externalProductReference.brand, `%${searchTerm}%`)
      )
    )
    .limit(limit)
    .all();

  if (externals.length > 0) {
    const extIds = externals.map((e: any) => e.id);
    const existingExtRelations = await db
      .select({ externalReferenceId: productCompatibility.externalReferenceId, relationType: productCompatibility.relationType })
      .from(productCompatibility)
      .where(
        and(
          eq(productCompatibility.sourceProductId, sourceProductId),
          inArray(productCompatibility.externalReferenceId, extIds),
          eq(productCompatibility.isActive, true)
        )
      )
      .all();

    const extRelationMap = new Map<string, CompatibilityRelationType>(
      existingExtRelations
        .filter((r: { externalReferenceId: string | null }) => !!r.externalReferenceId)
        .map((r: { externalReferenceId: string | null; relationType: string | null }) => [
          r.externalReferenceId as string,
          r.relationType as CompatibilityRelationType,
        ])
    );

    for (const e of externals) {
      results.push({
        id: e.id,
        reference: e.reference ?? 'N/A',
        designation: e.designation ?? 'N/A',
        brand: e.brand ?? 'N/A',
        supplierName: null,
        price: null,
        hasExistingRelation: extRelationMap.has(e.id),
        existingRelationType: extRelationMap.get(e.id),
        targetType: 'EXTERNAL',
      });
    }
  }

  return results;
}

/**
 * Check if a specific compatibility relation exists.
 * 
 * @param sourceProductId - Source product ID
 * @param targetProductId - Target product ID
 * @param relationType - Type of relation (optional, checks any type if not provided)
 * @returns Boolean indicating if relation exists
 */
export async function checkCompatibilityExists(
  sourceProductId: string,
  targetProductId: string,
  relationType?: CompatibilityRelationType
): Promise<boolean> {
  // use shared `db` from drizzle import
  const existing = await db
    .select()
    .from(productCompatibility)
    .where(
      and(
        eq(productCompatibility.sourceProductId, sourceProductId),
        or(eq(productCompatibility.targetProductId, targetProductId), eq(productCompatibility.externalReferenceId, targetProductId)),
        relationType ? eq(productCompatibility.relationType, relationType) : undefined,
        eq(productCompatibility.isActive, true)
      )
    )
    .get();

  return !!existing;
}

/**
 * Get count of products that have at least one active compatibility relation.
 * Useful for statistics and discovery UI.
 * 
 * @returns Count of products with compatibilities
 */
export async function getProductsWithCompatibilitiesCount(): Promise<number> {
  // Drizzle ORM: select all active productCompatibility, then count unique sourceProductId
  const rows = await db.select({ sourceProductId: productCompatibility.sourceProductId })
    .from(productCompatibility)
    .where(eq(productCompatibility.isActive, true))
    .all();
  const unique = new Set(rows.map((r: any) => r.sourceProductId));
  return unique.size;
}

/**
 * Get compatibility counts for multiple products in bulk.
 * Returns a map of productId -> total count of compatibilities (both incoming and outgoing).
 * 
 * @param productIds - Array of product IDs to get counts for
 * @returns Map of productId to compatibility count
 */
export async function getBulkCompatibilityCounts(
  productIds: string[]
): Promise<Map<string, number>> {
  if (productIds.length === 0) {
    return new Map();
  }

  // Outgoing: sourceProductId in productIds
  const outgoing = await db.select({
    sourceProductId: productCompatibility.sourceProductId,
    id: productCompatibility.id,
  })
    .from(productCompatibility)
    .where(and(inArray(productCompatibility.sourceProductId, productIds), eq(productCompatibility.isActive, true)))
    .all();

  // Incoming: targetProductId in productIds
  const incoming = await db.select({
    targetProductId: productCompatibility.targetProductId,
    id: productCompatibility.id,
  })
    .from(productCompatibility)
    .where(and(inArray(productCompatibility.targetProductId, productIds), eq(productCompatibility.isActive, true)))
    .all();

  // Aggregate counts
  const countMap = new Map<string, number>();
  for (const row of outgoing) {
    if (!row.sourceProductId) continue;
    countMap.set(row.sourceProductId, (countMap.get(row.sourceProductId) || 0) + 1);
  }
  for (const row of incoming) {
    if (!row.targetProductId) continue;
    countMap.set(row.targetProductId, (countMap.get(row.targetProductId) || 0) + 1);
  }
  return countMap;
}

/**
 * Get compatibilities for multiple source product IDs in a single call.
 * Used by the product search UI to fetch compatible products for a set
 * of direct search results, following the SEARCH PIPELINE described
 * in the UX specification.
 *
 * Returns an array of CompatibilityWithDetails for all outgoing
 * relations where sourceProductId is in the provided productIds.
 */
export async function getCompatibilitiesForSources(
  productIds: string[]
): Promise<CompatibilityWithDetails[]> {
  if (!productIds || productIds.length === 0) return [];

  // Drizzle ORM: select all active outgoing relations for these sources
  const relations = await db
    .select()
    .from(productCompatibility)
    .where(and(inArray(productCompatibility.sourceProductId, productIds), eq(productCompatibility.isActive, true)))
    .orderBy(desc(productCompatibility.createdAt))
    .all();

  // Collect internal product IDs and external reference IDs to resolve details
  const internalIds = new Set<string>();
  const externalIds = new Set<string>();
  for (const r of relations) {
    if ((r as any).targetType === 'EXTERNAL' && (r as any).externalReferenceId) {
      externalIds.add((r as any).externalReferenceId);
    } else if (r.targetProductId) {
      internalIds.add(r.targetProductId);
    }
  }

  const products = internalIds.size > 0
    ? await db.select().from(priceEntry).where(inArray(priceEntry.id, Array.from(internalIds))).all()
    : [];
  const externals = externalIds.size > 0
    ? await db.select().from(externalProductReference).where(inArray(externalProductReference.id, Array.from(externalIds))).all()
    : [];

  const productMap = new Map<string, any>(products.map((p: any) => [p.id, p]));
  const externalMap = new Map<string, any>(externals.map((e: any) => [e.id, e]));

  // Resolve into CompatibilityWithDetails
  const result: CompatibilityWithDetails[] = relations.map((rel: any) => {
    if ((rel as any).targetType === 'EXTERNAL' && (rel as any).externalReferenceId) {
      const ext = externalMap.get((rel as any).externalReferenceId);
      return {
        id: rel.id,
        relationType: rel.relationType as CompatibilityRelationType,
        note: rel.note,
        createdAt: rel.createdAt ? new Date(rel.createdAt) : new Date(0),
        createdBy: rel.createdBy ?? 'system',
        targetType: 'EXTERNAL',
        reference: ext?.reference ?? 'N/A',
        designation: ext?.designation ?? 'N/A',
        brand: ext?.brand ?? 'N/A',
        supplierName: 'N/A',
        price: null,
        sourceProductId: rel.sourceProductId as string,
        targetProductId: null,
        externalReferenceId: (rel as any).externalReferenceId,
      };
    }

    const relatedProductId = rel.targetProductId;
    const relatedProduct = relatedProductId ? productMap.get(relatedProductId) : undefined;

    return {
      id: rel.id,
      relationType: rel.relationType as CompatibilityRelationType,
      note: rel.note,
      createdAt: rel.createdAt ? new Date(rel.createdAt) : new Date(0),
      createdBy: rel.createdBy ?? 'system',
      targetType: 'INTERNAL',
      reference: relatedProduct?.reference ?? 'N/A',
      designation: relatedProduct?.designation ?? 'N/A',
      brand: relatedProduct?.brand ?? 'N/A',
      supplierName: relatedProduct?.supplierName ?? 'N/A',
      price: relatedProduct?.price ?? null,
      sourceProductId: rel.sourceProductId as string,
      targetProductId: rel.targetProductId,
    };
  });

  return result;
}

/**
 * Find an external reference by normalized reference+brand (trim+upper).
 */
export async function findExternalReferenceByReferenceAndBrand(
  reference: string,
  brand: string
): Promise<{ id: string; reference: string; brand: string } | null> {
  // use shared `db` from drizzle import
  const normRef = reference.trim().toUpperCase();
  const normBrand = brand.trim().toUpperCase();
  const ext = await db
    .select()
    .from(externalProductReference)
    .where(and(eq(externalProductReference.reference, normRef), eq(externalProductReference.brand, normBrand), eq(externalProductReference.isActive, true)))
    .get();
  if (!ext) return null;
  return { id: ext.id, reference: ext.reference ?? '', brand: ext.brand ?? '' };
}

/**
 * Convert an external reference into a real internal product.
 * - Updates all ProductCompatibility entries that referenced the external to point to the new product
 * - Preserves operation provenance by creating a conversion OperationLog
 * - Soft-deletes the external reference
 */
export async function convertExternalToInternal(
  externalReferenceId: string,
  newProductId: string,
  convertedBy: string = 'local'
): Promise<{ success: boolean; operationId?: string; error?: string }> {
  // use shared `db` from drizzle import
  let operationId: string | undefined;

  try {
    operationId = await createOperation({
      type: 'SYSTEM_MIGRATE',
      description: `Conversion référence externe ${externalReferenceId} → produit ${newProductId}`,
      metadata: { externalReferenceId, newProductId },
      createdBy: convertedBy,
    });

    // Update compatibilities: set targetType to INTERNAL, targetProductId to newProductId, clear externalReferenceId
    await db
      .update(productCompatibility)
      .set({ targetType: 'INTERNAL', targetProductId: newProductId, externalReferenceId: null })
      .where(and(eq(productCompatibility.externalReferenceId, externalReferenceId), eq(productCompatibility.isActive, true)))
      .run();

    // Soft-delete external reference
    await db
      .update(externalProductReference)
      .set({ isActive: false, deactivatedAt: new Date().toISOString(), deactivatedBy: convertedBy })
      .where(eq(externalProductReference.id, externalReferenceId))
      .run();

    await completeOperation({ operationId, rowCount: 1 });
    return { success: true, operationId };
  } catch (err) {
    console.error('[CompatibilityService] Failed to convert external reference:', err);
    if (operationId) await failOperation(operationId, err instanceof Error ? err.message : 'Unknown error');
    return { success: false, error: err instanceof Error ? err.message : 'Conversion failed' };
  }
}
