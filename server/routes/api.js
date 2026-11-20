/** Profile + ABHA, medicine uses, AI proxy, doctors/appointments (teleconsultation), reminders, admin. */
import { get, all, run, now, audit, getSetting, setSetting, delSetting } from '../lib/db.js';
import { seal, uuid, randomToken } from '../lib/security.js';
import { HttpError, bad, rateLimit, str, optStr, int } from '../lib/http.js';
import { generate, aiReady, getModel } from '../lib/gemini.js';
import { publicUser } from './auth.js';
import { SYSTEM_PROMPT } from '../../js/config.js';

const LANGS = { en: 'English', hi: 'Hindi', ta: 'Tamil', bn: 'Bengali' };
const ip = (req) => req.socket.remoteAddress || 'ip';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ---------------- ABHA (format check only: not verified with ABDM) ---------------- */
import { normaliseAbhaNumber as abhaNum, normaliseAbhaAddress as abhaAddr } from '../../js/utils/abha.js';
const wrap = (fn) => (v) => { try { return fn(v); } catch (e) { throw bad(e.message); } };
export const normaliseAbhaNumber = wrap(abhaNum);
export const normaliseAbhaAddress = wrap(abhaAddr);

/* ---------------- appointment slots (IST, Mon–Sat) ---------------- */
const SLOT_TIMES = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30'];
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export function slotsFor(date) {
  if (!DATE_RE.test(date)) throw bad('Date must look like 2026-11-20.');
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw bad('That date is not valid.');
  const today = istToday();
  const max = new Date(new Date(`${today}T00:00:00Z`).getTime() + 14 * 86400e3).toISOString().slice(0, 10);
  if (date < today || date > max) throw bad('Choose a date within the next 14 days.');
  if (d.getUTCDay() === 0) return [];
  return SLOT_TIMES.map((t) => `${date}T${t}:00+05:30`).filter((s) => new Date(s).getTime() > Date.now() + 30 * 60e3);
}

const apptOut = (a) => ({
  id: a.id, start: a.start_at, mode: a.mode, reason: a.reason, status: a.status,
  doctor: { id: a.doctor_id, name: a.doctor_name, speciality: a.speciality },
  room: a.mode === 'video' && a.status === 'booked' ? a.room : null,
});
const doctorOut = (d) => ({ id: d.id, name: d.name, speciality: d.speciality, languages: JSON.parse(d.languages), modes: JSON.parse(d.modes), bio: d.bio });
const reminderOut = (r) => ({ id: r.id, medicine: r.medicine, dose: r.dose, times: JSON.parse(r.times), startDate: r.start_date, days: r.days, notes: r.notes, active: Boolean(r.active) });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'video/mp4', 'video/webm', 'application/pdf']);

/* ---------- nearby places (clinic, hospital, pharmacy, emergency) ---------- */
const FACILITY_TYPES = {
  clinic: '["amenity"="clinic"]',
  hospital: '["amenity"="hospital"]',
  pharmacy: '["amenity"="pharmacy"]',
  emergency: '["emergency"="yes"]'
};

async function fetchNearbyPlaces(latitude, longitude, radius, type) {
  const tag = FACILITY_TYPES[type];
  const query = `[out:json][timeout:25];
    (
      node${tag}(around:${radius},${latitude},${longitude});
      way${tag}(around:${radius},${latitude},${longitude});
      relation${tag}(around:${radius},${latitude},${longitude});
    );
    out center;`;

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': 'MediGuide-AI/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query })
  });

  if (!res.ok) throw new HttpError(502, 'Places service unavailable');

  const data = await res.json();

  // Calculate Haversine distance
  const R = 6371000; // Earth radius in meters
  function toRad(x) { return x * Math.PI / 180; }

  const places = [];
  for (const element of data.elements || []) {
    let lat, lon;
    if (element.type === 'node') {
      lat = element.lat; lon = element.lon;
    } else if (element.center) {
      lat = element.center.lat; lon = element.center.lon;
    } else continue;

    const tags = element.tags || {};
    const name = tags.name || 'Unnamed Facility';

    // Build address
    const addrParts = [];
    for (const key of ['addr:housenumber', 'addr:street', 'addr:city', 'addr:postcode', 'addr:suburb']) {
      if (tags[key]) addrParts.push(tags[key]);
    }
    const address = addrParts.length ? addrParts.join(', ') : 'Address not available';

    // Calculate distance
    const dLat = toRad(lat - latitude);
    const dLon = toRad(lon - longitude);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(latitude)) * Math.cos(toRad(lat)) * Math.sin(dLon/2)**2;
    const distance = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));

    places.push({
      name, type, address, distance,
      latitude: lat, longitude: lon,
      directions_url: `https://www.google.com/maps?q=${lat},${lon}`
    });
  }

  // Sort by distance
  places.sort((a, b) => a.distance - b.distance);
  return places;
}

