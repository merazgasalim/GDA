import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type OperationType =
  | 'PRODUCT_CREATE'
  | 'SUPPLIER_CREATE'
  | 'INTERNAL_REFERENCE_CREATE'
  | 'EXTERNAL_REFERENCE_CREATE'
  | 'SYSTEM_MIGRATE'
  | string;

type EntityType = 'PRODUCT' | 'SUPPLIER' | 'EXTERNAL_REFERENCE' | string;

// Centralized operation creation - creates immutable payload snapshot and returns operation id
export async function createOperationLog(options: {
  operationType: OperationType;
  entityType?: EntityType;
  entityId?: string | null;
  payload: any;
  createdBy?: string;
}) {
  if (!options.payload) throw new Error('payload_snapshot is required');
  const op = await prisma.operationLog.create({
    data: {
      id: undefined as any,
      operationType: options.operationType,
      entityType: options.entityType ?? null,
      entityId: options.entityId ?? null,
      payloadSnapshot: JSON.stringify(options.payload),
      status: 'APPLIED',
      createdBy: options.createdBy ?? 'system'
    }
  });
  return op.id;
}

// Helper to perform transactional creation following the enforced sequence
async function transactionCreate<T>(
  operationType: OperationType,
  entityType: EntityType,
  payload: any,
  createdBy: string | undefined,
  createEntityFn: (tx: PrismaClient, operationId: string) => Promise<T>
) {
  if (!payload) throw new Error('payload_snapshot is required');
  return await prisma.$transaction(async (tx) => {
    // 1) create operation log
    const operation = await tx.operationLog.create({ data: ({
      operationType,
      entityType,
      entityId: null,
      payloadSnapshot: JSON.stringify(payload),
      status: 'APPLIED',
      createdBy: createdBy ?? 'system'
    } as any) });

    const operationId = operation.id;

    // 2) call entity creation function, which must attach operationId to created row
    const entity = await createEntityFn(tx as unknown as PrismaClient, operationId);

    // 3) ensure created entity has an id and set operation.entityId if missing
    const entityId = (entity && (entity as any).id) || null;
    if (!entityId) {
      throw new Error('Entity creation did not return an id — aborting transaction');
    }

    // 4) update operation to point to entityId
    await tx.operationLog.update({ where: { id: operationId }, data: ({ entityId } as any) });

    return { operationId, entity };
  });
}

// Public helpers for domain operations
export async function createProduct(payload: any, createdBy?: string) {
  // validation should be done by caller; minimal guard here
  return transactionCreate('PRODUCT_CREATE', 'PRODUCT', payload, createdBy, async (tx, operationId) => {
    // validate required fields
    if (!payload.reference) throw new Error('Product reference required');

    const created = await tx.priceEntry.create({ data: ({
      reference: payload.reference,
      designation: payload.designation ?? '',
      brand: payload.brand ?? '',
      supplierName: payload.supplierName ?? '',
      supplierPhone: payload.supplierPhone ?? null,
      price: payload.price ?? 0,
      currency: payload.currency ?? 'DZD',
      entryDate: payload.entryDate ?? new Date(),
      arrivageDate: payload.arrivageDate ?? null,
      notes: payload.notes ?? null,
      importBatchId: payload.importBatchId ?? null,
      createdAt: payload.createdAt ?? new Date(),
      createdBy: payload.createdBy ?? createdBy ?? 'local',
      operationId
    } as any) });
    return created;
  });
}

export async function createSupplier(payload: any, createdBy?: string) {
  return transactionCreate('SUPPLIER_CREATE', 'SUPPLIER', payload, createdBy, async (tx, operationId) => {
    if (!payload.name) throw new Error('Supplier name required');
    if (!payload.address) throw new Error('Supplier address required');

    const created = await tx.supplier.create({ data: ({
      name: payload.name,
      address: payload.address,
      website: payload.website ?? null,
      createdAt: payload.createdAt ?? new Date(),
      createdBy: payload.createdBy ?? createdBy ?? 'local',
      operationId
    } as any) });
    return created;
  });
}

export async function createInternalReference(payload: any, createdBy?: string) {
  return transactionCreate('INTERNAL_REFERENCE_CREATE', 'PRODUCT', payload, createdBy, async (tx, operationId) => {
    // Create a ProductCompatibility row for internal target
    if (!payload.sourceProductId || !payload.targetProductId) throw new Error('sourceProductId and targetProductId required');
    if (payload.sourceProductId === payload.targetProductId) throw new Error('source and target must differ');

    const created = await tx.productCompatibility.create({ data: ({
      sourceProductId: payload.sourceProductId,
      targetType: 'INTERNAL',
      targetProductId: payload.targetProductId,
      relationType: payload.relationType ?? 'EQUIVALENT',
      note: payload.note ?? null,
      isActive: true,
      createdAt: payload.createdAt ?? new Date(),
      createdBy: payload.createdBy ?? createdBy ?? 'local',
      operationId
    } as any) });
    return created;
  });
}

export async function createExternalReference(payload: any, createdBy?: string) {
  return transactionCreate('EXTERNAL_REFERENCE_CREATE', 'EXTERNAL_REFERENCE', payload, createdBy, async (tx, operationId) => {
    if (!payload.reference || !payload.brand) throw new Error('reference and brand required');

    const external = await tx.externalProductReference.create({ data: ({
      reference: payload.reference,
      designation: payload.designation ?? '',
      brand: payload.brand,
      notes: payload.notes ?? null,
      createdAt: payload.createdAt ?? new Date(),
      createdBy: payload.createdBy ?? createdBy ?? 'system',
      isActive: true,
      operationId
    } as any) });

    // also create compatibility row linking source -> external reference if requested
    if (payload.sourceProductId) {
      await tx.productCompatibility.create({ data: ({
        sourceProductId: payload.sourceProductId,
        targetType: 'EXTERNAL',
        externalReferenceId: external.id,
        relationType: payload.relationType ?? 'EQUIVALENT',
        note: payload.note ?? null,
        isActive: true,
        createdAt: new Date(),
        createdBy: payload.createdBy ?? createdBy ?? 'local',
        operationId
      } as any) });
    }

    return external;
  });
}

// Safety guard: used by services that may directly persist domain objects
export function assertOperationAttached(entity: any) {
  if (!entity || !entity.operationId) throw new Error('Entity save attempted without operationId');
}

export default {
  createOperationLog,
  createProduct,
  createSupplier,
  createInternalReference,
  createExternalReference,
  assertOperationAttached
};
