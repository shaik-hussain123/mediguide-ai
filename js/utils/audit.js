/** @file Local audit trail (HIPAA-ready architecture, SRS §8.5). Never stores message content or keys. */
import * as store from './storage.js';
import { KEYS, LIMITS } from '../config.js';

export function log(event, detail = '') {
  const list = store.get(KEYS.audit, []);
  list.push({ t: new Date().toISOString(), event, detail: String(detail).slice(0, 120) });
  store.set(KEYS.audit, list.slice(-LIMITS.auditEntries));
}
export const all = () => store.get(KEYS.audit, []).slice().reverse();
