/** Personal medication analytics, a non-diagnostic review checklist and printable health report. */
import { $, $$, escapeHtml as h, showToast } from '../utils/helpers.js';
import * as backend from '../services/backend.js';

let reportData = null;
let healthRequest = 0;

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not set' : date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

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

function buildReport(user, summary, schedules, appointments, sections) {
  const profile = summary.profile;
  const content = [];
  if (sections.includes('profile')) {
    content.push(`<section><h2><i class="fas fa-user" aria-hidden="true"></i> Health profile</h2>
      <dl><div><dt>Name</dt><dd>${h(user.name)}</dd></div><div><dt>Email</dt><dd>${h(user.email)}</dd></div>
      <div><dt>Age</dt><dd>${h(profile.age || 'Not provided')}</dd></div><div><dt>Weight</dt><dd>${h(profile.weight ? `${profile.weight} kg` : 'Not provided')}</dd></div>
      <div><dt>Conditions</dt><dd>${h(profile.conditions || 'Not provided')}</dd></div><div><dt>Allergies</dt><dd>${h(profile.allergies || 'Not provided')}</dd></div></dl></section>`);
  }
  if (sections.includes('medications')) {
    const list = schedules.length ? `<ul>${schedules.map((schedule) => `<li><strong>${h(schedule.med_name)}</strong> — ${h(schedule.dosage)}; ${h((schedule.times || []).join(', '))}; ${schedule.active ? 'Active' : 'Inactive'}${schedule.notes ? `; Note: ${h(schedule.notes)}` : ''}</li>`).join('')}</ul>` : '<p>No medication schedules recorded.</p>';
    content.push(`<section><h2><i class="fas fa-pills" aria-hidden="true"></i> Medication schedules and adherence</h2>
      <p>Recorded doses in the last ${h(summary.periodDays)} days: ${h(summary.medications.trackedDoses)}; taken: ${h(summary.medications.taken)}; skipped: ${h(summary.medications.skipped)}; missed: ${h(summary.medications.missed)}; adherence: ${summary.medications.adherencePercentage == null ? 'No data' : `${h(summary.medications.adherencePercentage)}%`}.</p>${list}</section>`);
  }
  if (sections.includes('appointments')) {
    const list = appointments.length ? `<ul>${appointments.map((appointment) => `<li><strong>${h(appointment.doctor.name)}</strong> — ${h(formatDate(appointment.start))}; ${h(appointment.mode)}; ${h(appointment.status)}${appointment.reason ? `; Reason: ${h(appointment.reason)}` : ''}</li>`).join('')}</ul>` : '<p>No appointments recorded.</p>';
    content.push(`<section><h2><i class="fas fa-calendar-check" aria-hidden="true"></i> Appointments</h2>${list}</section>`);
  }
  return `<header><h1><i class="fas fa-file-medical" aria-hidden="true"></i> MediGuide AI — Medical Report</h1>
    <p>Prepared for ${h(user.name)} on ${h(formatDate(new Date().toISOString()))}</p>
    <p class="report-warning">Personal information provided by the account holder. This report is not a diagnosis, prescription, or substitute for professional medical advice.</p></header>
    ${content.join('')}<footer>Keep this report private. Verify it is up to date before sharing it with a healthcare professional.</footer>`;
}

async function loadHealth() {
  const requestId = ++healthRequest;
  const gate = $('#healthGate');
  const user = backend.getUser();
  if (!backend.isOnline()) {
    reportData = null;
    gate.hidden = false; gate.textContent = 'Health analytics and reports require the MediGuide server.';
    $('#healthBody').hidden = true; return;
  }
  if (!user) {
    reportData = null;
    gate.hidden = false; gate.textContent = 'Log in to view your private health dashboard.';
    $('#healthBody').hidden = true; return;
  }
  if (user.role !== 'user') {
    reportData = null;
    gate.hidden = false; gate.textContent = 'This private health dashboard is available to patient accounts.';
    $('#healthBody').hidden = true; return;
  }
  reportData = null;
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
    reportData = {
      user, summary: summaryData, schedules: scheduleData.schedules || [], appointments: appointmentData.appointments || [],
    };
  } catch (error) {
    if (requestId !== healthRequest) return;
    reportData = null;
    $('#healthAnalytics').innerHTML = `<p class="tracker-error">${h(error.message)}</p>`;
    $('#healthGate').textContent = 'Could not load your health data. Check your connection and try again.';
    $('#healthGate').hidden = false;
    $('#healthBody').hidden = true;
    $('#generateHealthReport').disabled = true;
  }
}

export function initHealthDashboard() {
  $('#healthRefresh').addEventListener('click', loadHealth);
  $('#healthEditProfile').addEventListener('click', () => $('#profileBtn').click());
  $('#generateHealthReport').addEventListener('click', () => {
    const sections = $$('input[name="reportSection"]:checked').map((input) => input.value);
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
