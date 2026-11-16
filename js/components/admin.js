/** @file Admin dashboard. Server mode: real users, audit log, server-held AI key, site-wide medicine causes. Local mode: this browser only. */
import { $, $$, escapeHtml as h, formatDate, openModal, showToast } from '../utils/helpers.js';
import * as store from '../utils/storage.js';
import * as audit from '../utils/audit.js';
import { allUsers, isAdmin, currentUser, serverMode } from './auth.js';
import { getAll, categories, companies, setUses, resetUses, hasUsesOverride, setRemoteUse } from '../data/medicineDB.js';
import * as gemini from '../services/gemini.js';
import * as backend from '../services/backend.js';
import { KEYS, GEMINI } from '../config.js';

const table = (head, rows, empty) => rows.length
  ? `<div class="table-wrap" tabindex="0"><table class="alt-table"><thead><tr>${head.map((x) => `<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
  : `<p class="settings-note">${empty}</p>`;
const statGrid = (items) => `<div class="stat-grid">${items.map(([i, n, l]) => `<div class="stat"><i class="fas ${i}" aria-hidden="true"></i><strong>${h(n)}</strong><span>${h(l)}</span></div>`).join('')}</div>`;

let serverStats = null;

function renderKeyPanel() {
  const active = serverMode() ? Boolean(serverStats?.aiReady) : gemini.hasApiKey();
  $('#adminKeyStatus').className = `api-status${active ? ' active' : ''}`;
  $('#adminKeyStatus').innerHTML = `<i class="fas fa-circle" aria-hidden="true"></i> ${active ? 'Active' : 'Not set'}`;
  $('#adminApiKey').value = '';                                   // never echo the saved key (NFR-3.2)
  $('#adminApiKey').placeholder = active ? '•••••••• saved. Enter a new key to replace it' : 'AIza…';
  $('#adminModel').value = serverMode() ? serverStats?.model || '' : gemini.getModel();
  $('#adminModel').placeholder = `Default: ${GEMINI.models[0]}`;
  $('#adminKeyNote').textContent = serverMode()
    ? 'Stored encrypted on the server and used for everyone. It is never sent to browsers and never shown again after saving.'
    : 'Local mode: saved in this browser only (localStorage) and sent only to Google. Run the server (npm start) to share one key with all users.';
}

function renderMeds() {
  $('#adminMedsContent').innerHTML = getAll().map((m) => `<div class="uses-row">
    <label for="uses-${m.id}">${h(m.name)} <small>(${h(m.generic || '')})</small></label>
    <input type="text" id="uses-${m.id}" value="${h((m.uses || []).join(', '))}" maxlength="400" placeholder="e.g. Fever, Headache, Body ache" />
    <div class="uses-actions">
      <button type="button" class="btn-primary" data-save-uses="${m.id}"><i class="fas fa-save" aria-hidden="true"></i> Save</button>
      ${hasUsesOverride(m.id) ? `<button type="button" class="btn-secondary" data-reset-uses="${m.id}"><i class="fas fa-rotate-left" aria-hidden="true"></i> Reset to default</button>` : ''}
    </div></div>`).join('');
}

async function render() {
  const meds = getAll();
  try {
    if (serverMode()) {
      serverStats = await backend.api('/api/admin/stats');
      const s = serverStats;
      $('#adminStatsContent').innerHTML = statGrid([['fa-pills', meds.length, 'Medicines'], ['fa-users', s.users, 'Accounts'], ['fa-user-lock', s.twoFactorUsers, 'With 2FA'],
        ['fa-calendar-check', s.appointments, 'Booked visits'], ['fa-bell', s.reminders, 'Reminders'], ['fa-robot', s.aiRequests, 'AI requests'], ['fa-building', companies().length, 'Manufacturers']]);
      const { users } = await backend.api('/api/admin/users');
      const me = currentUser();
      $('#adminUsersContent').innerHTML = table(['Name', 'Email', 'Role', '2FA', 'Created', ''], users.map((u) => `<tr><td>${h(u.name)}</td><td>${h(u.email)}</td><td>${h(u.role)}</td><td>${u.totpEnabled ? 'On' : 'Off'}</td><td>${h(formatDate(u.created, false))}</td>
        <td>${u.id === me.id ? '' : `<button type="button" class="btn-secondary" data-role="${u.role === 'admin' ? 'user' : 'admin'}" data-user="${h(u.id)}">${u.role === 'admin' ? 'Make user' : 'Make admin'}</button>`}</td></tr>`), 'No accounts yet.');
      const { events } = await backend.api('/api/admin/audit');
      $('#adminAuditContent').innerHTML = table(['Time', 'Event', 'Detail'], events.map((a) => `<tr><td>${h(formatDate(a.at))}</td><td>${h(a.event)}</td><td>${h(a.detail || '—')}</td></tr>`), 'No events yet.');
    } else {
      $('#adminStatsContent').innerHTML = `${statGrid([['fa-pills', meds.length, 'Medicines'], ['fa-building', companies().length, 'Manufacturers'], ['fa-tags', categories().length, 'Categories'],
        ['fa-users', allUsers().length, 'Local accounts'], ['fa-comments', store.get(KEYS.chat, []).length, 'Saved chat records'], ['fa-camera', store.get(KEYS.scans, []).length, 'Scans']])}
        <p class="settings-note">Local mode reads this browser's data only. Run the server (npm start) for site-wide data.</p>`;
      $('#adminUsersContent').innerHTML = table(['Name', 'Email', 'Role', 'Created'], allUsers().map((u) => `<tr><td>${h(u.name)}</td><td>${h(u.email)}</td><td>${h(u.role)}</td><td>${h(formatDate(u.created, false))}</td></tr>`), 'No accounts on this device yet.');
      $('#adminAuditContent').innerHTML = table(['Time', 'Event', 'Detail'], audit.all().map((a) => `<tr><td>${h(formatDate(a.t))}</td><td>${h(a.event)}</td><td>${h(a.detail || '—')}</td></tr>`), 'No events yet.');
    }
  } catch (e) { showToast(e.message, 'error'); }
  renderKeyPanel(); renderMeds();
}

