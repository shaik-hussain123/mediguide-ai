# API Specification

## Authentication Endpoints

| Endpoint | Method | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `/api/auth/register` | POST | Register a new user | No |
| `/api/auth/login` | POST | Login and receive access token | No |
| `/api/auth/logout` | POST | Logout current user | Yes |
| `/api/auth/me` | GET | Get current user info | Yes |
| `/api/auth/refresh` | POST | Refresh access token | Yes |

## Admin Integration Settings

| Endpoint | Method | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `/api/admin/ai` | PUT | Save/remove the Gemini API key and AI model | Admin |
| `/api/admin/oauth` | GET | Read OAuth credential status and callback URL (never returns secrets) | Admin |
| `/api/admin/oauth` | PUT | Save/remove Google OAuth client credentials and callback URL | Admin |

The Gemini API key is required for the AI assistant. Google OAuth credentials are optional and enable Google sign-in. Nearby location uses browser geolocation, OpenStreetMap tiles, and Overpass; these do not require API keys.

## Medication Tracker Endpoints

| Endpoint | Method | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `/api/schedules` | POST | Create medication schedule | Yes |
| `/api/schedules` | GET | List medication schedules | Yes |
| `/api/schedules/{id}` | GET | Get specific schedule | Yes |
| `/api/schedules/{id}` | PUT | Update schedule | Yes |
| `/api/schedules/{id}` | DELETE | Delete schedule | Yes |
| `/api/schedules/{id}/log`| POST | Log dose activity | Yes |
| `/api/health/summary` | GET | Return the signed-in patient's own profile summary, medication activity, appointment counts, and reminder count | Patient |
| `/api/health/report-shares` | POST | Create a one-day encrypted snapshot link for selected report sections | Patient |
| `/api/health/report-shares` | GET | List the patient's active and revoked report links | Patient |
| `/api/health/report-shares/{id}` | DELETE | Revoke a report link immediately | Patient |
| `/api/health/shared-report/access` | POST | Read a shared report using its bearer token | No login; token required |

The health summary covers the most recent 30 days of dose logs. An adherence value is `null` when no doses have been logged; it is not a clinical risk score.
Share links show only the selected sections, expire after 24 hours, and can be revoked by the patient. The token is returned only when the link is created; the database stores its hash and an encrypted report snapshot. Anyone with the link can view it until it expires or is revoked.

Nearby healthcare searches use a public OpenStreetMap Overpass instance, with `overpass.private.coffee` as a failover when the primary is busy. Results are cached for five minutes and requests are limited per client IP. The selected location may be sent to either instance.

## Appointments and Doctor Accounts

| Endpoint | Method | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `/api/admin/doctors` | POST | Create a doctor profile and login from an admin-provided initial password | Admin |
| `/api/admin/appointments?view=upcoming|all` | GET | List upcoming or all appointments with patient details | Admin |
| `/api/admin/appointments` | POST | Book an appointment for a patient | Admin |
| `/api/admin/appointments/{id}` | PUT | Reschedule an appointment | Admin |
| `/api/admin/appointments/{id}` | DELETE | Cancel an appointment | Admin |
| `/api/doctor/appointments` | GET | List all appointments; visit links and updates are limited to the assigned doctor | Doctor |
| `/api/doctor/appointments/{id}` | PATCH | Mark an assigned appointment completed or cancel an upcoming one | Assigned Doctor |

Doctors can view all appointments, as configured, but can change status only for appointments assigned to their profile. Passwords are hashed and never returned. Patient analytics and reports are private to the signed-in patient; PDF output is prepared locally through the browser's print dialog. Shared report links are bearer links with a 24-hour expiry and revocation.

## Adverse Drug Reaction (ADR) Endpoints

| Endpoint | Method | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `/api/adr` | POST | Report an ADR | Yes |
| `/api/adr` | GET | List ADR reports | Yes |
| `/api/adr/stats` | GET | ADR statistics | Yes |
| `/api/adr/{id}` | PUT | Update ADR report | Yes |
| `/api/adr/{id}` | DELETE | Delete ADR report | Yes |

## Safety Endpoints (Phase 2)

| Endpoint | Method | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `/api/safety/dosage-check` | POST | Perform single medication dosage check | Yes |
| `/api/safety/score` | POST | Generate overall medication safety score | Yes |
| `/api/interactions/check` | POST | Check drug-drug interactions | Yes |

## Emergency Endpoints

