import * as store from '../utils/storage.js';
import { KEYS } from '../config.js';

/**
 * @file Medicine + company dataset and search (SRS §7, FR-1, FR-6, NFR-7.1).
 *
 * IMPORTANT: this is a small curated starter set. Dosage and brand details MUST be verified
 * against the CDSCO / manufacturer label by a qualified pharmacist before any public release.
 * The engine is index-based and handles 1,000+ records: add more via data/medicines.json
 * (same shape, auto-merged by loadExtra()).
 *
 * Fields beyond SRS §7.1 (used for FR-3 dosage visualisation):
 *  uses (plain-language reasons it is taken; admin-editable), generic, form, unit, rx, tier ('routine'|'care'|'prescription'), pills, schedule[], meal, prn,
 *  byAge{child,adult,senior}, cautions[], symptoms[], indianRegulatory.
 */

const SLOTS = ['morning', 'afternoon', 'evening', 'night'];

/** FR-6.5 company data (§7.2). */
export const COMPANIES = [
  { name: 'Micro Labs', country: 'India', hq: 'Bengaluru', founded: 1973, cdscoApproved: true },
  { name: 'Abbott India', country: 'India', hq: 'Mumbai', founded: 1910, cdscoApproved: true },
  { name: 'Alembic Pharmaceuticals', country: 'India', hq: 'Vadodara', founded: 1907, cdscoApproved: true },
  { name: 'Cipla', country: 'India', hq: 'Mumbai', founded: 1935, cdscoApproved: true },
  { name: 'Alkem Laboratories', country: 'India', hq: 'Mumbai', founded: 1973, cdscoApproved: true },
  { name: 'USV', country: 'India', hq: 'Mumbai', founded: 1961, cdscoApproved: true },
  { name: 'Mankind Pharma', country: 'India', hq: 'New Delhi', founded: 1995, cdscoApproved: true },
  { name: 'Zydus Lifesciences', country: 'India', hq: 'Ahmedabad', founded: 1952, cdscoApproved: true },
];

const ALL_STORES = ['1mg', 'apollo', 'platinumrx', 'netmeds', 'pharmeasy'];

const generic = (name, mfg, pros, cons) => ({ name, mfg, pros, cons });
const PMBJP = 'Bureau of Pharma PSUs of India (Jan Aushadhi)';

