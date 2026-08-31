// ---------- Estado ----------
let embeds = []; // cada embed es un objeto plano tipo Discord API
let editingId = null; // si estamos editando un mensaje existente
let authToken = localStorage.getItem('dispatch_token') || '';

function getAuthHeaders() {
  return authToken ? { 'X-Auth-Token': authToken } : {};
}
function authFetch(url, opts = {}) {
  opts.headers = { ...(opts.headers || {}), ...getAuthHeaders() };
  return fetch(url, opts);
}
function setAuthToken(token) {
  authToken = (token || '').trim();
  if (authToken) localStorage.setItem('dispatch_token', authToken);
  else localStorage.removeItem('dispatch_token');
  if (el.authToken) el.authToken.value = authToken;
  if (el.authOverlayInput) el.authOverlayInput.value = authToken;
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const el = {
  webhookUrl: $('#webhookUrl'),
  webhookInfo: $('#webhookInfo'),
  username: $('#username'),
  avatarUrl: $('#avatarUrl'),
  content: $('#content'),
  contentCounter: $('#contentCounter'),
  embedsList: $('#embedsList'),
  addEmbedBtn: $('#addEmbedBtn'),
  label: $('#label'),
  scheduledAt: $('#scheduledAt'),
  tzLabel: $('#tzLabel'),
  testBtn: $('#testBtn'),
  scheduleBtn: $('#scheduleBtn'),
  formMessage: $('#formMessage'),
  importUrl: $('#importUrl'),
  importBtn: $('#importBtn'),
  importMessage: $('#importMessage'),
  previewAvatar: $('#previewAvatar'),
  previewUsername: $('#previewUsername'),
  previewContent: $('#previewContent'),
  previewEmbeds: $('#previewEmbeds'),
  queueList: $('#queueList'),
  queueEmpty: $('#queueEmpty'),
  refreshQueueBtn: $('#refreshQueueBtn'),
  cronStatusText: $('#cronStatusText'),
  authToken: $('#authToken'),
  authSaveBtn: $('#authSaveBtn'),
  authStatus: $('#authStatus'),
  authOverlay: $('#authOverlay'),
  authOverlayInput: $('#authOverlayInput'),
  authOverlayBtn: $('#authOverlayBtn'),
  authOverlayMsg: $('#authOverlayMsg'),
};

el.tzLabel.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---------- Auth ----------
if (el.authToken) el.authToken.value = authToken;
if (el.authOverlayInput) el.authOverlayInput.value = authToken;

function showAuthOverlay(show, msg) {
  if (!el.authOverlay) return;
  el.authOverlay.style.display = show ? 'flex' : 'none';
  if (msg && el.authOverlayMsg) el.authOverlayMsg.textContent = msg;
}
function updateAuthStatus(ok, protectedMode) {
  if (!el.authStatus) return;
  if (!protectedMode) { el.authStatus.textContent = 'sin protección'; el.authStatus.style.color = 'var(--text-faint)'; return; }
  if (ok) { el.authStatus.textContent = '✓ desbloqueado'; el.authStatus.style.color = 'var(--success)'; }
  else { el.authStatus.textContent = 'bloqueado'; el.authStatus.style.color = 'var(--danger)'; }
}
async function checkAuth() {
  try {
    const r = await authFetch('/api/auth-check');
    const data = await r.json().catch(() => ({}));
    if (!data.protected) { showAuthOverlay(false); updateAuthStatus(true, false); return true; }
    if (r.ok && data.ok) { showAuthOverlay(false); updateAuthStatus(true, true); return true; }
    showAuthOverlay(true, 'Token requerido o inválido.');
    updateAuthStatus(false, true);
    return false;
  } catch (e) {
    // si no hay auth, no bloqueamos
    return true;
  }
}
async function saveTokenFromInput(inputEl) {
  const t = inputEl.value.trim();
  setAuthToken(t);
  const ok = await checkAuth();
  if (ok) {
    if (el.authStatus) { el.authStatus.textContent = '✓ guardado'; setTimeout(() => checkAuth(), 1200); }
    loadQueue();
  } else {
    if (el.authOverlayMsg) el.authOverlayMsg.textContent = 'Token incorrecto.';
  }
}
el.authSaveBtn?.addEventListener('click', () => saveTokenFromInput(el.authToken));
el.authToken?.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveTokenFromInput(el.authToken); });
el.authOverlayBtn?.addEventListener('click', () => saveTokenFromInput(el.authOverlayInput));
el.authOverlayInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveTokenFromInput(el.authOverlayInput); });

