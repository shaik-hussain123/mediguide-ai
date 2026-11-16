/** @file Voice-first support: read-aloud (speechSynthesis) and dictation (SpeechRecognition) in the chosen language. */
import { LANGS, currentLang } from '../i18n.js';
import { getPrefs } from '../components/settings.js';

export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const sttSupported = Boolean(SR);
export const isVoiceMode = () => getPrefs().voiceMode === true;

/** Remove markdown marks so the voice does not read "asterisk asterisk". */
export const plainText = (s) => String(s || '').replace(/[*_`#>]/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();

export function stopSpeaking() { if (ttsSupported) window.speechSynthesis.cancel(); }

export function speak(text, { lang = LANGS[currentLang()].speech, onEnd } = {}) {
  if (!ttsSupported) return false;
  const clean = plainText(text).slice(0, 1800);
  if (!clean) return false;
  stopSpeaking();
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = lang;
  u.rate = document.documentElement.classList.contains('elderly') ? 0.85 : 0.95;
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang === lang) || window.speechSynthesis.getVoices().find((v) => v.lang.startsWith(lang.slice(0, 2)));
  if (voice) u.voice = voice;
  u.onend = () => onEnd?.();
  window.speechSynthesis.speak(u);
  return true;
}

/** One-shot dictation. Returns {stop()} or null if unsupported. */
export function listen({ lang = LANGS[currentLang()].speech, onResult, onError, onEnd }) {
  if (!SR) return null;
  const rec = new SR();
  rec.lang = lang; rec.interimResults = false; rec.maxAlternatives = 1;
  rec.onresult = (e) => onResult?.(e.results[0][0].transcript);
  rec.onerror = (e) => onError?.(e.error);
  rec.onend = () => onEnd?.();
  rec.start();
  return { stop: () => rec.stop() };
}
