-- SQLite schema (used by server/lib/db.js). PostgreSQL version: schema.postgres.sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pw_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL,
  totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, oauth_sub TEXT,
  lang TEXT NOT NULL DEFAULT 'en', age INTEGER, weight REAL, conditions TEXT DEFAULT '', allergies TEXT DEFAULT '',
  abha_number TEXT, abha_address TEXT
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS med_uses (med_id INTEGER PRIMARY KEY, uses TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS doctors (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, speciality TEXT NOT NULL, languages TEXT NOT NULL, modes TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '',
  user_id TEXT REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES doctors(id), start_at TEXT NOT NULL, mode TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'booked', room TEXT, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_appt_slot ON appointments(doctor_id, start_at) WHERE status = 'booked';
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  medicine TEXT NOT NULL, dose TEXT NOT NULL DEFAULT '', times TEXT NOT NULL, start_date TEXT NOT NULL,
  days INTEGER, notes TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id TEXT, event TEXT NOT NULL, detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS report_shares (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, report_payload TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_report_shares_user ON report_shares(user_id);

CREATE TABLE IF NOT EXISTS medication_schedules (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  med_id INTEGER NOT NULL, med_name TEXT NOT NULL, dosage TEXT NOT NULL,
  times TEXT NOT NULL, days TEXT NOT NULL, start_date TEXT NOT NULL,
  end_date TEXT, notes TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_med_schedules_user ON medication_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_med_schedules_active ON medication_schedules(user_id, active);

CREATE TABLE IF NOT EXISTS medication_logs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule_id TEXT NOT NULL, scheduled_time TEXT NOT NULL, status TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '', logged_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_med_logs_user ON medication_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_med_logs_schedule ON medication_logs(schedule_id);
CREATE INDEX IF NOT EXISTS idx_med_logs_time ON medication_logs(scheduled_time);

CREATE TABLE IF NOT EXISTS adverse_events (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  medication TEXT NOT NULL, reaction TEXT NOT NULL, severity TEXT NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT, description TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_adverse_events_user ON adverse_events(user_id);
