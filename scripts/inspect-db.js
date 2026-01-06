const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'prisma', 'dev.db');
try {
  const db = new Database(dbPath, { readonly: true });
  const cols = db.prepare("PRAGMA table_info('ProductCompatibility')").all();
  console.log(JSON.stringify(cols, null, 2));
  db.close();
} catch (err) {
  console.error('Failed to read DB:', err.message);
  process.exit(2);
}
