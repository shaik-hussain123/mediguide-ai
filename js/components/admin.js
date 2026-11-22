/** @file Admin dashboard. Server mode: real users, audit log, server-held AI key, site-wide medicine causes. Local mode: this browser only. */
import { $, $$, escapeHtml as h, formatDate, openModal, closeModal, showToast } from '../utils/helpers.js';
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
let adminPatients = [];
let adminDoctors = [];
let adminAppointments = [];
let editingAppointmentId = null;
let adminSlotRequest = 0;

const istDate = (offset = 0) => new Date(Date.now() + 5.5 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
const apptDate = (value) => new Date(value).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

function renderAdminDoctorList() {
  $('#adminDoctorList').innerHTML = adminDoctors.length
    ? `<ul class="doctor-list">${adminDoctors.map((d) => `<li class="doctor-card"><div><strong><i class="fas fa-user-md" aria-hidden="true"></i> ${h(d.name)}</strong>
        <div class="doc-spec">${h(d.speciality)}</div><small><i class="fas fa-language" aria-hidden="true"></i> ${h(d.languages.join(', '))}</small></div>
        <small>${d.modes.map((mode) => `<span class="doctor-mode"><i class="fas ${mode === 'video' ? 'fa-video' : 'fa-hospital'}" aria-hidden="true"></i> ${h(mode)}</span>`).join(' ')}</small></li>`).join('')}</ul>`
    : '<p class="settings-note">No doctor profiles are available.</p>';
}

function renderAdminAppointments() {
  $('#adminApptList').innerHTML = adminAppointments.length ? adminAppointments.map((a) => {
    const future = a.status === 'booked' && new Date(a.start) > new Date();
    return `<li class="appt-item ${h(a.status)}"><div><strong><i class="fas fa-user" aria-hidden="true"></i> ${h(a.patient.name)}</strong>
      <small>${h(a.patient.email)}</small><div><i class="fas fa-user-md" aria-hidden="true"></i> ${h(a.doctor.name)} · ${h(apptDate(a.start))} IST</div>
      <div><i class="fas ${a.mode === 'video' ? 'fa-video' : 'fa-hospital'}" aria-hidden="true"></i> ${h(a.mode)} · <em>${h(a.status)}</em>${a.reason ? ` · ${h(a.reason)}` : ''}</div></div>
      <div class="rem-actions">${a.status === 'booked' && future ? `<button type="button" class="btn-secondary" data-reschedule="${h(a.id)}"><i class="fas fa-calendar-alt" aria-hidden="true"></i> Reschedule</button>` : ''}
      ${a.status === 'booked' ? `<button type="button" class="btn-danger" data-admin-cancel="${h(a.id)}"><i class="fas fa-calendar-times" aria-hidden="true"></i> Cancel</button>` : ''}</div></li>`;
  }).join('') : '<li class="empty"><i class="fas fa-calendar-check" aria-hidden="true"></i> No appointments in this view.</li>';
}

function setAdminAppointmentOptions() {
  const patient = $('#adminApptPatient');
  const doctor = $('#adminApptDoctor');
  const selectedPatient = patient.value;
  const selectedDoctor = doctor.value;
  patient.innerHTML = adminPatients.length
    ? `<option value="">Choose a patient</option>${adminPatients.map((u) => `<option value="${h(u.id)}">${h(u.name)} (${h(u.email)})</option>`).join('')}`
    : '<option value="">No patient accounts available</option>';
  doctor.innerHTML = adminDoctors.length
    ? `<option value="">Choose a doctor</option>${adminDoctors.map((d) => `<option value="${h(d.id)}">${h(d.name)} — ${h(d.speciality)}</option>`).join('')}`
    : '<option value="">No doctor profiles available</option>';
  if (adminPatients.some((u) => u.id === selectedPatient)) patient.value = selectedPatient;
  if (adminDoctors.some((d) => d.id === selectedDoctor)) doctor.value = selectedDoctor;
  $('#adminApptSave').disabled = !adminPatients.length || !adminDoctors.length;
  $('#adminApptDate').min = istDate(0);
  $('#adminApptDate').max = istDate(14);
  updateAdminAppointmentModes();
}

function updateAdminAppointmentModes() {
  const doctor = adminDoctors.find((d) => d.id === $('#adminApptDoctor').value);
  const select = $('#adminApptMode');
  const previous = select.value;
  select.innerHTML = (doctor?.modes || []).map((mode) => `<option value="${h(mode)}">${mode === 'video' ? 'Video visit' : 'Clinic visit'}</option>`).join('');
  if (doctor?.modes.includes(previous)) select.value = previous;
}

async function loadAdminSlots() {
  const requestId = ++adminSlotRequest;
  const doctorId = $('#adminApptDoctor').value;
  const date = $('#adminApptDate').value;
  const select = $('#adminApptSlot');
  select.disabled = true;
  select.innerHTML = '<option value="">Choose a date and doctor first</option>';
  if (!doctorId || !date) return;
  try {
    const { slots } = await backend.api(`/api/doctors/${encodeURIComponent(doctorId)}/slots?date=${encodeURIComponent(date)}`, { auth: false });
    if (requestId !== adminSlotRequest) return;
    select.innerHTML = slots.length
      ? `<option value="">Choose an available time</option>${slots.map((slot) => `<option value="${h(slot)}">${h(new Date(slot).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }))}</option>`).join('')}`
      : '<option value="">No available times</option>';
    select.disabled = !slots.length;
  } catch (error) { if (requestId === adminSlotRequest) showToast(error.message, 'error'); }
}