/** @type {object[]} */
const SEED = [
  {
    id: 1, name: 'Dolo 650', generic: 'Paracetamol', mg: 650, form: 'Tablet', mfg: 'Micro Labs',
    category: 'Analgesic & Antipyretic', rx: false, tier: 'routine', img: '💊', ageGroup: '12+ years / Adult',
    description: 'Brings down fever and relieves mild to moderate pain such as headache, body ache and toothache.',
    symptoms: ['fever', 'headache', 'body ache', 'toothache', 'cold', 'pain', 'viral'],
    dose: '1 tablet every 6 to 8 hours if needed. Do not take more than 4 tablets in 24 hours.',
    pills: 1, schedule: ['morning', 'afternoon', 'night'], prn: true, meal: 'any', frequency: 'Every 6 to 8 hours, only if needed',
    byAge: {
      child: 'The 650 mg tablet is not for young children. Syrup is given by body weight (about 10 to 15 mg per kg per dose). Ask a doctor.',
      adult: '1 tablet every 6 to 8 hours if needed. Maximum 4 tablets in 24 hours.',
      senior: 'Same tablet, but use the lowest amount that works and not more than 3 tablets a day unless your doctor says otherwise.',
    },
    cautions: ['Do not take other medicines that also contain paracetamol.', 'Avoid alcohol. Talk to a doctor first if you have liver disease.'],
    stores: ALL_STORES,
    alternatives: [
      generic('Crocin 650', 'Haleon', ['Well-known brand', 'Easy to find'], ['Brand price can be higher than generics']),
      generic('Pacimol 650', 'Ipca Laboratories', ['Same salt and strength', 'Widely stocked'], ['Fewer pharmacy discounts than big brands']),
      generic('Paracetamol 650 (Jan Aushadhi)', PMBJP, ['Usually much cheaper'], ['Stock depends on the nearby Jan Aushadhi Kendra']),
    ],
  },
  {
    id: 2, name: 'Brufen 400', generic: 'Ibuprofen', mg: 400, form: 'Tablet', mfg: 'Abbott India',
    category: 'NSAID Pain Reliever', rx: true, tier: 'prescription', img: '💊', ageGroup: '12+ years / Adult',
    description: 'Relieves pain and swelling from headache, toothache, muscle pain, period pain and joint pain, and lowers fever.',
    symptoms: ['pain', 'headache', 'toothache', 'muscle pain', 'joint pain', 'period pain', 'inflammation', 'fever', 'swelling'],
    dose: '1 tablet up to 3 times a day, always after food. Use for the shortest time possible.',
    pills: 1, schedule: ['morning', 'afternoon', 'night'], prn: true, meal: 'after', frequency: 'Up to 3 times a day, after food',
    byAge: {
      child: 'Tablets are not for young children. Syrup is dosed by weight. Ask a doctor.',
      adult: '1 tablet up to 3 times a day after food. Maximum 3 tablets a day without medical advice.',
      senior: 'Higher risk of stomach bleeding, kidney and blood pressure problems. Ask a doctor before use.',
    },
    cautions: ['Take after food to protect the stomach.', 'Avoid with stomach ulcers, kidney disease, heart failure or in late pregnancy.', 'Do not combine with aspirin or other pain killers of the same type.'],
    stores: ALL_STORES,
    alternatives: [
      generic('Ibugesic 400', 'Cipla', ['Same salt and strength', 'Widely stocked'], ['Brand price differs']),
      generic('Ibuprofen 400 (Jan Aushadhi)', PMBJP, ['Usually much cheaper'], ['Stock depends on the nearby Jan Aushadhi Kendra']),
    ],
  },
  {
    id: 3, name: 'Azithral 500', generic: 'Azithromycin', mg: 500, form: 'Tablet', mfg: 'Alembic Pharmaceuticals',
    category: 'Antibiotic', rx: true, tier: 'prescription', img: '💊', ageGroup: 'Adult (child dose by weight)',
    description: 'Antibiotic for bacterial infections of the throat, chest, ear, skin and some other sites. It does not work for colds or flu caused by viruses.',
    symptoms: ['throat infection', 'chest infection', 'bacterial infection', 'sinus', 'ear infection', 'pneumonia', 'skin infection', 'cough'],
    dose: '1 tablet once a day, usually for 3 days, exactly as your doctor prescribes.',
    pills: 1, schedule: ['morning'], prn: false, meal: 'any', frequency: 'Once a day (course set by doctor)',
    byAge: {
      child: 'Dose is based on body weight and chosen by a doctor.',
      adult: '500 mg once a day, usually for 3 days. Finish the full course your doctor gave.',
      senior: 'Usual adult dose. Tell your doctor about heart rhythm problems or other medicines you take.',
    },
    cautions: ['Prescription medicine. Do not use leftover tablets.', 'Do not stop early or take it for viral illness.', 'Seek help for severe diarrhoea, rash, or fast or irregular heartbeat.'],
    stores: ALL_STORES,
    alternatives: [
      generic('Azee 500', 'Cipla', ['Same salt and strength', 'Widely stocked'], ['Needs a prescription']),
      generic('Azithromycin 500 (Jan Aushadhi)', PMBJP, ['Usually much cheaper'], ['Needs a prescription', 'Stock varies']),
    ],
  },
  {
    id: 4, name: 'Novamox 500', generic: 'Amoxicillin', mg: 500, form: 'Capsule', mfg: 'Cipla',
    category: 'Antibiotic', rx: true, tier: 'prescription', img: '💊', ageGroup: 'Adult (child dose by weight)',
    description: 'Penicillin-type antibiotic for bacterial infections of the ear, throat, chest, urinary tract and teeth.',
    symptoms: ['ear infection', 'throat infection', 'chest infection', 'urinary infection', 'tooth infection', 'bacterial infection', 'sinus'],
    dose: '1 capsule every 8 hours for the number of days your doctor prescribes.',
    pills: 1, schedule: ['morning', 'afternoon', 'night'], prn: false, meal: 'any', frequency: 'Every 8 hours (course set by doctor)',
    byAge: {
      child: 'Dose is based on body weight and chosen by a doctor, usually as syrup.',
      adult: '500 mg every 8 hours, usually for 5 to 7 days, as prescribed.',
      senior: 'Usual adult dose. A doctor may lower it if kidneys are weak.',
    },
    cautions: ['Do not use if you are allergic to penicillin.', 'Prescription medicine. Finish the full course.', 'Seek help at once for rash, swelling of face or breathing trouble.'],
    stores: ALL_STORES,
    alternatives: [
      generic('Wymox 500', 'Wockhardt', ['Same salt and strength'], ['Needs a prescription']),
      generic('Amoxicillin 500 (Jan Aushadhi)', PMBJP, ['Usually much cheaper'], ['Needs a prescription', 'Stock varies']),
    ],
  },
  {
    id: 5, name: 'Okacet 10', generic: 'Cetirizine', mg: 10, form: 'Tablet', mfg: 'Cipla',
    category: 'Antihistamine (Allergy)', rx: true, tier: 'prescription', img: '💊', ageGroup: '6+ years / Adult',
    description: 'Relieves sneezing, runny nose, itchy or watery eyes and itchy skin rashes caused by allergies.',
    symptoms: ['allergy', 'sneezing', 'runny nose', 'itching', 'hives', 'rash', 'cold', 'watery eyes', 'hay fever'],
    dose: '1 tablet once a day, preferably at night. It can cause sleepiness.',
    pills: 1, schedule: ['night'], prn: false, meal: 'any', frequency: 'Once a day, at night',
    byAge: {
      child: '6 to 11 years: half a tablet (5 mg) once or twice a day. Under 6: a doctor should advise syrup.',
      adult: '1 tablet (10 mg) once a day.',
      senior: 'May cause drowsiness and falls. Ask a doctor about a lower dose, especially with weak kidneys.',
    },
    cautions: ['Can cause sleepiness. Do not drive after taking it.', 'Avoid alcohol.'],
    stores: ALL_STORES,
    alternatives: [
      generic('Zyncet', 'Unichem', ['Same salt and strength'], ['Brand price differs']),
      generic('Cetirizine 10 (Jan Aushadhi)', PMBJP, ['Usually much cheaper'], ['Stock varies']),
    ],
  },
  {
    id: 6, name: 'Pan 40', generic: 'Pantoprazole', mg: 40, form: 'Tablet', mfg: 'Alkem Laboratories',
    category: 'Antacid (Proton Pump Inhibitor)', rx: true, tier: 'prescription', img: '💊', ageGroup: 'Adult',
    description: 'Reduces stomach acid. Used for acidity, heartburn, acid reflux and stomach ulcers.',
    symptoms: ['acidity', 'heartburn', 'acid reflux', 'gas', 'stomach pain', 'ulcer', 'indigestion', 'gerd'],
    dose: '1 tablet once a day, 30 to 60 minutes before breakfast on an empty stomach. Swallow whole.',
    pills: 1, schedule: ['morning'], prn: false, meal: 'before', frequency: 'Once a day, before breakfast',
    byAge: {
      child: 'Not for children unless a doctor prescribes it.',
      adult: '1 tablet once a day before breakfast, for the period your doctor advises.',
      senior: 'Same dose. If you need it for months, ask your doctor to review it (long use can affect B12, magnesium and bones).',
    },
    cautions: ['Prescription medicine. Do not use for long periods without review.', 'See a doctor for black stools, vomiting blood or trouble swallowing.'],
    stores: ALL_STORES,
    alternatives: [
      generic('Pantocid 40', 'Sun Pharma', ['Same salt and strength', 'Widely stocked'], ['Needs a prescription']),
      generic('Pantoprazole 40 (Jan Aushadhi)', PMBJP, ['Usually much cheaper'], ['Needs a prescription', 'Stock varies']),
    ],
  },
  {
    id: 7, name: 'Uprise-D3 60K', generic: 'Cholecalciferol (Vitamin D3)', mg: 60000, unit: 'IU', form: 'Capsule', mfg: 'Alkem Laboratories',
    category: 'Vitamin D Supplement', rx: true, tier: 'care', img: '🟡', ageGroup: 'Adult',
    description: 'High-strength vitamin D3 used to treat low vitamin D, which can cause weak bones, tiredness and muscle pain.',
    symptoms: ['vitamin d deficiency', 'weak bones', 'bone pain', 'tiredness', 'muscle pain', 'osteoporosis', 'calcium'],
    dose: 'Usually 1 capsule once a week for the number of weeks your doctor advises.',
    pills: 1, schedule: ['morning'], prn: false, meal: 'after', frequency: 'Once a week (not daily)',
    byAge: {
      child: 'Dose for children is set by a doctor after a blood test.',
      adult: 'Usually 1 capsule once a week for 8 weeks, then as advised after a blood test.',
      senior: 'Same as adult. Too much vitamin D can raise calcium, so follow the doctor’s plan and test schedule.',
    },
    cautions: ['This is a WEEKLY capsule. Never take it daily.', 'Take with or after a meal that contains some fat.'],
    stores: ALL_STORES,
    alternatives: [
      generic('Calcirol', 'Cadila Pharmaceuticals', ['Same vitamin D3', 'Available as sachet'], ['Check strength carefully']),
    ],
  },
  {
    id: 8, name: 'Glycomet 500', generic: 'Metformin', mg: 500, form: 'Tablet', mfg: 'USV',
    category: 'Antidiabetic', rx: true, tier: 'prescription', img: '💊', ageGroup: 'Adult',
    description: 'First-line medicine for type 2 diabetes. It helps the body use insulin better and lowers blood sugar.',
    symptoms: ['diabetes', 'high blood sugar', 'type 2 diabetes', 'sugar', 'pcos'],
    dose: '1 tablet once or twice a day with or just after meals. Your doctor sets the exact dose.',
    pills: 1, schedule: ['morning', 'night'], prn: false, meal: 'after', frequency: 'Once or twice a day, with meals',
    byAge: {
      child: 'Only for children aged 10 and above, and only if a specialist prescribes it.',
      adult: 'Usually starts at 500 mg once or twice a day with meals. The doctor adjusts it slowly.',
      senior: 'Kidney function should be checked regularly. Dose is decided by your doctor.',
    },
    cautions: ['Prescription medicine. Never change the dose yourself.', 'Stop and call a doctor for severe vomiting, dehydration or unusual tiredness.', 'Tell your doctor before any scan using contrast dye.'],
    stores: ALL_STORES,
    alternatives: [
      generic('Metformin 500 (Jan Aushadhi)', PMBJP, ['Usually much cheaper'], ['Needs a prescription', 'Stock varies']),
    ],
  },
  {
    id: 9, name: 'Amlokind 5', generic: 'Amlodipine', mg: 5, form: 'Tablet', mfg: 'Mankind Pharma',
    category: 'Antihypertensive', rx: true, tier: 'prescription', img: '💊', ageGroup: 'Adult',
    description: 'Lowers high blood pressure and helps prevent chest pain (angina).',
    symptoms: ['high blood pressure', 'hypertension', 'bp', 'angina', 'chest pain'],
    dose: '1 tablet once a day at the same time every day, as prescribed.',
    pills: 1, schedule: ['morning'], prn: false, meal: 'any', frequency: 'Once a day',
    byAge: {
      child: 'Only for children aged 6 and above, and only if a specialist prescribes it.',
      adult: '5 mg once a day. The doctor may adjust the dose.',
      senior: 'Doctors often start with a lower dose (2.5 mg). Stand up slowly to avoid dizziness.',
    },
    cautions: ['Prescription medicine. Do not stop suddenly.', 'May cause ankle swelling, flushing or dizziness. Tell your doctor if it troubles you.'],
    stores: ALL_STORES,
    alternatives: [
      generic('Amlodac 5', 'Zydus Lifesciences', ['Same salt and strength'], ['Needs a prescription']),
      generic('Stamlo 5', 'Dr. Reddy’s', ['Same salt and strength'], ['Needs a prescription']),
    ],
  },
  {
    id: 10, name: 'Atorva 10', generic: 'Atorvastatin', mg: 10, form: 'Tablet', mfg: 'Zydus Lifesciences',
    category: 'Statin (Cholesterol)', rx: true, tier: 'prescription', img: '💊', ageGroup: 'Adult',
    description: 'Lowers “bad” LDL cholesterol and reduces the risk of heart attack and stroke.',
    symptoms: ['high cholesterol', 'cholesterol', 'heart disease', 'lipid', 'stroke prevention'],
    dose: '1 tablet once a day, at the same time every day, as prescribed.',
    pills: 1, schedule: ['night'], prn: false, meal: 'any', frequency: 'Once a day',
    byAge: {
      child: 'Only for specific conditions and only under a specialist.',
      adult: '10 mg once a day. The doctor may change the dose after a blood test.',
      senior: 'Usual dose. Report unexplained muscle pain or weakness quickly.',
    },
    cautions: ['Prescription medicine. Avoid in pregnancy.', 'Call a doctor for muscle pain, dark urine or yellow skin or eyes.'],
    stores: ALL_STORES,
    alternatives: [
      generic('Atorlip 10', 'Cipla', ['Same salt and strength'], ['Needs a prescription']),
      generic('Lipitor 10', 'Pfizer', ['Original brand'], ['Needs a prescription', 'Often costlier']),
    ],
  },
  {
    id: 11, name: 'Ecosprin 75', generic: 'Aspirin (low dose)', mg: 75, form: 'Tablet', mfg: 'USV',
    category: 'Antiplatelet (Blood Thinner)', rx: true, tier: 'prescription', img: '💊', ageGroup: 'Adult',
    description: 'Low-dose aspirin that makes blood less sticky. Used to lower the risk of heart attack and stroke in people your doctor selects.',
    symptoms: ['heart disease', 'stroke prevention', 'blood clot', 'angina', 'heart attack prevention'],
    dose: '1 tablet once a day after food, only if your doctor has prescribed it.',
    pills: 1, schedule: ['afternoon'], prn: false, meal: 'after', frequency: 'Once a day, after food',
    byAge: {
      child: 'Avoid in children and teenagers (risk of Reye’s syndrome).',
      adult: '75 mg once a day after food as prescribed.',
      senior: 'Higher risk of bleeding. Use only on your doctor’s advice and report black stools or unusual bruising.',
    },
    cautions: ['Prescription medicine. Do not start it on your own.', 'Do not combine with other pain killers like ibuprofen without asking a doctor.'],
    stores: ALL_STORES,
    alternatives: [
      generic('Aspirin 75 (Jan Aushadhi)', PMBJP, ['Usually much cheaper'], ['Needs a prescription', 'Stock varies']),
    ],
  },
  {
    id: 12, name: 'Emeset 4', generic: 'Ondansetron', mg: 4, form: 'Tablet', mfg: 'Cipla',
    category: 'Anti-nausea', rx: true, tier: 'prescription', img: '💊', ageGroup: 'Adult (child dose by weight)',
    description: 'Stops nausea and vomiting caused by infections, surgery or chemotherapy.',
    symptoms: ['nausea', 'vomiting', 'motion sickness', 'stomach flu', 'gastroenteritis'],
    dose: '1 tablet every 8 hours if needed, as prescribed.',
    pills: 1, schedule: ['morning', 'afternoon', 'night'], prn: true, meal: 'any', frequency: 'Every 8 hours, if needed',
    byAge: {
      child: 'Dose is based on body weight and chosen by a doctor.',
      adult: '4 mg every 8 hours if needed. The doctor may use 8 mg in some cases.',
      senior: 'Usual dose. Tell your doctor about heart rhythm problems or other medicines you take.',
    },
    cautions: ['Prescription medicine.', 'May cause constipation or headache. Seek help if vomiting lasts more than a day or you cannot keep fluids down.'],
    stores: ALL_STORES,
    alternatives: [
      generic('Vomikind 4', 'Mankind Pharma', ['Same salt and strength'], ['Needs a prescription']),
      generic('Ondem 4', 'Alkem Laboratories', ['Same salt and strength'], ['Needs a prescription']),
    ],
  },
];

