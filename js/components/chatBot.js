/**
 * @file MediChat: multimodal Gemini chatbot (FR-7.1–7.12). Text, image, audio and video input,
 * typing indicator, safe formatted replies, 50-record history, disclaimer on every AI reply.
 */
import { $, escapeHtml as h, renderRichText, validateFile, fileToBase64, showToast, formatDate } from '../utils/helpers.js';
import * as store from '../utils/storage.js';
import * as audit from '../utils/audit.js';
import * as gemini from '../services/gemini.js';
import { askConsent, sharesProfile } from './consent.js';
import { currentUser } from './auth.js';
import { getPrefs } from './settings.js';
import { speak, stopSpeaking, listen, sttSupported, isVoiceMode } from '../services/voice.js';
import { t, currentLang, onLangChange, LANGS } from '../i18n.js';
import { KEYS, LIMITS, GEMINI, SYSTEM_PROMPT } from '../config.js';

const el = {};
let records = [];          // [{user, bot, hasImage, attachment, timestamp}]  (SRS §7.3 + attachment kind)
let attachment = null;     // {file, kind, url}
let busy = false;
let context = null;        // medicine currently on screen

export const setContext = (med) => { context = med; };

const welcome = () => `**${t('welcomeTitle')}**
- ${t('welcome1')}
- ${t('welcome2')}
- ${t('welcome3')}`;

function scroll() { el.msgs.scrollTop = el.msgs.scrollHeight; }
const time = (iso) => `<time datetime="${h(iso)}">${h(formatDate(iso))}</time>`;

function mediaHtml(kind, url) {
  if (kind === 'image') return `<img class="msg-media" src="${url}" alt="Image you attached" />`;
  if (kind === 'audio') return `<audio class="msg-media" controls src="${url}"></audio>`;
  if (kind === 'video') return `<video class="msg-media" controls src="${url}"></video>`;
  return '';
}

function addUser(text, att, iso) {
  const node = document.createElement('div');
  node.className = 'msg user';
  const media = att?.url ? mediaHtml(att.kind, att.url)
    : att ? `<div class="msg-attached"><i class="fas fa-paperclip" aria-hidden="true"></i> ${h(att.kind || 'file')} attached</div>` : '';   // restored from history
  node.innerHTML = `<div class="msg-body">${media}${text ? `<div class="msg-text"><p>${h(text)}</p></div>` : ''}${time(iso)}</div>`;
  el.msgs.appendChild(node); scroll();
}

function addBot(text, { iso = new Date().toISOString(), error = false, plain = false } = {}) {
  const node = document.createElement('div');
  node.className = `msg bot${error ? ' error' : ''}`;
  node.innerHTML = `<div class="msg-avatar" aria-hidden="true"><i class="fas ${error ? 'fa-triangle-exclamation' : 'fa-robot'}"></i></div>
    <div class="msg-body"><div class="msg-text">${plain ? `<p>${h(text)}</p>` : renderRichText(text)}</div>
    ${error ? '' : `<div class="msg-disclaimer"><i class="fas fa-circle-info" aria-hidden="true"></i> ${h(t('disclaimer'))}</div>`}
    ${error ? '' : `${time(iso)}<button type="button" class="speak-btn" data-speak aria-label="${h(t('listen'))}" title="${h(t('listen'))}"><i class="fas fa-volume-up" aria-hidden="true"></i></button>`}</div>`;                                                         // FR-7.11
  el.msgs.appendChild(node); scroll();
  return node;
}

function showTyping(on) {
  $('#typingIndicator')?.remove();
  if (!on) return;
  const n = document.createElement('div');
  n.id = 'typingIndicator'; n.className = 'msg bot typing'; n.setAttribute('role', 'status'); n.setAttribute('aria-label', 'MediChat is typing');
  n.innerHTML = '<div class="msg-avatar" aria-hidden="true"><i class="fas fa-robot"></i></div><div class="msg-body"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
  el.msgs.appendChild(n); scroll();
}

function renderAll() {
  el.msgs.innerHTML = '';
  addBot(welcome(), { iso: new Date().toISOString() });
  records.forEach((r) => { addUser(r.user, r.hasImage ? { kind: r.attachment || 'image' } : null, r.timestamp); addBot(r.bot, { iso: r.timestamp }); });
}

function persist() {
  records = records.slice(-LIMITS.chatHistory);
  if (getPrefs().saveHistory) store.set(KEYS.chat, records);
}

/* ---------------- attachments (FR-7.2–7.4, FR-7.8) ---------------- */
function clearAttachment() {
  if (attachment?.url) URL.revokeObjectURL(attachment.url);
  attachment = null;
  el.preview.style.display = 'none'; el.preview.innerHTML = ''; el.file.value = '';
}

function setAttachment(file) {
  const v = validateFile(file, ['image', 'audio', 'video']);
  if (!v.ok) { showToast(v.error, 'error'); el.file.value = ''; return; }
  clearAttachment();
  attachment = { file, kind: v.kind, url: URL.createObjectURL(file) };
  el.preview.style.display = 'flex';
  el.preview.innerHTML = `${mediaHtml(v.kind, attachment.url).replace('class="msg-media"', 'class="preview-media"')}
    <span class="preview-name">${h(file.name)}</span>
    <button type="button" class="icon-btn" id="removeAttachment" aria-label="Remove attachment"><i class="fas fa-times" aria-hidden="true"></i></button>`;
  $('#removeAttachment').addEventListener('click', clearAttachment);
}

