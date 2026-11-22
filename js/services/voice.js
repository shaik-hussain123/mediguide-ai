/** @file Voice-first support: read-aloud (speechSynthesis) and dictation (SpeechRecognition) in the chosen language. */
import { LANGS, currentLang } from '../i18n.js';
import { getPrefs } from '../components/settings.js';

export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const sttSupported = Boolean(SR);
export const isVoiceMode = () => getPrefs().voiceMode === true;

/** Remove markdown marks so the voice does not read "asterisk asterisk". */
export const plainText = (s) => String(s || '').replace(/[*_`#>]/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();

/** Check if browser supports voice features. Returns { tts, stt, message } */
export function getVoiceSupport() {
  const support = { tts: ttsSupported, stt: sttSupported };
  let message = '';
  if (!support.tts && !support.stt) {
    message = 'Voice recognition is not supported in this browser.';
  } else if (!support.tts) {
    message = 'Text-to-speech is not supported in this browser.';
  } else if (!support.stt) {
    message = 'Speech recognition is not supported in this browser.';
  }
  return { ...support, message };
}

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

/**
 * Continuous dictation with transcript preview, timeout handling, and retry support.
 * Returns controller: { stop, abort }
 */
export function startDictation({
  lang = LANGS[currentLang()].speech,
  onResult,
  onInterim,
  onError,
  onEnd,
  onTimeout,
  timeoutMs = 30000,
  continuous = false
} = {}) {
  if (!SR) return null;

  const rec = new SR();
  rec.lang = lang;
  rec.continuous = continuous;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let timeoutId = null;
  let finalTranscript = '';
  let isListening = true;

  const clearTimeout = () => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const resetTimeout = () => {
    clearTimeout();
    if (timeoutMs > 0) {
      timeoutId = window.setTimeout(() => {
        if (isListening) {
          rec.stop();
          onTimeout?.();
        }
      }, timeoutMs);
    }
  };

  rec.onstart = () => {
    resetTimeout();
  };

  rec.onresult = (e) => {
    resetTimeout();
    let interimTranscript = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        finalTranscript += transcript + ' ';
      } else {
        interimTranscript += transcript;
      }
    }
    if (interimTranscript) onInterim?.(interimTranscript);
    if (finalTranscript.trim()) onResult?.(finalTranscript.trim());
  };

  rec.onerror = (e) => {
    clearTimeout();
    const error = e.error;
    let message = 'Could not hear you. Please try again.';
    if (error === 'not-allowed' || error === 'permission-denied') {
      message = 'Microphone access is blocked for this site. Allow it in browser site permissions, then try again.';
    } else if (error === 'no-speech') {
      message = 'No speech detected. Please try again.';
    } else if (error === 'network') {
      message = 'Network error. Please check your connection and try again.';
    } else if (error === 'aborted') {
      message = 'Voice input was cancelled.';
    } else if (error === 'audio-capture') {
      message = 'Audio capture failed. Check microphone connection.';
    } else if (error === 'service-not-allowed') {
      message = 'Speech recognition service not allowed.';
    }
    onError?.(message, error);
  };

  rec.onend = () => {
    clearTimeout();
    isListening = false;
    onEnd?.(finalTranscript.trim());
  };

  rec.start();

  return {
    stop: () => {
      isListening = false;
      clearTimeout();
      rec.stop();
    },
    abort: () => {
      isListening = false;
      clearTimeout();
      rec.abort();
    }
  };
}

/** One-shot dictation (legacy compatibility). Returns {stop()} or null if unsupported. */
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
