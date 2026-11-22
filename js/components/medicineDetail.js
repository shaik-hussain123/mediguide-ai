/**
 * @file Medicine card renderer (FR-2, FR-3, FR-4, FR-5, FR-10.5/10.6).
 * Every dynamic string is escaped before it reaches innerHTML.
 */
import { escapeHtml as h } from '../utils/helpers.js';
import { STORES } from '../config.js';
import { SLOTS } from '../data/medicineDB.js';
import { t, currentLang } from '../i18n.js';
import * as backend from '../services/backend.js';

const TIER_KEY = { routine: 'tierRoutine', care: 'tierCare', prescription: 'tierRx' };

/** FR-10.6 tooltips for medical terms. Keys are matched case-insensitively as whole words. */
export const GLOSSARY = {
  NSAID: 'Non-steroidal anti-inflammatory drug: reduces pain and swelling.',
  antipyretic: 'Brings down fever.',
  analgesic: 'Relieves pain.',
  antibiotic: 'Kills or stops bacteria. Does not work on viruses.',
  antihistamine: 'Blocks histamine, the body chemical behind allergy symptoms.',
  'Proton Pump Inhibitor': 'Reduces the amount of acid made by the stomach.',
  antiplatelet: 'Makes blood platelets less sticky so clots form less easily.',
  statin: 'A medicine that lowers cholesterol made by the liver.',
  hypertension: 'High blood pressure.',
  angina: 'Chest pain caused by reduced blood flow to the heart.',
  'acid reflux': 'Stomach acid flowing back up into the food pipe.',
  heartburn: 'Burning feeling in the chest caused by stomach acid.',
  LDL: 'Low-density lipoprotein, the “bad” cholesterol.',
  cholesterol: 'A fatty substance in the blood. Too much raises heart risk.',
  "Reye’s syndrome": 'A rare but serious illness of the brain and liver in children.',
  'type 2 diabetes': 'A long-term condition where blood sugar stays too high.',
  prescription: 'Needs a doctor’s written order to buy and use.',
};
const TERM_RE = new RegExp(`(?<![\\w])(${Object.keys(GLOSSARY).sort((a, b) => b.length - a.length)
  .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w])`, 'gi');
const GLOSS_LC = Object.fromEntries(Object.entries(GLOSSARY).map(([k, v]) => [k.toLowerCase(), v]));

