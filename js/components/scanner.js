/**
 * @file Image scanner + prescription analyser pages. Files are validated client-side (§8.3), kept in
 * memory only (nothing is stored; only a metadata log), and sent to Gemini after consent.
 */
import { $, escapeHtml as h, renderRichText, validateFile, fileToBase64, showToast } from '../utils/helpers.js';
import * as store from '../utils/storage.js';
import * as audit from '../utils/audit.js';
import * as gemini from '../services/gemini.js';
import { askConsent } from './consent.js';
import { search, getAll } from '../data/medicineDB.js';
import { parsePrescription, timesForFrequency } from '../utils/rxParser.js';
import { t, currentLang, LANGS } from '../i18n.js';
import { KEYS, SYSTEM_PROMPT } from '../config.js';

const note = () => `<div class="msg-disclaimer"><i class="fas fa-circle-info" aria-hidden="true"></i> ${h(t('disclaimer'))}</div>`;
const spinner = (t) => `<div class="scan-working" role="status"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> ${h(t)}</div>`;
const errorBox = (t) => `<div class="result-error" role="alert"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> ${h(t)}</div>`;

function logScan(kind, file) {
  const list = store.get(KEYS.scans, []);
  list.push({ t: new Date().toISOString(), kind, type: file.type, kb: Math.round(file.size / 1024) });   // metadata only, never the file
  store.set(KEYS.scans, list.slice(-100));
  audit.log('scan', kind);
}

