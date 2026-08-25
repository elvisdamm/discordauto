const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fetch = require('node-fetch');
const db = require('./db');
const scheduler = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function rowToApi(row) {
  return {
    id: row.id,
    label: row.label,
    webhookUrl: row.webhook_url,
    username: row.username,
    avatarUrl: row.avatar_url,
    content: row.content,
    embeds: JSON.parse(row.embeds || '[]'),
    scheduledAt: row.scheduled_at,
    timezone: row.timezone,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    sentAt: row.sent_at
  };
}

function validatePayload(body) {
  const errors = [];
  if (!body.webhookUrl || !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(body.webhookUrl)) {
    errors.push('webhookUrl debe ser una URL de webhook de Discord valida.');
  }
  if (!body.content && (!body.embeds || body.embeds.length === 0)) {
    errors.push('El mensaje necesita contenido de texto o al menos un embed.');
  }
  if (!body.scheduledAt || isNaN(Date.parse(body.scheduledAt))) {
    errors.push('scheduledAt debe ser una fecha/hora valida.');
  }
  if (body.embeds && body.embeds.length > 10) {
    errors.push('Discord permite un maximo de 10 embeds por mensaje.');
  }
  return errors;
}

// Listar todos los mensajes (mas proximos primero)
app.get('/api/messages', (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM messages ORDER BY scheduled_at ASC`)
    .all();
  res.json(rows.map(rowToApi));
});

// Crear un mensaje programado
app.post('/api/messages', (req, res) => {
  const errors = validatePayload(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO messages (id, label, webhook_url, username, avatar_url, content, embeds, scheduled_at, timezone, status, created_at)
    VALUES (@id, @label, @webhook_url, @username, @avatar_url, @content, @embeds, @scheduled_at, @timezone, 'pending', @created_at)
  `).run({
    id,
    label: req.body.label || '',
    webhook_url: req.body.webhookUrl,
    username: req.body.username || null,
    avatar_url: req.body.avatarUrl || null,
    content: req.body.content || null,
    embeds: JSON.stringify(req.body.embeds || []),
    scheduled_at: new Date(req.body.scheduledAt).toISOString(),
    timezone: req.body.timezone || 'UTC',
    created_at: now
  });

  const row = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id);
  res.status(201).json(rowToApi(row));
});

// Editar un mensaje (solo si sigue pendiente)
app.put('/api/messages/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ errors: ['Mensaje no encontrado.'] });
  if (existing.status !== 'pending') {
    return res.status(409).json({ errors: ['Solo se pueden editar mensajes pendientes.'] });
  }

  const errors = validatePayload(req.body);
  if (errors.length) return res.status(400).json({ errors });

  db.prepare(`
    UPDATE messages SET
      label = @label,
      webhook_url = @webhook_url,
      username = @username,
      avatar_url = @avatar_url,
      content = @content,
      embeds = @embeds,
      scheduled_at = @scheduled_at,
      timezone = @timezone
    WHERE id = @id
  `).run({
    id: req.params.id,
    label: req.body.label || '',
    webhook_url: req.body.webhookUrl,
    username: req.body.username || null,
    avatar_url: req.body.avatarUrl || null,
    content: req.body.content || null,
    embeds: JSON.stringify(req.body.embeds || []),
    scheduled_at: new Date(req.body.scheduledAt).toISOString(),
    timezone: req.body.timezone || 'UTC'
  });

  const row = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(req.params.id);
  res.json(rowToApi(row));
});

// Cancelar un mensaje pendiente
app.post('/api/messages/:id/cancel', (req, res) => {
  const existing = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ errors: ['Mensaje no encontrado.'] });
  if (existing.status !== 'pending') {
    return res.status(409).json({ errors: ['Solo se pueden cancelar mensajes pendientes.'] });
  }
  db.prepare(`UPDATE messages SET status = 'cancelled' WHERE id = ?`).run(req.params.id);
  res.json(rowToApi(db.prepare(`SELECT * FROM messages WHERE id = ?`).get(req.params.id)));
});