// ---------- Autocarga webhook como Discohook ----------
let webhookTimer = null;
async function loadWebhookInfo() {
  const url = el.webhookUrl.value.trim();
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) {
    if (el.webhookInfo) el.webhookInfo.textContent = '';
    return;
  }
  if (el.webhookInfo) el.webhookInfo.textContent = 'Verificando webhook…';
  try {
    const r = await authFetch(`/api/webhook-info?url=${encodeURIComponent(url)}`);
    const data = await r.json();
    if (!r.ok) throw new Error((data.errors || ['Webhook no valido']).join(' '));
    if (el.webhookInfo) {
      el.webhookInfo.textContent = `✓ ${data.name || 'Webhook'} ${data.channel_id ? '· #' + data.channel_id : ''}`;
      el.webhookInfo.style.color = 'var(--success)';
    }
    // Auto-rellena nombre/avatar solo si estan vacios (como Discohook)
    if (data.name && !el.username.value.trim()) { el.username.value = data.name; renderPreview(); }
    if (data.avatarUrl && !el.avatarUrl.value.trim()) { el.avatarUrl.value = data.avatarUrl; renderPreview(); }
  } catch (e) {
    if (el.webhookInfo) {
      el.webhookInfo.textContent = e.message;
      el.webhookInfo.style.color = 'var(--danger)';
    }
  }
}
el.webhookUrl.addEventListener('input', () => {
  if (el.webhookInfo) { el.webhookInfo.style.color = ''; }
  clearTimeout(webhookTimer);
  webhookTimer = setTimeout(loadWebhookInfo, 700);
});
el.webhookUrl.addEventListener('blur', loadWebhookInfo);
el.webhookUrl.addEventListener('paste', () => setTimeout(loadWebhookInfo, 100));

// ---------- Utilidades ----------
function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function hexToInt(hex) {
  return parseInt(hex.replace('#', ''), 16);
}

