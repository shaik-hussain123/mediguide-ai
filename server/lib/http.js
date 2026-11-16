/** Tiny HTTP toolkit: errors, JSON, body parsing, cookies, rate limiting, validation. */
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (m) => new HttpError(400, m);

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

export async function readJson(req, limit = 100_000) {
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Request is too large.');
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad('Body must be valid JSON.'); }
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function cookie(name, value, { maxAge, path = '/', secure = false } = {}) {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}${maxAge != null ? `; Max-Age=${maxAge}` : ''}`;
}

const hits = new Map();
/** Sliding-window limiter. Throws 429 when `key` exceeds `max` hits in `windowMs`. */
export function rateLimit(key, max, windowMs = 60_000) {
  const t = Date.now();
  const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
  if (list.length >= max) { hits.set(key, list); throw new HttpError(429, 'Too many requests. Please wait a minute and try again.'); }
  list.push(t); hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v.at(-1) > windowMs) hits.delete(k);
}
export const resetRateLimits = () => hits.clear();

export function str(v, name, min, max) {
  if (typeof v !== 'string') throw bad(`${name} is required.`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw bad(`${name} must be ${min}–${max} characters.`);
  return s;
}
export function optStr(v, name, max) { return v == null || v === '' ? '' : str(String(v), name, 0, max); }
export function int(v, name, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number between ${min} and ${max}.`);
  return n;
}
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
