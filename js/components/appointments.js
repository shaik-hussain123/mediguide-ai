/** @file Doctor discovery, slot booking and teleconsultation links (needs the MediGuide server + login). */
import { $, escapeHtml as h, showToast } from '../utils/helpers.js';
import * as backend from '../services/backend.js';
import { t, onLangChange } from '../i18n.js';

let doctors = [];
let selected = null;      // {doctor, date, slot, mode}
const IST = { timeZone: 'Asia/Kolkata' };
const fmt = (iso) => new Date(iso).toLocaleString('en-IN', { ...IST, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { ...IST, hour: '2-digit', minute: '2-digit' });
const istDate = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

/** Join window: 15 minutes before to 90 minutes after the start. */
export const canJoin = (startIso, now = Date.now()) => { const s = new Date(startIso).getTime(); return now >= s - 15 * 60e3 && now <= s + 90 * 60e3; };

async function load() {
  const gate = $('#careGate');
  if (!backend.isOnline()) { gate.hidden = false; gate.textContent = t('needServer'); $('#careBody').hidden = true; return; }
  if (!backend.getUser()) { gate.hidden = false; gate.textContent = t('loginToBook'); $('#careBody').hidden = true; return; }
  gate.hidden = true; $('#careBody').hidden = false;
  const isDoctor = backend.getUser().role === 'doctor';
  $('#patientCareBody').hidden = isDoctor;
  $('#doctorPortal').hidden = !isDoctor;
  try {
    if (isDoctor) {
      const { appointments } = await backend.api('/api/doctor/appointments');
      renderDoctorAppointments(appointments);
      return;
    }
    if (!doctors.length) doctors = (await backend.api('/api/doctors', { auth: false })).doctors;
    renderDoctors();
    const { appointments } = await backend.api('/api/appointments');
    renderAppointments(appointments);
  } catch (e) { showToast(e.message, 'error'); }
}

function renderDoctors() {
  $('#doctorList').innerHTML = doctors.map((d) => `<li class="doctor-card"><div><strong>${h(d.name)}</strong><div class="doc-spec">${h(d.speciality)}</div>
    <small>${h(d.languages.join(', '))}</small><p>${h(d.bio)}</p></div>
    <button type="button" class="btn-primary" data-book="${h(d.id)}"><i class="fas fa-calendar-plus" aria-hidden="true"></i> ${t('book')}</button></li>`).join('');
}

function renderAppointments(list) {
  $('#apptList').innerHTML = list.length ? list.map((a) => {
    const upcoming = a.status === 'booked' && new Date(a.start) > new Date();
    const joinable = a.room && canJoin(a.start);
    return `<li class="appt-item ${a.status}"><div><strong>${h(a.doctor.name)}</strong> <small>${h(a.doctor.speciality)}</small>
      <div>${h(fmt(a.start))} IST · ${a.mode === 'video' ? t('videoCall') : t('clinic')} · <em>${h(a.status)}</em></div>${a.reason ? `<small>${h(a.reason)}</small>` : ''}</div>
      <div class="rem-actions">${a.mode === 'video' && a.status === 'booked' ? (joinable
        ? `<a class="btn-primary" href="${h(a.room)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-video" aria-hidden="true"></i> ${t('join')}</a>`
        : `<button type="button" class="btn-secondary" disabled>${t('join')} (−15 min)</button>`) : ''}
        ${upcoming ? `<button type="button" class="btn-danger" data-cancel="${h(a.id)}">${t('cancel')}</button>` : ''}</div></li>`;
  }).join('') : '<li class="empty">—</li>';
}

function renderDoctorAppointments(list) {
  $('#doctorApptList').innerHTML = list.length ? list.map((a) => {
    const future = a.status === 'booked' && new Date(a.start) > new Date();
    const action = a.canUpdate && a.status === 'booked'
      ? `<button type="button" class="${future ? 'btn-danger' : 'btn-primary'}" data-doctor-status="${future ? 'cancelled' : 'completed'}" data-appointment="${h(a.id)}">
          <i class="fas ${future ? 'fa-calendar-times' : 'fa-check-circle'}" aria-hidden="true"></i> ${future ? 'Cancel appointment' : 'Mark completed'}</button>`
      : '';
    return `<li class="appt-item ${h(a.status)}"><div><strong><i class="fas fa-user" aria-hidden="true"></i> ${h(a.patient.name)}</strong>
      <small>${h(a.patient.email)}</small><div><i class="fas fa-user-md" aria-hidden="true"></i> ${h(a.doctor.name)} · ${h(fmt(a.start))} IST · ${a.mode === 'video' ? t('videoCall') : t('clinic')}</div>
      <div><i class="fas fa-info-circle" aria-hidden="true"></i> <em>${h(a.status)}</em>${a.reason ? ` · ${h(a.reason)}` : ''}</div>
      ${a.room ? `<a class="btn-primary" href="${h(a.room)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-video" aria-hidden="true"></i> Open visit</a>` : ''}</div>
      ${action ? `<div class="rem-actions">${action}</div>` : ''}</li>`;
  }).join('') : '<li class="empty"><i class="fas fa-calendar-check" aria-hidden="true"></i> No appointments to show.</li>';
}

async function loadSlots() {
  const date = $('#bookDate').value; if (!selected || !date) return;
  selected.date = date; selected.slot = null; $('#bookConfirm').disabled = true;
  try {
    const { slots } = await backend.api(`/api/doctors/${selected.doctor.id}/slots?date=${date}`, { auth: false });
    $('#slotList').innerHTML = slots.length ? slots.map((s) => `<button type="button" class="slot-btn" data-slot="${h(s)}" aria-pressed="false">${h(fmtTime(s))}</button>`).join('') : `<span class="empty">—</span>`;
  } catch (e) { showToast(e.message, 'error'); }
}

export function initAppointments() {
  $('#bookDate').min = istDate(0); $('#bookDate').max = istDate(14);
  $('#doctorList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-book]'); if (!b) return;
    const doctor = doctors.find((d) => d.id === b.dataset.book);
    selected = { doctor, mode: doctor.modes.includes('video') ? 'video' : 'clinic' };
    $('#bookTitle').textContent = doctor.name;
    $('#bookMode').innerHTML = doctor.modes.map((m) => `<option value="${m}">${m === 'video' ? t('videoCall') : t('clinic')}</option>`).join('');
    $('#bookDate').value = ''; $('#slotList').innerHTML = ''; $('#bookConfirm').disabled = true; $('#bookPanel').hidden = false;
    $('#bookDate').focus();
  });
  $('#bookDate').addEventListener('change', loadSlots);
  $('#slotList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-slot]'); if (!b) return;
    selected.slot = b.dataset.slot;
    $('#slotList').querySelectorAll('.slot-btn').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('#bookConfirm').disabled = false;
  });
  $('#bookConfirm').addEventListener('click', async () => {
    if (!selected?.slot) return showToast(t('pickSlot'), 'warn');
    try {
      await backend.api('/api/appointments', { method: 'POST', body: { doctorId: selected.doctor.id, start: selected.slot, mode: $('#bookMode').value, reason: $('#bookReason').value } });
      showToast(t('confirm'), 'success'); $('#bookPanel').hidden = true; $('#bookReason').value = ''; selected = null; await load();
    } catch (e) { showToast(e.message, 'error'); if (e.status === 409) loadSlots(); }
  });
  $('#bookCancel').addEventListener('click', () => { $('#bookPanel').hidden = true; selected = null; });
  $('#apptList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cancel]'); if (!b || !window.confirm(`${t('cancel')}?`)) return;
    try { await backend.api(`/api/appointments/${b.dataset.cancel}`, { method: 'DELETE' }); await load(); } catch (err) { showToast(err.message, 'error'); }
  });
  $('#doctorApptList').addEventListener('click', async (e) => {
    const button = e.target.closest('[data-doctor-status]');
    if (!button) return;
    const status = button.dataset.doctorStatus;
    if (status === 'cancelled' && !window.confirm('Cancel this appointment?')) return;
    try {
      await backend.api(`/api/doctor/appointments/${button.dataset.appointment}`, { method: 'PATCH', body: { status } });
      showToast(status === 'completed' ? 'Appointment marked completed.' : 'Appointment cancelled.', 'success');
      await load();
    } catch (err) { showToast(err.message, 'error'); }
  });
  onLangChange(() => { renderDoctors(); load(); });
  backend.onChange(load);
  load();
}
