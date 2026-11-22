import { escapeHtml as h } from '../utils/helpers.js';

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not set' : date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

export function buildReport(user, summary, schedules, appointments, sections, preparedAt = new Date().toISOString()) {
  const profile = summary.profile || {};
  const content = [];
  if (sections.includes('profile')) {
    content.push(`<section><h2><i class="fas fa-user" aria-hidden="true"></i> Health profile</h2>
      <dl><div><dt>Name</dt><dd>${h(user.name)}</dd></div><div><dt>Email</dt><dd>${h(user.email || 'Not provided')}</dd></div>
      <div><dt>Age</dt><dd>${h(profile.age || 'Not provided')}</dd></div><div><dt>Weight</dt><dd>${h(profile.weight ? `${profile.weight} kg` : 'Not provided')}</dd></div>
      <div><dt>Conditions</dt><dd>${h(profile.conditions || 'Not provided')}</dd></div><div><dt>Allergies</dt><dd>${h(profile.allergies || 'Not provided')}</dd></div></dl></section>`);
  }
  if (sections.includes('medications')) {
    const medications = summary.medications;
    const list = schedules.length ? `<ul>${schedules.map((schedule) => `<li><strong>${h(schedule.med_name)}</strong> — ${h(schedule.dosage)}; ${h((schedule.times || []).join(', '))}; ${schedule.active ? 'Active' : 'Inactive'}${schedule.notes ? `; Note: ${h(schedule.notes)}` : ''}</li>`).join('')}</ul>` : '<p>No medication schedules recorded.</p>';
    content.push(`<section><h2><i class="fas fa-pills" aria-hidden="true"></i> Medication schedules and adherence</h2>
      <p>Recorded doses in the last ${h(summary.periodDays)} days: ${h(medications.trackedDoses)}; taken: ${h(medications.taken)}; skipped: ${h(medications.skipped)}; missed: ${h(medications.missed)}; adherence: ${medications.adherencePercentage == null ? 'No data' : `${h(medications.adherencePercentage)}%`}.</p>${list}</section>`);
  }
  if (sections.includes('appointments')) {
    const list = appointments.length ? `<ul>${appointments.map((appointment) => `<li><strong>${h(appointment.doctor.name)}</strong> — ${h(formatDate(appointment.start))}; ${h(appointment.mode)}; ${h(appointment.status)}${appointment.reason ? `; Reason: ${h(appointment.reason)}` : ''}</li>`).join('')}</ul>` : '<p>No appointments recorded.</p>';
    content.push(`<section><h2><i class="fas fa-calendar-check" aria-hidden="true"></i> Appointments</h2>${list}</section>`);
  }
  return `<header><h1><i class="fas fa-file-medical" aria-hidden="true"></i> MediGuide AI — Medical Report</h1>
    <p>Prepared for ${h(user.name)} on ${h(formatDate(preparedAt))}</p>
    <p class="report-warning">Personal information provided by the account holder. This report is not a diagnosis, prescription, or substitute for professional medical advice.</p></header>
    ${content.join('')}<footer>Keep this report private. Verify it is up to date before sharing it with a healthcare professional.</footer>`;
}