function cleanParts(parts) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 3) throw bad('Send 1 to 3 message parts.');
  return parts.map((p) => {
    if (typeof p?.text === 'string') return { text: str(p.text, 'Message', 1, 4000) };
    const d = p?.inline_data;
    if (d && ALLOWED_MIME.has(d.mime_type) && typeof d.data === 'string' && d.data.length < 18_000_000 && /^[A-Za-z0-9+/=]+$/.test(d.data)) return { inline_data: { mime_type: d.mime_type, data: d.data } };
    throw bad('Unsupported attachment.');
  });
}

export const apiRoutes = [
  ['GET', '/api/health', () => ({ body: { ok: true, ai: aiReady(), time: now() } })],

  /* ---------- nearby healthcare facilities ---------- */
  ['GET', '/api/places/nearby', async ({ query }) => {
    const latitude = Number(query.latitude);
    const longitude = Number(query.longitude);
    const radius = int(query.radius || 5000, 'Radius', 100, 50000);
    const type = query.type || 'clinic';

    if (!(-90 <= latitude && latitude <= 90)) throw bad('Latitude must be between -90 and 90.');
    if (!(-180 <= longitude && longitude <= 180)) throw bad('Longitude must be between -180 and 180.');
    if (!FACILITY_TYPES[type]) throw bad('Invalid facility type. Must be one of: clinic, hospital, pharmacy, emergency.');

    const places = await fetchNearbyPlaces(latitude, longitude, radius, type);
    return { body: { places, total: places.length } };
  }],

  /* ---------- profile (+ language + ABHA) ---------- */
  ['PUT', '/api/profile', ({ user, body }) => {
    const age = body.age === '' || body.age == null ? null : int(body.age, 'Age', 1, 120);
    const weight = body.weight === '' || body.weight == null ? null : Number(body.weight);
    if (weight != null && !(weight >= 1 && weight <= 300)) throw bad('Weight must be between 1 and 300 kg.');
    const lang = body.lang && LANGS[body.lang] ? body.lang : user.lang;
    const abhaNumber = body.abha ? normaliseAbhaNumber(body.abha.number) : user.abha_number || '';
    const abhaAddress = body.abha ? normaliseAbhaAddress(body.abha.address) : user.abha_address || '';
    run('UPDATE users SET age=?, weight=?, conditions=?, allergies=?, lang=?, abha_number=?, abha_address=? WHERE id=?',
      age, weight, optStr(body.conditions, 'Conditions', 200), optStr(body.allergies, 'Allergies', 200), lang, abhaNumber || null, abhaAddress || null, user.id);
    audit(user.id, 'profile_updated');
    return { body: { user: publicUser(get('SELECT * FROM users WHERE id = ?', user.id)) } };
  }, { auth: 'user' }],

  /* ---------- medicine "commonly used for" overrides (site-wide) ---------- */
  ['GET', '/api/medicines/uses', () => ({ body: Object.fromEntries(all('SELECT med_id, uses FROM med_uses').map((r) => [r.med_id, JSON.parse(r.uses)])) })],

  /* ---------- AI proxy ---------- */
  ['POST', '/api/ai/generate', async ({ req, user, body }) => {
    rateLimit(`ai:${user?.id || ip(req)}`, 20);
    const parts = cleanParts(body.parts);
    const history = (Array.isArray(body.history) ? body.history : []).slice(-16).map((h) => ({
      role: h?.role === 'model' ? 'model' : 'user', text: str(String(h?.text ?? ''), 'History', 1, 4000),
    }));
    const lang = LANGS[body.lang] || 'English';
    let system = SYSTEM_PROMPT + `\nReply in ${lang}. Keep medicine names in their usual English or brand form as well.`;
    if (body.context?.name) system += `\nThe user is currently viewing: ${String(body.context.name).slice(0, 120)} (${String(body.context.generic || '').slice(0, 80)}).`;
    if (user && body.shareProfile === true) {
      const bits = [user.age && `age ${user.age}`, user.weight && `weight ${user.weight} kg`, user.conditions && `conditions: ${user.conditions}`, user.allergies && `allergies: ${user.allergies}`].filter(Boolean);
      if (bits.length) system += `\nThe user chose to share this profile (use it to be more careful, never to diagnose): ${bits.join('; ')}.`;
    }
    const out = await generate({ system, history, parts });
    audit(user?.id, 'ai_request', parts.some((p) => p.inline_data) ? 'with_attachment' : 'text');
    return { body: { text: out.text } };
  }, { auth: 'optional' }],

  /* ---------- doctors, slots, appointments (teleconsultation) ---------- */
  ['GET', '/api/doctors', () => ({ body: { sample: true, doctors: all('SELECT * FROM doctors ORDER BY name').map(doctorOut) } })],
  ['GET', '/api/doctors/:id/slots', ({ params, query }) => {
    const doc = get('SELECT id FROM doctors WHERE id = ?', params.id);
    if (!doc) throw new HttpError(404, 'Doctor not found.');
    const taken = new Set(all("SELECT start_at FROM appointments WHERE doctor_id = ? AND status = 'booked'", doc.id).map((r) => r.start_at));
    return { body: { date: query.date, slots: slotsFor(String(query.date || '')).filter((s) => !taken.has(s)) } };
  }],
  ['POST', '/api/appointments', ({ user, body }) => {
    rateLimit(`book:${user.id}`, 10);
    const doc = get('SELECT * FROM doctors WHERE id = ?', String(body.doctorId || ''));
    if (!doc) throw new HttpError(404, 'Doctor not found.');
    const start = String(body.start || '');
    if (!slotsFor(start.slice(0, 10)).includes(start)) throw bad('That time is not available. Please pick another slot.');
    const mode = body.mode === 'clinic' ? 'clinic' : 'video';
    if (!JSON.parse(doc.modes).includes(mode)) throw bad(`This doctor does not offer ${mode} visits.`);
    if (get("SELECT COUNT(*) AS n FROM appointments WHERE user_id = ? AND status = 'booked' AND start_at > ?", user.id, now()).n >= 5) throw bad('You already have 5 upcoming appointments.');
    const id = uuid();
    try {
      run('INSERT INTO appointments (id, user_id, doctor_id, start_at, mode, reason, room, created_at) VALUES (?,?,?,?,?,?,?,?)',
        id, user.id, doc.id, start, mode, optStr(body.reason, 'Reason', 200), mode === 'video' ? `https://meet.jit.si/MediGuide-${randomToken(12)}` : null, now());
    } catch { throw new HttpError(409, 'Someone just booked that slot. Please pick another.'); }
    audit(user.id, 'appointment_booked', mode);
    return { status: 201, body: { appointment: apptOut(get('SELECT a.*, d.name AS doctor_name, d.speciality FROM appointments a JOIN doctors d ON d.id = a.doctor_id WHERE a.id = ?', id)) } };
  }, { auth: 'user' }],
  ['GET', '/api/appointments', ({ user }) => ({
    body: { appointments: all('SELECT a.*, d.name AS doctor_name, d.speciality FROM appointments a JOIN doctors d ON d.id = a.doctor_id WHERE a.user_id = ? ORDER BY a.start_at DESC LIMIT 50', user.id).map(apptOut) },
  }), { auth: 'user' }],
  ['DELETE', '/api/appointments/:id', ({ user, params }) => {
    const a = get('SELECT * FROM appointments WHERE id = ? AND user_id = ?', params.id, user.id);
    if (!a) throw new HttpError(404, 'Appointment not found.');
    if (a.status !== 'booked' || a.start_at <= now()) throw bad('Only upcoming appointments can be cancelled.');
    run("UPDATE appointments SET status = 'cancelled' WHERE id = ?", a.id);
    audit(user.id, 'appointment_cancelled');
    return { body: { ok: true } };
  }, { auth: 'user' }],

  /* ---------- medicine reminders ---------- */
  ['GET', '/api/reminders', ({ user }) => ({ body: { reminders: all('SELECT * FROM reminders WHERE user_id = ? ORDER BY created_at DESC', user.id).map(reminderOut) } }), { auth: 'user' }],
  ['POST', '/api/reminders', ({ user, body }) => {
    if (get('SELECT COUNT(*) AS n FROM reminders WHERE user_id = ?', user.id).n >= 50) throw bad('You can keep up to 50 reminders.');
    const times = [...new Set(Array.isArray(body.times) ? body.times.map(String) : [])].sort();
    if (!times.length || times.length > 6 || !times.every((t) => TIME_RE.test(t))) throw bad('Give 1 to 6 times like 08:00.');
    const startDate = String(body.startDate || istToday());
    if (!DATE_RE.test(startDate)) throw bad('Start date must look like 2026-11-20.');
    const days = body.days == null || body.days === '' ? null : int(body.days, 'Days', 1, 365);
    const id = uuid();
    run('INSERT INTO reminders (id, user_id, medicine, dose, times, start_date, days, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      id, user.id, str(body.medicine, 'Medicine', 2, 80), optStr(body.dose, 'Dose', 60), JSON.stringify(times), startDate, days, optStr(body.notes, 'Notes', 200), now());
    return { status: 201, body: { reminder: reminderOut(get('SELECT * FROM reminders WHERE id = ?', id)) } };
  }, { auth: 'user' }],
  ['PUT', '/api/reminders/:id', ({ user, params, body }) => {
    const r = get('SELECT * FROM reminders WHERE id = ? AND user_id = ?', params.id, user.id);
    if (!r) throw new HttpError(404, 'Reminder not found.');
    run('UPDATE reminders SET active = ? WHERE id = ?', body.active ? 1 : 0, r.id);
    return { body: { reminder: reminderOut(get('SELECT * FROM reminders WHERE id = ?', r.id)) } };
  }, { auth: 'user' }],
  ['DELETE', '/api/reminders/:id', ({ user, params }) => {
    run('DELETE FROM reminders WHERE id = ? AND user_id = ?', params.id, user.id);
    return { body: { ok: true } };
  }, { auth: 'user' }],

  /* ---------- admin ---------- */
  ['GET', '/api/admin/stats', () => {
    const n = (sql) => get(sql).n;
    return { body: {
      users: n('SELECT COUNT(*) AS n FROM users'), appointments: n("SELECT COUNT(*) AS n FROM appointments WHERE status = 'booked'"),
      reminders: n('SELECT COUNT(*) AS n FROM reminders'), aiRequests: n("SELECT COUNT(*) AS n FROM audit WHERE event = 'ai_request'"),
      twoFactorUsers: n('SELECT COUNT(*) AS n FROM users WHERE totp_enabled = 1'), aiReady: aiReady(), model: getModel(),
    } };
  }, { auth: 'admin' }],
  ['GET', '/api/admin/users', () => ({
    body: { users: all('SELECT id, name, email, role, created_at, totp_enabled FROM users ORDER BY created_at DESC LIMIT 200').map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, created: u.created_at, totpEnabled: Boolean(u.totp_enabled) })) },
  }), { auth: 'admin' }],
  ['PUT', '/api/admin/users/:id/role', ({ user, params, body }) => {
    if (!['user', 'admin'].includes(body.role)) throw bad('Role must be user or admin.');
    if (params.id === user.id) throw bad('You cannot change your own role.');
    if (!get('SELECT 1 FROM users WHERE id = ?', params.id)) throw new HttpError(404, 'User not found.');
    run('UPDATE users SET role = ? WHERE id = ?', body.role, params.id);
    audit(user.id, 'role_changed', `${params.id}:${body.role}`);
    return { body: { ok: true } };
  }, { auth: 'admin' }],
  ['GET', '/api/admin/audit', () => ({ body: { events: all('SELECT at, event, detail FROM audit ORDER BY id DESC LIMIT 200') } }), { auth: 'admin' }],
  ['PUT', '/api/admin/ai', ({ user, body }) => {
    if (body.clear === true) { delSetting('ai_key'); audit(user.id, 'api_key_removed'); }
    if (body.apiKey) {
      const k = str(body.apiKey, 'API key', 20, 300);
      if (!/^[A-Za-z0-9_-]+$/.test(k)) throw bad('That does not look like a Gemini API key.');
      setSetting('ai_key', seal(k)); audit(user.id, 'api_key_set');
    }
    if (body.model !== undefined) {
      const m = String(body.model).trim();
      if (m && !/^[a-z0-9][a-z0-9.-]{2,60}$/i.test(m)) throw bad('Model name can only contain letters, numbers, dots and hyphens.');
      m ? setSetting('ai_model', m) : delSetting('ai_model');
    }
    return { body: { ready: aiReady(), model: getModel(), keyOrigin: getSetting('ai_key') ? 'admin' : aiReady() ? 'environment' : 'none' } };
  }, { auth: 'admin' }],
  ['PUT', '/api/admin/medicines/:id/uses', ({ user, params, body }) => {
    const id = int(params.id, 'Medicine id', 1, 1_000_000);
    const uses = [...new Set((Array.isArray(body.uses) ? body.uses : []).map((x) => String(x).trim().slice(0, 60)).filter(Boolean))].slice(0, 10);
    run('INSERT INTO med_uses (med_id, uses) VALUES (?, ?) ON CONFLICT(med_id) DO UPDATE SET uses = excluded.uses', id, JSON.stringify(uses));
    audit(user.id, 'uses_edited', `medicine ${id}`);
    return { body: { uses } };
  }, { auth: 'admin' }],
  ['DELETE', '/api/admin/medicines/:id/uses', ({ user, params }) => {
    run('DELETE FROM med_uses WHERE med_id = ?', int(params.id, 'Medicine id', 1, 1_000_000));
    audit(user.id, 'uses_reset', `medicine ${params.id}`);
    return { body: { ok: true } };
  }, { auth: 'admin' }],
];
