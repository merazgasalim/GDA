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

import { PrismaClient, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import {
  ProductCompatibility,
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

// ===========================================
// PRISMA CLIENT ACCESSOR
// ===========================================

let prismaClient: PrismaClient | null = null;

/**
 * Set the Prisma client instance.
 * Called from database-service.ts during initialization.
 */
export function setCompatibilityServicePrisma(client: PrismaClient): void {
  prismaClient = client;
}

/**
 * Get the Prisma client, throwing if not initialized.
 */
function getPrisma(): PrismaClient {
  if (!prismaClient) {
    throw new Error('Compatibility service not initialized. Call setCompatibilityServicePrisma first.');
  }
  return prismaClient;
}

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
  const db = getPrisma();
  
  // Rule 1: Source and target must be different
  if (input.sourceProductId === input.targetProductId) {
    return {
      isValid: false,
      error: 'Un produit ne peut pas être compatible avec lui-même',
    };
  }
  
  // Rule 2: Source product must exist
  const sourceExists = await db.priceEntry.findFirst({
    where: { id: input.sourceProductId, isActive: true },
  });
  if (!sourceExists) {
    return {
      isValid: false,
      error: 'Le produit source n\'existe pas ou n\'est plus actif',
    };
  }
  
  // Rule 3: Target product must exist
  const targetExists = await db.priceEntry.findFirst({
    where: { id: input.targetProductId, isActive: true },
  });
  if (!targetExists) {
    return {
      isValid: false,
      error: 'Le produit cible n\'existe pas ou n\'est plus actif',
    };
  }
  
  // Rule 4: No duplicate relation of same type (only check active relations)
  const existingRelation = await db.productCompatibility.findFirst({
    where: {
      sourceProductId: input.sourceProductId,
      targetProductId: input.targetProductId,
      relationType: input.relationType,
      isActive: true,
    },
  });
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
  const db = getPrisma();
  
  // Validate input
  const validation = await validateCompatibilityInput(input);
  if (!validation.isValid) {
    return {
      success: false,
      error: validation.error,
    };
  }
  
  let operationId: string | undefined;
  
  try {
    // Create operation log entry
    operationId = await createOperation({
      type: 'COMPATIBILITY_ADD',
      description: `Ajout de compatibilité: ${input.sourceProductId} → ${input.targetProductId} (${input.relationType})`,
      metadata: {
        sourceProductId: input.sourceProductId,
        targetProductId: input.targetProductId,
        relationType: input.relationType,
        note: input.note ?? undefined,
      },
      createdBy,
    });
    
    // Create compatibility record
    const compatibility = await db.productCompatibility.create({
      data: {
        id: uuidv4(),
        sourceProductId: input.sourceProductId,
        targetProductId: input.targetProductId,
        relationType: input.relationType,
        note: input.note ?? null,
        isActive: true,
        createdBy,
        operationId,
      },
    });
    
    // Complete operation
    await completeOperation({
      operationId,
      rowCount: 1,
    });
    
    return {
      success: true,
      compatibility: {
        ...compatibility,
        relationType: compatibility.relationType as CompatibilityRelationType,
        createdAt: compatibility.createdAt,
        deactivatedAt: compatibility.deactivatedAt,
      },
      operationId,
    };
  } catch (error) {
    console.error('[CompatibilityService] Failed to add compatibility:', error);
    
    // Mark operation as failed if it was created
    if (operationId) {
      await failOperation(operationId, error instanceof Error ? error.message : 'Unknown error');
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add compatibility',
    };
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
  const db = getPrisma();
  
  // Find existing active relation
  const existing = await db.productCompatibility.findFirst({
    where: {
      id: compatibilityId,
      isActive: true,
    },
  });
  
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
      description: `Suppression de compatibilité: ${existing.sourceProductId} → ${existing.targetProductId}`,
      metadata: {
        compatibilityId,
        sourceProductId: existing.sourceProductId,
        targetProductId: existing.targetProductId,
        relationType: existing.relationType,
        reason: reason ?? undefined,
      },
      createdBy: removedBy,
    });
    
    // Soft-delete: update isActive and deactivation fields
    await db.productCompatibility.update({
      where: { id: compatibilityId },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
        deactivatedBy: removedBy,
      },
    });
    
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
  const db = getPrisma();
  
  const {
    productId,
    includeIncoming = false,
    relationType,
    includeInactive = false,
  } = params;
  
  // Build base where clause for outgoing relations
  const outgoingWhere: Prisma.ProductCompatibilityWhereInput = {
    sourceProductId: productId,
    ...(relationType && { relationType }),
    ...(!includeInactive && { isActive: true }),
  };
  
  // Query outgoing relations
  const outgoingRelations = await db.productCompatibility.findMany({
    where: outgoingWhere,
    orderBy: { createdAt: 'desc' },
  });
  
  // Query incoming relations if requested
  let incomingRelations: typeof outgoingRelations = [];
  if (includeIncoming) {
    const incomingWhere: Prisma.ProductCompatibilityWhereInput = {
      targetProductId: productId,
      ...(relationType && { relationType }),
      ...(!includeInactive && { isActive: true }),
    };
    incomingRelations = await db.productCompatibility.findMany({
      where: incomingWhere,
      orderBy: { createdAt: 'desc' },
    });
  }
  
  // Combine and resolve product details
  const allRelations = [...outgoingRelations, ...incomingRelations];
  
  // Get unique product IDs to fetch details
  const productIds = new Set<string>();
  for (const rel of allRelations) {
    // For outgoing, we need target details; for incoming, we need source details
    if (rel.sourceProductId === productId) {
      productIds.add(rel.targetProductId);
    } else {
      productIds.add(rel.sourceProductId);
    }
  }
  
  // Fetch product details
  const products = await db.priceEntry.findMany({
    where: {
      id: { in: Array.from(productIds) },
    },
  });
  
  const productMap = new Map(products.map(p => [p.id, p]));
  
  // Build result with resolved details
  const result: CompatibilityWithDetails[] = allRelations.map(rel => {
    const isOutgoing = rel.sourceProductId === productId;
    const relatedProductId = isOutgoing ? rel.targetProductId : rel.sourceProductId;
    const relatedProduct = productMap.get(relatedProductId);
    
    return {
      id: rel.id,
      relationType: rel.relationType as CompatibilityRelationType,
      note: rel.note,
      createdAt: rel.createdAt,
      createdBy: rel.createdBy,
      reference: relatedProduct?.reference ?? 'N/A',
      designation: relatedProduct?.designation ?? 'N/A',
      brand: relatedProduct?.brand ?? 'N/A',
      supplierName: relatedProduct?.supplierName ?? 'N/A',
      price: relatedProduct?.price ?? null,
      sourceProductId: rel.sourceProductId,
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
  const db = getPrisma();
  
  // Count outgoing relations by type
  const outgoingCounts = await db.productCompatibility.groupBy({
    by: ['relationType'],
    where: {
      sourceProductId: productId,
      isActive: true,
    },
    _count: true,
  });
  
  // Count incoming relations
  const incomingCount = await db.productCompatibility.count({
    where: {
      targetProductId: productId,
      isActive: true,
    },
  });
  
  // Build type breakdown
  const byType: Record<CompatibilityRelationType, number> = {
    EQUIVALENT: 0,
    SUBSTITUTE: 0,
    OEM_ALTERNATIVE: 0,
  };
  
  let outgoingTotal = 0;
  for (const group of outgoingCounts) {
    const type = group.relationType as CompatibilityRelationType;
    byType[type] = group._count;
    outgoingTotal += group._count;
  }
  
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
  const db = getPrisma();
  
  if (!query || query.trim().length < 2) {
    return [];
  }
  
  const searchTerm = query.trim();
  
  // Search active products excluding source
  const products = await db.priceEntry.findMany({
    where: {
      isActive: true,
      id: { not: sourceProductId },
      OR: [
        { reference: { contains: searchTerm } },
        { designation: { contains: searchTerm } },
        { brand: { contains: searchTerm } },
      ],
    },
    take: limit,
    orderBy: [
      { reference: 'asc' },
      { brand: 'asc' },
    ],
  });
  
  // Get existing relations for these products
  const productIds = products.map(p => p.id);
  const existingRelations = await db.productCompatibility.findMany({
    where: {
      sourceProductId,
      targetProductId: { in: productIds },
      isActive: true,
    },
    select: {
      targetProductId: true,
      relationType: true,
    },
  });
  
  const relationMap = new Map<string, CompatibilityRelationType>(
    existingRelations.map((r: { targetProductId: string; relationType: string }) => [
      r.targetProductId,
      r.relationType as CompatibilityRelationType,
    ])
  );
  
  // Build results
  return products.map((p): CompatibilitySearchResult => ({
    id: p.id,
    reference: p.reference,
    designation: p.designation,
    brand: p.brand,
    supplierName: p.supplierName,
    price: p.price,
    hasExistingRelation: relationMap.has(p.id),
    existingRelationType: relationMap.get(p.id),
  }));
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
  const db = getPrisma();
  
  const existing = await db.productCompatibility.findFirst({
    where: {
      sourceProductId,
      targetProductId,
      ...(relationType && { relationType }),
      isActive: true,
    },
  });
  
  return existing !== null;
}

/**
 * Get count of products that have at least one active compatibility relation.
 * Useful for statistics and discovery UI.
 * 
 * @returns Count of products with compatibilities
 */
export async function getProductsWithCompatibilitiesCount(): Promise<number> {
  const db = getPrisma();
  
  // Get distinct source product IDs with active relations
  const result = await db.productCompatibility.findMany({
    where: { isActive: true },
    select: { sourceProductId: true },
    distinct: ['sourceProductId'],
  });
  
  return result.length;
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
  const db = getPrisma();
  
  if (productIds.length === 0) {
    return new Map();
  }
  
  // Get all outgoing relations (where product is source)
  const outgoing = await db.productCompatibility.groupBy({
    by: ['sourceProductId'],
    where: {
      sourceProductId: { in: productIds },
      isActive: true,
    },
    _count: {
      id: true,
    },
  });
  
  // Get all incoming relations (where product is target)
  const incoming = await db.productCompatibility.groupBy({
    by: ['targetProductId'],
    where: {
      targetProductId: { in: productIds },
      isActive: true,
    },
    _count: {
      id: true,
    },
  });
  
  // Build the map combining both outgoing and incoming counts
  const countMap = new Map<string, number>();
  
  for (const item of outgoing) {
    countMap.set(item.sourceProductId, item._count.id);
  }
  
  for (const item of incoming) {
    const existingCount = countMap.get(item.targetProductId) || 0;
    countMap.set(item.targetProductId, existingCount + item._count.id);
  }
  
  return countMap;
}
