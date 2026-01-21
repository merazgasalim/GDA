const Database = require('better-sqlite3');
const path = require('path');
try {
  const dbPath = path.resolve(__dirname, '..', 'prisma', 'dev.db');
  const db = new Database(dbPath, { readonly: true });
  const total = db.prepare('select count(*) as c from PriceEntry').get();
  console.log('PriceEntry count:', total && total.c ? total.c : 0);
  const active = db.prepare('select count(*) as c from PriceEntry where isActive=1').get();
  console.log('Active PriceEntry count:', active && active.c ? active.c : 0);
  const sample = db.prepare('select id, reference, supplierName, price, entryDate from PriceEntry limit 5').all();
  console.log('Sample rows:', sample);
  db.close();
} catch (err) {
  console.error('DB check failed:', err && err.message ? err.message : err);
  process.exit(1);
}
