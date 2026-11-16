/** @file RFC 6238 TOTP verification: the 2FA-ready hook (NFR-3.6). Enrolment UI arrives with the backend. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(s) {
  let bits = ''; const bytes = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(ch); if (v < 0) throw new Error('bad base32'); bits += v.toString(2).padStart(5, '0'); }
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(bytes);
}

async function hotp(secret, counter) {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new ArrayBuffer(8); new DataView(msg).setUint32(4, counter);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

/** Accepts the current 30 s step ±1 for clock drift. */
export async function verifyTotp(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(code || '')) return false;
  const step = Math.floor(now / 30000);
  for (const d of [-1, 0, 1]) if (await hotp(secret, step + d) === code) return true;
  return false;
}

/** Random 160-bit base32 secret for 2FA enrolment (RFC 4226 recommends ≥128 bits). */
export function generateSecret(bytes = 20) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let bits = ''; let out = '';
  for (const b of raw) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
