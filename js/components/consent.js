/** @file First-use consent (SRS §8.4, NFR-3.8). Chat and scans need it because they send data to Google Gemini. */
import { $, openModal, closeModal } from '../utils/helpers.js';
import * as store from '../utils/storage.js';
import * as audit from '../utils/audit.js';
import { KEYS } from '../config.js';

export const getConsent = () => store.get(KEYS.consent, null);
export const hasConsent = () => getConsent()?.accepted === true;
export const sharesProfile = () => hasConsent() && getConsent().shareProfile === true;

let pending = null;

/** Resolves true when the user accepts. Safe to call repeatedly. */
export function askConsent() {
  if (hasConsent()) return Promise.resolve(true);
  if (pending) return pending.promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  pending = { promise, resolve };
  $('#consentShareProfile').checked = false;
  openModal('consentModal');
  return promise;
}

function settle(accepted) {
  store.set(KEYS.consent, { accepted, shareProfile: accepted && $('#consentShareProfile').checked, date: new Date().toISOString() });
  audit.log(accepted ? 'consent_accepted' : 'consent_declined');
  closeModal('consentModal');
  pending?.resolve(accepted);
  pending = null;
}

export function initConsent() {
  $('#consentAccept').addEventListener('click', () => settle(true));
  $('#consentDecline').addEventListener('click', () => settle(false));
  if (getConsent() === null) setTimeout(askConsent, 400);       // "clear consent message on first use"
}