async function refreshAdminAppointments() {
  const { appointments } = await backend.api(`/api/admin/appointments?view=${encodeURIComponent($('#adminApptFilter').value)}`);
  adminAppointments = appointments;
  renderAdminAppointments();
}

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

async function renderOAuthPanel() {
  const panel = $('#adminOAuthBox');
  panel.hidden = !serverMode();
  if (!serverMode()) return;

  const settings = await backend.api('/api/admin/oauth');
  const configured = settings.clientIdConfigured && settings.clientSecretConfigured;
  $('#adminOAuthStatus').className = `api-status${configured ? ' active' : ''}`;
  $('#adminOAuthStatus').textContent = configured ? 'Configured' : 'Not set';
  $('#adminOAuthClientId').value = '';
  $('#adminOAuthClientId').placeholder = settings.clientIdConfigured ? 'Configured. Enter a new ID to replace it.' : 'Enter Google OAuth client ID';
  $('#adminOAuthClientSecret').value = '';
  $('#adminOAuthClientSecret').placeholder = settings.clientSecretConfigured ? 'Configured. Enter a new secret to replace it.' : 'Enter Google OAuth client secret';
  $('#adminOAuthRedirectUri').value = settings.redirectUri.startsWith('http://localhost:')
    ? `${location.origin}/api/auth/oauth/callback`
    : settings.redirectUri;
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
      $('#adminAppointmentTools').hidden = false;
      $('#adminAppointmentsUnavailable').hidden = true;
      serverStats = await backend.api('/api/admin/stats');
      const s = serverStats;
      $('#adminStatsContent').innerHTML = statGrid([['fa-pills', meds.length, 'Medicines'], ['fa-users', s.users, 'Accounts'], ['fa-user-lock', s.twoFactorUsers, 'With 2FA'],
        ['fa-calendar-check', s.appointments, 'Booked visits'], ['fa-bell', s.reminders, 'Reminders'], ['fa-robot', s.aiRequests, 'AI requests'], ['fa-building', companies().length, 'Manufacturers']]);
      const { users } = await backend.api('/api/admin/users');
      const me = currentUser();
      $('#adminUsersContent').innerHTML = table(['Name', 'Email', 'Role', '2FA', 'Created', ''], users.map((u) => {
        const role = u.role === 'admin' || u.role === 'doctor' ? 'user' : 'admin';
        const label = u.role === 'admin' ? 'Make user' : u.role === 'doctor' ? 'Remove doctor access' : 'Make admin';
        return `<tr><td>${h(u.name)}</td><td>${h(u.email)}</td><td>${h(u.role)}</td><td>${u.totpEnabled ? 'On' : 'Off'}</td><td>${h(formatDate(u.created, false))}</td>
          <td>${u.id === me.id ? '' : `<button type="button" class="btn-secondary" data-role="${role}" data-user="${h(u.id)}">${label}</button>`}</td></tr>`;
      }), 'No accounts yet.');
      adminPatients = users.filter((u) => u.role === 'user');
      adminDoctors = (await backend.api('/api/doctors', { auth: false })).doctors;
      setAdminAppointmentOptions();
      renderAdminDoctorList();
      await refreshAdminAppointments();
      const { events } = await backend.api('/api/admin/audit');
      $('#adminAuditContent').innerHTML = table(['Time', 'Event', 'Detail'], events.map((a) => `<tr><td>${h(formatDate(a.at))}</td><td>${h(a.event)}</td><td>${h(a.detail || '—')}</td></tr>`), 'No events yet.');
    } else {
      $('#adminAppointmentTools').hidden = true;
      $('#adminAppointmentsUnavailable').hidden = false;
      $('#adminStatsContent').innerHTML = `${statGrid([['fa-pills', meds.length, 'Medicines'], ['fa-building', companies().length, 'Manufacturers'], ['fa-tags', categories().length, 'Categories'],
        ['fa-users', allUsers().length, 'Local accounts'], ['fa-comments', store.get(KEYS.chat, []).length, 'Saved chat records'], ['fa-camera', store.get(KEYS.scans, []).length, 'Scans']])}
        <p class="settings-note">Local mode reads this browser's data only. Run the server (npm start) for site-wide data.</p>`;
      $('#adminUsersContent').innerHTML = table(['Name', 'Email', 'Role', 'Created'], allUsers().map((u) => `<tr><td>${h(u.name)}</td><td>${h(u.email)}</td><td>${h(u.role)}</td><td>${h(formatDate(u.created, false))}</td></tr>`), 'No accounts on this device yet.');
      $('#adminAuditContent').innerHTML = table(['Time', 'Event', 'Detail'], audit.all().map((a) => `<tr><td>${h(formatDate(a.t))}</td><td>${h(a.event)}</td><td>${h(a.detail || '—')}</td></tr>`), 'No events yet.');
    }
  } catch (e) { showToast(e.message, 'error'); }
  try { await renderOAuthPanel(); } catch (e) { showToast(e.message, 'error'); }
  renderKeyPanel(); renderMeds();
}

