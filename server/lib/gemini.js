/** Server-side Gemini client: the API key never leaves the server (fixes the browser-key limitation of phase 1). */
import { config } from './config.js';
import { HttpError } from './http.js';
import { getSetting } from './db.js';
import { open } from './security.js';

const MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
export const getKey = () => { const s = getSetting('ai_key'); return (s && open(s)) || config.geminiEnvKey || ''; };
export const getModel = () => getSetting('ai_model') || '';
export const aiReady = () => Boolean(getKey());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function generate({ system, history, parts }) {
  const key = getKey();
  if (!key) throw new HttpError(503, 'The AI assistant is not set up yet. Ask the administrator to add the Gemini API key.');
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })), { role: 'user', parts }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
  });
  const chain = [...new Set([getModel(), ...MODELS].filter(Boolean))];
  let last = new HttpError(502, 'The AI service is not reachable.');
  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res; let json = null;
      try {
        res = await fetch(`${config.geminiEndpoint}/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body, signal: AbortSignal.timeout(60000),
        });
        json = await res.json().catch(() => null);
      } catch { last = new HttpError(502, 'The AI service is not reachable. Please try again.'); if (attempt === 0) { await sleep(600); continue; } break; }
      if (res.ok) {
        const text = (json?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
        if (text) return { text, model };
        throw new HttpError(502, 'The AI could not answer this. Try rephrasing your question.');
      }
      if (res.status === 404) { last = new HttpError(502, 'The AI model is not available for this key.'); break; }
      if (res.status === 429) last = new HttpError(429, 'The AI quota is used up for now. Please try again in a minute.');
      else if (res.status === 400 || res.status === 403) throw new HttpError(502, 'The AI key on the server was rejected. The administrator should check it.');
      else last = new HttpError(502, 'The AI service is having trouble. Please try again shortly.');
      if (attempt === 0 && (res.status === 429 || res.status >= 500)) { await sleep(800); continue; }
      break;
    }
  }
  throw last;
}