export function initAdmin() {
  // Every action re-checks the role. In server mode the server enforces it too (403); local mode is a demo only.
  const guard = () => { if (isAdmin()) return true; showToast('Admin access only.', 'warn'); return false; };
  const changed = () => document.dispatchEvent(new CustomEvent('mg:data-changed'));

  $('#adminPanelBtn').addEventListener('click', async () => { if (!guard()) return; await render(); openModal('adminModal'); });
  $$('.admin-tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.admin-tab').forEach((x) => { x.classList.toggle('active', x === tab); x.setAttribute('aria-selected', String(x === tab)); });
    $$('.admin-panel').forEach((p) => { p.hidden = p.id !== tab.dataset.panel; });
  }));

  $('#adminToggleKey').addEventListener('click', () => {
    const i = $('#adminApiKey'); const show = i.type === 'password';
    i.type = show ? 'text' : 'password'; $('#adminToggleKey i').className = `fas ${show ? 'fa-eye-slash' : 'fa-eye'}`;
  });

  $('#adminSaveKey').addEventListener('click', async () => {
    if (!guard()) return;
    const key = $('#adminApiKey').value.trim();
    try {
      if (serverMode()) {
        const model = $('#adminModel').value.trim();
        if (!key && model === (serverStats?.model || '')) return showToast('Nothing to save. Enter a new key or model.', 'info');
        await backend.api('/api/admin/ai', { method: 'PUT', body: { ...(key ? { apiKey: key } : {}), model } });
        await backend.refreshHealth(); serverStats = await backend.api('/api/admin/stats');
      } else {
        const before = gemini.getModel();
        if (key) { gemini.setApiKey(key); audit.log('api_key_set'); }
        gemini.setModel($('#adminModel').value);
        if (!key && gemini.getModel() === before) return showToast('Nothing to save. Enter a new key or model.', 'info');
      }
      showToast('Saved.', 'success'); renderKeyPanel();
    } catch (e) { showToast(e.message, 'error'); }
  });

  $('#adminRemoveKey').addEventListener('click', async () => {
    if (!guard()) return;
    const has = serverMode() ? serverStats?.aiReady : gemini.hasApiKey();
    if (!has || !window.confirm('Remove the API key? Chat and scanning will stop working until a new key is added.')) return;
    try {
      if (serverMode()) { await backend.api('/api/admin/ai', { method: 'PUT', body: { clear: true } }); await backend.refreshHealth(); serverStats = await backend.api('/api/admin/stats'); }
      else { gemini.clearApiKey(); audit.log('api_key_removed'); }
      showToast('API key removed.', 'success'); renderKeyPanel();
    } catch (e) { showToast(e.message, 'error'); }
  });

  $('#adminMedsContent').addEventListener('click', async (e) => {
    if (!guard()) return;
    const save = e.target.closest('[data-save-uses]'); const reset = e.target.closest('[data-reset-uses]');
    try {
      if (save) {
        const id = Number(save.dataset.saveUses); const raw = $(`#uses-${id}`).value.split(',');
        const list = serverMode() ? (await backend.api(`/api/admin/medicines/${id}/uses`, { method: 'PUT', body: { uses: raw } })).uses : setUses(id, raw);
        if (serverMode()) setRemoteUse(id, list); else audit.log('uses_edited', `medicine ${id}`);
        showToast(`Saved ${list.length} item${list.length === 1 ? '' : 's'}.`, 'success'); renderMeds(); changed();
      } else if (reset) {
        const id = Number(reset.dataset.resetUses);
        if (serverMode()) { await backend.api(`/api/admin/medicines/${id}/uses`, { method: 'DELETE' }); setRemoteUse(id, null); } else { resetUses(id); audit.log('uses_reset', `medicine ${id}`); }
        showToast('Restored the default list.', 'success'); renderMeds(); changed();
      }
    } catch (err) { showToast(err.message, 'error'); }
  });

  $('#adminUsersContent').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-role]'); if (!b || !guard()) return;
    try { await backend.api(`/api/admin/users/${b.dataset.user}/role`, { method: 'PUT', body: { role: b.dataset.role } }); showToast('Role updated.', 'success'); await render(); }
    catch (err) { showToast(err.message, 'error'); }
  });
}
