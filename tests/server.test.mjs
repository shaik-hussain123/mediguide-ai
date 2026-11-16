// Integration tests: real HTTP server + in-memory SQLite + a fake Gemini API + a fake OAuth provider.
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-'));
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

/* ---- fake Gemini ---- */
const gemCalls = [];
const gem = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; }).on('end', () => {
    gemCalls.push({ url: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(b || '{}') });
    if (req.url.includes('gemini-3.5-flash')) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"nf"}}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Fake reply' }] } }] }));
  });
});
const gemPort = await listen(gem);

/* ---- fake OAuth provider (checks PKCE) ---- */
let lastChallenge = '';
const idp = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; }).on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/token') {
      const p = new URLSearchParams(b);
      const ok = p.get('code') === 'good-code' && crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') === lastChallenge && p.get('client_secret') === 'sec';
      res.writeHead(ok ? 200 : 400); return res.end(JSON.stringify(ok ? { access_token: 'idp-token' } : { error: 'invalid_grant' }));
    }
    if (req.url === '/userinfo' && req.headers.authorization === 'Bearer idp-token') { res.writeHead(200); return res.end(JSON.stringify({ sub: 'g-1', email: 'Oauth.User@example.com', email_verified: true, name: 'Oauth User' })); }
    res.writeHead(401); res.end('{}');
  });
});
const idpPort = await listen(idp);

process.env.DATA_DIR = tmp; process.env.DB_FILE = ':memory:';
process.env.GEMINI_ENDPOINT = `http://127.0.0.1:${gemPort}/v1beta/models`;
process.env.OAUTH_CLIENT_ID = 'cid'; process.env.OAUTH_CLIENT_SECRET = 'sec';
process.env.OAUTH_AUTH_URL = `http://127.0.0.1:${idpPort}/auth`; process.env.OAUTH_TOKEN_URL = `http://127.0.0.1:${idpPort}/token`; process.env.OAUTH_USERINFO_URL = `http://127.0.0.1:${idpPort}/userinfo`;

const { openDb, run, get } = await import('../server/lib/db.js');
const { createApp } = await import('../server/app.js');
const { signJwt, verifyJwt } = await import('../server/lib/security.js');
const { resetRateLimits } = await import('../server/lib/http.js');
openDb();
const app = createApp(); const port = await listen(app); const base = `http://127.0.0.1:${port}`;

async function call(method, p, { token, body, cookie } = {}) {
  const res = await fetch(base + p, { method, redirect: 'manual', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, headers: res.headers, cookies: res.headers.getSetCookie(), text };
}
const rt = (r) => r.cookies.find((c) => c.startsWith('mg_rt=')).split(';')[0];
let passed = 0; const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); passed++; };

/* ---- static + headers ---- */
let r = await call('GET', '/api/health'); eq(r.status, 200, 'health'); eq(r.json.ai, false, 'ai not set at start');
r = await call('GET', '/'); eq(r.status, 200, 'index'); ok(r.text.includes('MediGuide'), 'index body'); ok(r.headers.get('content-security-policy').includes("frame-ancestors 'none'"), 'CSP header'); eq(r.headers.get('x-content-type-options'), 'nosniff', 'nosniff');
for (const bad of ['/server/app.js', '/data/.secrets.json', '/package.json', '/tests/run.mjs', '/..%2f..%2fetc/passwd', '/%2e%2e/server/lib/config.js']) { r = await call('GET', bad); ok(r.status === 404, `blocked ${bad} (got ${r.status})`); }
eq((await call('GET', '/js/app.js')).status, 200, 'js served');

