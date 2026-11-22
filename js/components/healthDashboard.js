/** Personal medication analytics, a non-diagnostic review checklist and printable health report. */
import { $, $$, escapeHtml as h, showToast } from '../utils/helpers.js';
import * as backend from '../services/backend.js';
import { buildReport } from './healthReport.js';

let reportData = null;
let healthRequest = 0;
let shareListRequest = 0;

function renderAnalytics(summary) {
  const medications = summary.medications;
  const adherence = medications.adherencePercentage;
  $('#healthAnalytics').innerHTML = `<div class="health-stat-grid">
    <article class="health-stat"><i class="fas fa-pills" aria-hidden="true"></i><strong>${h(medications.activeSchedules)}</strong><span>Active schedules</span></article>
    <article class="health-stat"><i class="fas fa-calendar-check" aria-hidden="true"></i><strong>${h(summary.appointments.upcoming)}</strong><span>Upcoming appointments</span></article>
    <article class="health-stat"><i class="fas fa-bell" aria-hidden="true"></i><strong>${h(summary.activeReminders)}</strong><span>Active reminders</span></article>
  </div>
  <div class="health-adherence">
    <div><i class="fas fa-chart-bar" aria-hidden="true"></i> Dose activity over the past ${h(summary.periodDays)} days</div>
    ${adherence == null
      ? '<p>No dose records yet. Log doses in Medication Tracker to see adherence.</p>'
      : `<p><strong>${h(adherence)}% taken</strong> from ${h(medications.trackedDoses)} recorded dose${medications.trackedDoses === 1 ? '' : 's'}.</p>
        <progress value="${h(adherence)}" max="100" aria-label="Recorded doses taken: ${h(adherence)} percent">${h(adherence)}%</progress>
        <div class="health-dose-counts"><span><i class="fas fa-check-circle" aria-hidden="true"></i> Taken: ${h(medications.taken)}</span>
        <span><i class="fas fa-minus-circle" aria-hidden="true"></i> Skipped: ${h(medications.skipped)}</span>
        <span><i class="fas fa-times-circle" aria-hidden="true"></i> Missed: ${h(medications.missed)}</span></div>`}
  </div>
  <p class="settings-note">These counts come from your records only. They do not measure health or treatment outcomes.</p>`;
}

function renderChecklist(summary, schedules) {
  const profile = summary.profile;
  const items = [
    ['fa-user-check', profile.age ? `Age recorded: ${profile.age}` : 'Add your age to your profile if you want it included in medicine reviews.'],
    ['fa-weight', profile.weight ? `Weight recorded: ${profile.weight} kg` : 'Add your current weight if you want it included in medicine reviews.'],
    ['fa-allergies', profile.allergies ? `Allergies listed: ${profile.allergies}. Confirm the list with your clinician.` : 'No allergies are listed. Add them to your profile if applicable.'],
    ['fa-notes-medical', profile.conditions ? `Conditions listed: ${profile.conditions}. Keep this list current.` : 'No health conditions are listed. Add them if applicable.'],
    ['fa-pills', schedules.length ? `Medication list has ${schedules.length} schedule${schedules.length === 1 ? '' : 's'}. Review it when medicines change.` : 'No medication schedules are recorded. Keep a current list of medicines you take.'],
  ];
  $('#healthRiskChecklist').innerHTML = items.map(([icon, text]) => `<li><i class="fas ${icon}" aria-hidden="true"></i><span>${h(text)}</span></li>`).join('');
}

function selectedReportSections() {
  return $$('input[name="reportSection"]:checked').map((input) => input.value);
}

function renderReportShares(shares) {
  const list = $('#healthReportShareList');
  if (!shares.length) {
    list.innerHTML = '<p>No report links to manage.</p>';
    return;
  }
  list.innerHTML = `<ul class="report-share-list">${shares.map((share) => {
    const active = !share.revoked_at && Date.parse(share.expires_at) > Date.now();
    return `<li><strong>${active ? 'Active' : 'Revoked'}</strong> — Expires ${h(new Date(share.expires_at).toLocaleString())}
      ${active ? `<button class="btn-secondary" type="button" data-share-id="${h(share.id)}">Revoke link</button>` : ''}</li>`;
  }).join('')}</ul>`;
}

async function loadReportShares(userId) {
  const requestId = ++shareListRequest;
  const list = $('#healthReportShareList');
  list.textContent = 'Loading report links…';
  try {
    const data = await backend.api('/api/health/report-shares');
    if (requestId !== shareListRequest || backend.getUser()?.id !== userId) return;
    renderReportShares(data.shares || []);
  } catch (error) {
    if (requestId !== shareListRequest) return;
    list.textContent = `Could not load report links. ${error.message}`;
  }
}

