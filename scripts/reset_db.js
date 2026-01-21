const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'prisma', 'dev.db');
const backupDir = path.resolve(__dirname, '..', 'prisma', 'backups');

try {
  if (!fs.existsSync(path.dirname(dbPath))) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  if (fs.existsSync(dbPath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `dev.db.${timestamp}.bak`);
    fs.renameSync(dbPath, backupPath);
    console.log('Backed up existing DB to', backupPath);
  } else {
    console.log('No existing DB found at', dbPath);
  }

  // Ensure DB file removed so app will recreate schema on next init
  if (fs.existsSync(dbPath)) {
    try { fs.unlinkSync(dbPath); } catch (e) { /* ignore */ }
  }

  console.log('prisma/dev.db removed. Start the app to create a fresh empty database.');
  process.exit(0);
} catch (err) {
  console.error('Failed to reset DB:', err && err.message ? err.message : err);
  process.exit(1);
}
