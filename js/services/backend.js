/**
 * @file Backend client. The app works without a server ("local mode"); when /api/health answers, it switches to
 * "server mode": JWT sessions, server-side AI key, appointments, synced reminders.
 * The access token lives only in memory; the refresh token is an HttpOnly cookie the page cannot read.
 */
import * as store from '../utils/storage.js';
import { KEYS } from '../config.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let online = false;
let aiReady = false;
let token = null;
let user = null;
let loginAt = null;
let timer = null;
const subs = new Set();
const emit = () => subs.forEach((fn) => fn({ online, aiReady, user }));

export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const isOnline = () => online;
export const serverAiReady = () => online && aiReady;
export const getUser = () => user;
export const getLoginAt = () => loginAt;

export async function detect() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    online = r.ok && (r.headers.get('content-type') || '').includes('json');
    aiReady = online ? Boolean((await r.json()).ai) : false;
  } catch { online = false; aiReady = false; }
  emit();
  return online;
}
export const refreshHealth = detect;

function setSession(data) {
  token = data.accessToken;
  user = data.user;
  loginAt = loginAt || new Date().toISOString();
  store.set(KEYS.hasSession, true);                       // a flag only, not a secret
  clearTimeout(timer);
  timer = setTimeout(() => refresh().catch(() => {}), Math.max(30, (data.expiresIn || 900) - 60) * 1000);
  emit();
}
export function clearSession() {
  token = null; user = null; loginAt = null; clearTimeout(timer);
  store.remove(KEYS.hasSession);
  emit();
}
export const setUser = (u) => { user = u; emit(); };

let refreshing = null;
export function refresh() {
  refreshing ||= fetch('/api/auth/refresh', { method: 'POST' }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { clearSession(); throw new ApiError(r.status, data.error || 'Session expired.'); }
    setSession(data); return data;
  }).finally(() => { refreshing = null; });
  return refreshing;
}

/** Try to resume a previous session on page load (only when this browser logged in before). */
export async function restoreSession() {
  if (!online || !store.get(KEYS.hasSession, false)) return null;
  try { return (await refresh()).user; } catch { return null; }
}

export async function api(path, { method = 'GET', body, auth = true, _retry = true } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch { throw new ApiError(0, 'Could not reach the server. Check your connection and try again.'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth && _retry && user) {
    try { await refresh(); return api(path, { method, body, auth, _retry: false }); } catch { /* fall through */ }
  }
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong. Please try again.');
  return data;
}

export async function login(email, password, totp) {
  const data = await api('/api/auth/login', { method: 'POST', body: { email, password, totp: totp || undefined }, auth: false });
  loginAt = new Date().toISOString(); setSession(data); return data.user;
}
export async function register(name, email, password) {
  const data = await api('/api/auth/register', { method: 'POST', body: { name, email, password }, auth: false });
  loginAt = new Date().toISOString(); setSession(data); return data.user;
}
export async function logout() {
  try { await api('/api/auth/logout', { method: 'POST', auth: false }); } catch { /* ignore */ }
  clearSession();
}
