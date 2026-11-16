/** Server configuration from environment variables, with safe local defaults. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

/** JWT and at-rest encryption secrets: from env, else generated once and kept in data/.secrets.json (0600). */
function loadSecrets() {
  const file = path.join(DATA_DIR, '.secrets.json');
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  let dirty = false;
  for (const k of ['jwt', 'box']) if (!s[k]) { s[k] = crypto.randomBytes(32).toString('hex'); dirty = true; }
  if (dirty) fs.writeFileSync(file, JSON.stringify(s), { mode: 0o600 });
  return s;
}
const secrets = loadSecrets();

export const config = {
  port: Number(process.env.PORT || 5600),
  dataDir: DATA_DIR,
  dbFile: process.env.DB_FILE || path.join(DATA_DIR, 'mediguide.db'),
  jwtSecret: process.env.JWT_SECRET || secrets.jwt,
  boxSecret: process.env.SERVER_SECRET || secrets.box,
  production: process.env.NODE_ENV === 'production',
  accessTtl: 15 * 60,                       // seconds
  refreshTtl: 14 * 24 * 3600,
  geminiEndpoint: process.env.GEMINI_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta/models',
  geminiEnvKey: process.env.GEMINI_API_KEY || '',
  oauth: {
    authUrl: process.env.OAUTH_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: process.env.OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    userinfoUrl: process.env.OAUTH_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo',
    clientId: process.env.OAUTH_CLIENT_ID || '',
    clientSecret: process.env.OAUTH_CLIENT_SECRET || '',
    redirectUri: process.env.OAUTH_REDIRECT_URI || `http://localhost:${process.env.PORT || 5600}/api/auth/oauth/callback`,
    scope: 'openid email profile',
  },
};
