const cron = require('node-cron');
const fetch = require('node-fetch');
const db = require('./db');

async function dispatchMessage(row) {
  const payload = {};
  if (row.content) payload.content = row.content;
  if (row.username) payload.username = row.username;
  if (row.avatar_url) payload.avatar_url = row.avatar_url;

  const embeds = JSON.parse(row.embeds || '[]');
  if (embeds.length) payload.embeds = embeds;

  const res = await fetch(row.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord respondio ${res.status}: ${text.slice(0, 300)}`);
  }
}

async function runOnce() {
  const now = new Date().toISOString();
  const due = db
    .prepare(`SELECT * FROM messages WHERE status = 'pending' AND scheduled_at <= ?`)
    .all(now);

  for (const row of due) {
    try {
      await dispatchMessage(row);
      db.prepare(
        `UPDATE messages SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?`
      ).run(new Date().toISOString(), row.id);
      console.log(`[scheduler] enviado: ${row.id} (${row.label || 'sin etiqueta'})`);
    } catch (err) {
      db.prepare(
        `UPDATE messages SET status = 'failed', error = ? WHERE id = ?`
      ).run(String(err.message || err), row.id);
      console.error(`[scheduler] fallo al enviar ${row.id}:`, err.message || err);
    }
  }
}

function start() {
  // Revisa cada 30 segundos
  cron.schedule('*/30 * * * * *', () => {
    runOnce().catch((err) => console.error('[scheduler] error en ciclo:', err));
  });
  console.log('[scheduler] activo, revisando cada 30s');
}

module.exports = { start, runOnce, dispatchMessage };
