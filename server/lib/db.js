/** SQLite access via node:sqlite (built in to Node 22). Thin helpers keep SQL portable to PostgreSQL. */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { uuid } from './security.js';

let db;
export function openDb(file = config.dbFile) {
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8'));
  seedDoctors();
  return db;
}
export const get = (sql, ...p) => db.prepare(sql).get(...p) ?? null;
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export const now = () => new Date().toISOString();

export function audit(userId, event, detail = '') {
  run('INSERT INTO audit (at, user_id, event, detail) VALUES (?,?,?,?)', now(), userId || null, event, String(detail).slice(0, 200));
}
export const getSetting = (k) => get('SELECT value FROM settings WHERE key = ?', k)?.value ?? null;
export const setSetting = (k, v) => run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v);
export const delSetting = (k) => run('DELETE FROM settings WHERE key = ?', k);

/** Fictional sample doctors so booking can be demonstrated. Replace with real, verified practitioners. */
function seedDoctors() {
  if (get('SELECT COUNT(*) AS n FROM doctors').n) return;
  const docs = [
    ['Dr. Ananya Rao (sample)', 'General Physician', ['English', 'Hindi', 'Kannada'], ['video', 'clinic'], 'Fever, cold, everyday health questions and medicine reviews.'],
    ['Dr. Karthik Raman (sample)', 'Diabetologist', ['English', 'Tamil'], ['video'], 'Blood sugar, diet and medicine planning for type 2 diabetes.'],
    ['Dr. Sudipta Sen (sample)', 'Cardiologist', ['English', 'Bengali', 'Hindi'], ['video', 'clinic'], 'Blood pressure, cholesterol and heart health.'],
    ['Dr. Meera Iyer (sample)', 'Geriatrician', ['English', 'Tamil', 'Hindi'], ['video', 'clinic'], 'Care for adults aged 60 and above, including medicine safety.'],
  ];
  for (const [name, spec, langs, modes, bio] of docs) {
    run('INSERT INTO doctors (id, name, speciality, languages, modes, bio) VALUES (?,?,?,?,?,?)', uuid(), name, spec, JSON.stringify(langs), JSON.stringify(modes), bio);
  }
}
