const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'data.sqlite'));
db.pragma('journal_mode = WAL');

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
