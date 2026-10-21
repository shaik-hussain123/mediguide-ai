const $ = (id) => document.getElementById(id);
const authDialog = $('authDialog');
const CHAT_HISTORY_KEY = 'mediguide-catalog-chat-history';
const DISPLAY_KEY = 'mediguide-display-preferences';
let authMode = 'login';
let authenticated = false;
let searchTimer;
let searchSequence = 0;
let previewUrl = null;
let chatMessages = [];

localStorage.removeItem('mediguide-token');
$('dismissNotice').addEventListener('click', () => $('dismissNotice').parentElement.remove());

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({ detail: 'Unexpected server response.' }));
  if (!response.ok) throw new Error(data.detail || 'Request could not be completed.');
  return data;
}

function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function updateAccount() { $('accountButton').textContent = authenticated ? 'Sign out' : 'Sign in'; }
function statusClass(value) { return value === 'APPROVED' ? 'status approved' : 'status'; }
function valueOrNotListed(value) { return value ? escapeHtml(value) : 'Not listed in this record'; }

function pharmacyLinks(medicine) {
  const query = medicine.name || medicine.active_ingredient || '';
  const apolloSlug = query.replace(/\s*\([AB]\)/gi, '').replace(/\s*\+\s*/g, ' ').replace(/[^a-z0-9\s-]/gi, ' ').trim().replace(/\s+/g, '-').toLowerCase();
  const encoded = encodeURIComponent(query);
  return [
    ['Apollo Pharmacy', `https://www.apollopharmacy.in/search-medicines/${encodeURIComponent(apolloSlug)}`],
    ['Tata 1mg', `https://www.1mg.com/search/all?name=${encoded}`],
    ['Netmeds', `https://www.netmeds.com/catalogsearch/result?q=${encoded}`],
    ['PharmEasy', `https://pharmeasy.in/search/all?name=${encoded}`],
  ];
}

function pharmacyCards(medicine) {
  return `<section class="buy-section" aria-label="Where to buy"><h4>Check pharmacy availability</h4><div class="pharmacy-links">${pharmacyLinks(medicine).map(([name, url]) => `<a class="button secondary" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)} ↗</a>`).join('')}</div><p>These links open pharmacy search pages. Stock, delivery, price, and prescription requirements depend on your location. Confirm the exact medicine, strength, and form before purchase.</p></section>`;
}

function medicineCard(medicine) {
  const ingredient = medicine.generic_name === medicine.active_ingredient ? escapeHtml(medicine.generic_name) : `${escapeHtml(medicine.generic_name)} · ${escapeHtml(medicine.active_ingredient)}`;
  const sourcePeriod = medicine.source_date ? (medicine.source_name || '').includes('NPPA') ? ` · NPPA data period: ${escapeHtml(medicine.source_date)}` : ` · Source date: ${escapeHtml(medicine.source_date)}` : '';
  return `<article class="medicine-card"><div><h3>${escapeHtml(medicine.name)}</h3><p>${ingredient}</p><div class="medicine-meta">${escapeHtml(medicine.strength)} · ${escapeHtml(medicine.dosage_form)}${medicine.manufacturer ? ` · ${escapeHtml(medicine.manufacturer)}` : ''}</div><div class="source-line">Source: ${escapeHtml(medicine.source_name || 'Not provided')}${sourcePeriod}${medicine.source_url ? ` · <a href="${escapeHtml(medicine.source_url)}" target="_blank" rel="noopener noreferrer">View source</a>` : ''}</div></div><span class="${statusClass(medicine.regulatory_status)}">${escapeHtml(medicine.regulatory_status || 'UNKNOWN')}</span><p>${escapeHtml(medicine.description || '')}</p><small>${escapeHtml(medicine.warnings || '')}</small>${pharmacyCards(medicine)}<button class="detail-toggle" type="button" data-medicine-id="${Number(medicine.id)}" aria-expanded="false">View record details <span>＋</span></button><div class="medicine-detail hidden" id="detail-${Number(medicine.id)}"></div></article>`;
}

