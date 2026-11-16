/** @file Search bar logic (FR-1.1–1.6): debounced live search after ≥2 chars, Enter/click, category filter. */
import { $, debounce } from '../utils/helpers.js';
import { LIMITS } from '../config.js';
import { t } from '../i18n.js';
import { listen, sttSupported, stopSpeaking } from '../services/voice.js';

export function initSearch({ onChange, onClear }) {
  const input = $('#medicineSearch');
  const btn = $('#searchBtn');
  const category = $('#categoryFilter');
  const clear = $('#clearFilter');
  const read = () => ({ query: input.value.trim(), category: category.value });

  const live = debounce(() => {
    const q = input.value.trim();
    if (q.length === 0 || q.length >= LIMITS.searchMinChars) onChange(read());   // FR-1.2
  }, LIMITS.debounceMs);

  input.addEventListener('input', live);
  const now = () => { live.cancel(); onChange(read()); };                          // FR-1.4
  btn.addEventListener('click', now);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); now(); } });
  category.addEventListener('change', now);
  clear.addEventListener('click', () => { input.value = ''; category.value = ''; live.cancel(); onClear(); input.focus(); });

  const mic = $('#searchMicBtn');
  if (mic) {
    if (!sttSupported) mic.hidden = true;
    else mic.addEventListener('click', () => {
      stopSpeaking(); mic.classList.add('listening');
      listen({ onResult: (txt) => { input.value = txt.replace(/[.?!]+$/, ''); now(); }, onEnd: () => mic.classList.remove('listening') });
    });
  }

  return {
    setCategories(list) {
      const keep = category.value;
      category.innerHTML = `<option value="">${t('allCategories')}</option>`;
      list.forEach((c) => { const o = document.createElement('option'); o.value = o.textContent = c; category.appendChild(o); });
      category.value = list.includes(keep) ? keep : '';
    },
    reset() { input.value = ''; category.value = ''; },
  };
}
