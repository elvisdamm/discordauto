const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Railway: usa Volume montado en /data. Local: usa data.sqlite junto al codigo.
// Permite override con DATABASE_PATH (ej: /data/data.sqlite)
let rawPath = process.env.DATABASE_PATH || path.join(__dirname, 'data.sqlite');
let dbPath = rawPath;
try { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); } catch {}
console.log(`[db] intentando ${dbPath} (DATABASE_PATH=${process.env.DATABASE_PATH || 'default'})`);
// test rapido de apertura con timeout para detectar hang en volume de red (Railway)
const { spawnSync } = require('child_process');
let needFallback = false;
if (dbPath.startsWith('/data')) {
  try {
    const escaped = dbPath.replace(/'/g, "\\'");
    const r = spawnSync(process.execPath, ['-e', `const D=require('better-sqlite3'); const d=new D('${escaped}',{timeout:2000}); d.close(); console.log('ok')`], { timeout: 4000, encoding: 'utf8' });
    if (r.error || r.signal === 'SIGTERM' || r.status !== 0) {
      console.error(`[db] test apertura fallo/timeout en ${dbPath}:`, r.error || r.stderr?.slice(0,200) || `signal ${r.signal} status ${r.status}`, '-> fallback /tmp');
      needFallback = true;
    } else {
      console.log('[db] test apertura ok en volume');
    }
  } catch (e) {
    console.error('[db] test apertura excepcion', e.message, '-> fallback');
    needFallback = true;
  }
}
if (needFallback) {
  dbPath = path.join('/tmp', 'data.sqlite');
  try { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); } catch {}
  console.log(`[db] fallback a ${dbPath} (ephemeral, sin persistencia en Volume)`);
} else {
  console.log(`[db] usando ${dbPath}`);
}
// limpia WAL stale que puede bloquear en volumes de red (Railway)
for (const suffix of ['-wal', '-shm', '-journal']) {
  try { if (fs.existsSync(dbPath + suffix)) { fs.unlinkSync(dbPath + suffix); console.log(`[db] limpiado ${suffix}`); } } catch {}
}
let db;
try {
  console.log('[db] creando Database...');
  // timeout evita hang en NFS/volume, readonly false
  db = new Database(dbPath, { timeout: 5000, verbose: null });
  console.log('[db] Database creado, pragma WAL...');
  try { db.pragma('journal_mode = WAL'); console.log('[db] pragma WAL ok'); } catch (pe) { console.error('[db] pragma WAL fallo, probando DELETE', pe.message); try { db.pragma('journal_mode = DELETE'); console.log('[db] pragma DELETE ok'); } catch {} }
  console.log('[db] exec schema...');
} catch (e) {
  console.error(`[db] fallo abriendo ${dbPath}:`, e.stack || e.message);
  throw e;
}

try {
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
  console.log('[db] schema ok');
} catch (e) {
  console.error('[db] exec schema fallo', e.stack || e);
  throw e;
}

module.exports = db;
