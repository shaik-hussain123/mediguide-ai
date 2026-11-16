/** @file Shared helpers: DOM, sanitising, toasts, modals, file validation, crypto. */
import { LIMITS, MIME } from '../config.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** XSS prevention (NFR-3.4): escape every user/AI string before it touches innerHTML. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms = LIMITS.debounceMs) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function formatDate(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}

export function showToast(message, type = 'info', ms = 4500) {
  const host = $('#toastContainer');
  if (!host) return;
  const icons = { info: 'fa-info-circle', success: 'fa-check-circle', error: 'fa-exclamation-circle', warn: 'fa-exclamation-triangle' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<i class="fas ${icons[type] || icons.info}" aria-hidden="true"></i><span>${escapeHtml(message)}</span>`;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); }, ms);
}

/**
 * Safe light formatting for AI replies (FR-7.7): escape first, then allow only
 * **bold**, *italic*, `code`, bullet and numbered lists, paragraphs.
 */
export function renderRichText(text) {
  const inline = (s) => escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)/);
    const num = line.match(/^\d+[.)]\s+(.*)/);
    if (bullet || num) {
      const tag = bullet ? 'ul' : 'ol';
      if (list !== tag) { close(); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${inline((bullet || num)[1])}</li>`);
    } else if (!line) { close(); } else {
      close();
      const h = line.match(/^#{1,4}\s+(.*)/);
      out.push(h ? `<p><strong>${inline(h[1])}</strong></p>` : `<p>${inline(line)}</p>`);
    }
  }
  close();
  return out.join('');
}

/** Client-side file validation (SRS §8.3, FR-7.2–7.4). Returns {ok, kind, error}. */
export function validateFile(file, kinds = ['image']) {
  if (!file) return { ok: false, error: 'No file selected.' };
  const kind = kinds.find((k) => MIME[k]?.includes(file.type));
  if (!kind) {
    const names = kinds.map((k) => MIME[k].map((m) => m.split('/')[1].toUpperCase()).join('/')).join(', ');
    return { ok: false, error: `Unsupported file type. Allowed: ${names}.` };
  }
  const max = LIMITS[`${kind}Bytes`];
  if (file.size > max) return { ok: false, error: `File is too large. Maximum ${Math.round(max / 1048576)} MB for ${kind}.` };
  if (file.size === 0) return { ok: false, error: 'The file is empty.' };
  return { ok: true, kind };
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ mime: file.type, data: String(r.result).split(',')[1] });
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}

function subtle() {
  if (!globalThis.crypto?.subtle) throw new Error('Secure features need HTTPS or localhost. Please open the app from a web server.');
  return crypto.subtle;
}
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const randomHex = (n = 16) => toHex(crypto.getRandomValues(new Uint8Array(n)));

/** PBKDF2-SHA256 password hash. Phase-1 mock auth only; the real backend will replace this (JWT/OAuth2). */
export async function hashPassword(password, saltHex) {
  const s = subtle();
  const key = await s.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  return toHex(await s.deriveBits({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, key, 256));
}

/* ---- Modals: focus management, Escape, focus trap (WCAG 2.1, FR-10.4) ---- */
let lastFocus = null;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

export function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  lastFocus = document.activeElement;
  m.hidden = false;
  document.body.classList.add('modal-open');
  (m.querySelector('[data-autofocus]') || m.querySelector(FOCUSABLE))?.focus();
}
export function closeModal(id) {
  const m = document.getElementById(id);
  if (!m || m.hidden) return;
  m.hidden = true;
  if (!$$('.modal-overlay').some((x) => !x.hidden)) document.body.classList.remove('modal-open');
  lastFocus?.focus?.();
}
export function initModals() {
  document.addEventListener('click', (e) => {
    const closer = e.target.closest('.modal-close[data-modal]');
    if (closer) return closeModal(closer.dataset.modal);
    if (e.target.classList?.contains('modal-overlay') && !e.target.dataset.static) closeModal(e.target.id);
  });
  document.addEventListener('keydown', (e) => {
    const open = $$('.modal-overlay').filter((m) => !m.hidden).pop();
    if (!open) return;
    if (e.key === 'Escape' && !open.dataset.static) return closeModal(open.id);
    if (e.key !== 'Tab') return;
    const items = $$(FOCUSABLE, open).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const [first, last] = [items[0], items[items.length - 1]];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}
