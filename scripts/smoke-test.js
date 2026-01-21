const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { sql } = require('drizzle-orm');
const { eq, and } = require('drizzle-orm');
const { asc, desc } = require('drizzle-orm');
const path = require('path');

function getDbPath() {
  const dbPath = path.resolve(__dirname, '..', 'prisma', 'dev.db');
  return dbPath;
}

(async () => {
  try {
    const dbPath = getDbPath();
    console.log('Using DB:', dbPath);
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite);

    // Minimal schema references (only columns we use here)
    // We use raw SQL to avoid importing TypeScript schema
    const stats = await db.select({ count: sql`count(*)` }).from(sql`PriceEntry`).where({ isActive: 1 }).all();
    console.log('Stats count query result length:', stats.length);

    // Insert a supplier
    const supplierId = require('crypto').randomUUID();
    sqlite.prepare('INSERT INTO Supplier (id, name, phone, email, createdAt) VALUES (?,?,?,?, CURRENT_TIMESTAMP)').run(supplierId, 'SmokeSupplier', '12345', 's@ex.com');
    console.log('Inserted supplier', supplierId);

    // Insert a price entry
    const entryId = require('crypto').randomUUID();
    sqlite.prepare('INSERT INTO PriceEntry (id, reference, designation, brand, supplierName, supplierPhone, price, entryDate, operationId, isActive, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 1, CURRENT_TIMESTAMP)').run(entryId, 'REF-TEST', 'Test product', 'BrandX', 'SmokeSupplier', '12345', 100, entryId);
    console.log('Inserted price entry', entryId);

    // Query distinct supplier names (raw SQL)
    const rows = sqlite.prepare('SELECT DISTINCT supplierName as value FROM PriceEntry WHERE isActive = 1 ORDER BY supplierName ASC LIMIT 50').all();
    console.log('Distinct suppliers:', rows.map(r => r.value));

    // Get stats using raw SQL
    const total = sqlite.prepare('SELECT count(*) as c FROM PriceEntry WHERE isActive = 1').get();
    console.log('Total active entries:', total.c);

    process.exit(0);
  } catch (err) {
    console.error('Smoke test failed:', err);
    process.exit(1);
  }
})();
