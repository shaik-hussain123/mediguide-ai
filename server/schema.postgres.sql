-- PostgreSQL equivalent of schema.sql (SRS §12.3 names PostgreSQL). NOT executed in the build environment:
-- the running server uses SQLite via node:sqlite. Port db.js to `pg` ($1 placeholders) to use this file.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY, email CITEXT NOT NULL UNIQUE, name TEXT NOT NULL, pw_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','doctor')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  totp_secret TEXT, totp_enabled BOOLEAN NOT NULL DEFAULT false, oauth_sub TEXT,
  lang TEXT NOT NULL DEFAULT 'en', age SMALLINT, weight NUMERIC(5,1), conditions TEXT DEFAULT '', allergies TEXT DEFAULT '',
  abha_number TEXT, abha_address TEXT
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, revoked BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS med_uses (med_id INTEGER PRIMARY KEY, uses JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS doctors (
  id UUID PRIMARY KEY, name TEXT NOT NULL, speciality TEXT NOT NULL, languages TEXT[] NOT NULL, modes TEXT[] NOT NULL, bio TEXT NOT NULL DEFAULT '',
  user_id UUID UNIQUE REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES doctors(id), start_at TIMESTAMPTZ NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('video','clinic')),
  reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'booked', room TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_appt_slot ON appointments(doctor_id, start_at) WHERE status = 'booked';
CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  medicine TEXT NOT NULL, dose TEXT NOT NULL DEFAULT '', times TEXT[] NOT NULL, start_date DATE NOT NULL,
  days INTEGER, notes TEXT NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit (
  id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), user_id UUID, event TEXT NOT NULL, detail TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS adverse_events (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  medication TEXT NOT NULL, reaction TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('Mild','Moderate','Severe','Critical')),
  start_date DATE NOT NULL, end_date DATE, description TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_adverse_events_user ON adverse_events(user_id);
