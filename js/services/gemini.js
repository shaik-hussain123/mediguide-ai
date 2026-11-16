/**
 * @file Gemini API layer (SRS 6.3 gemini.js, NFR-7.3 swappable API layer).
 * HTTPS only (NFR-3.1). The key goes in a header, never in the URL, and is never logged.
 */
import { GEMINI, KEYS } from '../config.js';
import * as store from '../utils/storage.js';
import * as backend from './backend.js';

const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(aiAvailable()));

export const getApiKey = () => store.get(KEYS.apiKey, '');
export const hasApiKey = () => Boolean(getApiKey());
/** True when the server holds the key (preferred) or this browser has its own key (local mode). */
export const aiAvailable = () => backend.serverAiReady() || hasApiKey();
backend.onChange(notify);
export const onKeyChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getModel = () => store.get(KEYS.model, '');

export function setApiKey(key) {
  const k = String(key || '').trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(k)) throw new Error('That does not look like a Gemini API key. Copy it again from Google AI Studio.');
  store.set(KEYS.apiKey, k); notify();
}
export function clearApiKey() { store.remove(KEYS.apiKey); notify(); }
export function setModel(name) {
  const m = String(name || '').trim();
  if (m && !/^[a-z0-9][a-z0-9.\-]{2,60}$/i.test(m)) throw new Error('Model name can only contain letters, numbers, dots and hyphens.');
  m ? store.set(KEYS.model, m) : store.remove(KEYS.model);
}

export class GeminiError extends Error {
  constructor(message, code = 'unknown') { super(message); this.code = code; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let workingModel = null;

function explain(status, body) {
  const msg = body?.error?.message || '';
  if (status === 400 && /api key/i.test(msg)) return new GeminiError('Your API key was rejected. Check it in Settings and try again.', 'key');
  if (status === 401 || status === 403) return new GeminiError('This API key is not allowed to use Gemini. Create a new key in Google AI Studio.', 'key');
  if (status === 429) return new GeminiError('Too many requests or free quota used up. Please wait a minute and try again.', 'quota');
  if (status === 400) return new GeminiError(`The AI could not process that request. ${msg}`.trim(), 'bad');
  return new GeminiError('The AI service is having trouble. Please try again shortly.', 'server');
}

async function callOnce(model, body, key, signal) {
  const res = await fetch(`${GEMINI.endpoint}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error body */ }
  return { res, json };
}

/**
 * @param {{system:string, history?:{role:'user'|'model',text:string}[], parts:object[], signal?:AbortSignal}} o
 * @returns {Promise<string>} reply text
 */
export async function generate({ system, history = [], parts, signal }) {
  const key = getApiKey();
  if (!key) throw new GeminiError('Add your Gemini API key to start chatting.', 'nokey');
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })), { role: 'user', parts }],
    generationConfig: { temperature: GEMINI.temperature, maxOutputTokens: GEMINI.maxOutputTokens },
  };
  const chain = [...new Set([workingModel, getModel(), ...GEMINI.models].filter(Boolean))];
  let last = new GeminiError('The AI service is not reachable.', 'network');

  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {           // NFR-2.5: one automatic retry
      let out;
      try { out = await callOnce(model, body, key, signal); }
      catch (e) {
        if (e.name === 'AbortError') throw e;
        last = new GeminiError('No internet connection to the AI service. Check your network and try again.', 'network');
        if (attempt === 0) { await sleep(900); continue; }
        throw last;
      }
      const { res, json } = out;
      if (res.ok) {
        workingModel = model;
        const text = (json?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
        if (text) return text;
        const why = json?.promptFeedback?.blockReason || json?.candidates?.[0]?.finishReason;
        throw new GeminiError(why ? `The AI could not answer this (${why}). Try rephrasing your question.` : 'The AI returned an empty answer. Please try again.', 'empty');
      }
      if (res.status === 404) { last = new GeminiError('The AI model is not available for this key.', 'model'); break; } // next model
      last = explain(res.status, json);
      if ((res.status === 429 || res.status >= 500) && attempt === 0) { await sleep(1200); continue; }
      throw last;
    }
  }
  throw last;
}

/**
 * One entry point for chat and scanning. Server mode: POST /api/ai/generate (key stays on the server).
 * Local mode: call Gemini directly with the admin-entered key.
 */
export async function ask({ system, history = [], parts, lang = 'en', context = null, shareProfile = false }) {
  if (backend.serverAiReady()) {
    try {
      return (await backend.api('/api/ai/generate', { method: 'POST', body: { history, parts, lang, context, shareProfile } })).text;
    } catch (e) {
      throw new GeminiError(e.message, e.status === 503 ? 'nokey' : e.status === 429 ? 'quota' : 'server');
    }
  }
  return generate({ system, history, parts });
}