// Reintentar un mensaje fallido o cancelado (vuelve a pendiente)
app.post('/api/messages/:id/requeue', (req, res) => {
  const existing = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ errors: ['Mensaje no encontrado.'] });
  const newTime = req.body.scheduledAt ? new Date(req.body.scheduledAt).toISOString() : new Date().toISOString();
  db.prepare(`UPDATE messages SET status = 'pending', error = NULL, scheduled_at = ? WHERE id = ?`)
    .run(newTime, req.params.id);
  res.json(rowToApi(db.prepare(`SELECT * FROM messages WHERE id = ?`).get(req.params.id)));
});

// Enviar ahora mismo (ignora la hora programada)
app.post('/api/messages/:id/send-now', async (req, res) => {
  const existing = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ errors: ['Mensaje no encontrado.'] });
  try {
    await scheduler.dispatchMessage(existing);
    db.prepare(`UPDATE messages SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?`)
      .run(new Date().toISOString(), req.params.id);
    res.json(rowToApi(db.prepare(`SELECT * FROM messages WHERE id = ?`).get(req.params.id)));
  } catch (err) {
    db.prepare(`UPDATE messages SET status = 'failed', error = ? WHERE id = ?`)
      .run(String(err.message || err), req.params.id);
    res.status(502).json({ errors: [String(err.message || err)] });
  }
});