| Endpoint | Method | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `/api/emergency/profile` | POST | Save emergency profile | Yes |
| `/api/emergency/profile` | GET | Get emergency profile | Yes |
| `/api/emergency/qr` | GET | Generate emergency QR | Yes |
| `/api/emergency/view/{email}` | GET | Public emergency view | No |

## Health & Places Endpoints

| Endpoint | Method | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `/api/symptom-check` | POST | Record symptoms | Optional |
| `/api/places/geocode?q={query}` | GET | Search for a location by area or PIN code (OpenStreetMap Nominatim) | No |
| `/api/places/nearby` | GET | Find nearby facility | Optional |
| `/api/prescription/analyze` | POST | Analyze prescription | No |

Manual location search is limited to India and returns up to five matches. Queries are sent to OpenStreetMap Nominatim; repeated searches are briefly cached and requests are rate-limited.

Nearby searches use Overpass API and retry temporary capacity/network failures with exponential backoff (up to two retries).

## Rate Limiting
- Auth endpoints: 5 requests/minute
- API endpoints: 60 requests/minute
- Safety endpoints: 60 requests/minute
- Interaction endpoints: 60 requests/minute

## Response Standard
All responses follow the `APIResponse` model (see `backend/response_models.py`):
```json
{
  "success": true,
  "data": {...},
  "message": "...",
  "timestamp": "..."
}
```
Error responses:
```json
{
  "success": false,
  "error": "...",
  "status_code": 400,
  "timestamp": "..."
}
```

## Phase 2 Response Format

Phase 2 endpoints wrap responses in the standard format:
```json
{
  "success": true,
  "data": {
    // endpoint-specific response
  },
  "message": "Success message",
  "timestamp": "2026-11-19T12:00:00.000000"
}
```

## Validation Rules

### Dosage Check Request
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| med_id | int | Yes | Positive integer |
| dosage | float | Yes | Greater than 0 |
| frequency | string | No | One of: OD, BD, TDS, QID, Q8H, Q12H, HS (default: OD) |
| patient | object | No | Age: 0-120, weight: positive, conditions: array |

### Safety Score Request
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| med_ids | [int] | Yes | 1-10 medication IDs, positive integers |
| patient | object | No | Same as dosage check |

### Interaction Check Request
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| med_ids | [int] | Yes | 2-10 medication IDs (minimum 2 for interaction check) |
| patient | object | No | Same as dosage check |

## Request/Response Models

### Dosage Check Request
```json
{
  "med_id": 1,
  "dosage": 500.0,
  "frequency": "OD",
  "patient": {
    "age": 30,
    "weight_kg": 70,
    "is_pregnant": false,
    "conditions": [],
    "current_medications": []
  }
}
```

### Dosage Check Response
```json
{
  "med_name": "Paracetamol",
  "input_dosage": 500.0,
  "unit": "mg",
  "frequency": "OD",
  "daily_exposure": 500.0,
  "reference_min": 100.0,
  "reference_max": 2000.0,
  "risk_level": "CAUTION",
  "overallClinicalSeverity": "LOW",
  "findings": [],
  "safety_notes": [],
  "warnings": [],
  "evidence": {...},
  "disclaimer": "..."
}
```

### Safety Score Request
```json
{
  "med_ids": [1, 2, 3],
  "patient": {
    "age": 65,
    "weight_kg": 70,
    "is_pregnant": false,
    "conditions": ["hypertension"],
    "current_medications": ["metoprolol"]
  }
}
```

### Safety Score Response
```json
{
  "score": 75.5,
  "risk_category": "MODERATE",
  "gauge_color": "var(--warn)",
  "total_medications": 3,
  "total_findings": 5,
  "severity_breakdown": {
    "LOW": 2,
    "MODERATE": 2,
    "HIGH": 1,
    "CRITICAL": 0
  },
  "assessments": [...],
  "top_concerns": [...]
}
```

### Interaction Check Request
```json
{
  "med_ids": [1, 2, 3],
  "patient": {
    "age": 65,
    "weight_kg": 70,
    "is_pregnant": false,
    "conditions": ["hypertension"],
    "current_medications": []
  }
}
```

### Interaction Check Response
```json
{
  "interactions": [
    {
      "med_a": "Paracetamol",
      "med_b": "Warfarin",
      "severity": "Major",
      "description": "Increased bleeding risk",
      "recommendation": "Monitor INR closely"
    }
  ],
  "total_interactions": 1,
  "severity_breakdown": {
    "Minor": 0,
    "Moderate": 0,
    "Major": 1,
    "Contraindicated": 0
  },
  "highest_severity": "Major",
  "total_medications_checked": 3,
  "timestamp": "2026-11-18T00:00:00.000000"
}
```