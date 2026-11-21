# API Specification

## Authentication Endpoints

| Endpoint | Method | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `/api/auth/register` | POST | Register a new user | No |
| `/api/auth/login` | POST | Login and receive access token | No |
| `/api/auth/logout` | POST | Logout current user | Yes |
| `/api/auth/me` | GET | Get current user info | Yes |
| `/api/auth/refresh` | POST | Refresh access token | Yes |

## Medication Tracker Endpoints

| Endpoint | Method | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `/api/schedules` | POST | Create medication schedule | Yes |
| `/api/schedules` | GET | List medication schedules | Yes |
| `/api/schedules/{id}` | GET | Get specific schedule | Yes |
| `/api/schedules/{id}` | PUT | Update schedule | Yes |
| `/api/schedules/{id}` | DELETE | Delete schedule | Yes |
| `/api/schedules/{id}/log`| POST | Log dose activity | Yes |

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
| `/api/places/nearby` | GET | Find nearby facility | Optional |
| `/api/prescription/analyze` | POST | Analyze prescription | No |

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