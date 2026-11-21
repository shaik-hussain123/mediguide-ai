/**
 * @file Medication Tracker component.
 * Features: schedule management, dose logging, adherence dashboard.
 */
import { $, $$, showToast, escapeHtml as h, formatDate } from '../utils/helpers.js';
import * as backend from '../services/backend.js';
import { t, currentLang, onLangChange } from '../i18n.js';
import { currentUser } from './auth.js';

const SLOT_LABELS = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
  bedtime: 'Bedtime'
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS_LABELS = {
  taken: { label: 'Taken', icon: 'fa-check-circle', color: 'var(--good)' },
  skipped: { label: 'Skipped', icon: 'fa-minus-circle', color: 'var(--warn)' },
  missed: { label: 'Missed', icon: 'fa-times-circle', color: 'var(--bad)' }
};

let currentScheduleId = null;
let adherenceChart = null;

function timeToSlot(timeStr) {
  const hour = parseInt(timeStr.split(':')[0], 10);
  if (hour < 10) return 'morning';
  if (hour < 14) return 'afternoon';
  if (hour < 19) return 'evening';
  return 'night';
}

function formatTimeForInput(dateStr) {
  // Convert ISO string to HH:MM for time input
  try {
    const d = new Date(dateStr);
    return d.toTimeString().slice(0, 5);
  } catch {
    return '';
  }
}

function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

async function loadSchedules() {
  const container = $('#scheduleList');
  if (!container) return;

  try {
    const data = await backend.api('/api/schedules', { auth: true });
    renderScheduleList(data.schedules || []);
  } catch (err) {
    console.error('Failed to load schedules:', err);
    container.innerHTML = `<div class="tracker-error">${h(err.message || 'Failed to load schedules')}</div>`;
  }
}

function renderScheduleList(schedules) {
  const container = $('#scheduleList');
  if (!container) return;

  if (!schedules.length) {
    container.innerHTML = `
      <div class="tracker-empty">
        <i class="fas fa-calendar-plus" aria-hidden="true"></i>
        <p>No medication schedules yet</p>
        <button class="btn-primary" id="createFirstScheduleBtn">${t('addSchedule')}</button>
      </div>
    `;
    $('#createFirstScheduleBtn')?.addEventListener('click', () => openScheduleModal());
    return;
  }

  container.innerHTML = schedules.map(schedule => `
    <article class="schedule-card" data-id="${h(schedule._id)}">
      <div class="schedule-header">
        <div class="schedule-med">
          <strong>${h(schedule.med_name)}</strong>
          <small>${h(schedule.dosage)}</small>
        </div>
        <div class="schedule-status ${schedule.active ? 'active' : 'inactive'}">
          ${schedule.active ? '<span class="status-dot"></span> Active' : 'Inactive'}
        </div>
      </div>
      <div class="schedule-times">
        ${schedule.times.map(t => `<span class="time-chip" data-slot="${timeToSlot(t)}">${h(t)}</span>`).join('')}
      </div>
      <div class="schedule-days">
        ${schedule.days.map((d, i) => d ? `<span class="day-chip active">${DAY_LABELS[i]}</span>` : `<span class="day-chip">${DAY_LABELS[i]}</span>`).join('')}
      </div>
      <div class="schedule-actions">
        <button type="button" class="btn-icon btn-view" data-action="view" aria-label="View details">
          <i class="fas fa-eye" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn-icon btn-log" data-action="log" aria-label="Log dose">
          <i class="fas fa-pill" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn-icon btn-edit" data-action="edit" aria-label="Edit schedule">
          <i class="fas fa-edit" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn-icon btn-delete" data-action="delete" aria-label="Delete schedule">
          <i class="fas fa-trash" aria-hidden="true"></i>
        </button>
      </div>
    </article>
  `).join('');

  // Add event listeners
  container.querySelectorAll('.schedule-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-action="view"]')?.addEventListener('click', () => openScheduleDetail(id));
    card.querySelector('[data-action="log"]')?.addEventListener('click', () => openQuickLog(id));
    card.querySelector('[data-action="edit"]')?.addEventListener('click', () => openScheduleModal(id));
    card.querySelector('[data-action="delete"]')?.addEventListener('click', () => confirmDeleteSchedule(id));
  });
}

async function openScheduleDetail(scheduleId) {
  try {
    const data = await backend.api(`/api/schedules/${scheduleId}`, { auth: true });
    currentScheduleId = scheduleId;
    renderScheduleDetail(data.schedule, data.logs || []);
    openModal('scheduleDetailModal');
  } catch (err) {
    showToast(err.message || 'Failed to load schedule details', 'error');
  }
}