export function initAdmin() {
  // Every action re-checks the role. In server mode the server enforces it too (403); local mode is a demo only.
  const guard = () => { if (isAdmin()) return true; showToast('Admin access only.', 'warn'); return false; };
  const changed = () => document.dispatchEvent(new CustomEvent('mg:data-changed'));

  $('#adminPanelBtn').addEventListener('click', () => {
    if (!guard()) return;
    closeProfileAndOpenAdmin();
  });

  async function closeProfileAndOpenAdmin() {
    closeModal('profileModal');
    await render();
    openModal('adminModal');
  }

  $$('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.admin-tab').forEach((item) => {
        const active = item === tab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      $$('.admin-panel').forEach((panel) => { panel.hidden = panel.id !== tab.dataset.panel; });
    });
  });

  // Admin panel button removed - access controlled via authentication and permissions only
  // Admin panel access requires server-side permission check - not accessible via UI navigation
  // Tab switching handled elsewhere if needed

  function resetAdminAppointmentForm() {
    editingAppointmentId = null;
    $('#adminApptPatient').disabled = false;
    $('#adminApptPatient').value = '';
    $('#adminApptDoctor').value = '';
    $('#adminApptDate').value = '';
    $('#adminApptSlot').innerHTML = '<option value="">Choose a date and doctor first</option>';
    $('#adminApptSlot').disabled = true;
    $('#adminApptReason').value = '';
    $('#adminApptSave').innerHTML = '<i class="fas fa-calendar-plus" aria-hidden="true"></i> Create appointment';
    $('#adminApptReset').hidden = true;
    $('#adminApptMessage').textContent = '';
    updateAdminAppointmentModes();
  }

  $('#adminApptDoctor').addEventListener('change', () => {
    updateAdminAppointmentModes();
    loadAdminSlots();
  });
  $('#adminApptDate').addEventListener('change', loadAdminSlots);
  $('#adminApptFilter').addEventListener('change', async () => {
    try { await refreshAdminAppointments(); } catch (error) { showToast(error.message, 'error'); }
  });
  $('#adminApptSave').addEventListener('click', async () => {
    if (!guard()) return;
    const body = {
      userId: $('#adminApptPatient').value,
      doctorId: $('#adminApptDoctor').value,
      start: $('#adminApptSlot').value,
      mode: $('#adminApptMode').value,
      reason: $('#adminApptReason').value,
    };
    if ((!editingAppointmentId && !body.userId) || !body.doctorId || !body.start || !body.mode) {
      $('#adminApptMessage').textContent = 'Choose a patient, doctor, date, and available time.';
      return;
    }
    try {
      const path = editingAppointmentId ? `/api/admin/appointments/${editingAppointmentId}` : '/api/admin/appointments';
      await backend.api(path, { method: editingAppointmentId ? 'PUT' : 'POST', body });
      showToast(editingAppointmentId ? 'Appointment rescheduled.' : 'Appointment created.', 'success');
      resetAdminAppointmentForm();
      await refreshAdminAppointments();
    } catch (error) {
      $('#adminApptMessage').textContent = error.message;
      if (error.status === 409) loadAdminSlots();
    }
  });
  $('#adminApptReset').addEventListener('click', resetAdminAppointmentForm);
  $('#adminApptList').addEventListener('click', async (event) => {
    const reschedule = event.target.closest('[data-reschedule]');
    const cancel = event.target.closest('[data-admin-cancel]');
    if (reschedule) {
      const appointment = adminAppointments.find((item) => item.id === reschedule.dataset.reschedule);
      if (!appointment) return;
      editingAppointmentId = appointment.id;
      $('#adminApptPatient').value = appointment.patient.id;
      $('#adminApptPatient').disabled = true;
      $('#adminApptDoctor').value = appointment.doctor.id;
      updateAdminAppointmentModes();
      $('#adminApptMode').value = appointment.mode;
      $('#adminApptDate').value = '';
      $('#adminApptSlot').innerHTML = '<option value="">Choose a new date and time</option>';
      $('#adminApptSlot').disabled = true;
      $('#adminApptReason').value = appointment.reason || '';
      $('#adminApptSave').innerHTML = '<i class="fas fa-calendar-check" aria-hidden="true"></i> Save new time';
      $('#adminApptReset').hidden = false;
      $('#adminApptMessage').textContent = `Rescheduling ${appointment.patient.name}'s appointment.`;
      $('#adminApptDate').focus();
      return;
    }
    if (!cancel || !guard() || !window.confirm('Cancel this appointment?')) return;
    try {
      await backend.api(`/api/admin/appointments/${cancel.dataset.adminCancel}`, { method: 'DELETE' });
      showToast('Appointment cancelled.', 'success');
      await refreshAdminAppointments();
    } catch (error) { showToast(error.message, 'error'); }
  });
  $('#adminDoctorForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!guard()) return;
    const modes = $$('input[name="adminDoctorMode"]:checked').map((input) => input.value);
    const body = {
      name: $('#adminDoctorName').value,
      email: $('#adminDoctorEmail').value,
      password: $('#adminDoctorPassword').value,
      speciality: $('#adminDoctorSpeciality').value,
      languages: $('#adminDoctorLanguages').value.split(',').map((language) => language.trim()).filter(Boolean),
      bio: $('#adminDoctorBio').value,
      modes,
    };
    try {
      await backend.api('/api/admin/doctors', { method: 'POST', body });
    } catch (error) { showToast(error.message, 'error'); return; }
    $('#adminDoctorForm').reset();
    showToast('Doctor login created. The password was not retained or displayed.', 'success');
    try {
      adminDoctors = (await backend.api('/api/doctors', { auth: false })).doctors;
      setAdminAppointmentOptions();
      renderAdminDoctorList();
    } catch (error) { showToast(`Doctor login was created, but the list could not be refreshed: ${error.message}`, 'error'); }
  });

  $('#adminToggleKey').addEventListener('click', () => {
    const i = $('#adminApiKey'); const show = i.type === 'password';
    i.type = show ? 'text' : 'password'; $('#adminToggleKey i').className = `fas ${show ? 'fa-eye-slash' : 'fa-eye'}`;
  });
  $('#adminToggleOAuthSecret').addEventListener('click', () => {
    const input = $('#adminOAuthClientSecret'); const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('#adminToggleOAuthSecret i').className = `fas ${show ? 'fa-eye-slash' : 'fa-eye'}`;
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

  $('#adminSaveOAuth').addEventListener('click', async () => {
    if (!guard()) return;
    try {
      const settings = await backend.api('/api/admin/oauth', {
        method: 'PUT',
        body: {
          clientId: $('#adminOAuthClientId').value.trim() || undefined,
          clientSecret: $('#adminOAuthClientSecret').value.trim() || undefined,
          redirectUri: $('#adminOAuthRedirectUri').value.trim(),
        },
      });
      $('#adminOAuthClientSecret').value = '';
      await renderOAuthPanel();
      if (settings.clientIdConfigured && settings.clientSecretConfigured) showToast('Google OAuth settings saved.', 'success');
      else showToast('Callback URL saved. Add both OAuth client ID and client secret to enable Google sign-in.', 'warn');
    } catch (e) { showToast(e.message, 'error'); }
  });

  $('#adminRemoveOAuth').addEventListener('click', async () => {
    if (!guard() || !window.confirm('Remove the OAuth settings saved in this app? Environment-configured credentials will remain active.')) return;
    try {
      await backend.api('/api/admin/oauth', { method: 'PUT', body: { clear: true } });
      await renderOAuthPanel();
      showToast('Saved OAuth settings removed.', 'success');
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