/** Plain-language "commonly used for" lists shown on the card. Admins can edit them (stored as overrides). */
const USES = {
  1: ['Fever', 'Headache', 'Body ache', 'Toothache', 'Cold and flu aches'],
  2: ['Pain and swelling', 'Headache', 'Toothache', 'Muscle and joint pain', 'Period pain', 'Fever'],
  3: ['Throat infection', 'Chest infection', 'Ear infection', 'Skin infection', 'Sinus infection (bacterial)'],
  4: ['Ear infection', 'Throat infection', 'Chest infection', 'Urinary tract infection', 'Tooth infection'],
  5: ['Sneezing and runny nose', 'Itchy or watery eyes', 'Hives and itchy skin', 'Allergic rash'],
  6: ['Acidity', 'Heartburn', 'Acid reflux', 'Stomach ulcer', 'Indigestion'],
  7: ['Low vitamin D', 'Weak bones', 'Bone and muscle pain'],
  8: ['Type 2 diabetes', 'High blood sugar'],
  9: ['High blood pressure', 'Angina (heart-related chest pain)'],
  10: ['High cholesterol', 'Lowering risk of heart attack and stroke'],
  11: ['Lowering risk of heart attack', 'Lowering risk of stroke', 'Preventing blood clots'],
  12: ['Nausea', 'Vomiting', 'Nausea after surgery or chemotherapy'],
};
const INDIA_REGULATORY = {
  1: {
    category: 'K',
    label: 'Schedule K entry — paracetamol tablets',
    detail: 'The CDSCO 2016 Rules compilation lists paracetamol tablets among household remedies in Schedule K. This entry does not establish that every brand, strength or use is over the counter.',
  },
  2: {
    category: 'H',
    label: 'Schedule H entry — ibuprofen',
    detail: 'Ibuprofen is listed in Schedule H. Rule 65(9)(a) requires retail sale of Schedule H drugs on a Registered Medical Practitioner’s prescription.',
  },
  3: {
    category: 'H',
    label: 'Schedule H entry — antibiotics',
    detail: 'Antibiotics are listed in Schedule H. Rule 65(9)(a) requires retail sale of Schedule H drugs on a Registered Medical Practitioner’s prescription.',
  },
  4: {
    category: 'H',
    label: 'Schedule H entry — antibiotics',
    detail: 'Antibiotics are listed in Schedule H. Rule 65(9)(a) requires retail sale of Schedule H drugs on a Registered Medical Practitioner’s prescription.',
  },
  5: {
    category: 'H',
    label: 'Schedule H entry — cetirizine',
    detail: 'Cetirizine hydrochloride is listed in Schedule H. Rule 65(9)(a) requires retail sale of Schedule H drugs on a Registered Medical Practitioner’s prescription.',
  },
  6: {
    category: 'H',
    label: 'Schedule H entry — pantoprazole',
    detail: 'Pantoprazole is listed in Schedule H. Rule 65(9)(a) requires retail sale of Schedule H drugs on a Registered Medical Practitioner’s prescription.',
  },
  8: {
    category: 'G',
    label: 'Schedule G entry — metformin',
    detail: 'Metformin and its salts are listed in Schedule G. Rule 97 requires a medical-supervision caution on the label; this is distinct from the Schedule H retail-prescription rule.',
  },
  9: {
    category: 'H',
    label: 'Schedule H entry — amlodipine',
    detail: 'Amlodipine besylate is listed in Schedule H. Rule 65(9)(a) requires retail sale of Schedule H drugs on a Registered Medical Practitioner’s prescription.',
  },
  10: {
    category: 'H',
    label: 'Schedule H entry — atorvastatin',
    detail: 'Atorvastatin is listed in Schedule H. Rule 65(9)(a) requires retail sale of Schedule H drugs on a Registered Medical Practitioner’s prescription.',
  },
  11: {
    category: 'K',
    label: 'Schedule K entry — aspirin tablets',
    detail: 'The CDSCO 2016 Rules compilation lists aspirin tablets among household remedies in Schedule K. This entry does not establish that every brand, strength or use is over the counter.',
  },
};
SEED.forEach((m) => { m.uses = USES[m.id] || []; m.indianRegulatory = INDIA_REGULATORY[m.id] || null; });

