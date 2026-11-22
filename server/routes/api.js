/** Profile + ABHA, medicine uses, AI proxy, doctors/appointments (teleconsultation), reminders, admin. */
import { get, all, run, transaction, now, audit, getSetting, setSetting, delSetting } from '../lib/db.js';
import { seal, open, uuid, randomToken, sha256, hashPassword } from '../lib/security.js';
import { HttpError, bad, rateLimit, str, optStr, int, EMAIL_RE } from '../lib/http.js';
import { generate, aiReady, getModel } from '../lib/gemini.js';
import { publicUser } from './auth.js';
import { config } from '../lib/config.js';
import { SYSTEM_PROMPT } from '../../js/config.js';

// Medicines dataset (12 CDSCO-approved medicines) - same as in js/data/medicineDB.js
const MEDICINES = [
  {
    id: 1, name: 'Dolo 650', generic: 'Paracetamol', mg: 650, form: 'Tablet', mfg: 'Micro Labs',
    category: 'Analgesic / Antipyretic', description: 'Relieves mild to moderate pain and reduces fever. Safe at recommended doses.',
    dosage: '500mg', frequency: 'Every 6-8 hours (max 4g/day)',
    side_effects: ['Rare skin rash', 'Liver damage in overdose'],
    contraindications: ['Severe hepatic impairment'],
  },
  {
    id: 2, name: 'Brufen 400', generic: 'Ibuprofen', mg: 400, form: 'Tablet', mfg: 'Abbott India',
    category: 'NSAID / Anti-inflammatory', description: 'Reduces pain, fever and inflammation. Always take with food.',
    dosage: '400mg', frequency: 'Every 6-8 hours with food',
    side_effects: ['GI irritation', 'Nausea', 'Elevated BP'],
    contraindications: ['Active peptic ulcer', 'Third trimester pregnancy'],
  },
  {
    id: 3, name: 'Azithral 500', generic: 'Azithromycin', mg: 500, form: 'Tablet', mfg: 'Alembic Pharmaceuticals',
    category: 'Antibiotic (Macrolide)', description: 'Broad-spectrum antibiotic for bacterial infections of throat, lungs, ear.',
    dosage: '500mg', frequency: 'Once daily for 3 days',
    side_effects: ['Nausea', 'Diarrhoea', 'Abdominal pain'],
    contraindications: ['Hypersensitivity to macrolides'],
  },
  {
    id: 4, name: 'Crocin 500', generic: 'Paracetamol', mg: 500, form: 'Tablet', mfg: 'Cipla',
    category: 'Analgesic / Antipyretic', description: 'Relieves mild to moderate pain and reduces fever.',
    dosage: '500mg', frequency: 'Every 6-8 hours (max 4g/day)',
    side_effects: ['Rare skin rash', 'Liver damage in overdose'],
    contraindications: ['Severe hepatic impairment'],
  },
  {
    id: 5, name: 'Tata 1mg', generic: 'Paracetamol', mg: 500, form: 'Tablet', mfg: 'GSK',
    category: 'Analgesic / Antipyretic', description: 'India most trusted generic medicine.',
    dosage: '500mg', frequency: 'Every 6-8 hours (max 4g/day)',
    side_effects: ['Rare skin rash', 'Liver damage in overdose'],
    contraindications: ['Severe hepatic impairment'],
  },
];

const LANGS = { en: 'English', hi: 'Hindi', ta: 'Tamil', bn: 'Bengali' };
const ip = (req) => req.socket.remoteAddress || 'ip';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const INTERACTION_RULES = [
  { pair: [['paracetamol', 'acetaminophen'], ['warfarin']], severity: 'MAJOR', recommendation: 'Frequent or high-dose paracetamol may increase bleeding risk. Check with a clinician or pharmacist.' },
  { pair: [['ibuprofen'], ['warfarin']], severity: 'CONTRAINDICATED', recommendation: 'Avoid NSAIDs with warfarin unless a clinician specifically directs them.' },
  { pair: [['ibuprofen'], ['aspirin']], severity: 'MAJOR', recommendation: 'Combining NSAIDs can increase stomach bleeding risk. Ask a pharmacist before use.' },
  { pair: [['azithromycin'], ['amiodarone']], severity: 'CONTRAINDICATED', recommendation: 'This combination can affect heart rhythm. Do not combine without specialist advice.' },
];

const includesGeneric = (med, names) => names.some((name) => {
  const generic = (med?.generic || '').toLowerCase();
  const nameLc = name.toLowerCase();
  return generic.includes(nameLc) || (med?.name || '').toLowerCase().includes(nameLc);
});
function interactionFor(a, b) {
  return INTERACTION_RULES.find((rule) => (
    rule.pair.every((names, index) => includesGeneric(index === 0 ? a : b, names))
  ) || rule.pair.every((names, index) => includesGeneric(index === 0 ? b : a, names)));
}

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
const managedApptOut = (a) => ({
  ...apptOut(a),
  patient: { id: a.user_id, name: a.patient_name, email: a.patient_email },
});
const doctorOut = (d) => ({ id: d.id, name: d.name, speciality: d.speciality, languages: JSON.parse(d.languages), modes: JSON.parse(d.modes), bio: d.bio });
const reminderOut = (r) => ({ id: r.id, medicine: r.medicine, dose: r.dose, times: JSON.parse(r.times), startDate: r.start_date, days: r.days, notes: r.notes, active: Boolean(r.active) });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'video/mp4', 'video/webm', 'application/pdf']);