async function runMedicineSearch() {
  const query = $('searchInput').value.trim(); const result = $('results'); const count = $('resultCount'); const request = ++searchSequence;
  if (query.length < 2) { count.textContent = ''; result.innerHTML = '<div class="empty-state">Enter at least 2 characters to search the catalog.</div>'; return; }
  count.textContent = ''; result.innerHTML = '<div class="empty-state">Searching catalog…</div>';
  try {
    const rows = await api(`/api/medicine/search?q=${encodeURIComponent(query)}`);
    if (request !== searchSequence) return;
    count.textContent = rows.length ? `${rows.length} records shown${rows.length === 30 ? ' · maximum shown; refine your search for more' : ''}` : '0 records shown';
    result.innerHTML = rows.length ? rows.map(medicineCard).join('') : '<div class="empty-state">No catalog records found. Try another name or ingredient.</div>';
  } catch (error) { if (request === searchSequence) result.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
}

$('searchForm').addEventListener('submit', async (event) => { event.preventDefault(); clearTimeout(searchTimer); await runMedicineSearch(); });
$('searchInput').addEventListener('input', () => {
  const query = $('searchInput').value.trim(); searchSequence++; $('clearSearch').classList.toggle('hidden', !query); clearTimeout(searchTimer);
  if (query.length < 2) { $('resultCount').textContent = ''; $('results').innerHTML = query ? '<div class="empty-state">Enter at least 2 characters to search the catalog.</div>' : '<div class="empty-state"><span>⌕</span><p>Search the catalog to see medicine records.</p></div>'; return; }
  $('results').innerHTML = '<div class="empty-state">Searching catalog…</div>'; searchTimer = setTimeout(runMedicineSearch, 300);
});
$('clearSearch').addEventListener('click', () => { searchSequence++; clearTimeout(searchTimer); $('searchInput').value = ''; $('clearSearch').classList.add('hidden'); $('resultCount').textContent = ''; $('results').innerHTML = '<div class="empty-state"><span>⌕</span><p>Search the catalog to see medicine records.</p></div>'; $('searchInput').focus(); });

function alternativesTable(items, notice) {
  if (!items.length) return '';
  return `<h4>Comparable catalog entries</h4><p>${escapeHtml(notice)}</p><div class="table-scroll"><table class="alternatives-table"><caption>Entries with the same listed ingredient, strength, and form</caption><thead><tr><th scope="col">Medicine</th><th scope="col">Manufacturer</th><th scope="col">Listed form</th><th scope="col">Catalog status</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${valueOrNotListed(item.manufacturer)}</td><td>${escapeHtml(item.strength)} · ${escapeHtml(item.dosage_form)}</td><td>${escapeHtml(item.regulatory_status || 'UNKNOWN')}</td></tr>`).join('')}</tbody></table></div>`;
}

$('results').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-medicine-id]'); if (!button) return;
  const id = Number(button.dataset.medicineId); const panel = $(`detail-${id}`); const open = button.getAttribute('aria-expanded') === 'true';
  if (open) { panel.classList.add('hidden'); button.setAttribute('aria-expanded', 'false'); button.querySelector('span').textContent = '＋'; return; }
  button.setAttribute('aria-expanded', 'true'); button.querySelector('span').textContent = '−'; panel.classList.remove('hidden'); panel.innerHTML = '<p>Loading source-backed record…</p>';
  try {
    const [medicine, alternatives] = await Promise.all([api(`/api/medicine/${id}`), api(`/api/medicine/${id}/alternatives`)]);
    panel.innerHTML = `<h4>Catalog record</h4><dl class="record-list"><div><dt>Generic name</dt><dd>${valueOrNotListed(medicine.generic_name)}</dd></div><div><dt>Active ingredient</dt><dd>${valueOrNotListed(medicine.active_ingredient)}</dd></div><div><dt>Strength and form</dt><dd>${escapeHtml(medicine.strength)} · ${escapeHtml(medicine.dosage_form)}</dd></div><div><dt>Manufacturer</dt><dd>${valueOrNotListed(medicine.manufacturer)}</dd></div><div><dt>Regulatory status</dt><dd>${escapeHtml(medicine.regulatory_status || 'UNKNOWN')} — current product licensing is not verified.</dd></div></dl>${medicine.warnings ? `<p><b>Important note:</b> ${escapeHtml(medicine.warnings)}</p>` : ''}<p><b>Source:</b> ${escapeHtml(medicine.source_name || 'Not provided')}${medicine.source_date ? ` · ${escapeHtml(medicine.source_date)}` : ''}${medicine.source_url ? ` · <a href="${escapeHtml(medicine.source_url)}" target="_blank" rel="noopener noreferrer">Open source</a>` : ''}</p><p class="detail-disclaimer">Uses, dosage, side effects, and storage are not supplied by the available record. Follow the package label or ask a healthcare professional.</p>${alternativesTable(alternatives.items, alternatives.notice)}`;
  } catch (error) { panel.textContent = error.message; }
});

$('accountButton').addEventListener('click', async () => { if (authenticated) { try { await api('/api/auth/logout', { method: 'POST' }); authenticated = false; updateAccount(); } catch (error) { $('authMessage').textContent = error.message; } return; } authDialog.showModal(); });
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => setAuthMode(button.dataset.mode)));
function setAuthMode(mode) { authMode = mode; document.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('selected', button.dataset.mode === mode)); $('nameField').classList.toggle('hidden', mode !== 'register'); $('name').required = mode === 'register'; $('authTitle').textContent = mode === 'register' ? 'Create your account' : 'Welcome back'; $('authDescription').textContent = mode === 'register' ? 'Create an account to use your private document space.' : 'Sign in to use your private document space.'; $('password').autocomplete = mode === 'register' ? 'new-password' : 'current-password'; $('password').minLength = mode === 'register' ? 12 : 1; $('password').nextElementSibling.textContent = mode === 'register' ? 'At least 12 characters.' : 'Enter your password.'; $('authMessage').textContent = ''; }
$('authForm').addEventListener('submit', async (event) => { event.preventDefault(); const message = $('authMessage'); message.textContent = ''; try { const payload = { email: $('email').value, password: $('password').value }; if (authMode === 'register') payload.name = $('name').value; await api(`/api/auth/${authMode}`, { method: 'POST', body: JSON.stringify(payload) }); authenticated = true; updateAccount(); authDialog.close(); event.target.reset(); } catch (error) { message.textContent = error.message; } });

function setImagePreview(file) { const preview = $('imagePreview'); if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; preview.classList.add('hidden'); preview.removeAttribute('src'); if (file?.type.startsWith('image/')) { previewUrl = URL.createObjectURL(file); preview.src = previewUrl; preview.classList.remove('hidden'); } }
async function uploadFile(file) { const result = $('uploadResult'); if (!file) return; const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']; if (!allowed.includes(file.type)) { result.textContent = 'Choose a JPG, PNG, WEBP, or PDF file.'; return; } if (file.size > 5 * 1024 * 1024) { result.textContent = 'Choose a file smaller than 5 MB.'; return; } setImagePreview(file); result.textContent = 'Uploading privately…'; if (!authenticated) { result.textContent = 'Please sign in before uploading a document.'; authDialog.showModal(); return; } try { const form = new FormData(); form.append('file', file); form.append('purpose', file.type === 'application/pdf' ? 'prescription' : 'image'); const data = await api('/api/uploads', { method: 'POST', body: form }); result.textContent = `${data.filename}: ${data.message}`; } catch (error) { result.textContent = error.message; } }
$('fileInput').addEventListener('change', (event) => { uploadFile(event.target.files[0]); event.target.value = ''; });
const dropZone = $('uploadDropZone');
['dragenter', 'dragover'].forEach((type) => dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.add('drag-active'); }));
['dragleave', 'drop'].forEach((type) => dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.remove('drag-active'); }));
dropZone.addEventListener('drop', (event) => uploadFile(event.dataTransfer.files[0]));
dropZone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('fileInput').click(); } });

function chatMarkup(message) { const citations = message.citations?.length ? `<b>Sources</b>${message.citations.map((citation) => `<span class="citation">${escapeHtml(citation.title)} — ${escapeHtml(citation.source)}${citation.source_date ? ` · ${escapeHtml(citation.source_date)}` : ''} · Status: ${escapeHtml(citation.regulatory_status)}${citation.url ? ` · <a href="${escapeHtml(citation.url)}" target="_blank" rel="noopener noreferrer">View source</a>` : ''}</span>`).join('')}` : ''; return `<article class="chat-message user"><b>You</b><p>${escapeHtml(message.question)}</p></article><article class="chat-message assistant"><b>MediGuide</b><p>${escapeHtml(message.answer)}</p>${citations}${message.disclaimer ? `<span class="citation">${escapeHtml(message.disclaimer)}</span>` : ''}</article>`; }
function renderChat() { $('chatHistory').innerHTML = chatMessages.map(chatMarkup).join(''); }
function persistChat() { if ($('saveChatHistory').checked) localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatMessages.slice(-20))); }
function restoreChat() { try { const saved = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || '[]'); if (Array.isArray(saved)) { chatMessages = saved.slice(-20); $('saveChatHistory').checked = chatMessages.length > 0; renderChat(); } } catch { localStorage.removeItem(CHAT_HISTORY_KEY); } }
$('saveChatHistory').addEventListener('change', () => { if ($('saveChatHistory').checked) persistChat(); else localStorage.removeItem(CHAT_HISTORY_KEY); });
$('clearChatHistory').addEventListener('click', () => { chatMessages = []; localStorage.removeItem(CHAT_HISTORY_KEY); renderChat(); $('chatStatus').textContent = 'Chat cleared from this page and this browser.'; });
$('chatForm').addEventListener('submit', async (event) => { event.preventDefault(); const question = $('question').value.trim(); const status = $('chatStatus'); if (!question) return; if (!authenticated) { status.textContent = 'Please sign in to use the assistant.'; authDialog.showModal(); return; } status.textContent = 'Looking for supporting catalog records…'; try { const data = await api('/api/chat', { method: 'POST', body: JSON.stringify({ question }) }); chatMessages.push({ question, ...data }); chatMessages = chatMessages.slice(-20); renderChat(); persistChat(); $('question').value = ''; status.textContent = ''; } catch (error) { status.textContent = error.message; } });

function applyDisplayPreferences() { let preferences = {}; try { preferences = JSON.parse(localStorage.getItem(DISPLAY_KEY) || '{}'); } catch { preferences = {}; } document.body.classList.toggle('large-text', Boolean(preferences.largeText)); document.body.classList.toggle('high-contrast', Boolean(preferences.highContrast)); $('largeTextButton').setAttribute('aria-pressed', String(Boolean(preferences.largeText))); $('contrastButton').setAttribute('aria-pressed', String(Boolean(preferences.highContrast))); }
function toggleDisplayPreference(name) { let preferences = {}; try { preferences = JSON.parse(localStorage.getItem(DISPLAY_KEY) || '{}'); } catch { /* use defaults */ } preferences[name] = !preferences[name]; localStorage.setItem(DISPLAY_KEY, JSON.stringify(preferences)); applyDisplayPreferences(); }
$('largeTextButton').addEventListener('click', () => toggleDisplayPreference('largeText'));
$('contrastButton').addEventListener('click', () => toggleDisplayPreference('highContrast'));
applyDisplayPreferences(); restoreChat();

api('/api/profile').then(async (profile) => { authenticated = true; updateAccount(); if (profile.role === 'admin') { try { const stats = await api('/api/admin/stats'); $('adminOverview').classList.remove('hidden'); $('adminStats').innerHTML = [['Users', stats.users], ['Catalog records', stats.medicines], ['Private uploads', stats.uploads], ...Object.entries(stats.status_counts).map(([key, value]) => [key, value])].map(([key, value]) => `<div><span>${escapeHtml(key)}</span><b>${Number(value)}</b></div>`).join(''); } catch { /* Optional admin dashboard. */ } } }).catch(() => { authenticated = false; updateAccount(); });
api('/api/regulatory/sources').then((data) => { $('sourceCoverage').textContent = data.legal_status_note; $('sourceLinks').innerHTML = data.sources.map((source) => `<article class="source-entry"><b><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a></b><p>${escapeHtml(source.scope)}</p><small>${escapeHtml(source.limitation)}</small></article>`).join(''); }).catch(() => { $('sourceCoverage').textContent = 'Official-source coverage is temporarily unavailable.'; });