/* ------------------------------------------------------------------ */
let source = SEED;
let remoteOv = null;      // server mode: site-wide overrides from the API (not persisted in the browser)
let medicines = [];
let byId = new Map();

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

function prepare(m, ov = {}) {
  const rec = { unit: 'mg', symptoms: [], uses: [], alternatives: [], cautions: [], schedule: [], stores: ALL_STORES, tier: m.rx ? 'prescription' : 'routine', ...m };
  if (Array.isArray(ov[m.id]?.uses)) rec.uses = ov[m.id].uses;
  Object.defineProperty(rec, '_name', { value: norm(`${rec.name} ${rec.generic || ''}`), enumerable: false });
  Object.defineProperty(rec, '_hay', {
    value: norm([rec.name, rec.generic, rec.mfg, rec.category, rec.description, rec.symptoms.join(' '), rec.uses.join(' ')].join(' ')),
    enumerable: false,
  });
  return rec;
}

function build(list) {
  source = list;
  const ov = remoteOv ?? store.get(KEYS.medOverrides, {});
  medicines = list.map((m) => prepare(m, ov));
  byId = new Map(medicines.map((m) => [m.id, m]));
}
build(SEED);

/** NFR-2.3 / NFR-7.1: merge an optional bigger dataset; silently keeps the seed data if it is missing. */
export async function loadExtra(url = 'data/medicines.json') {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return 0;
    const extra = await res.json();
    if (!Array.isArray(extra)) return 0;
    const known = new Set(SEED.map((m) => m.id));
    const clean = extra.filter((m) => m && m.id != null && !known.has(m.id) && m.name && m.mfg && m.dose && m.category && m.cdscoApproved !== false);
    if (clean.length) build([...SEED, ...clean]);
    return clean.length;
  } catch { return 0; }
}