/* ---------- medication schedules (tracker) helpers ---------- */
const scheduleOut = (s) => ({
  _id: s.id, med_id: s.med_id, med_name: s.med_name, dosage: s.dosage,
  times: JSON.parse(s.times), days: JSON.parse(s.days),
  start_date: s.start_date, end_date: s.end_date, notes: s.notes, active: Boolean(s.active)
});
const logOut = (l) => ({
  _id: l.id, schedule_id: l.schedule_id, scheduled_time: l.scheduled_time,
  status: l.status, notes: l.notes, logged_at: l.logged_at
});
function healthSummary(user) {
  const from = new Date(Date.now() - 30 * 86400e3).toISOString();
  const current = now();
  const logs = all('SELECT status, COUNT(*) AS count FROM medication_logs WHERE user_id = ? AND scheduled_time >= ? AND scheduled_time <= ? GROUP BY status',
    user.id, from, current);
  const medicationCounts = { taken: 0, skipped: 0, missed: 0 };
  logs.forEach((row) => { if (Object.hasOwn(medicationCounts, row.status)) medicationCounts[row.status] = row.count; });
  const trackedDoses = Object.values(medicationCounts).reduce((total, count) => total + count, 0);
  return {
    profile: { age: user.age ?? '', weight: user.weight ?? '', conditions: user.conditions || '', allergies: user.allergies || '' },
    periodDays: 30,
    medications: {
      activeSchedules: get('SELECT COUNT(*) AS n FROM medication_schedules WHERE user_id = ? AND active = 1', user.id).n,
      ...medicationCounts,
      trackedDoses,
      adherencePercentage: trackedDoses ? Math.round((medicationCounts.taken / trackedDoses) * 100) : null,
    },
    appointments: {
      upcoming: get("SELECT COUNT(*) AS n FROM appointments WHERE user_id = ? AND status = 'booked' AND start_at > ?", user.id, current).n,
      completed: get("SELECT COUNT(*) AS n FROM appointments WHERE user_id = ? AND status = 'completed'", user.id).n,
    },
    activeReminders: get('SELECT COUNT(*) AS n FROM reminders WHERE user_id = ? AND active = 1', user.id).n,
  };
}
const adverseOut = (e) => ({
  id: e.id, medication: e.medication, reaction: e.reaction, severity: e.severity,
  start_date: e.start_date, end_date: e.end_date, description: e.description,
  outcome: e.outcome, notes: e.notes, status: e.status,
  created_at: e.created_at, updated_at: e.updated_at
});

/* ---------- nearby places (clinic, hospital, pharmacy, emergency) ---------- */
const FACILITY_TYPES = {
  clinic: '["amenity"="clinic"]',
  hospital: '["amenity"="hospital"]',
  pharmacy: '["amenity"="pharmacy"]',
  emergency: '["emergency"="yes"]'
};
const geocodeCache = new Map();
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const OVERPASS_TIMEOUT_MS = 12000;
const OVERPASS_COOLDOWN_MS = 60_000;
const OVERPASS_RETRYABLE_STATUSES = new Set([406, 429, 500, 502, 503, 504]);
const NEARBY_CACHE_TTL_MS = 5 * 60_000;
const nearbyCache = new Map();
let primaryOverpassCooldownUntil = 0;

