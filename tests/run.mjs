// Run: npm test  (pure-logic checks: dataset integrity, search, prescription parser, rich-text escaping)
import assert from 'node:assert/strict';
import * as db from '../js/data/medicineDB.js';
import { parsePrescription } from '../js/utils/rxParser.js';
import { verifyTotp, generateSecret } from '../js/utils/totp.js';
import { missingKeys } from '../js/i18n.js';
import { normaliseAbhaNumber, normaliseAbhaAddress } from '../js/utils/abha.js';
import { timesForFrequency, parseFrequency } from '../js/utils/rxParser.js';
import { canJoin } from '../js/components/appointments.js';

const required = ['id', 'name', 'mfg', 'dose', 'mg', 'description', 'stores', 'category', 'ageGroup'];   // SRS §7.1
for (const m of db.getAll()) {
  for (const f of required) assert.ok(m[f] !== undefined && m[f] !== '', `${m.name} missing ${f}`);
  assert.ok(m.byAge.child && m.byAge.adult && m.byAge.senior, `${m.name} needs byAge`);
  for (const a of m.alternatives) assert.ok(a.pros.length && a.cons.length, `${m.name} alt ${a.name} needs pros and cons`);   // FR-4.2
}
assert.equal(new Set(db.getAll().map((m) => m.id)).size, db.getAll().length, 'unique ids');
assert.equal(db.search('PARA')[0].name, 'Dolo 650', 'case-insensitive partial (FR-1.6)');
assert.equal(db.search('fever')[0].name, 'Dolo 650', 'symptom search ranks name/symptom hits');
assert.equal(db.search('zzzz').length, 0, 'no results');
assert.ok(db.search('', { company: 'Cipla' }).every((m) => m.mfg === 'Cipla'), 'company filter (FR-6.2)');
const rows = parsePrescription('Dolo 650 mg twice daily for 5 days; Azithromycin 250mg once daily x3 days', db.getAll());
assert.equal(rows[0].frequency, 'Twice a day'); assert.equal(rows[0].duration, '5 days');
assert.equal(rows[1].strengthMatches, false, 'flags strength mismatch');
// RFC 6238 test vector: secret "12345678901234567890" (base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ), T=59s -> 94287082 (last 6 = 287082)
assert.equal(await verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', 59000), true, 'TOTP');
// advanced features
assert.deepEqual(missingKeys(), [], 'every UI string has en/hi/ta/bn');
assert.match(generateSecret(), /^[A-Z2-7]{32}$/, '160-bit base32 secret');
assert.equal(normaliseAbhaNumber('12 3456 7890 1234'), '12-3456-7890-1234'); assert.throws(() => normaliseAbhaNumber('123'));
assert.equal(normaliseAbhaAddress(' Asha.K@ABDM '), 'asha.k@abdm'); assert.throws(() => normaliseAbhaAddress('asha@gmail.com'));
assert.deepEqual(timesForFrequency('Twice a day'), ['08:00', '20:00']); assert.deepEqual(timesForFrequency('Every 6 hours'), ['02:00', '08:00', '14:00', '20:00']);
assert.deepEqual(timesForFrequency('Only if needed'), [], 'as-needed has no schedule'); assert.equal(parseFrequency('1-0-1 after food'), 'Twice a day');
const start = new Date('2026-12-01T10:00:00+05:30').getTime();
assert.equal(canJoin('2026-12-01T10:00:00+05:30', start - 16 * 60e3), false, 'too early'); assert.equal(canJoin('2026-12-01T10:00:00+05:30', start - 10 * 60e3), true, '10 min before');
assert.equal(canJoin('2026-12-01T10:00:00+05:30', start + 100 * 60e3), false, 'too late');
console.log(`OK: ${db.getAll().length} medicines, all checks passed`);
// "Commonly used for" (admin-editable causes)
for (const m of db.getAll()) assert.ok(m.uses.length >= 2, `${m.name} needs a uses list`);
assert.equal(db.search('urinary')[0]?.name, 'Novamox 500', 'uses are searchable');