function intToHex(int) {
  return '#' + (int >>> 0).toString(16).padStart(6, '0').slice(-6);
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function countdownText(iso, status) {
  if (status !== 'pending') return '';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'enviando…';
  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `en ${d}d ${h}h`;
  if (h > 0) return `en ${h}h ${m}m`;
  if (m > 0) return `en ${m}m`;
  return `en ${s % 60}s`;
}

function statusLabel(status) {
  return { pending: 'Pendiente', sent: 'Enviado', failed: 'Fallido', cancelled: 'Cancelado' }[status] || status;
}

// ---------- Embed builder ----------
function newEmbed() {
  return {
    color: hexToInt('#f2a93b'),
    author: { name: '', icon_url: '' },
    title: '',
    url: '',
    description: '',
    fields: [],
    image: { url: '' },
    thumbnail: { url: '' },
    footer: { text: '', icon_url: '' },
    useTimestamp: false,
  };
}

function addEmbedCard(embed) {
  const tpl = $('#embedTemplate').content.cloneNode(true);
  const card = tpl.querySelector('.embed-card');
  card._embed = embed;
  bindEmbedCard(card, embed);
  el.embedsList.appendChild(card);
  renderEmbedIndexes();
}

function renderEmbedIndexes() {
  $$('.embed-card', el.embedsList).forEach((card, i) => {
    $('.embed-index', card).textContent = `EMBED ${i + 1} / 10`;
  });
}

function bindEmbedCard(card, embed) {
  const set = (sel, val) => { $(sel, card).value = val; };
  set('.embed-color', intToHex(embed.color));
  set('.embed-author-name', embed.author.name);
  set('.embed-author-icon', embed.author.icon_url);
  set('.embed-title', embed.title);
  set('.embed-url', embed.url);
  set('.embed-description', embed.description);
  set('.embed-image', embed.image.url);
  set('.embed-thumbnail', embed.thumbnail.url);
  set('.embed-footer-text', embed.footer.text);
  set('.embed-footer-icon', embed.footer.icon_url);
  $('.embed-timestamp', card).checked = embed.useTimestamp;

  const onChange = () => {
    embed.color = hexToInt($('.embed-color', card).value);
    embed.author.name = $('.embed-author-name', card).value;
    embed.author.icon_url = $('.embed-author-icon', card).value;
    embed.title = $('.embed-title', card).value;
    embed.url = $('.embed-url', card).value;
    embed.description = $('.embed-description', card).value;
    embed.image.url = $('.embed-image', card).value;
    embed.thumbnail.url = $('.embed-thumbnail', card).value;
    embed.footer.text = $('.embed-footer-text', card).value;
    embed.footer.icon_url = $('.embed-footer-icon', card).value;
    embed.useTimestamp = $('.embed-timestamp', card).checked;
    card.style.borderLeftColor = $('.embed-color', card).value;
    renderPreview();
  };
  card.style.borderLeftColor = intToHex(embed.color);

  $$('input, textarea', card).forEach((input) => {
    if (input.closest('.embed-fields')) return;
    input.addEventListener('input', onChange);
    input.addEventListener('change', onChange);
  });

  $('.embed-remove', card).addEventListener('click', () => {
    embeds = embeds.filter((e) => e !== embed);
    card.remove();
    renderEmbedIndexes();
    renderPreview();
  });

  $('.add-field', card).addEventListener('click', () => {
    if (embed.fields.length >= 25) return;
    const field = { name: '', value: '', inline: false };
    embed.fields.push(field);
    addFieldRow(card, embed, field);
    renderPreview();
  });

  embed.fields.forEach((field) => addFieldRow(card, embed, field));
}

function addFieldRow(card, embed, field) {
  const tpl = $('#fieldTemplate').content.cloneNode(true);
  const row = tpl.querySelector('.embed-field-row');
  $('.field-name', row).value = field.name;
  $('.field-value', row).value = field.value;
  $('.field-inline', row).checked = field.inline;

  const onChange = () => {
    field.name = $('.field-name', row).value;
    field.value = $('.field-value', row).value;
    field.inline = $('.field-inline', row).checked;
    renderPreview();
  };
  $$('input', row).forEach((i) => i.addEventListener('input', onChange));
  $$('input', row).forEach((i) => i.addEventListener('change', onChange));

  $('.field-remove', row).addEventListener('click', () => {
    embed.fields = embed.fields.filter((f) => f !== field);
    row.remove();
    renderPreview();
  });

  $('.embed-fields', card).appendChild(row);
}

el.addEmbedBtn.addEventListener('click', () => {
  if (embeds.length >= 10) return;
  const embed = newEmbed();
  embeds.push(embed);
  addEmbedCard(embed);
  renderPreview();
});

// ---------- Preview ----------
function renderPreview() {
  el.previewUsername.textContent = el.username.value.trim() || 'Webhook';
  if (el.avatarUrl.value.trim()) {
    el.previewAvatar.style.backgroundImage = `url(${el.avatarUrl.value.trim()})`;
    el.previewAvatar.textContent = '';
  } else {
    el.previewAvatar.style.backgroundImage = '';
    el.previewAvatar.textContent = (el.username.value.trim() || 'D')[0].toUpperCase();
  }
  el.previewContent.textContent = el.content.value;

  el.previewEmbeds.innerHTML = '';
  embeds.forEach((embed) => {
    if (!embed.title && !embed.description && !embed.fields.length && !embed.image.url && !embed.thumbnail.url && !embed.author.name && !embed.footer.text) return;
    const box = document.createElement('div');
    box.className = 'd-embed';
    box.style.borderLeftColor = intToHex(embed.color);

    const main = document.createElement('div');
    main.className = 'd-embed-main';

    if (embed.author.name) {
      const a = document.createElement('div');
      a.className = 'd-embed-author';
      if (embed.author.icon_url) a.innerHTML = `<img src="${escapeHtml(embed.author.icon_url)}" alt="">`;
      a.innerHTML += `<span>${escapeHtml(embed.author.name)}</span>`;
      main.appendChild(a);
    }
    if (embed.title) {
      const t = document.createElement('div');
      t.className = 'd-embed-title';
      t.innerHTML = embed.url
        ? `<a href="${escapeHtml(embed.url)}" target="_blank" rel="noopener">${escapeHtml(embed.title)}</a>`
        : escapeHtml(embed.title);
      main.appendChild(t);
    }
    if (embed.description) {
      const d = document.createElement('div');
      d.className = 'd-embed-desc';
      d.textContent = embed.description;
      main.appendChild(d);
    }
    if (embed.fields.length) {
      const grid = document.createElement('div');
      grid.className = 'd-embed-fields';
      embed.fields.forEach((f) => {
        if (!f.name && !f.value) return;
        const fEl = document.createElement('div');
        fEl.className = 'd-embed-field' + (f.inline ? '' : ' full');
        fEl.innerHTML = `<div class="d-embed-field-name">${escapeHtml(f.name)}</div><div class="d-embed-field-value">${escapeHtml(f.value)}</div>`;
        grid.appendChild(fEl);
      });
      main.appendChild(grid);
    }

    box.appendChild(main);
    if (embed.thumbnail.url) {
      const th = document.createElement('img');
      th.className = 'd-embed-thumb';
      th.src = embed.thumbnail.url;
      box.appendChild(th);
    }
    if (embed.image.url) {
      const im = document.createElement('img');
      im.className = 'd-embed-image';
      im.src = embed.image.url;
      box.appendChild(im);
    }
    if (embed.footer.text) {
      const f = document.createElement('div');
      f.className = 'd-embed-footer';
      if (embed.footer.icon_url) f.innerHTML = `<img src="${escapeHtml(embed.footer.icon_url)}" alt="">`;
      f.innerHTML += `<span>${escapeHtml(embed.footer.text)}</span>`;
      box.appendChild(f);
    }
    el.previewEmbeds.appendChild(box);
  });
}

[el.username, el.avatarUrl, el.content].forEach((input) => {
  input.addEventListener('input', renderPreview);
});
el.content.addEventListener('input', () => {
  el.contentCounter.textContent = `${el.content.value.length} / 2000`;
});

// ---------- Construcción de payload para la API ----------
function buildEmbedsPayload() {
  return embeds
    .filter((e) => e.title || e.description || e.fields.length || e.image.url || e.thumbnail.url || e.author.name || e.footer.text)
    .map((e) => {
      const out = { color: e.color };
      if (e.title) out.title = e.title;
      if (e.url) out.url = e.url;
      if (e.description) out.description = e.description;
      if (e.author.name) out.author = { name: e.author.name, ...(e.author.icon_url ? { icon_url: e.author.icon_url } : {}) };
      if (e.footer.text) out.footer = { text: e.footer.text, ...(e.footer.icon_url ? { icon_url: e.footer.icon_url } : {}) };
      if (e.image.url) out.image = { url: e.image.url };
      if (e.thumbnail.url) out.thumbnail = { url: e.thumbnail.url };
      const fields = e.fields.filter((f) => f.name && f.value);
      if (fields.length) out.fields = fields;
      if (e.useTimestamp) out.timestamp = new Date().toISOString();
      return out;
    });
}

function buildBasePayload() {
  return {
    webhookUrl: el.webhookUrl.value.trim(),
    username: el.username.value.trim(),
    avatarUrl: el.avatarUrl.value.trim(),
    content: el.content.value,
    embeds: buildEmbedsPayload(),
  };
}

function showFormMessage(text, type) {
  el.formMessage.textContent = text;
  el.formMessage.className = 'form-message' + (type ? ' ' + type : '');
}
function showImportMessage(text, type) {
  el.importMessage.textContent = text;
  el.importMessage.className = 'form-message' + (type ? ' ' + type : '');
}

function applyImportedData(data) {
  if (typeof data.content === 'string') {
    el.content.value = data.content;
    el.contentCounter.textContent = `${el.content.value.length} / 2000`;
  }
  if (data.username) el.username.value = data.username;
  if (data.avatarUrl) el.avatarUrl.value = data.avatarUrl;
  if (Array.isArray(data.embeds)) {
    // reemplazar embeds actuales por los importados
    embeds = data.embeds.slice(0, 10).map((e) => ({
      color: e.color ?? hexToInt('#f2a93b'),
      author: { name: e.author?.name || '', icon_url: e.author?.icon_url || '' },
      title: e.title || '',
      url: e.url || '',
      description: e.description || '',
      fields: (e.fields || []).map((f) => ({ name: f.name || '', value: f.value || '', inline: !!f.inline })),
      image: { url: e.image?.url || '' },
      thumbnail: { url: e.thumbnail?.url || '' },
      footer: { text: e.footer?.text || '', icon_url: e.footer?.icon_url || '' },
      useTimestamp: !!e.timestamp,
    }));
    el.embedsList.innerHTML = '';
    embeds.forEach(addEmbedCard);
  }
  renderPreview();
}

// ---------- Acciones ----------
el.importBtn?.addEventListener('click', async () => {
  const raw = el.importUrl.value.trim();
  if (!raw) { showImportMessage('Pega una URL o JSON.', 'error'); return; }
  // Si parece JSON directo, no llamar al servidor
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      let data = JSON.parse(raw);
      if (Array.isArray(data)) data = { embeds: data };
      if (data.data && (data.data.embeds || data.data.content)) data = data.data;
      applyImportedData(data);
      showImportMessage(`Formato copiado: ${Array.isArray(data.embeds) ? data.embeds.length : 0} embed(s)`, 'success');
    } catch (e) { showImportMessage('JSON invalido: ' + e.message, 'error'); }
    return;
  }
  showImportMessage('Importando…', '');
  try {
    const res = await authFetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: raw, webhookUrl: el.webhookUrl.value.trim() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data.errors || ['Error desconocido']).join(' '));
    applyImportedData(data);
    showImportMessage(`Formato copiado: ${data.embeds?.length || 0} embed(s) ✓`, 'success');
  } catch (err) {
    showImportMessage(err.message, 'error');
  }
});

