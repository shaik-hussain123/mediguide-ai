/** @file Company directory chips + company detail modal (FR-6.1–6.5). */
import { $, escapeHtml as h, openModal } from '../utils/helpers.js';
import { companies, getCompany, search } from '../data/medicineDB.js';

let handlers = {};

export function initCompanies({ onFilter, onPick }) {
  handlers = { onFilter, onPick };
  const grid = $('#companyGrid');
  grid.addEventListener('click', (e) => {
    const info = e.target.closest('[data-company-info]');
    if (info) return openCompany(info.dataset.companyInfo);
    const chip = e.target.closest('[data-company-chip]');
    if (chip) onFilter(chip.getAttribute('aria-pressed') === 'true' ? '' : chip.dataset.companyChip);   // toggle
  });
  $('#companyModalBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (b) { handlers.onPick(Number(b.dataset.pick)); document.querySelector('#companyModal .modal-close').click(); }
  });
}

/** FR-6.1 / 6.4 */
export function renderCompanies(active = '') {
  const grid = $('#companyGrid');
  const list = companies();
  // Announce dynamic updates only when useful (not during initial load)
  const statusEl = $('#companyGridStatus');
  if (statusEl && document.readyState !== 'loading') {
    statusEl.textContent = list.length ? `${list.length} manufacturer(s) loaded` : 'No manufacturers found';
  }
  if (!list.length) { grid.innerHTML = '<span class="company-empty"><i class="fas fa-circle-info" aria-hidden="true"></i> No manufacturers found.</span>'; return; }
  grid.innerHTML = list.map((c) => `<span class="company-chip-wrap">
    <button type="button" class="company-chip${c.name === active ? ' active' : ''}" data-company-chip="${h(c.name)}" aria-pressed="${c.name === active}">
      ${h(c.name)} <span class="count">${c.count}</span></button>
    <button type="button" class="company-info" data-company-info="${h(c.name)}" aria-label="About ${h(c.name)}"><i class="fas fa-circle-info" aria-hidden="true"></i></button>
  </span>`).join('');
}

/** FR-6.5 company page (modal). */
export function openCompany(name) {
  const c = getCompany(name);
  if (!c) return;
  const meds = search('', { company: name });
  $('#companyModalTitle').innerHTML = `<i class="fas fa-building" aria-hidden="true"></i> ${h(c.name)}`;
  $('#companyModalBody').innerHTML = `
    <dl class="company-facts">
      <div><dt>Headquarters</dt><dd>${h(c.hq || '—')}, ${h(c.country)}</dd></div>
      <div><dt>Founded</dt><dd>${c.founded ? h(c.founded) : '—'}</dd></div>
      <div><dt>Regulatory status</dt><dd>Not independently verified in this catalogue; check the manufacturer’s current licence and product label.</dd></div>
    </dl>
    <h4 class="company-meds-title">Medicines listed (${meds.length})</h4>
    <ul class="company-meds">${meds.map((m) => `<li><button type="button" class="result-item" data-pick="${m.id}">
      <span class="result-emoji" aria-hidden="true">${h(m.img || '💊')}</span>
      <span class="result-main"><strong>${h(m.name)}</strong><small>${h(m.generic || '')} · ${h(m.category)}</small></span></button></li>`).join('')}</ul>`;
  openModal('companyModal');
}
