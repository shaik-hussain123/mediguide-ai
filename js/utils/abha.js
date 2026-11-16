/** ABHA (Ayushman Bharat Health Account) format checks. Format only: NOT verified with ABDM/NHA. */
export function normaliseAbhaNumber(v) {
  const d = String(v || '').replace(/[\s-]/g, '');
  if (!d) return '';
  if (!/^\d{14}$/.test(d)) throw new Error('ABHA number must have 14 digits (XX-XXXX-XXXX-XXXX).');
  return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10)}`;
}
export function normaliseAbhaAddress(v) {
  const a = String(v || '').trim().toLowerCase();
  if (!a) return '';
  if (!/^[a-z0-9._]{4,32}@(abdm|sbx)$/.test(a)) throw new Error('ABHA address looks like name@abdm.');
  return a;
}