/** Escape, then wrap known terms in keyboard-focusable tooltips. */
export function termify(text) {
  return h(text).replace(TERM_RE, (m) => {
    const tip = GLOSS_LC[m.toLowerCase().replace(/&#39;/g, "'")] || GLOSS_LC[m.toLowerCase()];
    return tip ? `<span class="term" tabindex="0" role="note" data-tip="${h(tip)}" aria-label="${h(m)}: ${h(tip)}">${m}</span>` : m;
  });
}

const SLOT_META = {
  morning: { icon: 'fa-sun', label: 'Morning' },
  afternoon: { icon: 'fa-cloud-sun', label: 'Afternoon' },
  evening: { icon: 'fa-cloud-moon', label: 'Evening' },
  night: { icon: 'fa-moon', label: 'Night' },
};
const TIER = {
  routine: { label: 'Everyday medicine', icon: 'fa-circle-check', hint: 'Check the exact pack label; this catalogue does not establish OTC status' },
  care: { label: 'Use with care', icon: 'fa-triangle-exclamation', hint: 'Follow the label closely and ask a doctor if unsure' },
  prescription: { label: 'Use only as prescribed', icon: 'fa-file-prescription', hint: 'Use only as your doctor prescribed' },
};
const CDSCO_RULES_URL = 'https://cdsco.gov.in/opencms/export/sites/CDSCO_WEB/Pdf-documents/acts_rules/2016DrugsandCosmeticsAct1940Rules1945.pdf';
const MEAL = { before: ['fa-utensils', 'Before food'], after: ['fa-utensils', 'After food'], any: ['fa-utensils', 'With or without food'] };
const AGE = { child: ['fa-child', 'Child'], adult: ['fa-user', 'Adult'], senior: ['fa-person-cane', 'Senior 60+'] };

export const ageGroupFor = (age) => (age && age < 13 ? 'child' : age >= 60 ? 'senior' : 'adult');
export const strengthText = (m) => `${Number(m.mg).toLocaleString('en-IN')} ${m.unit || 'mg'}`;

function renderIndianRegulatory(m) {
  const status = m.indianRegulatory || {
    label: 'Schedule status not verified',
    detail: 'This catalogue has not verified the exact product’s Schedule H, H1 or X status. Check the current pack and ask a registered pharmacist; missing data does not mean a medicine is over the counter.',
  };
  return `<section class="india-regulatory" aria-label="Indian regulatory information">
    <h4><i class="fas fa-scale-balanced" aria-hidden="true"></i> Indian label and schedule</h4>
    <strong>${h(status.label)}</strong>
    <p>${h(status.detail)}</p>
    <a href="${CDSCO_RULES_URL}" target="_blank" rel="noopener noreferrer">Official CDSCO Drugs and Cosmetics Rules (2016 compilation)</a>
    <p class="regulatory-note">The linked compilation is amended through 31 December 2016. Rules may have changed; check the current product packaging. This is general information, not product approval or a substitute for medical advice.</p>
  </section>`;
}

function renderRegulatoryBadge(m) {
  const category = m.indianRegulatory?.category;
  if (category === 'H') return '<span class="badge badge-rx"><i class="fas fa-file-prescription" aria-hidden="true"></i> Schedule H · Rx</span>';
  if (category === 'G') return '<span class="badge badge-review"><i class="fas fa-user-doctor" aria-hidden="true"></i> Schedule G · medical supervision</span>';
  if (m.rx) return '<span class="badge badge-rx"><i class="fas fa-user-doctor" aria-hidden="true"></i> Use only on doctor’s advice</span>';
  return '<span class="badge badge-review"><i class="fas fa-box" aria-hidden="true"></i> Check pack label</span>';
}

/** FR-1.5: results list or the "No results" message. */
export function renderResults(list, selectedId, query = '') {
  if (!list.length) {
    return `<div class="no-results" role="status"><i class="fas fa-magnifying-glass" aria-hidden="true"></i>
      <strong>${h(t('noResults'))}${query ? ` “${h(query)}”` : ''}.</strong>
      <span>Check the spelling, or try a symptom (for example “fever”), a company or a category.</span></div>`;
  }
  const items = list.map((m) => `
    <li><button type="button" class="result-item${m.id === selectedId ? ' selected' : ''}" data-select="${m.id}"
        aria-pressed="${m.id === selectedId}">
      <span class="result-emoji" aria-hidden="true">${h(m.img || '💊')}</span>
      <span class="result-main"><strong>${h(m.name)}</strong><small>${h(m.generic || '')} · ${h(strengthText(m))}</small></span>
      <span class="result-mfg">${h(m.mfg)}</span>
      ${m.indianRegulatory?.category === 'H' ? '<span class="rx-chip" title="Schedule H prescription medicine">Rx</span>' : ''}
    </button></li>`).join('');
  return `<div class="result-head" aria-live="polite">${h(t('foundN', { n: list.length }))}</div>
    <ul class="result-list" aria-label="Search results">${items}</ul>`;
}

function dosageVisual(m, age) {
  const tier = TIER[m.tier] || TIER.routine;
  const icon = m.form === 'Capsule' ? 'fa-capsules' : 'fa-tablets';
  const unit = m.form === 'Capsule' ? 'capsule' : 'tablet';
  const pills = Array.from({ length: Math.min(m.pills || 1, 4) }, () => `<i class="fas ${icon} pill-icon" aria-hidden="true"></i>`).join('');
  const slots = SLOTS.map((s) => {
    const on = m.schedule.includes(s);
    const meta = SLOT_META[s];
    return `<li class="slot${on ? ' on' : ''}" aria-label="${t(s)}: ${on ? (m.prn ? 'possible dose time' : 'take a dose') : 'no dose'}">
      <i class="fas ${meta.icon}" aria-hidden="true"></i><span>${t(s)}</span>
      <i class="fas ${on ? 'fa-check' : 'fa-minus'} slot-mark" aria-hidden="true"></i></li>`;
  }).join('');
  const [mealIcon, mealText] = MEAL[m.meal] || MEAL.any;
  const tabs = Object.entries(AGE).map(([k, [ic]]) => `
    <button type="button" role="tab" class="age-tab${k === age ? ' active' : ''}" data-age="${k}" aria-selected="${k === age}">
      <i class="fas ${ic}" aria-hidden="true"></i> ${t(k)}</button>`).join('');
  const panels = Object.keys(AGE).map((k) => `<div class="age-panel" role="tabpanel" data-age-panel="${k}" ${k === age ? '' : 'hidden'}>${termify(m.byAge?.[k] || m.dose)}</div>`).join('');

  return `<section class="dosage tier-${m.tier}" aria-label="Dosage guide">
    <h4><i class="fas fa-prescription-bottle-medical" aria-hidden="true"></i> ${h(t('howToTake'))}</h4>
    <p class="dose-text">${termify(m.dose)}</p>
    <div class="dose-visual">
      <div class="dose-box" aria-label="Amount per dose: ${m.pills || 1} ${unit}">
        <div class="pill-row">${pills}</div><strong>${m.pills || 1} ${unit}</strong><small>${h(t('perDose'))}</small></div>
      <div class="dose-box" aria-label="How often: ${h(m.frequency || '')}">
        <i class="fas fa-clock dose-big" aria-hidden="true"></i><strong>${h(m.frequency || '')}</strong>
        <small>${m.prn ? 'Only when needed' : 'Regular schedule'}</small></div>
      <div class="dose-box" aria-label="${mealText}">
        <i class="fas ${mealIcon} dose-big" aria-hidden="true"></i><strong>${mealText}</strong><small>meal timing</small></div>
    </div>
    <ul class="slot-row" aria-label="Daily timeline">${slots}</ul>
    <div class="tier-tag tier-${m.tier}"><i class="fas ${tier.icon}" aria-hidden="true"></i> <strong>${h(t(TIER_KEY[m.tier] || 'tierRoutine'))}</strong>${currentLang() === 'en' ? ` · ${tier.hint}` : ''}</div>
    <div class="age-tabs" role="tablist" aria-label="${h(t('ageGroup'))}">${tabs}</div>
    ${panels}
  </section>`;
}

function alternativesTable(m) {
  if (!m.alternatives?.length) return '';
  const rows = m.alternatives.map((a) => `<tr>
    <th scope="row"><strong>${h(a.name)}</strong><small>${h(a.mfg)}</small></th>
    <td><ul class="pros">${a.pros.map((p) => `<li><i class="fas fa-check" aria-hidden="true"></i><span class="sr-only">Pro: </span>${h(p)}</li>`).join('')}</ul></td>
    <td><ul class="cons">${a.cons.map((c) => `<li><i class="fas fa-xmark" aria-hidden="true"></i><span class="sr-only">Con: </span>${h(c)}</li>`).join('')}</ul></td>
  </tr>`).join('');
  return `<section class="alternatives" aria-label="Alternatives">
    <h4><i class="fas fa-code-compare" aria-hidden="true"></i> ${h(t('alternatives'))}</h4>
    <div class="table-wrap" tabindex="0"><table class="alt-table">
      <caption class="sr-only">Alternatives to ${h(m.name)} with pros and cons</caption>
      <thead><tr><th scope="col">Medicine</th><th scope="col" class="pros-h">${h(t('pros'))}</th><th scope="col" class="cons-h">${h(t('cons'))}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="alt-note">Same salt does not always mean same brand quality or price. Ask your pharmacist before switching.</p>
  </section>`;
}

/** FR-2.1–2.6 */
export function renderMedicine(m, age = 'adult', assessment = null) {
  if (!m) return '';
  return `<article class="med-card tier-${m.tier}" aria-labelledby="medTitle">
    <header class="med-head">
      <div class="med-icon" aria-hidden="true">${h(m.img || '💊')}</div>
      <div class="med-title"><h3 id="medTitle">${h(m.name)}</h3>
        <div class="med-sub">${termify(m.generic || '')} · ${h(m.form || '')}</div></div>
      <div class="med-badges">
        ${renderRegulatoryBadge(m)}
      </div>
    </header>
    <dl class="med-meta">
      <div><dt><i class="fas fa-industry" aria-hidden="true"></i> ${h(t('manufacturer'))}</dt>
        <dd><button type="button" class="link-btn" data-company="${h(m.mfg)}">${h(m.mfg)}</button></dd></div>
      <div><dt><i class="fas fa-weight-scale" aria-hidden="true"></i> ${h(t('strength'))}</dt><dd>${h(strengthText(m))}</dd></div>
      <div><dt><i class="fas fa-tag" aria-hidden="true"></i> ${h(t('category'))}</dt><dd>${termify(m.category)}</dd></div>
      <div><dt><i class="fas fa-users" aria-hidden="true"></i> ${h(t('ageGroup'))}</dt><dd>${h(m.ageGroup || '—')}</dd></div>
    </dl>
    ${renderIndianRegulatory(m)}
    <p class="med-desc">${termify(m.description)}</p>
    ${m.uses?.length ? `<section class="uses" aria-label="${h(t('commonlyUsed'))}"><h4><i class="fas fa-notes-medical" aria-hidden="true"></i> ${h(t('commonlyUsed'))}</h4>
      <ul class="use-chips">${m.uses.map((u) => `<li>${termify(u)}</li>`).join('')}</ul></section>` : ''}
    ${dosageVisual(m, age)}
    ${assessment ? '<div id="clinicalFindings" class="clinical-findings"></div>' : ''}
    ${m.cautions?.length ? `<section class="cautions" aria-label="Precautions"><h4><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> ${h(t('important'))}</h4>
      <ul>${m.cautions.map((c) => `<li>${termify(c)}</li>`).join('')}</ul></section>` : ''}
    ${alternativesTable(m)}
    ${renderDosageCharts(m, assessment)}
    <div class="med-actions">
      <button type="button" class="btn-secondary" data-ask="${m.id}"><i class="fas fa-comment-medical" aria-hidden="true"></i> ${h(t('askAbout'))} ${h(m.name)}</button>
      <button type="button" class="btn-secondary" data-listen="${m.id}"><i class="fas fa-volume-up" aria-hidden="true"></i> ${h(t('listen'))}</button>
      <button type="button" class="btn-secondary" data-remind="${m.id}"><i class="fas fa-bell" aria-hidden="true"></i> ${h(t('remindMe'))}</button></div>
  </article>`;
}

/** FR-5: pharmacy buttons; search link carries the medicine name (FR-5.2). Only verified stores (FR-5.3). */
export function renderStoreLinks(med, fallbackQuery = '') {
  const q = encodeURIComponent((med ? med.name : fallbackQuery) || 'medicines');
  const allowed = med?.stores?.length ? STORES.filter((s) => med.stores.includes(s.id)) : STORES;
  return allowed.map((s) => `<a class="store-btn" href="${h(s.url(q))}" target="_blank" rel="noopener noreferrer">
    <i class="fas ${s.icon}" aria-hidden="true"></i> ${h(s.name)}<i class="fas fa-arrow-up-right-from-square ext" aria-hidden="true"></i>
    <span class="sr-only">(opens in a new tab)</span></a>`).join('');
}

/** FR-3: Dosage Charts - Adult, Pediatric, Daily Exposure */
export function renderDosageCharts(m, assessment = null) {
  if (!m) return '';

  const safeMin = Number(m.safe_min);
  const safeMax = Number(m.safe_max);
  const pediatricMax = Number(m.pediatric_max);
  const mgPerKgMax = Number(m.mg_per_kg_max);
  const sourceName = typeof m.sourceName === 'string' ? m.sourceName.trim() : '';
  const sourceUrl = typeof m.sourceUrl === 'string' && /^https:\/\//i.test(m.sourceUrl) ? m.sourceUrl : '';
  const hasDosageEvidence = Boolean(sourceName && sourceUrl);
  const hasAdultRange = hasDosageEvidence
    && Number.isFinite(safeMin) && safeMin > 0
    && Number.isFinite(safeMax) && safeMax >= safeMin;
  const hasPediatricRange = hasDosageEvidence
    && Number.isFinite(pediatricMax) && pediatricMax > 0;
  const confidenceScore = Number(m.confidenceScore);
  const evidenceTier = Number(m.evidenceTier);
  const hasConfidence = hasDosageEvidence && m.confidenceScore != null
    && Number.isFinite(confidenceScore) && confidenceScore >= 0 && confidenceScore <= 100;
  const hasEvidenceTier = hasDosageEvidence && m.evidenceTier != null
    && Number.isInteger(evidenceTier) && evidenceTier >= 1 && evidenceTier <= 4;
  const unit = m.unit || 'mg';
  const strength = Number(m.mg);

  const adultChart = hasAdultRange ? `
    <div class="dosage-chart adult-chart" aria-label="Adult dosage reference range">
      <h5><i class="fas fa-user" aria-hidden="true"></i> Adult Dosage Range</h5>
      <div class="chart-bar-wrapper">
        <div class="chart-bar adult-bar" role="img" aria-label="Adult dosage range from ${safeMin} to ${safeMax} mg">
          <div class="chart-marker min-marker" style="left: 0%" aria-label="Minimum safe dose: ${safeMin} mg"></div>
          <div class="chart-range" style="left: 0%; width: 100%"></div>
          <div class="chart-marker max-marker" style="right: 0%" aria-label="Maximum safe dose: ${safeMax} mg"></div>
        </div>
        <div class="chart-labels">
          <span class="label-min">Min: ${safeMin} mg</span>
          <span class="label-max">Max: ${safeMax} mg</span>
        </div>
      </div>
    </div>
  ` : `
    <div class="dosage-chart adult-chart" aria-label="Adult dosage range unavailable">
      <h5><i class="fas fa-user" aria-hidden="true"></i> Adult Dosage Range</h5>
      ${Number.isFinite(strength) && strength > 0 ? `<p><strong>Product strength:</strong> ${strength} ${h(unit)} per ${h((m.form || 'unit').toLowerCase())}.</p>` : ''}
      <p role="status">No verified adult dosage range is available for this entry. Product strength is not a recommended dose. Follow the current package label and confirm the dose with a doctor or pharmacist.</p>
    </div>
  `;

  // Pediatric Dosage Chart
  const pediatricChart = hasPediatricRange ? `
    <div class="dosage-chart pediatric-chart" aria-label="Pediatric dosage chart">
      <h5><i class="fas fa-child" aria-hidden="true"></i> Pediatric Dosage Guidance</h5>
      <div class="chart-bar-wrapper">
        <div class="chart-bar pediatric-bar" role="img" aria-label="Pediatric dosage range up to ${pediatricMax} mg">
          <div class="chart-marker min-marker" style="left: 0%"></div>
          <div class="chart-range" style="left: 0%; width: ${hasAdultRange ? Math.min(100, (pediatricMax / safeMax) * 100) : 100}%"></div>
          <div class="chart-marker max-marker" style="right: 0%"></div>
        </div>
        <div class="chart-labels">
          <span class="label-max">Max: ${pediatricMax} mg</span>
        </div>
      </div>
      ${Number.isFinite(mgPerKgMax) && mgPerKgMax > 0 ? `<p class="mg-kg-guidance"><i class="fas fa-weight-scale" aria-hidden="true"></i> Weight-based: up to ${mgPerKgMax} mg/kg</p>` : ''}
    </div>
  ` : '';

  // Show an exposure estimate only when the assessment belongs to this exact medicine.
  let exposureChart = '';
  const dailyExposure = Number(assessment?.dailyExposure ?? assessment?.daily_exposure);
  if (assessment?.medication === m.name && Number.isFinite(dailyExposure) && dailyExposure > 0) {
    const level = String(assessment.overallClinicalSeverity || assessment.riskLevel || assessment.risk_level || '').toUpperCase();
    const ruleResult = { LOW: 'No rule triggered', MODERATE: 'Review recommended', HIGH: 'Clinician review recommended' }[level] || 'Not available';
    exposureChart = `
      <div class="dosage-chart exposure-chart" aria-label="Daily exposure chart">
        <h5><i class="fas fa-chart-line" aria-hidden="true"></i> Estimated Daily Exposure</h5>
        <p><strong>${dailyExposure.toLocaleString('en-IN')} mg/day</strong></p>
        <p>Rule check: ${h(ruleResult)}</p>
        <p>This estimate uses the submitted dose and frequency; it does not establish a safe dose or replace the current package label.</p>
      </div>
    `;
  }

  // Evidence attribution
  const evidenceHtml = `
    <div class="dosage-evidence" aria-label="Evidence attribution">
      <h5><i class="fas fa-book-medical" aria-hidden="true"></i> Evidence Source</h5>
      <div class="evidence-row">
        <span class="evidence-label">Source:</span>
        <span class="evidence-value">${hasDosageEvidence ? `<a href="${h(sourceUrl)}" target="_blank" rel="noopener noreferrer">${h(sourceName)}</a>` : 'Not provided'}</span>
      </div>
      <div class="evidence-row">
        <span class="evidence-label">Confidence:</span>
        <span class="evidence-value">${hasConfidence ? `${confidenceScore}%` : 'Not assessed'}</span>
      </div>
      <div class="evidence-row">
        <span class="evidence-label">Evidence Tier:</span>
        <span class="evidence-value">${hasEvidenceTier ? `Tier ${evidenceTier}` : 'Not assigned'}</span>
      </div>
      ${hasDosageEvidence ? '' : '<p>No linked dosage source is available for this entry, so confidence and evidence tier are not assessed.</p>'}
    </div>
  `;

  return `<section class="dosage-charts" aria-labelledby="chartsTitle">
    <h4 id="chartsTitle"><i class="fas fa-chart-bar" aria-hidden="true"></i> Dosage Safety Charts</h4>
    <div class="charts-grid">
      ${adultChart}
      ${pediatricChart}
      ${exposureChart}
    </div>
    ${evidenceHtml}
  </section>`;
}

/** One delegated listener set for the whole detail panel (no inline handlers, NFR-3.5). */
export function initDetail(container, { onSelect, onCompany, onAsk, onListen, onRemind }) {
  container.addEventListener('click', (e) => {
    const sel = e.target.closest('[data-select]');
    if (sel) return onSelect(Number(sel.dataset.select));
    const comp = e.target.closest('[data-company]');
    if (comp) return onCompany(comp.dataset.company);
    const ask = e.target.closest('[data-ask]');
    if (ask) return onAsk(Number(ask.dataset.ask));
    const lis = e.target.closest('[data-listen]');
    if (lis) return onListen(Number(lis.dataset.listen));
    const rem = e.target.closest('[data-remind]');
    if (rem) return onRemind(Number(rem.dataset.remind));
    const tab = e.target.closest('.age-tab');
    if (tab) {
      const scope = tab.closest('.dosage');
      scope.querySelectorAll('.age-tab').forEach((t) => { const on = t === tab; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
      scope.querySelectorAll('.age-panel').forEach((p) => { p.hidden = p.dataset.agePanel !== tab.dataset.age; });
    }
  });
}