async function loadHealth() {
  const requestId = ++healthRequest;
  const gate = $('#healthGate');
  const user = backend.getUser();
  if (!backend.isOnline()) {
    reportData = null;
    $('#generateHealthReport').disabled = true;
    $('#shareHealthReport').disabled = true;
    gate.hidden = false; gate.textContent = 'Health analytics and reports require the MediGuide server.';
    $('#healthBody').hidden = true; return;
  }
  if (!user) {
    reportData = null;
    $('#generateHealthReport').disabled = true;
    $('#shareHealthReport').disabled = true;
    gate.hidden = false; gate.textContent = 'Log in to view your private health dashboard.';
    $('#healthBody').hidden = true; return;
  }
  if (user.role !== 'user') {
    reportData = null;
    $('#generateHealthReport').disabled = true;
    $('#shareHealthReport').disabled = true;
    gate.hidden = false; gate.textContent = 'This private health dashboard is available to patient accounts.';
    $('#healthBody').hidden = true; return;
  }
  reportData = null;
  $('#generateHealthReport').disabled = true;
  $('#shareHealthReport').disabled = true;
  gate.hidden = false;
  gate.textContent = 'Loading your private health data…';
  $('#healthBody').hidden = true;
  try {
    const [summaryData, scheduleData, appointmentData] = await Promise.all([
      backend.api('/api/health/summary'),
      backend.api('/api/schedules'),
      backend.api('/api/appointments'),
    ]);
    if (requestId !== healthRequest || backend.getUser()?.id !== user.id) return;
    renderAnalytics(summaryData);
    renderChecklist(summaryData, scheduleData.schedules || []);
    gate.hidden = true;
    $('#healthBody').hidden = false;
    $('#generateHealthReport').disabled = false;
    $('#shareHealthReport').disabled = false;
    reportData = {
      user, summary: summaryData, schedules: scheduleData.schedules || [], appointments: appointmentData.appointments || [],
    };
    void loadReportShares(user.id);
  } catch (error) {
    if (requestId !== healthRequest) return;
    reportData = null;
    $('#healthAnalytics').innerHTML = `<p class="tracker-error">${h(error.message)}</p>`;
    $('#healthGate').textContent = 'Could not load your health data. Check your connection and try again.';
    $('#healthGate').hidden = false;
    $('#healthBody').hidden = true;
    $('#generateHealthReport').disabled = true;
    $('#shareHealthReport').disabled = true;
  }
}

export function initHealthDashboard() {
  $('#healthRefresh').addEventListener('click', loadHealth);
  $('#healthEditProfile').addEventListener('click', () => $('#profileBtn').click());
  $('#shareHealthReport').addEventListener('click', async () => {
    const sections = selectedReportSections();
    if (!sections.length) return showToast('Select at least one report section.', 'warn');
    if (!reportData) return showToast('Refresh your dashboard before sharing a report.', 'error');
    const button = $('#shareHealthReport');
    button.disabled = true;
    try {
      const share = await backend.api('/api/health/report-shares', { method: 'POST', body: { sections } });
      const link = `${window.location.origin}/shared-report.html#${encodeURIComponent(share.token)}`;
      const result = $('#healthReportShareResult');
      result.dataset.shareId = share.shareId;
      result.innerHTML = `<p>This link lets anyone who has it view the selected report sections until ${h(new Date(share.expiresAt).toLocaleString())}. Revoke it any time.</p>
        <div class="report-share-link"><label for="healthReportShareLink">Share link</label><input id="healthReportShareLink" type="url" readonly value="${h(link)}" /><button class="btn-secondary" id="copyHealthReportLink" type="button">Copy link</button></div>`;
      result.hidden = false;
      await loadReportShares(reportData.user.id);
    } catch (error) {
      showToast(`Could not create a share link: ${error.message}`, 'error');
    } finally {
      button.disabled = !reportData;
    }
  });
  $('#healthReportShareResult').addEventListener('click', async (event) => {
    if (event.target.closest('#copyHealthReportLink')) {
      const input = $('#healthReportShareLink');
      try {
        await navigator.clipboard.writeText(input.value);
        showToast('Share link copied.', 'success');
      } catch {
        input.focus();
        input.select();
        showToast('Copy is unavailable. Select the link and copy it manually.', 'warn');
      }
    }
  });
  $('#healthReportShareList').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-share-id]');
    if (!button) return;
    button.disabled = true;
    try {
      await backend.api(`/api/health/report-shares/${encodeURIComponent(button.dataset.shareId)}`, { method: 'DELETE' });
      const result = $('#healthReportShareResult');
      if (result.dataset.shareId === button.dataset.shareId) {
        result.hidden = true;
        result.innerHTML = '';
        delete result.dataset.shareId;
      }
      if (backend.getUser()?.id) await loadReportShares(backend.getUser().id);
      showToast('Report link revoked.', 'success');
    } catch (error) {
      button.disabled = false;
      showToast(`Could not revoke the report link: ${error.message}`, 'error');
    }
  });
  $('#generateHealthReport').addEventListener('click', () => {
    const sections = selectedReportSections();
    if (!sections.length) return showToast('Select at least one report section.', 'warn');
    if (!reportData) return showToast('Refresh your dashboard before preparing a report.', 'error');
    const area = $('#reportPrintArea');
    area.innerHTML = buildReport(reportData.user, reportData.summary, reportData.schedules, reportData.appointments, sections);
    area.hidden = false;
    document.body.classList.add('printing-report');
    const cleanup = () => {
      document.body.classList.remove('printing-report');
      area.hidden = true;
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    try { window.print(); } catch (error) { cleanup(); showToast(`Could not open the print dialog: ${error.message}`, 'error'); }
  });
  document.addEventListener('mg:goto-tab', (event) => { if (event.detail === 'pageHealth') loadHealth(); });
  backend.onChange(() => { if (!$('#pageHealth').hidden) loadHealth(); });
  document.addEventListener('mg:data-changed', () => { if (!$('#pageHealth').hidden) loadHealth(); });
}
