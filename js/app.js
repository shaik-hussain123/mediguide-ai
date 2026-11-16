/** @file Entry point: bootstraps modules and owns the search → detail data flow (SRS §6.3). */
import { $, $$, initModals, showToast } from './utils/helpers.js';
import * as db from './data/medicineDB.js';
import * as backend from './services/backend.js';
import { initI18n, onLangChange, t } from './i18n.js';
import { initSearch } from './components/search.js';
import { renderResults, renderMedicine, renderStoreLinks, initDetail, ageGroupFor } from './components/medicineDetail.js';
import { initCompanies, renderCompanies, openCompany } from './components/companyList.js';
import { initChat, setContext, focusChat } from './components/chatBot.js';
import { initAuth, onAuthChange } from './components/auth.js';
import { initSettings } from './components/settings.js';
import { initConsent } from './components/consent.js';
import { initScanners } from './components/scanner.js';
import { initAdmin } from './components/admin.js';
import { initReminders } from './components/reminders.js';
import { initAppointments } from './components/appointments.js';
import { speak, stopSpeaking, plainText } from './services/voice.js';

const state = { query: '', category: '', company: '', selectedId: null, age: 'adult' };
const PAGES = ['pageMedicine', 'pageScanner', 'pagePrescription', 'pageCare', 'pageReminders'];
let search;

function refresh() {
  const results = db.search(state.query, { category: state.category, company: state.company });
  if (!results.some((m) => m.id === state.selectedId)) state.selectedId = results[0]?.id ?? null;   // data-flow step 2
  const med = db.getById(state.selectedId);
  $('#medDetail').innerHTML = renderResults(results, state.selectedId, state.query) + renderMedicine(med, state.age);
  $('#globalStoreLinks').innerHTML = renderStoreLinks(med, state.query);
  $('#medicineCount').textContent = db.getAll().length;
  renderCompanies(state.company);
  setContext(med || null);
}

function activateTab(pageId) {
  $$('.page-tab').forEach((tab) => { const on = tab.dataset.page === pageId; tab.classList.toggle('active', on); tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; });
  PAGES.forEach((id) => { $(`#${id}`).hidden = id !== pageId; });
}

function initTabs() {
  const tabs = $$('.page-tab');
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.page));
    tab.addEventListener('keydown', (e) => {                                  // arrow-key tab navigation (FR-10.4)
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!d) return;
      const next = tabs[(i + d + tabs.length) % tabs.length]; next.focus(); next.click();
    });
  });
  document.addEventListener('mg:goto-tab', (e) => activateTab(e.detail));
}

function selectMedicine(id) {
  state.selectedId = id;
  const rec = db.getById(id);
  if (rec && !db.search(state.query, { category: state.category, company: state.company }).includes(rec)) {
    Object.assign(state, { query: '', category: '', company: '' });   // selected item is hidden by filters: reset them
    search.reset();
  }
  refresh();
  $('#medDetail').querySelector('.med-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Read-aloud summary of a medicine card. Card text is English, so it is read with an English voice. */
function speakMedicine(m) {
  stopSpeaking();
  const text = `${m.name}, ${m.generic || ''}. ${m.description} Commonly used for ${m.uses.join(', ')}. ${m.dose} ${(m.cautions || []).join(' ')}`;
  if (!speak(plainText(text), { lang: 'en-IN' })) showToast('Read-aloud is not supported in this browser.', 'warn');
}

const SLOT_TIME = { morning: '08:00', afternoon: '14:00', evening: '18:00', night: '21:00' };
function remindFor(m) {
  document.dispatchEvent(new CustomEvent('mg:add-reminder', { detail: {
    medicine: m.name, dose: `${m.pills || 1} ${m.form === 'Capsule' ? 'capsule' : 'tablet'}`,
    times: m.prn ? [] : m.schedule.map((s) => SLOT_TIME[s]), days: '' } }));
}

function initInstall() {
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
  $('#installBtn').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#installBtn').hidden = true; });
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });
}

async function boot() {
  initModals();
  initI18n();
  await backend.detect();                                                                     // server mode or local mode
  if (backend.isOnline()) {
    try { db.applyRemoteUses(await backend.api('/api/medicines/uses', { auth: false })); } catch { /* keep bundled lists */ }
  }
  initSettings({ onSaveHistoryOff: () => {} });
  initConsent();
  initChat();
  initScanners();
  initAdmin();
  initTabs();
  initInstall();
  initReminders();
  initAppointments();

  $('#dismissBanner').addEventListener('click', () => { $('#disclaimerBanner').hidden = true; });
  search = initSearch({
    onChange: ({ query, category }) => { Object.assign(state, { query, category }); refresh(); },
    onClear: () => { Object.assign(state, { query: '', category: '', company: '' }); refresh(); },
  });
  initCompanies({ onFilter: (name) => { state.company = name; refresh(); }, onPick: selectMedicine });
  initDetail($('#medDetail'), {
    onSelect: selectMedicine, onCompany: openCompany,
    onAsk: (id) => { const m = db.getById(id); setContext(m); focusChat(`${t('tellMeAbout')} ${m.name}`); },
    onListen: (id) => speakMedicine(db.getById(id)),
    onRemind: (id) => remindFor(db.getById(id)),
  });
  document.addEventListener('mg:data-changed', refresh);
  document.addEventListener('mg:open-medicine', (e) => { activateTab('pageMedicine'); selectMedicine(e.detail); });
  onLangChange(() => { search.setCategories(db.categories()); refresh(); });
  onAuthChange((u) => { const age = ageGroupFor(u?.profile?.age); if (search && age !== state.age) { state.age = age; refresh(); } });   // default age tab from profile

  search.setCategories(db.categories());
  refresh();                                                                                  // instant first paint from bundled data
  initAuth();                                                                                 // may resume a session (network); does not block paint
  const added = await db.loadExtra();                                                         // optional larger dataset
  if (added) { search.setCategories(db.categories()); refresh(); showToast(`${added} more medicines loaded.`, 'info', 2500); }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });   // NFR-6.3
  }
}

boot();