el.testBtn.addEventListener('click', async () => {
  showFormMessage('Enviando prueba…', '');
  try {
    const res = await authFetch('/api/test-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBasePayload()),
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data.errors || ['Error desconocido']).join(' '));
    showFormMessage('Prueba enviada a Discord ✓', 'success');
  } catch (err) {
    showFormMessage(err.message, 'error');
  }
});

el.scheduleBtn.addEventListener('click', async () => {
  if (!el.scheduledAt.value) {
    showFormMessage('Elige una fecha y hora de envío.', 'error');
    return;
  }
  const payload = {
    ...buildBasePayload(),
    label: el.label.value.trim(),
    scheduledAt: new Date(el.scheduledAt.value).toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  try {
    const url = editingId ? `/api/messages/${editingId}` : '/api/messages';
    const method = editingId ? 'PUT' : 'POST';
    const res = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data.errors || ['Error desconocido']).join(' '));
    showFormMessage(editingId ? 'Mensaje actualizado ✓' : 'Mensaje programado ✓', 'success');
    resetForm();
    loadQueue();
  } catch (err) {
    showFormMessage(err.message, 'error');
  }
});

function resetForm() {
  editingId = null;
  el.scheduleBtn.textContent = 'Programar envío';
  el.label.value = '';
  el.content.value = '';
  el.contentCounter.textContent = '0 / 2000';
  el.scheduledAt.value = '';
  embeds = [];
  el.embedsList.innerHTML = '';
  renderPreview();
}

