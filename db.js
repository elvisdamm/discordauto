const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Railway: usa Volume montado en /data. Local: usa data.sqlite junto al codigo.
// Permite override con DATABASE_PATH (ej: /data/data.sqlite)
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data.sqlite');
try { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); } catch {}
console.log(`[db] usando ${dbPath} (DATABASE_PATH=${process.env.DATABASE_PATH || 'default'})`);
let db;
try {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
} catch (e) {
  console.error(`[db] fallo abriendo ${dbPath}:`, e.message);
  throw e;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '',
    webhook_url TEXT NOT NULL,
    username TEXT,
    avatar_url TEXT,
    content TEXT,
    embeds TEXT NOT NULL DEFAULT '[]',
    scheduled_at TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_messages_status_time
    ON messages (status, scheduled_at);
`);

module.exports = db;
