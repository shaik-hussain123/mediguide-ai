/** HTTP app: router, auth middleware, security headers, static files. Exported for tests. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './lib/config.js';
import { get } from './lib/db.js';
import { verifyJwt } from './lib/security.js';
import { HttpError, sendJson, readJson, rateLimit } from './lib/http.js';
import { authRoutes } from './routes/auth.js';
import { apiRoutes } from './routes/api.js';

const routes = [...authRoutes, ...apiRoutes].map(([method, pattern, handler, opts = {}]) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:([a-z]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  return { method, re, keys, handler, opts };
});

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://generativelanguage.googleapis.com; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
  ...(config.production ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const PUBLIC = [/^index\.html$/, /^sw\.js$/, /^manifest\.json$/, /^(css|js|icons)\//, /^data\/medicines\.json$/];

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC.some((re) => re.test(path.relative(ROOT, file).split(path.sep).join('/')))) {
    return sendJson(res, 404, { error: 'Not found.' });
  }
  fs.readFile(file, (err, buf) => {
    if (err) return sendJson(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

async function authenticate(req, level) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const payload = m ? verifyJwt(m[1]) : null;
  const user = payload ? get('SELECT * FROM users WHERE id = ?', payload.sub) : null;
  if (level === 'optional') return user;
  if (!user) throw new HttpError(401, 'Please log in.');
  if (level === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Admin access only.');
  return user;
}

export function createApp() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
        return serveStatic(req, res, url.pathname);
      }
      rateLimit(`global:${req.socket.remoteAddress}`, 300);
      let match = null; let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method === req.method) { match = { r, m }; break; }
      }
      if (!match) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Method not allowed.' : 'Not found.');
      const { r, m } = match;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const user = r.opts.auth ? await authenticate(req, r.opts.auth) : null;
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req, url.pathname === '/api/ai/generate' ? 26_000_000 : 100_000) : {};
      const out = await r.handler({ req, res, url, params, query: Object.fromEntries(url.searchParams), body, user });
      const headers = { ...SECURITY_HEADERS, ...(out.headers || {}) };
      if (out.redirect) { res.writeHead(302, { Location: out.redirect, 'Cache-Control': 'no-store', ...headers }); return res.end(); }
      sendJson(res, out.status || 200, out.body ?? {}, headers);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message }, SECURITY_HEADERS);
      console.error('Unhandled error:', e);
      sendJson(res, 500, { error: 'Something went wrong on the server.' }, SECURITY_HEADERS);
    }
  });
}