function renderScheduleDetail(schedule, logs) {
  const scheduleInfo = $('#scheduleDetailInfo');
  const logsList = $('#scheduleLogsList');
  const adherenceContainer = $('#adherenceContainer');

  if (!scheduleInfo || !logsList) return;

  // Schedule info
  scheduleInfo.innerHTML = `
    <div class="detail-row"><strong>${t('medicine')}:</strong> ${h(schedule.med_name)}</div>
    <div class="detail-row"><strong>${t('dosage')}:</strong> ${h(schedule.dosage)}</div>
    <div class="detail-row"><strong>${t('times')}:</strong> ${schedule.times.map(t => `<span class="time-chip">${h(t)}</span>`).join('')}</div>
    <div class="detail-row"><strong>${t('days')}:</strong> ${schedule.days.map((d, i) => d ? `<span class="day-chip active">${DAY_LABELS[i]}</span>` : `<span class="day-chip">${DAY_LABELS[i]}</span>`).join('')}</div>
    <div class="detail-row"><strong>${t('startDate')}:</strong> ${formatDate(schedule.start_date)}</div>
    ${schedule.end_date ? `<div class="detail-row"><strong>${t('endDate')}:</strong> ${formatDate(schedule.end_date)}</div>` : ''}
    ${schedule.notes ? `<div class="detail-row"><strong>${t('notes')}:</strong> ${h(schedule.notes)}</div>` : ''}
  `;

  // Logs
  if (!logs.length) {
    logsList.innerHTML = `<div class="tracker-empty"><p>No doses logged yet</p></div>`;
  } else {
    logsList.innerHTML = logs.map(log => `
      <div class="log-entry ${log.status}">
        <div class="log-status">
          <i class="fas ${STATUS_LABELS[log.status]?.icon || 'fa-circle'}" style="color: ${STATUS_LABELS[log.status]?.color || 'var(--muted)'}" aria-hidden="true"></i>
          <span>${h(STATUS_LABELS[log.status]?.label || log.status)}</span>
        </div>
        <div class="log-time">${formatDate(log.scheduled_time)}</div>
        ${log.notes ? `<div class="log-notes">${h(log.notes)}</div>` : ''}
        <div class="log-meta">Logged: ${formatDate(log.logged_at)}</div>
      </div>
    `).join('');
  }

  // Load adherence chart
  loadAdherenceChart(schedule._id);
}

async function loadAdherenceChart(scheduleId) {
  try {
    const data = await backend.api(`/api/schedules/${scheduleId}/adherence?days=30`, { auth: true });
    renderAdherenceChart(data);
  } catch (err) {
    console.error('Failed to load adherence:', err);
    const container = $('#adherenceChart');
    if (container) container.innerHTML = `<p class="tracker-error">Failed to load adherence chart</p>`;
  }
}

function renderAdherenceChart(data) {
  const container = $('#adherenceChart');
  const summary = $('#adherenceSummary');
  if (!container) return;

  const pct = data.adherence_percentage || 0;
  const color = pct >= 80 ? 'var(--good)' : pct >= 60 ? 'var(--warn)' : 'var(--bad)';

  summary.innerHTML = `
    <div class="adherence-score" style="color: ${color}">${pct}%</div>
    <div class="adherence-stats">
      <span>${data.taken}/${data.total_scheduled} taken</span>
      <span>${data.missed} missed</span>
      <span>${data.skipped} skipped</span>
    </div>
  `;

  // Simple SVG donut chart
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  container.innerHTML = `
    <svg class="adherence-chart" width="120" height="120" role="img" aria-label="Adherence ${pct}%">
      <circle class="chart-bg" cx="60" cy="60" r="${radius}" fill="none" stroke="var(--border)" stroke-width="8"/>
      <circle class="chart-progress" cx="60" cy="60" r="${radius}" fill="none" stroke="${color}" stroke-width="8"
        stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"
        style="transform: rotate(-90deg); transform-origin: 60px 60px; transition: stroke-dashoffset 0.5s ease;"/>
      <text x="60" y="65" text-anchor="middle" font-size="24" font-weight="700" fill="var(--text)">${pct}%</text>
    </svg>
  `;
}

function openScheduleModal(scheduleId = null) {
  const isEdit = !!scheduleId;
  $('#scheduleModalTitle').textContent = isEdit ? t('editSchedule') : t('addSchedule');
  $('#scheduleForm').reset();
  $('#scheduleId').value = scheduleId || '';

  // Set default start date to today
  $('#scheduleStartDate').value = getTodayDateString();

  // Populate medicine dropdown
  populateMedicineSelect();

  if (isEdit) {
    loadScheduleForEdit(scheduleId);
  }

  openModal('scheduleModal');
}

