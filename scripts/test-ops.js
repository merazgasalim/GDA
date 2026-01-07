const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

async function run() {
  const db = new PrismaClient();
  await db.$connect();

  try {
    // 1. Create a PENDING operation (legacyStatus kept for compatibility)
    const operationId = crypto.randomUUID();
    console.log('Creating operation', operationId);
    await db.operationLog.create({
      data: {
        id: operationId,
        operationType: 'IMPORT',
        payloadSnapshot: JSON.stringify({ test: true }),
        status: 'APPLIED',
        createdBy: 'test-script',
        type: 'IMPORT',
        legacyStatus: 'PENDING',
        metadata: JSON.stringify({ source: 'test' }),
        description: 'Test operation from script',
        rowCount: 0,
      },
    });

    // 2. Create a PriceEntry attached to the operation
    const price = await db.priceEntry.create({
      data: {
        reference: 'TEST-REF',
        designation: 'Test Item',
        brand: 'TestBrand',
        supplierName: 'Test Supplier',
        supplierPhone: '000',
        price: 123.45,
        currency: 'EUR',
        entryDate: new Date(),
        arrivageDate: new Date(),
        notes: 'Created by test script',
        importBatchId: null,
        createdAt: new Date(),
        createdBy: 'test-script',
        operationId: operationId,
        isActive: true,
      },
    });
    console.log('Created PriceEntry', price.id);

    // 3. Complete the operation (update legacyStatus and rowCount)
    const count = await db.priceEntry.count({ where: { operationId } });
    await db.operationLog.update({ where: { id: operationId }, data: { legacyStatus: 'COMPLETED', completedAt: new Date(), rowCount: count } });
    console.log('Completed operation', operationId, 'rowCount', count);

    // 4. Query incomplete operations (should not include our completed op)
    const pending = await db.operationLog.findMany({ where: { status: 'PENDING' }, select: { id: true, type: true, rowCount: true, createdAt: true, description: true } });
    console.log('Pending operations count (status=PENDING):', pending.length);

    // 5. Abandon the operation using a transaction similar to abandonOperation
    console.log('Abandoning operation', operationId);
    const abandonTimestamp = new Date();
    const result = await db.$transaction(async (tx) => {
      const updateResult = await tx.priceEntry.updateMany({ where: { operationId, isActive: true }, data: { isActive: false, abandonedAt: abandonTimestamp } });
      await tx.operationLog.update({ where: { id: operationId }, data: { status: 'ABANDONED', legacyStatus: 'ABANDONED', abandonedAt: abandonTimestamp, abandonedBy: 'test-script' } });
      const abandonEventId = crypto.randomUUID();
      await tx.operationLog.create({ data: {
        id: abandonEventId,
        operationType: 'BULK_DELETE',
        type: 'BULK_DELETE',
        status: 'ABANDONED',
        legacyStatus: 'COMPLETED',
        completedAt: abandonTimestamp,
        rowCount: updateResult.count,
        createdBy: 'test-script',
        description: `Abandoned operation: ${operationId}`,
        abandonedOperationId: operationId,
        metadata: JSON.stringify({ abandonedOperationType: 'IMPORT' }),
        payloadSnapshot: JSON.stringify({ abandonedOperationType: 'IMPORT' }),
        revertOperationId: operationId,
      } });
      return updateResult.count;
    });

    console.log('Abandoned affected rows:', result);

    // 6. Verify priceEntry is inactive
    const activeCount = await db.priceEntry.count({ where: { operationId, isActive: true } });
    console.log('Active rows for operation after abandon:', activeCount);

  } catch (err) {
    console.error('Test script error:', err);
  } finally {
    await db.$disconnect();
  }
}

run();