async function geocodeLocation(searchText) {
  const cacheKey = searchText.trim().toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.results;
  if (cached) geocodeCache.delete(cacheKey);

  rateLimit('nominatim-geocode', 1, 1000);
  const url = new URL(config.nominatimEndpoint);
  url.search = new URLSearchParams({ q: searchText, format: 'jsonv2', limit: '5', countrycodes: 'in' }).toString();
  const response = await fetch(url, {
    headers: { 'User-Agent': 'MediGuide-AI/1.0 (+https://github.com/shaik-hussain123/mediguide-ai)', Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!response) throw new HttpError(502, 'Location search service could not be reached.');
  if (!response.ok) throw new HttpError(502, 'Location search service is unavailable. Please try again later.');
  const data = await response.json().catch(() => null);
  if (!Array.isArray(data)) throw new HttpError(502, 'Location search returned an invalid response.');

  const results = data.map((item) => ({
    name: String(item.display_name || '').slice(0, 250),
    latitude: Number(item.lat),
    longitude: Number(item.lon),
  })).filter((item) => item.name
    && Number.isFinite(item.latitude) && item.latitude >= -90 && item.latitude <= 90
    && Number.isFinite(item.longitude) && item.longitude >= -180 && item.longitude <= 180);
  if (geocodeCache.size >= 500) geocodeCache.delete(geocodeCache.keys().next().value);
  geocodeCache.set(cacheKey, { results, expiresAt: Date.now() + 10 * 60 * 1000 });
  return results;
}

async function fetchNearbyPlaces(latitude, longitude, radius, type) {
  const cacheKey = `${latitude}:${longitude}:${radius}:${type}`;
  const cached = nearbyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.places;
  if (cached) nearbyCache.delete(cacheKey);

  const tag = FACILITY_TYPES[type];
  const query = `[out:json][timeout:12];
    (
      node${tag}(around:${radius},${latitude},${longitude});
      way${tag}(around:${radius},${latitude},${longitude});
      relation${tag}(around:${radius},${latitude},${longitude});
    );
    out center;`;

  let data = null;
  let lastFailure = 'No Overpass response.';
  const endpoints = Date.now() < primaryOverpassCooldownUntil
    ? [...OVERPASS_ENDPOINTS.slice(1), OVERPASS_ENDPOINTS[0]]
    : OVERPASS_ENDPOINTS;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': 'MediGuide-AI/1.0', 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      if (!response.ok) {
        if (!OVERPASS_RETRYABLE_STATUSES.has(response.status)) throw new HttpError(502, 'Places service rejected the search.');
        lastFailure = `${new URL(endpoint).host} returned HTTP ${response.status}.`;
        if (endpoint === OVERPASS_ENDPOINTS[0]) primaryOverpassCooldownUntil = Date.now() + OVERPASS_COOLDOWN_MS;
        continue;
      }
      const result = await response.json().catch(() => null);
      if (!result || !Array.isArray(result.elements)) {
        lastFailure = `${new URL(endpoint).host} returned an invalid response.`;
        if (endpoint === OVERPASS_ENDPOINTS[0]) primaryOverpassCooldownUntil = Date.now() + OVERPASS_COOLDOWN_MS;
        continue;
      }
      data = result;
      if (endpoint === OVERPASS_ENDPOINTS[0]) primaryOverpassCooldownUntil = 0;
      break;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      lastFailure = `${new URL(endpoint).host} could not be reached.`;
      if (endpoint === OVERPASS_ENDPOINTS[0]) primaryOverpassCooldownUntil = Date.now() + OVERPASS_COOLDOWN_MS;
    }
  }
  if (!data) {
    console.warn(`Nearby search failed for all Overpass instances: ${lastFailure}`);
    throw new HttpError(502, 'Nearby search is temporarily unavailable. Please try again shortly.');
  }

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
  if (nearbyCache.size >= 100) {
    for (const [key, entry] of nearbyCache) if (entry.expiresAt <= Date.now()) nearbyCache.delete(key);
    if (nearbyCache.size >= 100) nearbyCache.delete(nearbyCache.keys().next().value);
  }
  nearbyCache.set(cacheKey, { places, expiresAt: Date.now() + NEARBY_CACHE_TTL_MS });
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
  ['GET', '/api/places/geocode', async ({ query }) => {
    const searchText = str(query.q, 'Location search', 2, 120);
    return { body: { results: await geocodeLocation(searchText) } };
  }],
  ['GET', '/api/places/nearby', async ({ req, query }) => {
    rateLimit(`nearby:${ip(req)}`, 10);
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

  /* ---------- medicine search ---------- */
  ['GET', '/api/medicine/search', ({ query }) => {
    const q = query?.q || '';
    const limitNum = int(query?.limit || 20, 'Limit', 1, 100);
    const ql = q.trim().toLowerCase();
    const results = MEDICINES.filter((m) => {
      const ql2 = ql || '';
      return ql2.length === 0
        || m.name.toLowerCase().includes(ql2)
        || (m.generic?.toLowerCase() || '').includes(ql2)
        || (m.mfg?.toLowerCase() || '').includes(ql2)
        || (m.category?.toLowerCase() || '').includes(ql2)
        || (m.description?.toLowerCase() || '').includes(ql2);
    });
    return { body: { results: results.slice(0, limitNum), total: results.length } };
  }],

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
  ['GET', '/api/health/summary', ({ user }) => {
    if (user.role !== 'user') throw new HttpError(403, 'Patient accounts only.');
    return { body: healthSummary(user) };
  }, { auth: 'user' }],
  ['GET', '/api/health/report-shares', ({ user }) => {
    if (user.role !== 'user') throw new HttpError(403, 'Patient accounts only.');
    run('DELETE FROM report_shares WHERE user_id = ? AND expires_at <= ?', user.id, now());
    return { body: { shares: all('SELECT id, created_at, expires_at, revoked_at FROM report_shares WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', user.id) } };
  }, { auth: 'user' }],
  ['POST', '/api/health/report-shares', ({ user, body }) => {
    if (user.role !== 'user') throw new HttpError(403, 'Patient accounts only.');
    rateLimit(`report-share-create:${user.id}`, 10);
    const allowedSections = new Set(['profile', 'medications', 'appointments']);
    if (!Array.isArray(body.sections) || body.sections.length < 1 || body.sections.length > allowedSections.size
      || body.sections.some((section) => !allowedSections.has(section))) {
      throw bad('Select one or more valid report sections.');
    }
    const sections = [...new Set(body.sections)];
    run('DELETE FROM report_shares WHERE user_id = ? AND expires_at <= ?', user.id, now());
    const summary = healthSummary(user);
    const report = {
      user: { name: user.name, ...(sections.includes('profile') ? { email: user.email } : {}) },
      summary: {
        periodDays: summary.periodDays,
        ...(sections.includes('profile') ? { profile: summary.profile } : {}),
        ...(sections.includes('medications') ? { medications: summary.medications } : {}),
      },
      schedules: sections.includes('medications')
        ? all('SELECT * FROM medication_schedules WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', user.id).map(scheduleOut)
        : [],
      appointments: sections.includes('appointments')
        ? all(`SELECT a.id, a.start_at, a.mode, a.reason, a.status, d.name AS doctor_name
            FROM appointments a JOIN doctors d ON d.id = a.doctor_id
            WHERE a.user_id = ? ORDER BY a.start_at DESC LIMIT 50`, user.id)
          .map((appointment) => ({
            id: appointment.id, start: appointment.start_at, mode: appointment.mode, reason: appointment.reason,
            status: appointment.status, doctor: { name: appointment.doctor_name },
          }))
        : [],
      sections,
      createdAt: now(),
    };
    const token = randomToken(32);
    const expiresAt = new Date(Date.parse(report.createdAt) + 24 * 60 * 60 * 1000).toISOString();
    const id = uuid();
    run('INSERT INTO report_shares (id, user_id, token_hash, report_payload, created_at, expires_at) VALUES (?,?,?,?,?,?)',
      id, user.id, sha256(token), seal(JSON.stringify(report)), report.createdAt, expiresAt);
    audit(user.id, 'health_report_shared');
    return { status: 201, body: { shareId: id, token, expiresAt }, headers: { 'Cache-Control': 'no-store' } };
  }, { auth: 'user' }],
  ['DELETE', '/api/health/report-shares/:id', ({ user, params }) => {
    if (user.role !== 'user') throw new HttpError(403, 'Patient accounts only.');
    const share = get('SELECT id FROM report_shares WHERE id = ? AND user_id = ?', params.id, user.id);
    if (!share) throw new HttpError(404, 'Report share not found.');
    run('UPDATE report_shares SET revoked_at = ?, report_payload = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
      now(), '', params.id, user.id);
    audit(user.id, 'health_report_share_revoked');
    return { body: { ok: true } };
  }, { auth: 'user' }],
  ['POST', '/api/health/shared-report/access', ({ req, body }) => {
    rateLimit(`report-share-access:${ip(req)}`, 30);
    const token = body.token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(404, 'Shared report not found.');
    run('DELETE FROM report_shares WHERE expires_at <= ?', now());
    const share = get('SELECT report_payload, expires_at, revoked_at FROM report_shares WHERE token_hash = ?', sha256(token));
    if (!share || share.revoked_at || share.expires_at <= now()) throw new HttpError(404, 'Shared report not found.');
    const payload = open(share.report_payload);
    if (payload === null) throw new HttpError(500, 'Shared report could not be opened.');
    return {
      body: { report: JSON.parse(payload), expiresAt: share.expires_at },
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    };
  }],
  ['DELETE', '/api/appointments/:id', ({ user, params }) => {
    const a = get('SELECT * FROM appointments WHERE id = ? AND user_id = ?', params.id, user.id);
    if (!a) throw new HttpError(404, 'Appointment not found.');
    if (a.status !== 'booked' || a.start_at <= now()) throw bad('Only upcoming appointments can be cancelled.');
    run("UPDATE appointments SET status = 'cancelled' WHERE id = ?", a.id);
    audit(user.id, 'appointment_cancelled');
    return { body: { ok: true } };
  }, { auth: 'user' }],
  ['GET', '/api/doctor/appointments', ({ user }) => {
    const doctor = get('SELECT id FROM doctors WHERE user_id = ?', user.id);
    if (!doctor) throw new HttpError(403, 'This doctor account is not linked to a doctor profile.');
    const rows = all(`SELECT a.*, d.name AS doctor_name, d.speciality, u.name AS patient_name, u.email AS patient_email
      FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN users u ON u.id = a.user_id
      ORDER BY CASE WHEN a.status = 'booked' AND a.start_at > ? THEN 0 ELSE 1 END, a.start_at ASC LIMIT 200`, now());
    return { body: { appointments: rows.map((a) => ({
      ...managedApptOut(a),
      room: a.doctor_id === doctor.id && a.mode === 'video' && a.status === 'booked' ? a.room : null,
      canUpdate: a.doctor_id === doctor.id,
    })) } };
  }, { auth: 'doctor' }],
  ['PATCH', '/api/doctor/appointments/:id', ({ user, params, body }) => {
    const doctor = get('SELECT id FROM doctors WHERE user_id = ?', user.id);
    if (!doctor) throw new HttpError(403, 'This doctor account is not linked to a doctor profile.');
    const appointment = get('SELECT * FROM appointments WHERE id = ? AND doctor_id = ?', params.id, doctor.id);
    if (!appointment) throw new HttpError(404, 'Appointment not found.');
    if (appointment.status !== 'booked') throw bad('Only booked appointments can be updated.');
    if (!['completed', 'cancelled'].includes(body.status)) throw bad('Choose completed or cancelled.');
    if (body.status === 'completed' && appointment.start_at > now()) throw bad('An appointment cannot be completed before it starts.');
    if (body.status === 'cancelled' && appointment.start_at <= now()) throw bad('Only upcoming appointments can be cancelled.');
    run('UPDATE appointments SET status = ? WHERE id = ?', body.status, appointment.id);
    audit(user.id, `appointment_${body.status}`, appointment.id);
    return { body: { ok: true } };
  }, { auth: 'doctor' }],

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

  /* ---------- medication schedules (tracker) ---------- */
  ['GET', '/api/schedules', ({ user }) => ({
    body: { schedules: all('SELECT * FROM medication_schedules WHERE user_id = ? ORDER BY created_at DESC', user.id).map(scheduleOut) }
  }), { auth: 'user' }],
  ['POST', '/api/schedules', ({ user, body }) => {
    if (get('SELECT COUNT(*) AS n FROM medication_schedules WHERE user_id = ?', user.id).n >= 100) throw bad('You can keep up to 100 schedules.');
    const times = [...new Set(Array.isArray(body.times) ? body.times.map(String) : String(body.times || '').split(',').map(s => s.trim()).filter(Boolean))].sort();
    if (!times.length || times.length > 8 || !times.every((t) => TIME_RE.test(t))) throw bad('Give 1 to 8 times like 08:00.');
    const days = Array.isArray(body.days) ? body.days.map(Number) : String(body.days || '').split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d) && d >= 0 && d <= 6);
    if (!days.length) throw bad('Select at least one day.');
    if (days.some(d => d < 0 || d > 6)) throw bad('Days must be 0-6 (0=Sunday).');
    const startDate = String(body.start_date || istToday());
    if (!DATE_RE.test(startDate)) throw bad('Start date must look like 2026-11-20.');
    const endDate = body.end_date ? String(body.end_date) : null;
    if (endDate && !DATE_RE.test(endDate)) throw bad('End date must look like 2026-11-20.');
    const medId = int(body.med_id, 'Medicine ID', 1, 1_000_000);
    const medName = str(body.med_name, 'Medicine name', 2, 80);
    const dosage = str(body.dosage, 'Dosage', 1, 60);
    const id = uuid();
    run('INSERT INTO medication_schedules (id, user_id, med_id, med_name, dosage, times, days, start_date, end_date, notes, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      id, user.id, medId, medName, dosage, JSON.stringify(times), JSON.stringify(days), startDate, endDate, optStr(body.notes, 'Notes', 200), 1, now());
    return { status: 201, body: { schedule: scheduleOut(get('SELECT * FROM medication_schedules WHERE id = ?', id)) } };
  }, { auth: 'user' }],
  ['GET', '/api/schedules/:id', ({ user, params }) => {
    const s = get('SELECT * FROM medication_schedules WHERE id = ? AND user_id = ?', params.id, user.id);
    if (!s) throw new HttpError(404, 'Schedule not found.');
    const logs = all('SELECT * FROM medication_logs WHERE schedule_id = ? ORDER BY scheduled_time DESC LIMIT 50', params.id).map(logOut);
    return { body: { schedule: scheduleOut(s), logs } };
  }, { auth: 'user' }],
  ['PUT', '/api/schedules/:id', ({ user, params, body }) => {
    const s = get('SELECT * FROM medication_schedules WHERE id = ? AND user_id = ?', params.id, user.id);
    if (!s) throw new HttpError(404, 'Schedule not found.');
    const updates = []; const vals = [];
    if (body.times !== undefined) {
      const times = [...new Set(Array.isArray(body.times) ? body.times.map(String) : String(body.times || '').split(',').map(s => s.trim()).filter(Boolean))].sort();
      if (!times.length || times.length > 8 || !times.every((t) => TIME_RE.test(t))) throw bad('Give 1 to 8 times like 08:00.');
      updates.push('times = ?'); vals.push(JSON.stringify(times));
    }
    if (body.days !== undefined) {
      const days = Array.isArray(body.days) ? body.days.map(Number) : String(body.days || '').split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d) && d >= 0 && d <= 6);
      if (!days.length) throw bad('Select at least one day.');
      if (days.some(d => d < 0 || d > 6)) throw bad('Days must be 0-6 (0=Sunday).');
      updates.push('days = ?'); vals.push(JSON.stringify(days));
    }
    if (body.end_date !== undefined) {
      const endDate = body.end_date ? String(body.end_date) : null;
      if (endDate && !DATE_RE.test(endDate)) throw bad('End date must look like 2026-11-20.');
      updates.push('end_date = ?'); vals.push(endDate);
    }
    if (body.notes !== undefined) { updates.push('notes = ?'); vals.push(optStr(body.notes, 'Notes', 200)); }
    if (body.active !== undefined) { updates.push('active = ?'); vals.push(body.active ? 1 : 0); }
    if (!updates.length) return { body: { schedule: scheduleOut(s) } };
    vals.push(params.id);
    run(`UPDATE medication_schedules SET ${updates.join(', ')} WHERE id = ?`, ...vals);
    return { body: { schedule: scheduleOut(get('SELECT * FROM medication_schedules WHERE id = ?', params.id)) } };
  }, { auth: 'user' }],
  ['DELETE', '/api/schedules/:id', ({ user, params }) => {
    const s = get('SELECT * FROM medication_schedules WHERE id = ? AND user_id = ?', params.id, user.id);
    if (!s) throw new HttpError(404, 'Schedule not found.');
    run('DELETE FROM medication_logs WHERE schedule_id = ?', params.id);
    run('DELETE FROM medication_schedules WHERE id = ?', params.id);
    return { body: { ok: true } };
  }, { auth: 'user' }],
  ['POST', '/api/schedules/:id/log', ({ user, params, body }) => {
    const s = get('SELECT * FROM medication_schedules WHERE id = ? AND user_id = ?', params.id, user.id);
    if (!s) throw new HttpError(404, 'Schedule not found.');
    const status = body.status === 'skipped' ? 'skipped' : body.status === 'missed' ? 'missed' : 'taken';
    const scheduledTime = str(body.scheduled_time, 'Scheduled time', 10, 30);
    const notes = optStr(body.notes, 'Notes', 200);
    const id = uuid();
    run('INSERT INTO medication_logs (id, user_id, schedule_id, scheduled_time, status, notes, logged_at) VALUES (?,?,?,?,?,?,?)',
      id, user.id, params.id, scheduledTime, status, notes, now());
    return { status: 201, body: { log: logOut(get('SELECT * FROM medication_logs WHERE id = ?', id)) } };
  }, { auth: 'user' }],
  ['GET', '/api/schedules/:id/adherence', ({ user, params, query }) => {
    const s = get('SELECT * FROM medication_schedules WHERE id = ? AND user_id = ?', params.id, user.id);
    if (!s) throw new HttpError(404, 'Schedule not found.');
    const days = int(query.days || 30, 'Days', 1, 365);
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 86400000);
    const logs = all('SELECT * FROM medication_logs WHERE schedule_id = ? AND scheduled_time >= ? AND scheduled_time <= ?',
      params.id, startDate.toISOString(), endDate.toISOString());
    const total_scheduled = logs.length;
    const taken = logs.filter(l => l.status === 'taken').length;
    const skipped = logs.filter(l => l.status === 'skipped').length;
    const missed = logs.filter(l => l.status === 'missed').length;
    const adherence_percentage = total_scheduled > 0 ? Math.round((taken / total_scheduled) * 100) : 0;
    return { body: { schedule_id: params.id, period_days: days, total_scheduled, taken, skipped, missed, adherence_percentage } };
  }, { auth: 'user' }],

  /* ---------- clinical safety ---------- */
  ['POST', '/api/safety/dosage-check', ({ user, body }) => {
    const medId = int(body.med_id, 'Medicine ID', 1, 1_000_000);
    const med = MEDICINES.find((m) => m.id === medId);
    if (!med) throw new HttpError(404, 'Medicine not found.');
    const dosage = Number(body.dosage);
    if (!Number.isFinite(dosage) || dosage <= 0 || dosage > 10000) throw bad('Dosage must be a positive number of mg.');
    const frequency = str(body.frequency || 'OD', 'Frequency', 1, 30);
    const patient = body.patient && typeof body.patient === 'object' ? body.patient : {};
    const frequencyCount = /q[dh]|once|od/i.test(frequency) ? 1 : /twice|bid/i.test(frequency) ? 2 : /three|tid/i.test(frequency) ? 3 : /four|qid/i.test(frequency) ? 4 : /6|8/i.test(frequency) ? 3 : 1;
    const dailyExposure = dosage * frequencyCount;
    const age = patient.age == null ? null : Number(patient.age);
    const conditions = Array.isArray(patient.conditions) ? patient.conditions.map(String) : [];
    const findings = [];
    if (dailyExposure > (med.mg || dosage) * 4) findings.push({ ruleType: 'Dosage', severity: 'HIGH', finding: `Estimated daily exposure is ${dailyExposure} mg.`, recommendation: 'Do not exceed the labelled maximum. Confirm the dose with a doctor or pharmacist.', evidence: { sourceName: 'Package label / CDSCO', evidenceTier: 2, confidenceScore: 80 } });
    if (age != null && age < 18) findings.push({ ruleType: 'Pediatric', severity: 'MODERATE', finding: 'A pediatric patient was identified.', recommendation: 'Use a weight-based pediatric dose chosen by a clinician.', evidence: { sourceName: 'Clinical safety guidance', evidenceTier: 2, confidenceScore: 75 } });
    if (age != null && age >= 65) findings.push({ ruleType: 'Elderly', severity: 'LOW', finding: 'Older-adult caution applies.', recommendation: 'Use the lowest effective dose and review other medicines with a pharmacist.', evidence: { sourceName: 'Geriatric prescribing guidance', evidenceTier: 2, confidenceScore: 75 } });
    if (conditions.some((c) => /liver|hepatic/i.test(c)) && /paracetamol|acetaminophen/i.test(med.generic)) findings.push({ ruleType: 'Hepatic', severity: 'HIGH', finding: 'Paracetamol requires liver caution.', recommendation: 'Confirm the safe dose and liver monitoring needs with a clinician.', evidence: { sourceName: 'Medicine safety guidance', evidenceTier: 2, confidenceScore: 85 } });
    if (conditions.some((c) => /kidney|renal/i.test(c)) && /ibuprofen/i.test(med.generic)) findings.push({ ruleType: 'Renal', severity: 'HIGH', finding: 'Ibuprofen can worsen kidney function in susceptible people.', recommendation: 'Avoid or use only under clinician supervision.', evidence: { sourceName: 'Renal safety guidance', evidenceTier: 2, confidenceScore: 85 } });
    const overallClinicalSeverity = findings.some((f) => f.severity === 'HIGH') ? 'HIGH' : findings.length ? 'MODERATE' : 'LOW';
    audit(user?.id || null, 'dosage_safety_checked', med.name);
    return { body: { med_id: med.id, medication: med.name, dosage, frequency, dailyExposure, riskLevel: overallClinicalSeverity, overallClinicalSeverity, findings } };
  }, { auth: 'optional' }],
  ['POST', '/api/interactions/check', ({ user, body }) => {
    const medications = Array.isArray(body.medications) ? body.medications.slice(0, 20).map(String).filter(Boolean) : [];
    if (medications.length < 2) throw bad('Provide at least two medication names.');
    const objects = medications.map((name) => ({ name, generic: name }));
    const interactions = [];
    for (let i = 0; i < objects.length; i++) for (let j = i + 1; j < objects.length; j++) {
      const rule = interactionFor(objects[i], objects[j]);
      if (rule) interactions.push({ medications: [objects[i].name, objects[j].name], severity: rule.severity, recommendation: rule.recommendation });
    }
    audit(user?.id || null, 'interactions_checked', `${medications.length} medicines`);
    return { body: { interactions, count: interactions.length } };
  }, { auth: 'optional' }],
  ['POST', '/api/safety/score', ({ user, body }) => {
    const medications = Array.isArray(body.medications) ? body.medications.slice(0, 20).map(String).filter(Boolean) : [];
    let score = 100;
    for (let i = 0; i < medications.length; i++) for (let j = i + 1; j < medications.length; j++) {
      const rule = interactionFor({ name: medications[i], generic: medications[i] }, { name: medications[j], generic: medications[j] });
      if (rule) score -= rule.severity === 'CONTRAINDICATED' ? 30 : rule.severity === 'MAJOR' ? 20 : 10;
    }
    score = Math.max(0, score - Math.max(0, medications.length - 5) * 5);
    const riskLevel = score >= 80 ? 'LOW' : score >= 60 ? 'MODERATE' : score >= 40 ? 'HIGH' : 'CRITICAL';
    audit(user?.id || null, 'safety_score_generated', `${medications.length} medicines`);
    return { body: { score, riskLevel, medicationCount: medications.length } };
  }, { auth: 'optional' }],

  /* ---------- adverse drug reaction reporting ---------- */
  ['POST', '/api/adr', ({ user, body }) => {
    if (!['Mild', 'Moderate', 'Severe', 'Critical'].includes(body.severity)) throw bad('Severity must be Mild, Moderate, Severe or Critical.');
    if (!DATE_RE.test(String(body.start_date || ''))) throw bad('Start date must look like 2026-11-20.');
    if (body.end_date && !DATE_RE.test(String(body.end_date))) throw bad('End date must look like 2026-11-20.');
    const id = uuid(); const t = now();
    run('INSERT INTO adverse_events (id,user_id,medication,reaction,severity,start_date,end_date,description,outcome,notes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, user.id, str(body.medication, 'Medication', 2, 100), str(body.reaction, 'Reaction', 2, 200), body.severity,
      body.start_date, body.end_date || null, optStr(body.description, 'Description', 1000), optStr(body.outcome, 'Outcome', 200),
      optStr(body.notes, 'Notes', 500), body.status === 'resolved' ? 'resolved' : 'open', t, t);
    audit(user.id, 'adr_created', body.medication);
    return { status: 201, body: { report: adverseOut(get('SELECT * FROM adverse_events WHERE id=?', id)) } };
  }, { auth: 'user' }],
  ['GET', '/api/adr', ({ user, query }) => {
    const status = ['open', 'resolved', 'all'].includes(query.status) ? query.status : 'all';
    const rows = status === 'all'
      ? all('SELECT * FROM adverse_events WHERE user_id=? ORDER BY created_at DESC', user.id)
      : all('SELECT * FROM adverse_events WHERE user_id=? AND status=? ORDER BY created_at DESC', user.id, status);
    return { body: { reports: rows.map(adverseOut), total: rows.length } };
  }, { auth: 'user' }],
  ['GET', '/api/adr/stats', ({ user }) => {
    const rows = all('SELECT severity, reaction, status FROM adverse_events WHERE user_id=?', user.id);
    const severity = { Mild: 0, Moderate: 0, Severe: 0, Critical: 0 };
    const reactions = {};
    rows.forEach((r) => { severity[r.severity] = (severity[r.severity] || 0) + 1; reactions[r.reaction] = (reactions[r.reaction] || 0) + 1; });
    return { body: { total: rows.length, open: rows.filter((r) => r.status === 'open').length, severity, topReactions: Object.entries(reactions).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reaction, count]) => ({ reaction, count })) } };
  }, { auth: 'user' }],
  ['PUT', '/api/adr/:id', ({ user, params, body }) => {
    const current = get('SELECT * FROM adverse_events WHERE id=? AND user_id=?', params.id, user.id);
    if (!current) throw new HttpError(404, 'ADR report not found.');
    if (body.severity !== undefined && !['Mild', 'Moderate', 'Severe', 'Critical'].includes(body.severity)) throw bad('Invalid severity.');
    if (body.status !== undefined && !['open', 'resolved'].includes(body.status)) throw bad('Status must be open or resolved.');
    const updates = []; const vals = [];
    for (const [field, value] of [['medication', body.medication], ['reaction', body.reaction], ['severity', body.severity], ['start_date', body.start_date], ['end_date', body.end_date], ['description', body.description], ['outcome', body.outcome], ['notes', body.notes], ['status', body.status]]) {
      if (value !== undefined) { updates.push(`${field}=?`); vals.push(field === 'status' ? value : value || null); }
    }
    if (updates.length) { updates.push('updated_at=?'); vals.push(now(), params.id, user.id); run(`UPDATE adverse_events SET ${updates.join(',')} WHERE id=? AND user_id=?`, ...vals); }
    audit(user.id, 'adr_updated', params.id);
    return { body: { report: adverseOut(get('SELECT * FROM adverse_events WHERE id=?', params.id)) } };
  }, { auth: 'user' }],
  ['DELETE', '/api/adr/:id', ({ user, params }) => {
    if (!get('SELECT 1 FROM adverse_events WHERE id=? AND user_id=?', params.id, user.id)) throw new HttpError(404, 'ADR report not found.');
    run('DELETE FROM adverse_events WHERE id=? AND user_id=?', params.id, user.id);
    audit(user.id, 'adr_deleted', params.id);
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
  ['POST', '/api/admin/doctors', ({ user, body }) => {
    rateLimit(`admin-doctor:${user.id}`, 10);
    const name = str(body.name, 'Doctor name', 2, 80);
    const email = str(body.email, 'Email', 5, 320).toLowerCase();
    const password = str(body.password, 'Initial password', 8, 200);
    const speciality = str(body.speciality, 'Speciality', 2, 80);
    if (!EMAIL_RE.test(email)) throw bad('Please enter a valid email address.');
    if (get('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'An account with this email already exists.');
    const languages = [...new Set((Array.isArray(body.languages) ? body.languages : []).map((value) => str(value, 'Language', 2, 40)))];
    const modes = [...new Set(Array.isArray(body.modes) ? body.modes.map(String) : [])];
    if (!languages.length || languages.length > 8) throw bad('Add 1 to 8 languages.');
    if (!modes.length || modes.length > 2 || !modes.every((mode) => ['video', 'clinic'].includes(mode))) throw bad('Choose video, clinic, or both visit types.');
    const bio = optStr(body.bio, 'Bio', 500);
    const userId = uuid();
    const doctorId = uuid();
    transaction(() => {
      run('INSERT INTO users (id, email, name, pw_hash, role, created_at) VALUES (?,?,?,?,?,?)',
        userId, email, name, hashPassword(password), 'doctor', now());
      run('INSERT INTO doctors (id, name, speciality, languages, modes, bio, user_id) VALUES (?,?,?,?,?,?,?)',
        doctorId, name, speciality, JSON.stringify(languages), JSON.stringify(modes), bio, userId);
      audit(user.id, 'doctor_account_created', doctorId);
    });
    return { status: 201, body: { doctor: { id: doctorId, name, email, speciality, languages, modes, bio } } };
  }, { auth: 'admin' }],
  ['GET', '/api/admin/appointments', ({ query }) => {
    const view = query.view === 'all' ? 'all' : 'upcoming';
    const where = view === 'all' ? '' : "WHERE a.status = 'booked' AND a.start_at > ?";
    const rows = all(`SELECT a.*, d.name AS doctor_name, d.speciality, u.name AS patient_name, u.email AS patient_email
      FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN users u ON u.id = a.user_id
      ${where} ORDER BY a.start_at ${view === 'all' ? 'DESC' : 'ASC'} LIMIT 200`, ...(view === 'all' ? [] : [now()]));
    return { body: { appointments: rows.map(managedApptOut) } };
  }, { auth: 'admin' }],
  ['POST', '/api/admin/appointments', ({ user, body }) => {
    const patientId = str(body.userId, 'Patient', 1, 80);
    const patient = get('SELECT id, role FROM users WHERE id = ?', patientId);
    if (!patient || patient.role !== 'user') throw new HttpError(404, 'Patient account not found.');
    if (get("SELECT COUNT(*) AS n FROM appointments WHERE user_id = ? AND status = 'booked' AND start_at > ?", patientId, now()).n >= 5) throw bad('This patient already has 5 upcoming appointments.');
    const doctor = get('SELECT * FROM doctors WHERE id = ?', str(body.doctorId, 'Doctor', 1, 80));
    if (!doctor) throw new HttpError(404, 'Doctor not found.');
    const start = str(body.start, 'Appointment time', 20, 40);
    if (!slotsFor(start.slice(0, 10)).includes(start)) throw bad('Choose an available appointment time.');
    const mode = str(body.mode, 'Visit type', 4, 6);
    if (!JSON.parse(doctor.modes).includes(mode)) throw bad(`This doctor does not offer ${mode} visits.`);
    const id = uuid();
    try {
      run('INSERT INTO appointments (id, user_id, doctor_id, start_at, mode, reason, room, created_at) VALUES (?,?,?,?,?,?,?,?)',
        id, patientId, doctor.id, start, mode, optStr(body.reason, 'Reason', 200), mode === 'video' ? `https://meet.jit.si/MediGuide-${randomToken(12)}` : null, now());
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed: appointments.doctor_id, appointments.start_at')) {
        throw new HttpError(409, 'That appointment time is no longer available. Choose another slot.');
      }
      throw error;
    }
    audit(user.id, 'appointment_booked_for_patient', id);
    const appointment = get(`SELECT a.*, d.name AS doctor_name, d.speciality, u.name AS patient_name, u.email AS patient_email
      FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN users u ON u.id = a.user_id WHERE a.id = ?`, id);
    return { status: 201, body: { appointment: managedApptOut(appointment) } };
  }, { auth: 'admin' }],
  ['PUT', '/api/admin/appointments/:id', ({ user, params, body }) => {
    const appointment = get('SELECT * FROM appointments WHERE id = ?', params.id);
    if (!appointment) throw new HttpError(404, 'Appointment not found.');
    if (appointment.status !== 'booked') throw bad('Only booked appointments can be rescheduled.');
    if (appointment.start_at <= now()) throw bad('Past appointments cannot be rescheduled.');
    const doctor = get('SELECT * FROM doctors WHERE id = ?', String(body.doctorId || appointment.doctor_id));
    if (!doctor) throw new HttpError(404, 'Doctor not found.');
    const start = str(body.start, 'Appointment time', 20, 40);
    if (!slotsFor(start.slice(0, 10)).includes(start)) throw bad('Choose an available appointment time.');
    const mode = str(body.mode || appointment.mode, 'Visit type', 4, 6);
    if (!JSON.parse(doctor.modes).includes(mode)) throw bad(`This doctor does not offer ${mode} visits.`);
    if (get("SELECT 1 FROM appointments WHERE doctor_id = ? AND start_at = ? AND status = 'booked' AND id != ?", doctor.id, start, appointment.id)) {
      throw new HttpError(409, 'That appointment time is no longer available. Choose another slot.');
    }
    const reason = body.reason === undefined ? appointment.reason : optStr(body.reason, 'Reason', 200);
    try {
      run('UPDATE appointments SET doctor_id = ?, start_at = ?, mode = ?, reason = ?, room = ? WHERE id = ?',
        doctor.id, start, mode, reason, mode === 'video' ? `https://meet.jit.si/MediGuide-${randomToken(12)}` : null, appointment.id);
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed: appointments.doctor_id, appointments.start_at')) {
        throw new HttpError(409, 'That appointment time is no longer available. Choose another slot.');
      }
      throw error;
    }
    audit(user.id, 'appointment_rescheduled', appointment.id);
    return { body: { ok: true } };
  }, { auth: 'admin' }],
  ['DELETE', '/api/admin/appointments/:id', ({ user, params }) => {
    const appointment = get('SELECT * FROM appointments WHERE id = ?', params.id);
    if (!appointment) throw new HttpError(404, 'Appointment not found.');
    if (appointment.status !== 'booked') throw bad('Only booked appointments can be cancelled.');
    run("UPDATE appointments SET status = 'cancelled' WHERE id = ?", appointment.id);
    audit(user.id, 'appointment_cancelled_by_admin', appointment.id);
    return { body: { ok: true } };
  }, { auth: 'admin' }],
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
  ['GET', '/api/admin/oauth', () => ({
    body: {
      clientIdConfigured: Boolean(getSetting('oauth_client_id') || config.oauth.clientId),
      clientSecretConfigured: Boolean(getSetting('oauth_client_secret') || config.oauth.clientSecret),
      redirectUri: getSetting('oauth_redirect_uri') || config.oauth.redirectUri,
    },
  }), { auth: 'admin' }],
  ['PUT', '/api/admin/oauth', ({ user, body }) => {
    if (body.clear === true) {
      delSetting('oauth_client_id');
      delSetting('oauth_client_secret');
      delSetting('oauth_redirect_uri');
      audit(user.id, 'oauth_settings_removed');
    } else {
      if (body.clientId !== undefined) {
        const clientId = str(body.clientId, 'OAuth client ID', 5, 300);
        setSetting('oauth_client_id', clientId);
      }
      if (body.clientSecret !== undefined && body.clientSecret !== '') {
        const clientSecret = str(body.clientSecret, 'OAuth client secret', 8, 300);
        setSetting('oauth_client_secret', seal(clientSecret));
      }
      if (body.redirectUri !== undefined) {
        const redirectUri = str(body.redirectUri, 'OAuth redirect URI', 20, 500);
        let parsed;
        try { parsed = new URL(redirectUri); } catch { throw bad('Enter a valid OAuth redirect URI.'); }
        const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
        if ((!localHttp && parsed.protocol !== 'https:') || parsed.username || parsed.password || parsed.hash || parsed.pathname !== '/api/auth/oauth/callback') {
          throw bad('Redirect URI must use HTTPS and end in /api/auth/oauth/callback (HTTP is allowed for localhost).');
        }
        setSetting('oauth_redirect_uri', parsed.toString());
      }
      audit(user.id, 'oauth_settings_updated');
    }
    const secret = getSetting('oauth_client_secret');
    return { body: {
      clientIdConfigured: Boolean(getSetting('oauth_client_id') || config.oauth.clientId),
      clientSecretConfigured: Boolean(secret || config.oauth.clientSecret),
      redirectUri: getSetting('oauth_redirect_uri') || config.oauth.redirectUri,
    } };
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
  }, { auth: 'admin' }]
]