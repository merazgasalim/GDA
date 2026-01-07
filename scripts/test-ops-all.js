const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

async function createOperation(db, opts) {
  const id = crypto.randomUUID();
  await db.operationLog.create({ data: {
    id,
    operationType: opts.type,
    payloadSnapshot: JSON.stringify(opts.payload || {}),
    status: 'APPLIED',
    createdBy: opts.createdBy || 'test-script',
    type: opts.type,
    legacyStatus: opts.legacyStatus || 'PENDING',
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
    description: opts.description || null,
    rowCount: 0,
  } });
  return id;
}

async function completeOp(db, id) {
  const count = await db.priceEntry.count({ where: { operationId: id } });
  await db.operationLog.update({ where: { id }, data: { legacyStatus: 'COMPLETED', completedAt: new Date(), rowCount: count } });
}

async function abandonOp(db, id) {
  const t = new Date();
  await db.$transaction(async (tx) => {
    const updateResult = await tx.priceEntry.updateMany({ where: { operationId: id, isActive: true }, data: { isActive: false, abandonedAt: t } });
    await tx.operationLog.update({ where: { id }, data: { status: 'ABANDONED', legacyStatus: 'ABANDONED', abandonedAt: t, abandonedBy: 'test-script' } });
    const abandonEventId = crypto.randomUUID();
    await tx.operationLog.create({ data: {
      id: abandonEventId,
      operationType: 'BULK_DELETE',
      type: 'BULK_DELETE',
      status: 'ABANDONED',
      legacyStatus: 'COMPLETED',
      completedAt: t,
      rowCount: updateResult.count,
      createdBy: 'test-script',
      description: `Abandoned operation: ${id}`,
      abandonedOperationId: id,
      metadata: JSON.stringify({ originalRowCount: updateResult.count }),
      payloadSnapshot: JSON.stringify({ originalRowCount: updateResult.count }),
      revertOperationId: id,
    } });
  });
}

async function runAll() {
  const db = new PrismaClient();
  await db.$connect();
  try {
    console.log('\n-- PriceEntry import flow (single) --');
    const op1 = await createOperation(db, { type: 'IMPORT', payload: { source: 'clipboard' } });
    const pe1 = await db.priceEntry.create({ data: {
      reference: 'REF-ALL-1', designation: 'All Test 1', brand: 'BrandA', supplierName: 'SupplierA', supplierPhone: '123', price: 10.5, currency: 'EUR', entryDate: new Date(), createdBy: 'test-script', operationId: op1, isActive: true,
    } });
    console.log('Created PriceEntry', pe1.id);
    await completeOp(db, op1);
    console.log('Completed op', op1);

    console.log('\n-- Supplier create flow --');
    const op2 = await createOperation(db, { type: 'SUPPLIER_CREATE', payload: { name: 'SupplierX' } });
    const supplier = await db.supplier.create({ data: {
      name: 'SupplierX', address: '123 Test St', website: null, createdBy: 'test-script', operationId: op2,
      contacts: { create: [ { type: 'PHONE', channel: 'REGULAR', value: '0555123456', isPrimary: true }, { type: 'EMAIL', value: 'supx@example.com', isPrimary: false } ] },
    }, include: { contacts: true } });
    console.log('Created Supplier', supplier.id, 'contacts', supplier.contacts.length);
    await completeOp(db, op2);

    console.log('\n-- Internal compatibility flow --');
    const op3 = await createOperation(db, { type: 'COMPATIBILITY_ADD', payload: { relation: 'internal' } });
    // create two price entries to link
    const pA = await db.priceEntry.create({ data: { reference: 'SRC-1', designation: 'Src', brand: 'B1', supplierName: 'S1', price: 5.0, currency: 'EUR', createdBy: 'test-script', operationId: op3, isActive: true } });
    const pB = await db.priceEntry.create({ data: { reference: 'TGT-1', designation: 'Tgt', brand: 'B1', supplierName: 'S2', price: 6.0, currency: 'EUR', createdBy: 'test-script', operationId: op3, isActive: true } });
    const compat = await db.productCompatibility.create({ data: {
      sourceProductId: pA.id,
      targetType: 'INTERNAL',
      targetProductId: pB.id,
      relationType: 'EQUIVALENT',
      note: 'Test internal compat',
      operationId: op3,
    } });
    console.log('Created internal compatibility', compat.id);
    await completeOp(db, op3);

    console.log('\n-- External reference & compatibility flow --');
    const op4 = await createOperation(db, { type: 'COMPATIBILITY_ADD', payload: { relation: 'external' } });
    const ext = await db.externalProductReference.create({ data: {
      reference: 'EXT-REF-1', designation: 'External Item', brand: 'ExtBrand', notes: 'from vendor', createdBy: 'test-script', operationId: op4,
    } });
    const compatExt = await db.productCompatibility.create({ data: {
      sourceProductId: pe1.id,
      targetType: 'EXTERNAL',
      externalReferenceId: ext.id,
      relationType: 'SUBSTITUTE',
      note: 'External substitute',
      operationId: op4,
    } });
    console.log('Created external reference', ext.id, 'and compat', compatExt.id);
    await completeOp(db, op4);

    console.log('\n-- Pending operation finalize/abandon checks --');
    const op5 = await createOperation(db, { type: 'IMPORT', payload: { source: 'pending-test' }, legacyStatus: 'PENDING' });
    await db.priceEntry.create({ data: { reference: 'PEND-1', designation: 'Pending', brand: 'B', supplierName: 'S', price: 1, currency: 'EUR', createdBy: 'test-script', operationId: op5, isActive: true } });
    // Check pending operations
    const pending = await db.operationLog.findMany({ where: { legacyStatus: 'PENDING' }, select: { id: true, metadata: true } });
    console.log('Pending ops count (legacyStatus=PENDING):', pending.length);
    // finalize pending
    await db.operationLog.update({ where: { id: op5 }, data: { legacyStatus: 'COMPLETED', completedAt: new Date() } });
    console.log('Finalized pending operation', op5);

    // create another pending and then abandon
    const op6 = await createOperation(db, { type: 'IMPORT', payload: { source: 'pend-abandon' }, legacyStatus: 'PENDING' });
    await db.priceEntry.create({ data: { reference: 'PEND-2', designation: 'Pending2', brand: 'B', supplierName: 'S', price: 2, currency: 'EUR', createdBy: 'test-script', operationId: op6, isActive: true } });
    await abandonOp(db, op6);
    console.log('Abandoned pending op', op6);

    console.log('\n-- Summary Counts --');
    const ops = await db.operationLog.count();
    const activeEntries = await db.priceEntry.count({ where: { isActive: true } });
    console.log('Total operations:', ops, 'Active entries:', activeEntries);

  } catch (err) {
    console.error('Error in test-ops-all:', err);
  } finally {
    await db.$disconnect();
  }
}

runAll();
