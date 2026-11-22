/** Auth: register/login, JWT access + rotating refresh cookie, TOTP 2FA, OAuth2 (authorization code + PKCE). */
import crypto from 'node:crypto';
import { config } from '../lib/config.js';
import { get, run, now, audit, getSetting } from '../lib/db.js';
import { hashPassword, verifyPassword, signJwt, verifyJwt, randomToken, sha256, uuid, seal, open } from '../lib/security.js';
import { HttpError, bad, cookie, parseCookies, rateLimit, str, EMAIL_RE } from '../lib/http.js';
import { verifyTotp, generateSecret } from '../../js/utils/totp.js';

const RT_COOKIE = 'mg_rt';
const rtCookie = (v, maxAge) => cookie(RT_COOKIE, v, { maxAge, path: '/api/auth', secure: config.production });

export function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, lang: u.lang, created: u.created_at,
    totpEnabled: Boolean(u.totp_enabled), oauth: Boolean(u.oauth_sub),
    profile: { age: u.age ?? '', weight: u.weight ?? '', conditions: u.conditions || '', allergies: u.allergies || '' },
    abha: { number: u.abha_number || '', address: u.abha_address || '' },
  };
}

function issueSession(user) {
  const refresh = randomToken(32);
  run('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?,?,?,?)', uuid(), user.id, sha256(refresh),
    new Date(Date.now() + config.refreshTtl * 1000).toISOString());
  return {
    body: { accessToken: signJwt({ sub: user.id, role: user.role }), expiresIn: config.accessTtl, user: publicUser(user) },
    headers: { 'Set-Cookie': rtCookie(refresh, config.refreshTtl) },
  };
}

const userById = (id) => get('SELECT * FROM users WHERE id = ?', id);
const ip = (req) => req.socket.remoteAddress || 'ip';
const oauthConfig = () => ({
  ...config.oauth,
  clientId: getSetting('oauth_client_id') ?? config.oauth.clientId,
  clientSecret: getSetting('oauth_client_secret') ? open(getSetting('oauth_client_secret')) : config.oauth.clientSecret,
  redirectUri: getSetting('oauth_redirect_uri') ?? config.oauth.redirectUri,
});

