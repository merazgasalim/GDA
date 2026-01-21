import path from 'path';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';

// Mock electron.app.getPath to avoid requiring a real Electron runtime
vi.mock('electron', () => ({
  app: {
    getPath: (p: string) => {
      // return workspace root for userData to keep DB in repo during tests
      return path.resolve(__dirname, '..');
    }
  }
}));

describe('Import integration', () => {
  let dbService: any;

  beforeAll(async () => {
    dbService = await import('../src/main/services/database-service');
    await dbService.initializeDatabase();
  });

  afterAll(async () => {
    try {
      await dbService.closeDatabase();
    } catch (e) {
      // ignore
    }
  });

  it('inserts a batch with createdAt present', async () => {
    const entries = [
      {
        reference: 'TEST-REF-1',
        designation: 'Test product',
        brand: 'TestBrand',
        supplierName: 'TestSupplier',
        supplierPhone: null,
        price: 123.45,
        currency: 'DZD',
        entryDate: new Date(),
        arrivageDate: null,
        notes: null,
      },
    ];

    const operationId = 'test-op-' + Date.now();
    const res = await dbService.createEntriesBatchWithOperation(entries, operationId);
    expect(res).toBeDefined();
    expect(res.count).toBeGreaterThanOrEqual(1);
  });
});