/** Admin: replace the "commonly used for" list of one medicine. Returns the cleaned list. */
/** Server mode: install the site-wide overrides fetched from /api/medicines/uses. */
export function applyRemoteUses(map) {
  remoteOv = Object.fromEntries(Object.entries(map || {}).map(([id, uses]) => [id, { uses }]));
  build(source);
}
export function setRemoteUse(id, uses) {
  remoteOv ||= {};
  if (uses) remoteOv[id] = { uses }; else delete remoteOv[id];
  build(source);
}
export function setUses(id, list) {
  const clean = [...new Set((Array.isArray(list) ? list : []).map((x) => String(x).trim().slice(0, 60)).filter(Boolean))].slice(0, 10);
  if (remoteOv) return clean;
  const ov = store.get(KEYS.medOverrides, {});
  ov[id] = { uses: clean };
  store.set(KEYS.medOverrides, ov);
  build(source);
  return clean;
}
export function resetUses(id) {
  const ov = store.get(KEYS.medOverrides, {});
  delete ov[id];
  store.set(KEYS.medOverrides, ov);
  build(source);
}
export const hasUsesOverride = (id) => Boolean((remoteOv ?? store.get(KEYS.medOverrides, {}))[id]);

export const getAll = () => medicines;
export const getById = (id) => byId.get(Number(id));
export const categories = () => [...new Set(medicines.map((m) => m.category))].sort();