/** Shared drop-zone behaviour. Returns {get(): File|null}. */
function uploader({ zone, browse, input, preview, kinds }) {
  let file = null;
  let url = null;
  const set = (f) => {
    const v = validateFile(f, kinds);
    if (!v.ok) { showToast(v.error, 'error'); input.value = ''; return; }
    if (url) URL.revokeObjectURL(url);
    file = f; url = URL.createObjectURL(f);
    preview.style.display = 'block';
    preview.innerHTML = v.kind === 'pdf'
      ? `<div class="file-chip"><i class="fas fa-file-pdf" aria-hidden="true"></i> ${h(f.name)}</div>`
      : `<img class="scan-img" src="${url}" alt="Preview of ${h(f.name)}" />`;
  };
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  browse.addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
  input.addEventListener('change', () => input.files[0] && set(input.files[0]));
  ['dragenter', 'dragover'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', (e) => e.dataTransfer.files[0] && set(e.dataTransfer.files[0]));
  return { get: () => file };
}

async function ready() {
  if (!(await askConsent())) { showToast('Consent is needed to analyse files with Gemini.', 'warn'); return false; }
  if (!gemini.aiAvailable()) { showToast('The AI assistant is not set up yet. Ask the administrator to add the Gemini API key.', 'warn'); return false; }
  return true;
}

async function askGemini(file, prompt) {
  const { mime, data } = await fileToBase64(file);
  const lang = currentLang();
  return gemini.ask({ system: `${SYSTEM_PROMPT}\nReply in ${LANGS[lang].aiName}.`, parts: [{ text: prompt }, { inline_data: { mime_type: mime, data } }], lang });
}

/* ------------------------------- Scanner ------------------------------- */
const SCAN_PROMPT = `Look at this photo of a medicine (strip, box or tablet). Reply in exactly this format:
NAME: <brand or generic name you can read, or "unclear">
Then short bullet points: **Strength**, **Used for**, **Manufacturer** (only if visible), **How sure you are** (high/medium/low and why), **Check** (what the user should confirm on the printed label or with a pharmacist).
Never guess a name you cannot read. If the image is not a medicine, say so.`;

function initScanner() {
  const up = uploader({ zone: $('#scanDropZone'), browse: $('#scanBrowseBtn'), input: $('#scanFileInput'), preview: $('#scanPreview'), kinds: ['image'] });
  $('#scanUploadBtn').addEventListener('click', async (e) => {
    const file = up.get();
    if (!file) return showToast('Choose a medicine image first.', 'warn');
    if (!(await ready())) return;
    const btn = e.currentTarget; btn.disabled = true;
    $('#scanResult').innerHTML = spinner('Analysing the image…');
    try {
      const reply = await askGemini(file, SCAN_PROMPT);
      logScan('scan', file);
      const name = (reply.match(/^NAME:\s*(.+)$/im) || [])[1] || '';
      const body = reply.replace(/^NAME:.*$/im, '').trim();
      const hits = name && !/unclear/i.test(name) ? search(name.replace(/[^\w\s-]/g, ' ')).slice(0, 3) : [];
      $('#scanResult').innerHTML = `<div class="scan-found"><div class="scan-name"><i class="fas fa-magnifying-glass-chart" aria-hidden="true"></i> ${h(name || 'Result')}</div>
        <div class="msg-text">${renderRichText(body)}</div>
        ${hits.length ? `<div class="scan-matches"><strong>Possible matches in our database:</strong>${hits.map((m) => `<button type="button" class="btn-secondary" data-open="${m.id}">${h(m.name)}</button>`).join('')}</div>` : ''}
        ${note()}</div>`;
    } catch (err) { $('#scanResult').innerHTML = errorBox(err.message); } finally { btn.disabled = false; }
  });
}

/* ----------------------------- Prescription ----------------------------- */
const RX_PROMPT = `This is a photo or PDF of a prescription. Return ONLY valid JSON, no markdown, in this shape:
{"medicines":[{"name":"","strength":"","frequency":"","days":""}],"notes":""}
Write each medicine you can read. Use "" for anything unclear: never guess. frequency examples: "twice daily", "1-0-1", "at night". Do not suggest any change to a dose.`;

let lastRows = [];

/** Parse the model's JSON reply into table rows. Returns null if it is not usable JSON. */
export function rowsFromAiJson(text) {
  try {
    const clean = String(text).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const list = JSON.parse(clean).medicines;
    if (!Array.isArray(list) || !list.length) return null;
    return list.slice(0, 20).map((m) => {
      const line = `${m.name || ''} ${m.strength || ''} ${m.frequency || ''} ${m.days ? `for ${String(m.days).replace(/\D/g, '')} days` : ''}`.trim();
      return parsePrescription(line, getAll())[0] || { raw: line, med: null, strength: null, strengthMatches: null, frequency: null, duration: null };
    });
  } catch { return null; }
}

function renderRxTable(rows) {
  if (!rows.length) return `<div class="no-results"><i class="fas fa-file-circle-question" aria-hidden="true"></i><strong>No medicines recognised.</strong><span>Try typing each line like “Dolo 650 mg twice daily for 5 days”.</span></div>`;
  lastRows = rows;
  const body = rows.map((r, i) => {
    const warn = [];
    if (r.med?.rx) warn.push('<span class="rx-chip">Rx</span> Prescription medicine');
    if (r.strengthMatches === false) warn.push(`<span class="warn-text"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> Written ${h(r.strength)} differs from listed ${h(r.med.mg)} ${h(r.med.unit || 'mg')}. Confirm with your pharmacist.</span>`);
    if (!r.med) warn.push('<span class="warn-text">Not found in our database</span>');
    return `<tr>
      <th scope="row">${r.med ? `<button type="button" class="link-btn" data-open="${r.med.id}">${h(r.med.name)}</button><small>${h(r.med.generic || '')}</small>` : `<span>${h(r.raw)}</span>`}</th>
      <td>${r.strength != null ? h(r.strength) : '—'}</td><td>${h(r.frequency || '—')}</td><td>${h(r.duration || '—')}</td><td>${warn.join('<br>') || '—'}</td>
      <td>${r.med || r.frequency ? `<button type="button" class="btn-secondary" data-remind-row="${i}"><i class="fas fa-bell" aria-hidden="true"></i> ${h(t('remindMe'))}</button>` : '—'}</td></tr>`;
  }).join('');
  return `<div class="table-wrap" tabindex="0"><table class="rx-table"><caption class="sr-only">Medicines found in the prescription text</caption>
    <thead><tr><th scope="col">Medicine</th><th scope="col">Strength</th><th scope="col">How often</th><th scope="col">Duration</th><th scope="col">Notes</th><th scope="col"></th></tr></thead>
    <tbody>${body}</tbody></table></div>
    <p class="alt-note">Read from the text you typed. Never change a prescribed medicine or dose based on this table.</p>${note()}`;
}

function initPrescription() {
  const up = uploader({ zone: $('#rxDropZone'), browse: $('#rxBrowseBtn'), input: $('#rxFileInput'), preview: $('#rxPreview'), kinds: ['image', 'pdf'] });
  $('#rxAnalyzeBtn').addEventListener('click', () => {                                    // local, offline
    const text = $('#rxTextInput').value.trim().slice(0, 4000);
    if (!text) return showToast('Type or paste the prescription text first.', 'warn');
    $('#rxResult').innerHTML = renderRxTable(parsePrescription(text, getAll()));
    audit.log('rx_text_analyzed');
  });
  $('#rxUploadBtn').addEventListener('click', async (e) => {
    const file = up.get();
    if (!file) return showToast('Choose a prescription image or PDF first.', 'warn');
    if (!(await ready())) return;
    const btn = e.currentTarget; btn.disabled = true;
    $('#rxResult').innerHTML = spinner('Reading the prescription…');
    try {
      const reply = await askGemini(file, RX_PROMPT);
      logScan('prescription', file);
      const rows = rowsFromAiJson(reply);
      $('#rxResult').innerHTML = rows
        ? `${renderRxTable(rows)}<p class="alt-note">Read by AI from your image. Handwriting can be misread: check every line against the paper.</p>`
        : `<div class="msg-text">${renderRichText(reply)}</div><p class="alt-note">Handwriting can be misread. Always confirm with your doctor or pharmacist.</p>${note()}`;
    } catch (err) { $('#rxResult').innerHTML = errorBox(err.message); } finally { btn.disabled = false; }
  });
}

export function initScanners() {
  initScanner();
  initPrescription();
  // buttons inside results ask the app to open a medicine
  for (const id of ['#scanResult', '#rxResult']) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('[data-open]');
      if (b) document.dispatchEvent(new CustomEvent('mg:open-medicine', { detail: Number(b.dataset.open) }));
      const rm = e.target.closest('[data-remind-row]');
      if (rm) {
        const r = lastRows[Number(rm.dataset.remindRow)];
        const days = (r.duration || '').match(/^(\d+) (day|week|month)/);
        const mult = days ? { day: 1, week: 7, month: 30 }[days[2]] : 0;
        document.dispatchEvent(new CustomEvent('mg:add-reminder', { detail: {
          medicine: r.med?.name || r.raw.split(/\s+/).slice(0, 2).join(' '), dose: r.strength != null ? `${r.strength} ${r.med?.unit || 'mg'}` : '',
          times: timesForFrequency(r.frequency), days: days ? Number(days[1]) * mult : '' } }));
      }
    });
  }
}