async function populateMedicineSelect() {
  const select = $('#scheduleMedicine');
  if (!select) return;

  try {
    const data = await backend.api('/api/medicine/search?limit=100', { auth: false });
    select.innerHTML = '<option value="">Select a medicine</option>' +
      data.results.map(m => `<option value="${m.id}" data-name="${h(m.name)}" data-dosage="${h(m.dosage || '')}">${h(m.name)} (${h(m.strength || '')})</option>`).join('');
  } catch (err) {
    console.error('Failed to load medicines:', err);
  }
}

async function loadScheduleForEdit(scheduleId) {
  try {
    const data = await backend.api(`/api/schedules/${scheduleId}`, { auth: true });
    const schedule = data.schedule;

    $('#scheduleMedicine').value = schedule.med_id;
    $('#scheduleDosage').value = schedule.dosage;
    $('#scheduleTimes').value = schedule.times.join(', ');
    $('#scheduleDays').value = schedule.days.join(',');
    $('#scheduleStartDate').value = schedule.start_date;
    $('#scheduleEndDate').value = schedule.end_date || '';
    $('#scheduleNotes').value = schedule.notes || '';
  } catch (err) {
    showToast(err.message || 'Failed to load schedule for editing', 'error');
  }
}

async function saveSchedule(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

  const scheduleId = $('#scheduleId').value;
  const medId = parseInt($('#scheduleMedicine').value, 10);
  const medOption = $('#scheduleMedicine').options[$('#scheduleMedicine').selectedIndex];
  const medName = medOption.dataset.name || '';
  const dosage = $('#scheduleDosage').value;
  const times = $('#scheduleTimes').value.split(',').map(t => t.trim()).filter(Boolean);
  const days = $('#scheduleDays').value.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d));
  const startDate = $('#scheduleStartDate').value;
  const endDate = $('#scheduleEndDate').value || null;
  const notes = $('#scheduleNotes').value;

  if (!medId || !dosage || !times.length) {
    showToast('Please fill all required fields', 'error');
    btn.disabled = false;
    btn.innerHTML = originalText;
    return;
  }

  try {
    if (scheduleId) {
      await backend.api(`/api/schedules/${scheduleId}`, {
        method: 'PUT',
        body: { times, days, end_date: endDate, notes },
        auth: true
      });
      showToast('Schedule updated', 'success');
    } else {
      await backend.api('/api/schedules', {
        method: 'POST',
        body: { med_id: medId, med_name: medName, dosage, times, days, start_date: startDate, end_date: endDate, notes },
        auth: true
      });
      showToast('Schedule created', 'success');
    }
    closeModal('scheduleModal');
    loadSchedules();
  } catch (err) {
    showToast(err.message || 'Failed to save schedule', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function confirmDeleteSchedule(scheduleId) {
  if (!confirm('Delete this medication schedule?')) return;
  try {
    await backend.api(`/api/schedules/${scheduleId}`, { method: 'DELETE', auth: true });
    showToast('Schedule deleted', 'success');
    loadSchedules();
  } catch (err) {
    showToast(err.message || 'Failed to delete schedule', 'error');
  }
}

async function openQuickLog(scheduleId) {
  currentScheduleId = scheduleId;
  $('#quickLogTime').value = new Date().toTimeString().slice(0, 5);
  openModal('quickLogModal');
}

async function saveQuickLog(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging...';

  const status = $('#quickLogStatus').value;
  const time = $('#quickLogTime').value;
  const notes = $('#quickLogNotes').value;

  // Combine today's date with the time
  const today = new Date().toISOString().split('T')[0];
  const scheduledTime = `${today}T${time}:00`;

  try {
    await backend.api(`/api/schedules/${currentScheduleId}/log`, {
      method: 'POST',
      body: { schedule_id: currentScheduleId, scheduled_time: scheduledTime, status, notes },
      auth: true
    });
    showToast(`Dose marked as ${status}`, 'success');
    closeModal('quickLogModal');
    if (currentScheduleId) {
      const data = await backend.api(`/api/schedules/${currentScheduleId}`, { auth: true });
      renderScheduleDetail(data.schedule, data.logs || []);
    }
    loadSchedules();
  } catch (err) {
    showToast(err.message || 'Failed to log dose', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

function initMedicationTracker() {
  // Check if tracker page is visible
  const page = $('#pageTracker');
  if (!page || page.hidden) return;

  // Load schedules
  loadSchedules();

  // Event listeners
  $('#addScheduleBtn')?.addEventListener('click', () => openScheduleModal());
  $('#scheduleForm')?.addEventListener('submit', saveSchedule);
  $('#quickLogForm')?.addEventListener('submit', saveQuickLog);

  // Time input helper - quick add common times
  $('#scheduleTimes')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val && !val.includes(',')) {
        e.target.value = val + ', ';
      }
    }
  });
}

export { initMedicationTracker, loadSchedules };