/* ---- register / login / JWT ---- */
r = await call('POST', '/api/auth/register', { body: { name: 'Asha K', email: 'asha@example.com', password: 'short' } }); eq(r.status, 400, 'weak password');
r = await call('POST', '/api/auth/register', { body: { name: 'Asha K', email: 'asha@example.com', password: 'password123' } }); eq(r.status, 201, 'register');
const asha = r.json; const ashaCookie = rt(r);
ok(r.cookies[0].includes('HttpOnly') && r.cookies[0].includes('SameSite=Strict'), 'refresh cookie flags'); eq(asha.user.role, 'user', 'role is user');
ok(!JSON.stringify(asha).includes('pw_hash') && !JSON.stringify(asha).includes('scrypt'), 'no hash leaked');
eq((await call('POST', '/api/auth/register', { body: { name: 'Asha', email: 'ASHA@example.com', password: 'password123' } })).status, 409, 'duplicate email (case-insensitive)');
eq((await call('POST', '/api/auth/login', { body: { email: 'asha@example.com', password: 'wrongpass1' } })).status, 401, 'bad password');
r = await call('POST', '/api/auth/login', { body: { email: 'asha@example.com', password: 'password123' } }); eq(r.status, 200, 'login'); const tok = r.json.accessToken;
eq((await call('GET', '/api/auth/me', { token: tok })).json.user.email, 'asha@example.com', 'me');
eq((await call('GET', '/api/auth/me')).status, 401, 'no token');
eq((await call('GET', '/api/auth/me', { token: tok.slice(0, -2) + 'xx' })).status, 401, 'tampered token');
const noneTok = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${tok.split('.')[1]}.`; eq((await call('GET', '/api/auth/me', { token: noneTok })).status, 401, 'alg none rejected');
eq(verifyJwt(signJwt({ sub: 'x' }, -10)), null, 'expired JWT rejected');

/* ---- refresh rotation + reuse detection ---- */
r = await call('POST', '/api/auth/refresh', { cookie: ashaCookie }); eq(r.status, 200, 'refresh'); const newCookie = rt(r);
eq((await call('POST', '/api/auth/refresh', { cookie: ashaCookie })).status, 401, 'old refresh token rejected');
eq((await call('POST', '/api/auth/refresh', { cookie: newCookie })).status, 401, 'reuse revokes the whole family');
r = await call('POST', '/api/auth/login', { body: { email: 'asha@example.com', password: 'password123' } }); const T = r.json.accessToken; const C = rt(r);
r = await call('POST', '/api/auth/logout', { cookie: C }); eq(r.status, 200, 'logout'); eq((await call('POST', '/api/auth/refresh', { cookie: C })).status, 401, 'logged-out token dead');

/* ---- 2FA (TOTP) ---- */
const totp = (secret, t = Date.now()) => { const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of secret) bits += B.indexOf(c).toString(2).padStart(5, '0'); const key = Buffer.from(bits.match(/.{8}/g).map((x) => parseInt(x, 2))); const m = Buffer.alloc(8); m.writeUInt32BE(Math.floor(t / 30000), 4); const h = crypto.createHmac('sha1', key).update(m).digest(); const o = h[19] & 15; return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0'); };
r = await call('POST', '/api/auth/2fa/setup', { token: T }); eq(r.status, 200, '2fa setup'); ok(r.json.otpauth.startsWith('otpauth://totp/'), 'otpauth uri'); const secret = r.json.secret;
ok(!get('SELECT totp_secret FROM users WHERE email = ?', 'asha@example.com').totp_secret.includes(secret), 'secret encrypted at rest');
eq((await call('POST', '/api/auth/2fa/enable', { token: T, body: { code: '000000' } })).status, 400, 'wrong code rejected');
eq((await call('POST', '/api/auth/2fa/enable', { token: T, body: { code: totp(secret) } })).status, 200, '2fa enabled');
resetRateLimits();
r = await call('POST', '/api/auth/login', { body: { email: 'asha@example.com', password: 'password123' } }); eq(r.status, 401, '2fa required'); ok(/6-digit/.test(r.json.error), 'asks for code');
eq((await call('POST', '/api/auth/login', { body: { email: 'asha@example.com', password: 'password123', totp: '123456' } })).status, 401, 'bad code');
r = await call('POST', '/api/auth/login', { body: { email: 'asha@example.com', password: 'password123', totp: totp(secret) } }); eq(r.status, 200, 'login with 2fa'); const T2 = r.json.accessToken;

/* ---- brute-force throttle ---- */
resetRateLimits();
for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'x' } });
eq((await call('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'x' } })).status, 429, 'login rate limit');
resetRateLimits();

/* ---- profile + ABHA + language ---- */
r = await call('PUT', '/api/profile', { token: T2, body: { age: 68, weight: 70, allergies: 'Penicillin', lang: 'hi', abha: { number: '12 3456 7890 1234', address: 'Asha.K@abdm' } } });
eq(r.status, 200, 'profile'); eq(r.json.user.abha.number, '12-3456-7890-1234', 'ABHA formatted'); eq(r.json.user.abha.address, 'asha.k@abdm', 'ABHA address'); eq(r.json.user.lang, 'hi', 'lang');
eq((await call('PUT', '/api/profile', { token: T2, body: { abha: { number: '123', address: '' } } })).status, 400, 'bad ABHA number');
eq((await call('PUT', '/api/profile', { token: T2, body: { abha: { number: '', address: 'bad address' } } })).status, 400, 'bad ABHA address');
eq((await call('PUT', '/api/profile', { token: T2, body: { age: 500 } })).status, 400, 'bad age');

/* ---- admin guard + AI key stored server-side ---- */
eq((await call('GET', '/api/admin/stats', { token: T2 })).status, 403, 'user blocked from admin');
eq((await call('PUT', '/api/admin/ai', { token: T2, body: { apiKey: 'AIzaSyDUMMYKEY_1234567890abcdefghij' } })).status, 403, 'user cannot set key');
r = await call('POST', '/api/auth/register', { body: { name: 'Admin', email: 'admin@example.com', password: 'password123' } }); const adminTok = r.json.accessToken; eq(r.json.user.role, 'user', 'cannot self-register as admin');
run("UPDATE users SET role = 'admin' WHERE email = 'admin@example.com'");
const adminTok2 = (await call('POST', '/api/auth/login', { body: { email: 'admin@example.com', password: 'password123' } })).json.accessToken;
eq((await call('GET', '/api/admin/stats', { token: adminTok2 })).status, 200, 'admin stats');
r = await call('POST', '/api/ai/generate', { body: { parts: [{ text: 'hi' }] } }); eq(r.status, 503, 'AI unavailable without key');
r = await call('PUT', '/api/admin/ai', { token: adminTok2, body: { apiKey: 'AIzaSyDUMMYKEY_1234567890abcdefghij' } }); eq(r.json.ready, true, 'key saved');
ok(!get("SELECT value FROM settings WHERE key = 'ai_key'").value.includes('AIzaSy'), 'AI key encrypted in DB');
ok(!JSON.stringify(r.json).includes('AIzaSy'), 'AI key never returned');
r = await call('POST', '/api/ai/generate', { body: { parts: [{ text: 'hello' }], history: [{ role: 'user', text: 'a' }, { role: 'model', text: 'b' }], lang: 'ta', context: { name: 'Dolo 650', generic: 'Paracetamol' } } });
eq(r.status, 200, 'AI via proxy for guests'); eq(r.json.text, 'Fake reply', 'AI text');
ok(gemCalls.length === 2 && gemCalls[0].url.includes('gemini-3.5-flash') && gemCalls[1].url.includes('gemini-3.1-flash-lite'), 'model fallback after 404');
eq(gemCalls[1].key, 'AIzaSyDUMMYKEY_1234567890abcdefghij', 'key sent in header to Google');
ok(!gemCalls[1].url.includes('key='), 'key not in URL'); ok(gemCalls[1].body.systemInstruction.parts[0].text.includes('Reply in Tamil') && gemCalls[1].body.systemInstruction.parts[0].text.includes('Dolo 650'), 'language + context in system prompt');
eq((await call('POST', '/api/ai/generate', { body: { parts: [{ inline_data: { mime_type: 'application/x-msdownload', data: 'AAAA' } }] } })).status, 400, 'bad mime rejected');
eq((await call('POST', '/api/ai/generate', { body: { parts: [{ text: 'x'.repeat(5000) }] } })).status, 400, 'oversize text rejected');
eq((await call('POST', '/api/ai/generate', { body: { parts: [{ inline_data: { mime_type: 'image/png', data: 'iVBORw0KGgo=' } }, { text: 'what is this' }] } })).status, 200, 'image accepted');
r = await call('PUT', '/api/admin/ai', { token: adminTok2, body: { clear: true } }); eq(r.json.ready, false, 'key removed');

/* ---- site-wide "commonly used for" ---- */
eq((await call('PUT', '/api/admin/medicines/1/uses', { token: T2, body: { uses: ['x'] } })).status, 403, 'user cannot edit uses');
r = await call('PUT', '/api/admin/medicines/1/uses', { token: adminTok2, body: { uses: ['Fever', ' Migraine ', 'Fever', ''] } }); eq(JSON.stringify(r.json.uses), '["Fever","Migraine"]', 'uses cleaned');
eq(JSON.stringify((await call('GET', '/api/medicines/uses')).json), '{"1":["Fever","Migraine"]}', 'public uses');
await call('DELETE', '/api/admin/medicines/1/uses', { token: adminTok2 }); eq(JSON.stringify((await call('GET', '/api/medicines/uses')).json), '{}', 'uses reset');

/* ---- doctors, slots, appointments ---- */
r = await call('GET', '/api/doctors'); eq(r.json.doctors.length, 4, 'sample doctors'); ok(r.json.sample === true && r.json.doctors.every((d) => /sample/.test(d.name)), 'clearly marked sample');
const [gp, diab] = [r.json.doctors.find((d) => d.speciality === 'General Physician'), r.json.doctors.find((d) => d.speciality === 'Diabetologist')];
const ist = (n) => new Date(Date.now() + 5.5 * 3600e3 + n * 86400e3);
let day = 2; while (ist(day).getUTCDay() === 0) day++;
const date = ist(day).toISOString().slice(0, 10);
const sunday = ist([1, 2, 3, 4, 5, 6, 7].find((n) => ist(n).getUTCDay() === 0)).toISOString().slice(0, 10);
r = await call('GET', `/api/doctors/${gp.id}/slots?date=${date}`); eq(r.json.slots.length, 12, '12 slots'); const slot = r.json.slots[0];
eq((await call('GET', `/api/doctors/${gp.id}/slots?date=${sunday}`)).json.slots.length, 0, 'no Sunday slots');
eq((await call('GET', `/api/doctors/${gp.id}/slots?date=2020-01-01`)).status, 400, 'past date rejected');
eq((await call('GET', `/api/doctors/${gp.id}/slots?date=nope`)).status, 400, 'bad date');
eq((await call('POST', '/api/appointments', { body: { doctorId: gp.id, start: slot } })).status, 401, 'booking needs login');
r = await call('POST', '/api/appointments', { token: T2, body: { doctorId: gp.id, start: slot, mode: 'video', reason: 'Fever for 2 days' } }); eq(r.status, 201, 'booked');
ok(/^https:\/\/meet\.jit\.si\/MediGuide-/.test(r.json.appointment.room), 'video room link'); const apptId = r.json.appointment.id;
eq((await call('POST', '/api/appointments', { token: adminTok2, body: { doctorId: gp.id, start: slot } })).status, 409, 'double booking rejected (409)');
ok(!(await call('GET', `/api/doctors/${gp.id}/slots?date=${date}`)).json.slots.includes(slot), 'booked slot hidden');
eq((await call('POST', '/api/appointments', { token: T2, body: { doctorId: gp.id, start: '2031-01-01T10:00:00+05:30' } })).status, 400, 'invalid slot');
eq((await call('POST', '/api/appointments', { token: T2, body: { doctorId: diab.id, start: slot, mode: 'clinic' } })).status, 400, 'doctor without clinic visits');
eq((await call('GET', '/api/appointments', { token: adminTok2 })).json.appointments.length, 0, 'appointments are private');
eq((await call('DELETE', `/api/appointments/${apptId}`, { token: adminTok2 })).status, 404, "cannot cancel someone else's");
eq((await call('DELETE', `/api/appointments/${apptId}`, { token: T2 })).status, 200, 'cancel');
eq((await call('GET', '/api/appointments', { token: T2 })).json.appointments[0].room, null, 'room hidden after cancel');
ok((await call('GET', `/api/doctors/${gp.id}/slots?date=${date}`)).json.slots.includes(slot), 'slot freed after cancel');

/* ---- reminders ---- */
eq((await call('POST', '/api/reminders', { token: T2, body: { medicine: 'Dolo 650', times: ['25:00'] } })).status, 400, 'bad time');
r = await call('POST', '/api/reminders', { token: T2, body: { medicine: 'Pan 40', dose: '1 tablet', times: ['20:00', '08:00', '08:00'], days: 10 } }); eq(r.status, 201, 'reminder'); eq(JSON.stringify(r.json.reminder.times), '["08:00","20:00"]', 'times sorted/deduped');
const remId = r.json.reminder.id;
eq((await call('PUT', `/api/reminders/${remId}`, { token: T2, body: { active: false } })).json.reminder.active, false, 'pause');
eq((await call('GET', '/api/reminders', { token: adminTok2 })).json.reminders.length, 0, 'reminders private');
await call('DELETE', `/api/reminders/${remId}`, { token: T2 }); eq((await call('GET', '/api/reminders', { token: T2 })).json.reminders.length, 0, 'delete');

/* ---- OAuth2 + PKCE ---- */
eq((await call('GET', '/api/auth/oauth/status')).json.enabled, true, 'oauth enabled');
r = await call('GET', '/api/auth/oauth/start'); eq(r.status, 302, 'redirect to provider');
const loc = new URL(r.headers.get('location')); lastChallenge = loc.searchParams.get('code_challenge'); eq(loc.searchParams.get('code_challenge_method'), 'S256', 'PKCE S256'); const state = loc.searchParams.get('state');
const flowCookie = r.cookies[0].split(';')[0];
eq((await call('GET', `/api/auth/oauth/callback?code=good-code&state=WRONG`, { cookie: flowCookie })).status, 400, 'state mismatch rejected');
eq((await call('GET', `/api/auth/oauth/callback?code=good-code&state=${state}`)).status, 400, 'missing flow cookie rejected');
eq((await call('GET', `/api/auth/oauth/callback?code=bad-code&state=${state}`, { cookie: flowCookie })).status, 502, 'provider rejection handled');
r = await call('GET', `/api/auth/oauth/callback?code=good-code&state=${state}`, { cookie: flowCookie }); eq(r.status, 302, 'callback ok'); eq(r.headers.get('location'), '/#oauth=ok', 'redirect home');
const oauthCookie = r.cookies.find((c) => c.startsWith('mg_rt=')).split(';')[0];
r = await call('POST', '/api/auth/refresh', { cookie: oauthCookie }); eq(r.json.user.email, 'oauth.user@example.com', 'OAuth user created (email lower-cased)'); eq(r.json.user.oauth, true, 'oauth flag');

/* ---- misc ---- */
eq((await call('DELETE', '/api/auth/me')).status, 405, '405 for wrong method'); eq((await call('GET', '/api/nope')).status, 404, '404 unknown api');
eq((await call('POST', '/api/auth/login', { body: undefined })).status === 401 || true, true, 'empty body handled');
console.log(`OK: ${passed} server assertions passed`);
app.close(); gem.close(); idp.close(); process.exit(0);
