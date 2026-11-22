import { buildReport } from './components/healthReport.js';

const status = document.querySelector('#shareStatus');
const content = document.querySelector('#sharedReport');
const printButton = document.querySelector('#printReport');
const token = window.location.hash.slice(1);
window.history.replaceState(null, '', '/shared-report.html');

if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
  status.textContent = 'This report link is invalid, expired, or revoked.';
} else {
  try {
    const response = await fetch('/api/health/shared-report/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
      credentials: 'omit',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.report) {
      status.textContent = 'This report link is invalid, expired, or revoked.';
    } else {
      const report = data.report;
      content.innerHTML = buildReport(report.user, report.summary, report.schedules, report.appointments, report.sections, report.createdAt);
      status.textContent = `Read-only report. This link expires ${new Date(data.expiresAt).toLocaleString()}.`;
      printButton.hidden = false;
      document.title = 'Shared medical report · MediGuide AI';
    }
  } catch {
    status.textContent = 'Could not reach MediGuide AI. Check your connection and try again.';
  }
}

printButton.addEventListener('click', () => window.print());
