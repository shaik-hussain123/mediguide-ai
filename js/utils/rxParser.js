/**
 * @file Local prescription text parser (pure, no DOM). Matches known medicines and pulls out
 * strength, frequency and duration. Fully offline (NFR-2.3); never changes or recommends a dose.
 */
const FREQ = [
  [/\b(?:1\s*-\s*1\s*-\s*1|tds|tid|thrice|three times)\b/i, 'Three times a day'],
  [/\b(?:1\s*-\s*0\s*-\s*1|bd|bid|b\.d\.?|twice|two times)\b/i, 'Twice a day'],
  [/\b(?:qid|four times)\b/i, 'Four times a day'],
  [/\b(?:1\s*-\s*0\s*-\s*0|0\s*-\s*0\s*-\s*1|0\s*-\s*1\s*-\s*0|od|o\.d\.?|once|daily|hs|at night|nocte)\b/i, 'Once a day'],
  [/\b(?:sos|prn|if needed|as needed|when required)\b/i, 'Only if needed'],
  [/\b(?:weekly|once a week|once weekly)\b/i, 'Once a week'],
  [/\bevery\s*(\d{1,2})\s*(?:h|hr|hrs|hours)\b/i, null],
];

export function parseFrequency(text) {
  // "weekly" must win over "daily"-style words
  if (/\b(weekly|once a week|once weekly)\b/i.test(text)) return 'Once a week';
  for (const [re, label] of FREQ) {
    const m = text.match(re);
    if (m) return label || `Every ${m[1]} hours`;
  }
  return null;
}

export function parseDuration(text) {
  const m = text.match(/\b(?:for|x)?\s*(\d{1,3})\s*(day|days|d|week|weeks|wk|wks|month|months)\b/i);
  if (!m) return null;
  const u = m[2].toLowerCase();
  const unit = u.startsWith('d') ? 'day' : u.startsWith('w') ? 'week' : 'month';
  return `${m[1]} ${unit}${Number(m[1]) === 1 ? '' : 's'}`;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Brand, brand without its strength suffix ("Uprise-D3 60K" → "Uprise-D3"), and generic name. */
function names(m) {
  const base = m.name.replace(/\s+\d[\w.]*$/, '');
  return [m.name, base.length >= 5 ? base : null, m.generic ? m.generic.split('(')[0].trim() : null]
    .filter(Boolean).map((n) => n.toLowerCase());
}

/**
 * @param {string} text prescription text
 * @param {{id:number,name:string,generic?:string,mg:number,unit?:string,_name?:string}[]} meds dataset
 * @returns {{raw:string, med:object|null, strength:number|null, strengthMatches:boolean|null, frequency:string|null, duration:string|null}[]}
 */
export function parsePrescription(text, meds) {
  const parts = String(text || '').split(/[\n;,]+|\band\b/i).map((s) => s.trim()).filter((s) => s.length > 2);
  const rows = [];
  for (const raw of parts) {
    const lower = raw.toLowerCase();
    const med = meds.find((m) => names(m).some((n) => new RegExp(`(^|[^a-z0-9])${escapeRe(n)}($|[^a-z0-9])`).test(lower)));
    const s = raw.match(/(\d{1,6}(?:\.\d+)?)\s*(mg|iu|mcg)\b/i);
    const strength = s ? Number(s[1]) : null;
    rows.push({
      raw,
      med: med || null,
      strength,
      strengthMatches: med && strength != null ? Number(med.mg) === strength : null,
      frequency: parseFrequency(raw),
      duration: parseDuration(raw),
    });
  }
  return rows.filter((r) => r.med || r.frequency || r.strength != null);
}

/** Default reminder times for a parsed frequency label. Returns [] when there is no fixed schedule. */
export function timesForFrequency(label) {
  return ({
    'Once a day': ['08:00'], 'Twice a day': ['08:00', '20:00'], 'Three times a day': ['08:00', '14:00', '20:00'],
    'Four times a day': ['07:00', '12:00', '17:00', '22:00'], 'Once a week': ['08:00'],
  })[label] || (/^Every (\d{1,2}) hours$/.test(label || '') ? everyHours(Number(RegExp.$1)) : []);
}
function everyHours(h) {
  if (!(h >= 4 && h <= 12)) return [];
  const out = []; for (let t = 8; t < 8 + 24 && out.length < 6; t += h) out.push(`${String(t % 24).padStart(2, '0')}:00`);
  return [...new Set(out)].sort();
}