// Eliminar un mensaje definitivamente
app.delete('/api/messages/:id', (req, res) => {
  db.prepare(`DELETE FROM messages WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});

// Info de webhook (para autocarga como Discohook) - GET directo a Discord sin CORS
app.get('/api/webhook-info', async (req, res) => {
  const url = (req.query.url || '').trim();
  if (!url || !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) {
    return res.status(400).json({ errors: ['URL de webhook no valida.'] });
  }
  try {
    const r = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'Dispatch/1.0' } });
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ errors: [`Discord ${r.status}: ${text.slice(0, 300)}`] });
    const data = JSON.parse(text);
    // data: {id, type, guild_id, channel_id, name, avatar, token}
    let avatarUrl = null;
    if (data.avatar) avatarUrl = `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`;
    // alternative webhook avatar endpoint also works
    res.json({ id: data.id, name: data.name, avatar: data.avatar, avatarUrl, channel_id: data.channel_id, guild_id: data.guild_id, type: data.type });
  } catch (e) {
    res.status(502).json({ errors: [String(e.message || e)] });
  }
});

// Importar formato desde URL de otro embed/mensaje (copia formato)
app.post('/api/import', async (req, res) => {
  const url = (req.body.url || '').trim();
  if (!url) return res.status(400).json({ errors: ['URL requerida.'] });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ errors: ['URL debe empezar por http:// o https://'] });

  // Caso especial: link de mensaje de Discord https://discord.com/channels/<guild>/<channel>/<message>
  // Intenta primero via webhook (como Discohook) si hay webhookUrl, luego via bot token
  const discordMsgMatch = url.match(/discord(?:app)?\.com\/channels\/\d+\/(\d+)\/(\d+)/);
  if (discordMsgMatch) {
    const channelId = discordMsgMatch[1];
    const messageId = discordMsgMatch[2];
    const webhookUrl = (req.body.webhookUrl || '').trim();

    // 1) Intento via webhook token (igual que Discohook: GET /webhooks/{id}/{token}/messages/{messageId})
    if (webhookUrl && /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/.+/.test(webhookUrl)) {
      try {
        const m = webhookUrl.match(/\/api\/webhooks\/(\d+)\/([^/?#]+)/);
        if (m) {
          const whId = m[1], whToken = m[2].split('?')[0];
          const r = await fetch(`https://discord.com/api/v10/webhooks/${whId}/${whToken}/messages/${messageId}`, {
            headers: { 'User-Agent': 'Dispatch/1.0' }
          });
          if (r.ok) {
            const msg = await r.json();
            return res.json({
              content: msg.content || '',
              embeds: (msg.embeds || []).slice(0, 10),
              username: msg.author?.username || '',
              avatarUrl: msg.author?.avatar ? `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png` : ''
            });
          }
          // si 404 puede ser mensaje no es del webhook, seguimos a bot token
          const t = await r.text().catch(() => '');
          if (r.status !== 404) {
            return res.status(502).json({ errors: [`Webhook API ${r.status}: ${t.slice(0, 300)}`] });
          }
        }
      } catch (e) {
        // ignora y prueba bot token
      }
    }

    const token = process.env.DISCORD_BOT_TOKEN;
    if (token) {
      try {
        const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
          headers: { Authorization: `Bot ${token}` }
        });
        if (!r.ok) {
          const t = await r.text().catch(() => '');
          return res.status(502).json({ errors: [`Discord API ${r.status}: ${t.slice(0, 300)}`] });
        }
        const msg = await r.json();
        return res.json({
          content: msg.content || '',
          embeds: (msg.embeds || []).slice(0, 10),
          username: msg.author?.username || '',
          avatarUrl: msg.author?.avatar ? `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png` : ''
        });
      } catch (e) {
        return res.status(502).json({ errors: [String(e.message || e)] });
      }
    }
    return res.status(400).json({ errors: ['Para cargar un mensaje de Discord pega el webhook del mismo canal arriba y vuelve a pulsar Copiar formato. El mensaje debe haber sido enviado por ese webhook (como hace Discohook: GET /webhooks/{id}/{token}/messages/{id}). Alternativa sin webhook: configura DISCORD_BOT_TOKEN en Railway o pega el JSON directo del mensaje.'] });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Dispatch-import/1.0' } });
    clearTimeout(timeout);
    if (!r.ok) return res.status(502).json({ errors: [`Fetch ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`] });
    const text = (await r.text()).replace(/^\uFEFF/, '').trim();
    let data;
    try { data = JSON.parse(text); } catch { return res.status(400).json({ errors: ['La URL no devolvio JSON valido. Pega directamente el JSON del embed si lo tienes.'] }); }

    // Normalizar: acepta {content, embeds} , {data:{content,embeds}}, [embeds], o mensaje Discord
    if (Array.isArray(data)) data = { embeds: data };
    if (data.data && (data.data.embeds || data.data.content)) data = data.data;
    // Discohook a veces usa {embeds:[...]} directo
    const embeds = (data.embeds || data.embed || []).slice(0, 10);
    const content = data.content || '';
    const username = data.username || data.author?.username || '';
    const avatarUrl = data.avatar_url || data.avatarUrl || data.author?.avatar_url || '';

    if (!content && embeds.length === 0) {
      return res.status(400).json({ errors: ['No se encontraron embeds ni contenido en esa URL.'] });
    }
    return res.json({ content, embeds, username, avatarUrl });
  } catch (e) {
    return res.status(502).json({ errors: [String(e.message || e)] });
  }
});

// Probar un webhook enviando el payload actual sin guardarlo
app.post('/api/test-webhook', async (req, res) => {
  const errors = validatePayload({ ...req.body, scheduledAt: new Date().toISOString() });
  if (errors.length) return res.status(400).json({ errors });
  try {
    await scheduler.dispatchMessage({
      webhook_url: req.body.webhookUrl,
      username: req.body.username || null,
      avatar_url: req.body.avatarUrl || null,
      content: req.body.content || null,
      embeds: JSON.stringify(req.body.embeds || [])
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ errors: [String(err.message || err)] });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor escuchando en 0.0.0.0:${PORT} (PORT=${process.env.PORT}, DATABASE_PATH=${process.env.DATABASE_PATH || 'default'})`);
  scheduler.start();
}).on('error', (err) => {
  console.error('[server] listen error:', err);
  process.exit(1);
});
