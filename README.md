# MediGuide AI · Smart Medicine Assistant

Elderly-friendly medicine information for India: CDSCO-approved medicine search, dosage visuals, a multimodal
Gemini assistant, English/Hindi/Tamil/Bengali interface, voice-first mode, medicine reminders, doctor
appointments with video consultation links, prescription reading, ABHA linking, installable offline PWA.
Implements `MediGuide_AI_SRS_1.docx` including the §12.3 future-enhancement list. Node 22+, **no npm dependencies**.

## Run

```
npm start            # http://localhost:5600  (server + front-end, "server mode")
npm run make-admin -- you@example.com     # after registering in the app
npm test             # unit + 107 server integration assertions (fake Gemini + fake OAuth provider)
npm run static       # front-end only on :5500 ("local mode": no accounts/appointments server)
```

Open the app, register, make yourself admin with the command above, then **Admin → API Key** and paste a free Gemini key
from https://aistudio.google.com. The key is stored encrypted on the server and never reaches browsers.

Two modes, chosen automatically (`/api/health`): **server mode** (everything below) and **local mode** (static hosting:
browser-only demo accounts, admin-entered key in that browser, local reminders; no appointments).

## Advanced features (SRS §12.3)

| Item | Status | Where |
|---|---|---|
| Backend API (Node.js) | Done: 31 endpoints, zero dependencies | `server/` |
| PostgreSQL | **Schema provided, not run.** The server uses SQLite (`node:sqlite`); port `server/lib/db.js` to `pg` | `server/schema.postgres.sql` |
| OAuth2 + JWT | Done: JWT access (15 min) + rotating HttpOnly refresh cookie with reuse detection; OAuth2 code flow + PKCE. **OAuth tested against a simulated provider only**, not live Google | `server/routes/auth.js` |
| 2FA | Done: TOTP (RFC 6238) enrolment and login in the UI | profile modal |
| Multi-language | UI + AI replies in hi/ta/bn. **Medicine facts stay English; translations need native/clinical review** | `js/i18n.js` |
| Voice-first | Done: voice search, dictation, read-aloud, Voice Mode (auto-read, auto-send). Needs a browser with speech support and language voices | `js/services/voice.js` |
| Prescription OCR | Done via Gemini vision → structured table → one-tap reminders. Not benchmarked on real handwriting | `js/components/scanner.js` |
| PWA / offline | Done for static assets and bundled data. **No Web Push** | `sw.js` |
| Medicine reminders | Done (server-synced when logged in). **Alerts fire while the app is open** | `js/components/reminders.js` |
| ABHA | Number/address **format check and storage only**. No ABDM verification (needs NHA registration and credentials) | `js/utils/abha.js` |
| Doctor appointments | Done with **fictional sample doctors**, slot rules, double-booking protection. Video = third-party meet.jit.si link. No payments or doctor portal | `js/components/appointments.js` |

## Security summary

Scrypt password hashing · JWT HS256 with algorithm pinning · refresh rotation + reuse detection · TOTP 2FA · AES-256-GCM
for the stored API key · rate limiting (login, AI, booking, global) · strict CSP (no inline scripts) · no API caching in the
service worker · path-traversal-safe static server · input validation on every route · audit log without message content ·
AI key never sent to browsers · consent before any data goes to Gemini.

## Before real users

1. Have a pharmacist verify every medicine, dose and alternative against CDSCO/label data.
2. Replace sample doctors with verified practitioners; add proper consent, payment and clinical-record rules.
3. Serve over HTTPS with `NODE_ENV=production`; set `JWT_SECRET` and `SERVER_SECRET`.
4. Get translations reviewed; run Lighthouse and real-device tests (not measured here).
5. This is an information tool, not a medical device. Emergency: 112.
