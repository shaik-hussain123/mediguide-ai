/** @file Settings, accessibility prefs (FR-10.1), API key management (FR-9), right to delete (§8.4). */
import { $, openModal, showToast } from '../utils/helpers.js';
import * as store from '../utils/storage.js';
import * as gemini from '../services/gemini.js';
import { onAuthChange, isAdmin } from './auth.js';
import { t, onLangChange } from '../i18n.js';
import { KEYS, APP } from '../config.js';

const DEFAULTS = { elderly: false, contrast: false, font: 'normal', saveHistory: true, voiceMode: false };
export const getPrefs = () => ({ ...DEFAULTS, ...store.get(KEYS.prefs, {}) });
const setPrefs = (patch) => { const p = { ...getPrefs(), ...patch }; store.set(KEYS.prefs, p); applyPrefs(p); return p; };

export function applyPrefs(p = getPrefs()) {
  document.documentElement.classList.toggle('elderly', p.elderly);
  document.documentElement.classList.toggle('high-contrast', p.contrast);
  document.documentElement.dataset.font = p.font;
  $('#voiceModeBtn').setAttribute('aria-pressed', String(p.voiceMode));
  $('#voiceModeBtn').classList.toggle('active', p.voiceMode);
  $('#elderlyToggle').setAttribute('aria-pressed', String(p.elderly));
  $('#elderlyToggle').classList.toggle('active', p.elderly);
  $('#settingsElderlyMode').checked = p.elderly;
  $('#settingsHighContrast').checked = p.contrast;
  $('#settingsFontSize').value = p.font;
  $('#settingsSaveHistory').checked = p.saveHistory;
}

/** Chat-panel status line. The key itself is managed by the administrator (admin.js). */
export function renderKeyStatus() {
  const active = gemini.aiAvailable();
  $('#apiStatus').className = `api-status${active ? ' active' : ''}`;
  $('#apiStatus').innerHTML = `<i class="fas fa-circle" aria-hidden="true"></i> ${t(active ? 'aiReady' : 'aiNotSet')}`;
  $('#apiHint').textContent = active ? '' : isAdmin() ? 'Open Admin → API Key to add the Gemini key.' : 'Ask the administrator to add the Gemini API key.';
}

export function initSettings({ onSaveHistoryOff }) {
  $('#settingsBtn').addEventListener('click', () => openModal('settingsModal'));
  $('#aboutBtn').addEventListener('click', () => openModal('aboutModal'));
  $('#appVersion').textContent = APP.version;

  $('#voiceModeBtn').addEventListener('click', () => {
    const on = !getPrefs().voiceMode; setPrefs({ voiceMode: on });
    showToast(on ? 'Voice mode on: answers are read aloud and the mic sends automatically.' : 'Voice mode off.', 'info');
  });
  $('#elderlyToggle').addEventListener('click', () => setPrefs({ elderly: !getPrefs().elderly }));
  $('#settingsElderlyMode').addEventListener('change', (e) => setPrefs({ elderly: e.target.checked }));
  $('#settingsHighContrast').addEventListener('change', (e) => setPrefs({ contrast: e.target.checked }));
  $('#settingsFontSize').addEventListener('change', (e) => setPrefs({ font: e.target.value }));
  $('#settingsSaveHistory').addEventListener('change', (e) => {
    setPrefs({ saveHistory: e.target.checked });
    if (!e.target.checked) { store.remove(KEYS.chat); onSaveHistoryOff?.(); }
  });


  $('#clearAllDataBtn').addEventListener('click', () => {
    if (!window.confirm('Remove your API key, chat history, profile, accounts and all settings from this device? This cannot be undone.')) return;
    store.clearAll();
    showToast('All local data removed.', 'success');
    setTimeout(() => location.reload(), 600);
  });

  gemini.onKeyChange(renderKeyStatus);
  onAuthChange(renderKeyStatus);        // hint differs for admins
  onLangChange(renderKeyStatus);
  applyPrefs();
}
