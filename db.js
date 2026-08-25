const fs = require('fs');
const path = require('path');

let rawPath = process.env.DATABASE_PATH || path.join(__dirname, 'data.sqlite');
let dbPath = rawPath;
try { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); } catch {}
console.log(`[db] intentando ${dbPath} (DATABASE_PATH=${process.env.DATABASE_PATH || 'default'})`);

const { spawnSync } = require('child_process');
let useJsFallback = false;
let nativeWorks = false;

// test nativo con timeout: si hace SIGSEGV/timeout, usamos fallback JS
try {
  const escaped = dbPath.replace(/'/g, "\\'");
  const r = spawnSync(process.execPath, ['-e', `const D=require('better-sqlite3'); const d=new D('${escaped}',{timeout:2000}); d.close(); console.log('ok')`], { timeout: 4000, encoding: 'utf8' });
  if (r.error || r.signal || r.status !== 0) {
    console.error(`[db] test nativo fallo (signal=${r.signal} status=${r.status}) ${r.stderr?.slice(0,200) || r.error || ''} -> fallback JS`);
    useJsFallback = true;
  } else {
    console.log('[db] test nativo ok');
    nativeWorks = true;
  }
} catch (e) {
  console.error('[db] test excepcion', e.message, '-> fallback JS');
  useJsFallback = true;
}

// si /data falla, probamos /tmp con mismo test antes de decidir fallback final
if (useJsFallback && dbPath.startsWith('/data')) {
  const tmpPath = path.join('/tmp', 'data.sqlite');
  try { fs.mkdirSync(path.dirname(tmpPath), { recursive: true }); } catch {}
  try {
    const esc2 = tmpPath.replace(/'/g, "\\'");
    const r2 = spawnSync(process.execPath, ['-e', `const D=require('better-sqlite3'); const d=new D('${esc2}',{timeout:2000}); d.close(); console.log('ok')`], { timeout: 4000, encoding: 'utf8' });
    if (!r2.error && !r2.signal && r2.status === 0) {
      console.log('[db] nativo funciona en /tmp, usando fallback a /tmp');
      dbPath = tmpPath;
      useJsFallback = false;
      nativeWorks = true;
      for (const s of ['-wal','-shm','-journal']) { try { if (fs.existsSync(dbPath+s)) fs.unlinkSync(dbPath+s); } catch {} }
    } else {
      console.error(`[db] nativo tambien falla en /tmp (signal=${r2.signal}) -> fallback JS puro`);
      useJsFallback = true;
    }
  } catch (e) {
    console.error('[db] test /tmp excepcion', e.message);
    useJsFallback = true;
  }
}

let db;
if (!useJsFallback && nativeWorks) {
  // --- intento nativo ---
  for (const s of ['-wal','-shm','-journal']) { try { if (fs.existsSync(dbPath+s)) { fs.unlinkSync(dbPath+s); console.log(`[db] limpiado ${s}`); } } catch {} }
  try {
    console.log('[db] creando Database nativo...');
    const Database = require('better-sqlite3');
    db = new Database(dbPath, { timeout: 5000 });
    console.log('[db] Database nativo creado, pragma WAL...');
    try { db.pragma('journal_mode = WAL'); console.log('[db] pragma WAL ok'); } catch (pe) { console.error('[db] pragma WAL fallo', pe.message); try { db.pragma('journal_mode = DELETE'); } catch {} }
    console.log('[db] exec schema nativo...');
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
      CREATE INDEX IF NOT EXISTS idx_messages_status_time ON messages (status, scheduled_at);
    `);
    console.log('[db] schema nativo ok');
  } catch (e) {
    console.error('[db] nativo fallo, pasando a JS fallback', e.stack || e.message);
    useJsFallback = true;
  }
}

if (useJsFallback || !db) {
  console.log('[db] usando fallback JS (JSON) en', dbPath + '.json');
  const jsonPath = dbPath + '.json';
  // ensure dir
  try { fs.mkdirSync(path.dirname(jsonPath), { recursive: true }); } catch {}
  let data = [];
  try {
    if (fs.existsSync(jsonPath)) data = JSON.parse(fs.readFileSync(jsonPath, 'utf8') || '[]');
    if (!Array.isArray(data)) data = [];
  } catch (e) { console.error('[db] json load fallo, reseteando', e.message); data = []; }
  const save = () => { try { fs.writeFileSync(jsonPath, JSON.stringify(data)); } catch (e) { console.error('[db] json save fallo', e.message); } };
  // helpers
  const toRow = (m) => ({
    id: m.id, label: m.label, webhook_url: m.webhook_url, username: m.username, avatar_url: m.avatar_url,
    content: m.content, embeds: m.embeds, scheduled_at: m.scheduled_at, timezone: m.timezone,
    status: m.status, error: m.error, created_at: m.created_at, sent_at: m.sent_at
  });
  db = {
    pragma() { return; },
    exec(sql) {
      // solo asegura archivo existe
      if (!fs.existsSync(jsonPath)) save();
      console.log('[db-js] exec (noop)');
    },
    prepare(sql) {
      const s = sql.replace(/\s+/g, ' ').trim();
      // SELECT all ordered
      if (s.includes('SELECT * FROM messages ORDER BY scheduled_at ASC')) {
        return { all: () => [...data].sort((a,b)=> new Date(a.scheduled_at) - new Date(b.scheduled_at)).map(toRow), get:()=>null, run:()=>{} };
      }
      if (s.includes("SELECT * FROM messages WHERE status = 'pending' AND scheduled_at <=")) {
        return { all: (now) => data.filter(r=> r.status==='pending' && r.scheduled_at <= now).map(toRow), get:()=>null, run:()=>{} };
      }
      if (s.includes('SELECT * FROM messages WHERE id =')) {
        return {
          get: (id) => { const r=data.find(x=>x.id===id); return r?toRow(r):undefined; },
          all: (id) => { const r=data.find(x=>x.id===id); return r?[toRow(r)]:[]; },
          run:()=>{}
        };
      }
      if (s.startsWith('INSERT INTO messages')) {
        return {
          run: (p) => {
            const row = { id: p.id, label: p.label||'', webhook_url: p.webhook_url, username: p.username||null, avatar_url: p.avatar_url||null, content: p.content||null, embeds: p.embeds||'[]', scheduled_at: p.scheduled_at, timezone: p.timezone||'UTC', status: 'pending', error: null, created_at: p.created_at, sent_at: null };
            data.push(row); save(); return { changes:1 };
          }, get:()=>null, all:()=>[]
        };
      }
      if (s.startsWith('UPDATE messages SET') && s.includes('WHERE id = @id')) {
        return {
          run: (p) => {
            const r=data.find(x=>x.id===p.id); if(!r) return {changes:0};
            Object.assign(r, { label: p.label??r.label, webhook_url: p.webhook_url??r.webhook_url, username: p.username??r.username, avatar_url: p.avatar_url??r.avatar_url, content: p.content??r.content, embeds: p.embeds??r.embeds, scheduled_at: p.scheduled_at??r.scheduled_at, timezone: p.timezone??r.timezone }); save(); return {changes:1};
          }, get:()=>null, all:()=>[]
        };
      }
      if (s.includes("UPDATE messages SET status = 'cancelled' WHERE id =")) {
        return { run: (id) => { const r=data.find(x=>x.id===id); if(r){ r.status='cancelled'; save(); } return {changes:r?1:0}; }, get:()=>null, all:()=>[] };
      }
      if (s.includes("UPDATE messages SET status = 'pending', error = NULL, scheduled_at =")) {
        return { run: (newTime, id) => { const r=data.find(x=>x.id===id); if(r){ r.status='pending'; r.error=null; r.scheduled_at=newTime; save(); } return {changes:r?1:0}; }, get:()=>null, all:()=>[] };
      }
      if (s.includes("UPDATE messages SET status = 'sent', sent_at =")) {
        return { run: (now, id) => { const r=data.find(x=>x.id===id); if(r){ r.status='sent'; r.sent_at=now; r.error=null; save(); } return {changes:r?1:0}; }, get:()=>null, all:()=>[] };
      }
      if (s.includes("UPDATE messages SET status = 'failed', error =")) {
        return { run: (err, id) => { const r=data.find(x=>x.id===id); if(r){ r.status='failed'; r.error=err; save(); } return {changes:r?1:0}; }, get:()=>null, all:()=>[] };
      }
      if (s.startsWith('DELETE FROM messages WHERE id =')) {
        return { run: (id) => { const i=data.findIndex(x=>x.id===id); if(i>=0){ data.splice(i,1); save(); return {changes:1}; } return {changes:0}; }, get:()=>null, all:()=>[] };
      }
      // fallback generico
      return { run:()=>({changes:0}), get:()=>null, all:()=>[] };
    }
  };
  console.log('[db] fallback JS listo,', data.length, 'mensajes cargados');
}

module.exports = db;
