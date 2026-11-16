/** @file localStorage wrappers (SRS §6.2 utils/storage.js). All calls are failure-safe. */
const PREFIX = 'mg_';

export function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function set(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function remove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/** Right to delete (SRS §8.4): removes every MediGuide key. */
export function clearAll() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch { /* ignore */ }
}