export const authRoutes = [
  ['POST', '/api/auth/register', async ({ req, body }) => {
    rateLimit(`reg:${ip(req)}`, 10);
    const name = str(body.name, 'Name', 2, 80);
    const email = str(body.email, 'Email', 5, 320).toLowerCase();
    const password = str(body.password, 'Password', 8, 200);
    if (!EMAIL_RE.test(email)) throw bad('Please enter a valid email address.');
    if (get('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'An account with this email already exists. Please log in.');
    const id = uuid();
    run('INSERT INTO users (id, email, name, pw_hash, role, created_at) VALUES (?,?,?,?,?,?)', id, email, name, hashPassword(password), 'user', now());
    audit(id, 'register');
    const s = issueSession(userById(id));
    return { status: 201, body: s.body, headers: s.headers };
  }],

  ['POST', '/api/auth/login', async ({ req, body }) => {
    const email = String(body.email || '').trim().toLowerCase();
    rateLimit(`login:${ip(req)}:${email}`, 5);
    rateLimit(`login:${ip(req)}`, 30);
    const u = get('SELECT * FROM users WHERE email = ?', email);
    const ok = u && u.pw_hash && verifyPassword(String(body.password || ''), u.pw_hash);
    if (!ok) { audit(u?.id, 'login_failed'); throw new HttpError(401, 'Email or password is incorrect.'); }
    if (u.totp_enabled) {
      const secret = open(u.totp_secret);
      if (!body.totp) throw new HttpError(401, 'Enter the 6-digit code from your authenticator app.');
      if (!secret || !(await verifyTotp(secret, String(body.totp).trim()))) { audit(u.id, 'login_2fa_failed'); throw new HttpError(401, 'That 6-digit code is not correct.'); }
    }
    audit(u.id, 'login');
    return issueSession(u);
  }],

  /** Rotating refresh: the old token is revoked and a new pair is issued. Reuse of a revoked token revokes the whole family. */
  ['POST', '/api/auth/refresh', async ({ req }) => {
    const token = parseCookies(req)[RT_COOKIE];
    if (!token) throw new HttpError(401, 'Not signed in.');
    const row = get('SELECT * FROM refresh_tokens WHERE token_hash = ?', sha256(token));
    if (!row) throw new HttpError(401, 'Session expired. Please log in again.');
    if (row.revoked) { run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', row.user_id); audit(row.user_id, 'refresh_reuse_detected'); throw new HttpError(401, 'Session expired. Please log in again.'); }
    if (new Date(row.expires_at) < new Date()) throw new HttpError(401, 'Session expired. Please log in again.');
    run('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', row.id);
    const u = userById(row.user_id);
    if (!u) throw new HttpError(401, 'Session expired. Please log in again.');
    return issueSession(u);
  }],

  ['POST', '/api/auth/logout', async ({ req }) => {
    const token = parseCookies(req)[RT_COOKIE];
    if (token) run('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?', sha256(token));
    return { body: { ok: true }, headers: { 'Set-Cookie': rtCookie('', 0) } };
  }],

  ['GET', '/api/auth/me', ({ user }) => ({ body: { user: publicUser(user) } }), { auth: 'user' }],

  /* ---------- 2FA (TOTP, RFC 6238) ---------- */
  ['POST', '/api/auth/2fa/setup', ({ user }) => {
    if (user.totp_enabled) throw bad('2FA is already on.');
    const secret = generateSecret();
    run('UPDATE users SET totp_secret = ? WHERE id = ?', seal(secret), user.id);
    const label = encodeURIComponent(`MediGuide AI:${user.email}`);
    return { body: { secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=MediGuide%20AI&digits=6&period=30` } };
  }, { auth: 'user' }],
  ['POST', '/api/auth/2fa/enable', async ({ user, body }) => {
    const secret = open(user.totp_secret || '');
    if (!secret) throw bad('Start 2FA setup first.');
    if (!(await verifyTotp(secret, String(body.code || '').trim()))) throw bad('That 6-digit code is not correct.');
    run('UPDATE users SET totp_enabled = 1 WHERE id = ?', user.id); audit(user.id, '2fa_enabled');
    return { body: { ok: true } };
  }, { auth: 'user' }],
  ['POST', '/api/auth/2fa/disable', async ({ user, body }) => {
    if (!user.pw_hash || !verifyPassword(String(body.password || ''), user.pw_hash)) throw new HttpError(401, 'Password is incorrect.');
    run('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', user.id); audit(user.id, '2fa_disabled');
    return { body: { ok: true } };
  }, { auth: 'user' }],

  /* ---------- OAuth2 / OIDC authorization-code flow with PKCE ---------- */
  ['GET', '/api/auth/oauth/status', () => { const o = oauthConfig(); return { body: { enabled: Boolean(o.clientId && o.clientSecret) } }; }],

  ['GET', '/api/auth/oauth/start', () => {
    const o = oauthConfig();
    if (!o.clientId || !o.clientSecret) throw new HttpError(501, 'Social sign-in is not configured on this server.');
    const state = randomToken(16);
    const verifier = randomToken(48);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ response_type: 'code', client_id: o.clientId, redirect_uri: o.redirectUri, scope: o.scope, state, code_challenge: challenge, code_challenge_method: 'S256' });
    const flow = signJwt({ state, verifier }, 600);
    return { redirect: `${o.authUrl}?${q}`, headers: { 'Set-Cookie': cookie('mg_oauth', flow, { maxAge: 600, path: '/api/auth/oauth', secure: config.production }) } };
  }],

  ['GET', '/api/auth/oauth/callback', async ({ req, query }) => {
    const o = oauthConfig();
    const flow = verifyJwt(parseCookies(req).mg_oauth);
    const clear = cookie('mg_oauth', '', { maxAge: 0, path: '/api/auth/oauth', secure: config.production });
    if (!flow || !query.state || query.state !== flow.state || !query.code) throw new HttpError(400, 'Sign-in could not be verified. Please try again.');
    const tokenRes = await fetch(o.tokenUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ grant_type: 'authorization_code', code: query.code, redirect_uri: o.redirectUri, client_id: o.clientId, client_secret: o.clientSecret, code_verifier: flow.verifier }),
    }).catch(() => null);
    const tok = tokenRes?.ok ? await tokenRes.json().catch(() => null) : null;
    if (!tok?.access_token) throw new HttpError(502, 'The sign-in provider rejected the request.');
    const infoRes = await fetch(o.userinfoUrl, { headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    const info = infoRes?.ok ? await infoRes.json().catch(() => null) : null;
    const email = String(info?.email || '').toLowerCase();
    if (!info?.sub || !EMAIL_RE.test(email) || info.email_verified === false) throw new HttpError(502, 'The sign-in provider did not return a verified email.');
    let u = get('SELECT * FROM users WHERE email = ?', email);
    if (!u) {
      const id = uuid();
      run('INSERT INTO users (id, email, name, pw_hash, role, created_at, oauth_sub) VALUES (?,?,?,?,?,?,?)', id, email, String(info.name || email.split('@')[0]).slice(0, 80), null, 'user', now(), String(info.sub));
      u = userById(id);
    } else if (!u.oauth_sub) run('UPDATE users SET oauth_sub = ? WHERE id = ?', String(info.sub), u.id);
    audit(u.id, 'login_oauth');
    const s = issueSession(u);
    return { redirect: '/#oauth=ok', headers: { 'Set-Cookie': [s.headers['Set-Cookie'], clear] } };
  }],
];

