const Database = require('better-sqlite3');
const path = require('path');

function inspect(dbPath, table) {
  console.log('Inspecting:', dbPath);
  try {
    const db = new Database(dbPath, { readonly: true });
    const cols = db.prepare(`PRAGMA table_info('${table}')`).all();
    console.log(JSON.stringify(cols, null, 2));
    db.close();
  } catch (err) {
    console.error('Failed to read DB:', dbPath, err.message);
  }
}

const runtimeDb = path.join(process.env.APPDATA || '', 'Gestion des Arrivages', 'data', 'dev.db');
const workspaceDb = path.join(__dirname, '..', 'prisma', 'dev.db');

inspect(runtimeDb, 'PriceEntry');
inspect(workspaceDb, 'PriceEntry');