export function companies() {
  const info = new Map(COMPANIES.map((c) => [c.name, c]));
  const counts = new Map();
  medicines.forEach((m) => counts.set(m.mfg, (counts.get(m.mfg) || 0) + 1));
  return [...counts].map(([name, count]) => ({ ...(info.get(name) || { name, country: 'India', founded: null, hq: null, cdscoApproved: true }), count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export const getCompany = (name) => companies().find((c) => c.name === name);

/**
 * FR-1.2/1.3/1.6: case-insensitive partial match over name, generic, manufacturer, category,
 * description and symptoms. Every word of the query must match somewhere. Ranked: name hits first.
 */
export function search(query = '', { category = '', company = '' } = {}) {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  const scored = [];
  for (const m of medicines) {
    if (category && m.category !== category) continue;
    if (company && m.mfg !== company) continue;
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      if (m._name.startsWith(t)) score += 4;
      else if (m._name.includes(t)) score += 3;
      else if (m._hay.includes(t)) {
        const i = m.symptoms.findIndex((x) => norm(x).startsWith(t));
        score += i >= 0 ? 2 - Math.min(i, 5) * 0.1 : 1;   // symptom hits outrank loose text hits
      } else { ok = false; break; }
    }
    if (ok) scored.push([score, m]);
  }
  if (!tokens.length) return scored.map(([, m]) => m);          // browsing: keep curated dataset order
  return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).map(([, m]) => m);
}

export { SLOTS };
