const express = require('express');
const crypto = require('crypto');
const path = require('path');
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

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  scheduler.start();
});
