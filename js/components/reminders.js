/**
 * @file Medicine reminders. Stored on the server when logged in, otherwise in this browser.
 * Alerts fire while MediGuide is open (in-page toast + browser notification + optional voice).
 * Background push while the app is closed needs a Web Push server (VAPID): not included.
 */
import { $, escapeHtml as h, showToast, uid } from '../utils/helpers.js';
import * as store from '../utils/storage.js';
import * as backend from '../services/backend.js';
import { speak, isVoiceMode } from '../services/voice.js';
import { getAll } from '../data/medicineDB.js';
import { t, onLangChange } from '../i18n.js';
import { KEYS } from '../config.js';

let list = [];
let draft = [];
const fired = new Set(JSON.parse(sessionStorage.getItem('mg_fired') || '[]'));
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const useServer = () => backend.isOnline() && Boolean(backend.getUser());
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() + n); return localDate(d); };

export function dueNow(r, now = new Date()) {
  const date = localDate(now);
  const inRange = r.startDate <= date && (!r.days || date < addDays(r.startDate, r.days));
  return r.active && inRange && r.times.includes(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
}

async function load() {
  try { list = useServer() ? (await backend.api('/api/reminders')).reminders : store.get(KEYS.reminders, []); } catch { list = []; }
  render();
}

function validate(rem) {
  if (rem.medicine.length < 2 || rem.medicine.length > 80) throw new Error('Enter the medicine name.');
  if (!rem.times.length) throw new Error('Add at least one time.');
  if (rem.days != null && !(rem.days >= 1 && rem.days <= 365)) throw new Error('Days must be between 1 and 365.');
}

async function save() {
  const rem = {
    medicine: $('#remMedicine').value.trim(), dose: $('#remDose').value.trim().slice(0, 60), times: [...new Set(draft)].sort(),
    startDate: $('#remStart').value || localDate(), days: $('#remDays').value ? Number($('#remDays').value) : null,
  };
  try {
    validate(rem);
    if (useServer()) await backend.api('/api/reminders', { method: 'POST', body: rem });
    else { list = [{ id: uid(), ...rem, notes: '', active: true }, ...list]; store.set(KEYS.reminders, list); }
    draft = []; $('#remMedicine').value = ''; $('#remDose').value = ''; $('#remDays').value = '';
    showToast(t('saveReminder'), 'success'); await load();
  } catch (e) { showToast(e.message, 'error'); }
}

async function patch(id, fn) {
  if (useServer()) { await fn.server(id); } else { fn.local(id); store.set(KEYS.reminders, list); }
  await load();
}

function renderDraft() {
  $('#remTimesList').innerHTML = draft.sort().map((x) => `<li class="time-chip">${h(x)} <button type="button" class="chip-x" data-del-time="${h(x)}" aria-label="Remove ${h(x)}"><i class="fas fa-times" aria-hidden="true"></i></button></li>`).join('');
}

export function render() {
  const date = localDate();
  const today = list.filter((r) => r.active && r.startDate <= date && (!r.days || date < addDays(r.startDate, r.days)))
    .flatMap((r) => r.times.map((time) => ({ time, r }))).sort((a, b) => a.time.localeCompare(b.time));
  const nowHm = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  $('#remToday').innerHTML = today.length
    ? today.map(({ time, r }) => `<li class="${time < nowHm ? 'past' : ''}"><strong>${h(time)}</strong> ${h(r.medicine)} <small>${h(r.dose)}</small></li>`).join('')
    : '<li class="empty">—</li>';
  $('#remList').innerHTML = list.length ? list.map((r) => `<li class="rem-item${r.active ? '' : ' paused'}">
    <div class="rem-main"><strong>${h(r.medicine)}</strong> <small>${h(r.dose)}</small>
      <div class="rem-times">${r.times.map((x) => `<span class="time-chip">${h(x)}</span>`).join('')}</div>
      <small>${h(r.startDate)}${r.days ? ` · ${r.days} d` : ''}</small></div>
    <div class="rem-actions">
      <button type="button" class="btn-secondary" data-toggle="${h(r.id)}">${r.active ? t('pause') : t('resume')}</button>
      <button type="button" class="btn-danger" data-remove="${h(r.id)}" aria-label="${t('remove')} ${h(r.medicine)}"><i class="fas fa-trash-alt" aria-hidden="true"></i></button></div></li>`).join('')
    : '<li class="empty">—</li>';
  $('#remNotifBtn').hidden = !('Notification' in window) || Notification.permission === 'granted';
}

function notify(r) {
  const msg = `${t('takeNow')} ${r.medicine}${r.dose ? ` (${r.dose})` : ''}`;
  showToast(msg, 'warn', 15000);
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification('MediGuide AI', { body: msg, icon: 'icons/icon.svg', tag: r.id }); } catch { /* some mobile browsers need a service worker */ }
  if (isVoiceMode()) speak(msg);
}

function tick() {
  const key = `${localDate()}`;
  for (const r of list) {
    if (!dueNow(r)) continue;
    const k = `${r.id}:${key}:${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
    if (fired.has(k)) continue;
    fired.add(k); sessionStorage.setItem('mg_fired', JSON.stringify([...fired].slice(-100)));
    notify(r);
  }
}

export function initReminders({ reload } = {}) {
  $('#remMedList').innerHTML = getAll().map((m) => `<option value="${h(m.name)}"></option>`).join('');
  $('#remStart').value = localDate();
  $('#remAddTimeBtn').addEventListener('click', () => {
    const v = $('#remTimeInput').value;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return showToast(t('timesLbl'), 'warn');
    if (draft.length >= 6) return showToast('Up to 6 times a day.', 'warn');
    if (!draft.includes(v)) draft.push(v);
    renderDraft();
  });
  $('#remTimesList').addEventListener('click', (e) => { const b = e.target.closest('[data-del-time]'); if (b) { draft = draft.filter((x) => x !== b.dataset.delTime); renderDraft(); } });
  $('#remSaveBtn').addEventListener('click', save);
  $('#remNotifBtn').addEventListener('click', async () => { try { await Notification.requestPermission(); } catch { /* ignore */ } render(); });
  $('#remList').addEventListener('click', async (e) => {
    const tog = e.target.closest('[data-toggle]'); const del = e.target.closest('[data-remove]');
    if (tog) { const r = list.find((x) => x.id === tog.dataset.toggle); await patch(r.id, { server: (id) => backend.api(`/api/reminders/${id}`, { method: 'PUT', body: { active: !r.active } }), local: () => { r.active = !r.active; } }); }
    if (del) await patch(del.dataset.remove, { server: (id) => backend.api(`/api/reminders/${id}`, { method: 'DELETE' }), local: (id) => { list = list.filter((x) => x.id !== id); } });
  });
  // prefill from the medicine card / prescription table
  document.addEventListener('mg:add-reminder', (e) => {
    const d = e.detail || {};
    $('#remMedicine').value = d.medicine || ''; $('#remDose').value = d.dose || ''; $('#remDays').value = d.days || '';
    draft = [...(d.times || [])]; renderDraft();
    document.dispatchEvent(new CustomEvent('mg:goto-tab', { detail: 'pageReminders' }));
    $('#remMedicine').focus();
  });
  onLangChange(render);
  backend.onChange(() => load());
  setInterval(tick, 20000);
  load();
  void reload;
}
