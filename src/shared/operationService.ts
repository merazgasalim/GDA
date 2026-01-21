import { db } from './drizzle';
import { operationLog, priceEntry, supplier, productCompatibility, externalProductReference, supplierContact } from './schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// Drizzle ORM is initialized in shared/drizzle.ts and imported as db

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
  // Insert operation log using Drizzle
  const id = uuidv4();
  await db.insert(operationLog).values({
    id,
    operationType: options.operationType,
    entityType: options.entityType ?? null,
    entityId: options.entityId ?? null,
    payloadSnapshot: JSON.stringify(options.payload),
    status: 'APPLIED',
    createdBy: options.createdBy ?? 'system',
    type: options.operationType as any,
    legacyStatus: 'PENDING',
    rowCount: 0,
    createdAt: new Date().toISOString(),
  }).run();
  return id;
}

// Helper to perform transactional creation following the enforced sequence
async function transactionCreate<T>(
  operationType: OperationType,
  entityType: EntityType,
  payload: any,
  createdBy: string | undefined,
  createEntityFn: (tx: any, operationId: string) => Promise<T>
) {
  if (!payload) throw new Error('payload_snapshot is required');
  // Perform a Drizzle transaction and provide a lightweight shim that
  // supports the minimal `{table}.create({ data })` / `update` / `delete`
  // calls used by legacy helpers during the migration.
  return db.transaction(async (tx: any) => {
    const operationId = uuidv4();

    // Insert operation log record inside the transaction
    await tx.insert(operationLog).values({
      id: operationId,
      operationType,
      entityType: entityType ?? null,
      entityId: payload?.entityId ?? null,
      payloadSnapshot: JSON.stringify(payload),
      status: 'APPLIED',
      createdBy: createdBy ?? 'system',
      type: operationType as any,
      legacyStatus: 'PENDING',
      rowCount: 0,
      createdAt: new Date().toISOString(),
    }).run();

    // Table lookup for shim
    const tableMap: Record<string, any> = {
      priceEntry,
      supplier,
      productCompatibility,
      externalProductReference,
      supplierContact,
    };

    const txShim = new Proxy({}, {
      get(_, prop: string) {
        const table = tableMap[prop as string];
        if (!table) {
          throw new Error(`Unknown table via tx.${String(prop)}`);
        }
        return {
          create: async ({ data }: { data: any }) => {
            if (!data) throw new Error('create requires data');
            if (!data.id) data.id = uuidv4();
            await tx.insert(table).values(data).run();
            return data;
          },
          update: async ({ where, data }: { where: any; data: any }) => {
            if (!where || !where.id) throw new Error('update currently requires where.id');
            await tx.update(table).set(data).where(eq((table as any).id, where.id)).run();
            return { ...where, ...data };
          },
          delete: async ({ where }: { where: any }) => {
            if (!where || !where.id) throw new Error('delete currently requires where.id');
            await tx.delete(table).where(eq((table as any).id, where.id)).run();
            return { ...where };
          }
        };
      }
    });

    // Call user-provided create function with shim and operationId
    const result = await createEntityFn(txShim, operationId);

    // Optionally update operation log rowCount if result suggests rows created
    try {
      const rowCount = (result && (result as any).length) ? (result as any).length : 1;
      await tx.update(operationLog).set({ rowCount }).where(eq(operationLog.id, operationId)).run();
    } catch (e) {
      // swallow; non-critical
    }

    return result;
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