/* ---------------- sending ---------------- */
function profileContext() {
  const u = currentUser();
  if (!u || !sharesProfile()) return '';
  const p = u.profile;
  const bits = [p.age && `age ${p.age}`, p.weight && `weight ${p.weight} kg`, p.conditions && `conditions: ${p.conditions}`, p.allergies && `allergies: ${p.allergies}`].filter(Boolean);
  return bits.length ? `\nThe user chose to share this profile (use it to be more careful, never to diagnose): ${bits.join('; ')}.` : '';
}

function buildSystem() {
  const med = context ? `\nThe user is currently viewing: ${context.name} (${context.generic || ''} ${context.mg} ${context.unit || 'mg'}, ${context.category}). Treat "this medicine" as this one.` : '';
  return `${SYSTEM_PROMPT}\nReply in ${LANGS[currentLang()].aiName}. Keep medicine names in their usual English or brand form as well.${med}${profileContext()}`;
}

export async function send(textOverride) {
  if (busy) return;
  const text = String(textOverride ?? el.input.value).trim().slice(0, 2000);
  if (!text && !attachment) return;
  if (!(await askConsent())) { addBot('Chat needs your consent to send questions to Google Gemini. You can accept it when asked.', { error: true, plain: true }); return; }
  if (!gemini.aiAvailable()) {                                                             // FR-7.10
    addBot('The AI assistant is not set up yet. The administrator needs to add the Gemini API key (Admin → API Key).', { error: true, plain: true });
    return;
  }

  busy = true; el.send.disabled = true;
  const att = attachment; attachment = null;                                              // keep object URL alive for the bubble
  el.preview.style.display = 'none'; el.preview.innerHTML = ''; el.file.value = '';
  const iso = new Date().toISOString();
  addUser(text, att, iso);
  el.input.value = '';
  showTyping(true);

  try {
    const parts = [{ text: text || `Please look at the attached ${att.kind} and tell me what it shows about the medicine.` }];
    if (att) {
      const { mime, data } = await fileToBase64(att.file);
      parts.push({ inline_data: { mime_type: mime, data } });                              // FR-7.5 / FR-7.12
    }
    const history = records.slice(-GEMINI.historyTurns).flatMap((r) => [{ role: 'user', text: r.user }, { role: 'model', text: r.bot }]);
    const reply = await gemini.ask({ system: buildSystem(), history, parts, lang: currentLang(), context: context ? { name: context.name, generic: context.generic } : null, shareProfile: sharesProfile() });
    showTyping(false);
    addBot(reply, { iso: new Date().toISOString() });
    if (isVoiceMode()) speak(reply);                                                       // voice-first: read the answer aloud
    records.push({ user: text || `(${att.kind} attached)`, bot: reply, hasImage: Boolean(att), attachment: att?.kind || null, timestamp: iso });
    persist();
    audit.log('chat_message', att ? att.kind : 'text');
  } catch (err) {
    showTyping(false);
    addBot(err.message || 'Something went wrong. Please try again.', { error: true, plain: true });   // NFR-4.3 clear + actionable
  } finally {
    busy = false; el.send.disabled = false; el.input.focus();
  }
}

/* ---------------- voice input (language follows the UI language) ---------------- */
function initVoice() {
  if (!sttSupported) { el.mic.hidden = true; return; }
  let ctl = null;
  el.mic.addEventListener('click', () => {
    if (ctl) { ctl.stop(); return; }
    stopSpeaking();
    el.mic.classList.add('listening'); el.mic.setAttribute('aria-pressed', 'true');
    ctl = listen({
      onResult: (text) => { el.input.value = `${el.input.value} ${text}`.trim(); if (isVoiceMode()) send(); },
      onError: () => showToast('Could not hear you. Check microphone permission and try again.', 'warn'),
      onEnd: () => { ctl = null; el.mic.classList.remove('listening'); el.mic.setAttribute('aria-pressed', 'false'); if (!isVoiceMode()) el.input.focus(); },
    });
  });
}

export function clearHistory() { records = []; store.remove(KEYS.chat); renderAll(); }

export function initChat() {
  Object.assign(el, { msgs: $('#chatMessages'), input: $('#chatInput'), send: $('#sendChatBtn'), file: $('#fileInput'), preview: $('#imagePreview'), mic: $('#micBtn') });
  records = getPrefs().saveHistory ? store.get(KEYS.chat, []).slice(-LIMITS.chatHistory) : [];     // NFR-2.4
  renderAll();

  el.send.addEventListener('click', () => send());
  el.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  el.file.addEventListener('change', () => el.file.files[0] && setAttachment(el.file.files[0]));
  $('#chatClearBtn').addEventListener('click', () => { if (window.confirm('Clear all chat history on this device?')) { clearHistory(); showToast('Chat history cleared.', 'success'); } });
  document.querySelectorAll('.quick-chip').forEach((c) => c.addEventListener('click', () => {
    send(context ? `${c.dataset.prompt} (about ${context.name})` : c.dataset.prompt);
  }));
  el.msgs.addEventListener('click', (e) => {                       // read-aloud button on every AI reply
    const b = e.target.closest('[data-speak]'); if (b) speak(b.closest('.msg-body').querySelector('.msg-text').textContent);
  });
  onLangChange(() => { renderAll(); el.input.placeholder = t('chatPlaceholder'); });
  initVoice();
}

export function focusChat(prefill = '') { el.input.value = prefill; el.input.focus(); el.input.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
