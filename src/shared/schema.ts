export const operationLog = sqliteTable('OperationLog', {
  id: text('id').primaryKey(),
  operationType: text('operationType'),
  entityType: text('entityType'),
  entityId: text('entityId'),
  payloadSnapshot: text('payloadSnapshot'),
  status: text('status'),
  createdBy: text('createdBy'),
  createdAt: text('createdAt'),
  type: text('type'),
  legacyStatus: text('legacyStatus'),
  metadata: text('metadata'),
  description: text('description'),
  rowCount: integer('rowCount'),
  completedAt: text('completedAt'),
  abandonedAt: text('abandonedAt'),
  abandonedBy: text('abandonedBy'),
  revertOperationId: text('revertOperationId'),
  abandonedOperationId: text('abandonedOperationId'),
});

export const productCompatibility = sqliteTable('ProductCompatibility', {
  id: text('id').primaryKey(),
  sourceProductId: text('sourceProductId'),
  targetType: text('targetType'),
  targetProductId: text('targetProductId'),
  externalReferenceId: text('externalReferenceId'),
  relationType: text('relationType'),
  note: text('note'),
  isActive: integer('isActive', { mode: 'boolean' }).default(true),
  createdAt: text('createdAt'),
  createdBy: text('createdBy'),
  deactivatedAt: text('deactivatedAt'),
  deactivatedBy: text('deactivatedBy'),
  operationId: text('operationId'),
});

export const supplier = sqliteTable('Supplier', {
  id: text('id').primaryKey(),
  name: text('name'),
  address: text('address'),
  website: text('website'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
  operationId: text('operationId'),
});

export const supplierContact = sqliteTable('SupplierContact', {
  id: text('id').primaryKey(),
  supplierId: text('supplierId'),
  type: text('type'),
  channel: text('channel'),
  value: text('value'),
  isPrimary: integer('isPrimary', { mode: 'boolean' }).default(false),
  createdAt: text('createdAt'),
});

export const externalProductReference = sqliteTable('ExternalProductReference', {
  id: text('id').primaryKey(),
  reference: text('reference'),
  designation: text('designation'),
  brand: text('brand'),
  notes: text('notes'),
  createdBy: text('createdBy'),
  operationId: text('operationId'),
  isActive: integer('isActive', { mode: 'boolean' }).default(true),
  createdAt: text('createdAt'),
  deactivatedAt: text('deactivatedAt'),
  deactivatedBy: text('deactivatedBy'),
});

export const importLog = sqliteTable('ImportLog', {
  id: text('id').primaryKey(),
  batchId: text('batchId'),
  rowCount: integer('rowCount'),
  importedAt: text('importedAt'),
  rawPreview: text('rawPreview'),
  status: text('status'),
  errorMessage: text('errorMessage'),
});
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const priceEntry = sqliteTable('PriceEntry', {
  id: text('id').primaryKey(),
  reference: text('reference').notNull(),
  designation: text('designation').notNull(),
  brand: text('brand').notNull(),
  supplierName: text('supplierName'),
  supplierPhone: text('supplierPhone'),
  price: real('price').notNull(),
  currency: text('currency').default('DZD'),
  entryDate: text('entryDate').notNull(),
  arrivageDate: text('arrivageDate'),
  notes: text('notes'),
  importBatchId: text('importBatchId'),
  createdAt: text('createdAt').notNull(),
  createdBy: text('createdBy').default('local'),
  operationId: text('operationId').notNull(),
  isActive: integer('isActive', { mode: 'boolean' }).default(true),
  abandonedAt: text('abandonedAt'),
});