function loadMessageIntoForm(msg) {
  editingId = msg.id;
  el.scheduleBtn.textContent = 'Guardar cambios';
  el.webhookUrl.value = msg.webhookUrl;
  el.username.value = msg.username || '';
  el.avatarUrl.value = msg.avatarUrl || '';
  el.content.value = msg.content || '';
  el.contentCounter.textContent = `${(msg.content || '').length} / 2000`;
  el.label.value = msg.label || '';
  const local = new Date(msg.scheduledAt);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  el.scheduledAt.value = local.toISOString().slice(0, 16);

  embeds = msg.embeds.map((e) => ({
    color: e.color ?? hexToInt('#f2a93b'),
    author: { name: e.author?.name || '', icon_url: e.author?.icon_url || '' },
    title: e.title || '',
    url: e.url || '',
    description: e.description || '',
    fields: (e.fields || []).map((f) => ({ ...f })),
    image: { url: e.image?.url || '' },
    thumbnail: { url: e.thumbnail?.url || '' },
    footer: { text: e.footer?.text || '', icon_url: e.footer?.icon_url || '' },
    useTimestamp: !!e.timestamp,
  }));
  el.embedsList.innerHTML = '';
  embeds.forEach(addEmbedCard);
  renderPreview();
  loadWebhookInfo();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- Cola de despacho ----------
async function loadQueue() {
  try {
    const res = await authFetch('/api/messages');
    if (res.status === 401) {
      const data = await res.json().catch(() => ({}));
      if (data.errors) el.cronStatusText.textContent = 'No autorizado - revisa token';
      showAuthOverlay(true, 'Token requerido.');
      updateAuthStatus(false, true);
      return;
    }
    const rows = await res.json();
    renderQueue(rows);
    el.cronStatusText.textContent = `Cola activa · ${rows.filter(r => r.status === 'pending').length} pendientes`;
  } catch (err) {
    el.cronStatusText.textContent = 'Sin conexión con el servidor';
  }
}

function renderQueue(rows) {
  el.queueList.innerHTML = '';
  el.queueEmpty.style.display = rows.length ? 'none' : 'block';

  const firstPendingId = rows.find((r) => r.status === 'pending')?.id;

  rows.forEach((msg) => {
    const tpl = $('#queueItemTemplate').content.cloneNode(true);
    const item = tpl.querySelector('.timeline-item');
    item.dataset.status = msg.status;
    if (msg.id === firstPendingId) item.classList.add('next');

    $('.timeline-label', item).textContent = msg.label || '(sin etiqueta)';
    $('.timeline-status', item).textContent = statusLabel(msg.status);
    $('.timeline-time', item).textContent = formatDateTime(msg.scheduledAt);
    $('.timeline-countdown', item).textContent = countdownText(msg.scheduledAt, msg.status);
    item.dataset.scheduledAt = msg.scheduledAt;
    item.dataset.msgStatus = msg.status;

    const snippet = msg.content || msg.embeds?.[0]?.title || msg.embeds?.[0]?.description || '(embed sin texto)';
    $('.timeline-snippet', item).textContent = snippet;
    $('.timeline-error', item).textContent = msg.error || '';

    const actions = $('.timeline-actions', item);
    const addBtn = (text, handler, danger) => {
      const b = document.createElement('button');
      b.className = 'btn ghost small' + (danger ? ' danger' : '');
      b.textContent = text;
      b.addEventListener('click', handler);
      actions.appendChild(b);
    };

    if (msg.status === 'pending') {
      addBtn('Editar', () => loadMessageIntoForm(msg));
      addBtn('Enviar ahora', async () => {
        await authFetch(`/api/messages/${msg.id}/send-now`, { method: 'POST' });
        loadQueue();
      });
      addBtn('Cancelar', async () => {
        await authFetch(`/api/messages/${msg.id}/cancel`, { method: 'POST' });
        loadQueue();
      }, true);
    } else {
      if (msg.status === 'failed' || msg.status === 'cancelled') {
        addBtn('Reprogramar', async () => {
          const iso = prompt('Nueva fecha/hora (formato: 2025-01-31T18:30):');
          if (!iso) return;
          await authFetch(`/api/messages/${msg.id}/requeue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scheduledAt: new Date(iso).toISOString() }),
          });
          loadQueue();
        });
      }
      addBtn('Eliminar', async () => {
        await authFetch(`/api/messages/${msg.id}`, { method: 'DELETE' });
        loadQueue();
      }, true);
    }

    el.queueList.appendChild(item);
  });
}

function tickCountdowns() {
  $$('.timeline-item').forEach((item) => {
    if (item.dataset.msgStatus === 'pending') {
      $('.timeline-countdown', item).textContent = countdownText(item.dataset.scheduledAt, 'pending');
    }
  });
}

el.refreshQueueBtn.addEventListener('click', loadQueue);

// ---------- Init ----------
renderPreview();
checkAuth().then(() => loadQueue());
setInterval(() => { checkAuth().then(ok => { if (ok) loadQueue(); }); }, 15000);
setInterval(tickCountdowns, 1000);
