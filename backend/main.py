import os
import uuid
import re
import logging
import jwt
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException, UploadFile, File, Request, Depends, status, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.base import BaseHTTPMiddleware
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, Field

from .models.safety import DosageRequest, SafetyScoreRequest
from .safety_engine import DosageSafetyEngine
from .database import (
    initialize_database, run_migrations, validate_all_documents,
    seed_emergency_blood_groups, seed_pregnancy_categories,
    seed_interaction_severities, seed_adr_severities, seed_adr_statuses,
    seed_risk_levels, seed_clinical_severities
)
from .utils.rate_limiter import auth_limiter, rate_limit_exceeded_handler
from .utils.audit_logger import audit_logger, setup_audit_logger
from .response_models import APIResponse
from .validators import validate_password_strength

# Import shared dependencies (breaks circular import)
from .api.deps import (
    init_db, log_audit, get_current_user, get_current_user_optional,
    require_admin, hash_password, verify_password, create_access_token,
    MEDICINES, MEDICINES_BY_ID, COMPANIES
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

safety_engine = DosageSafetyEngine()


# ── Security Configuration ──────────────────────────────────────────────────
load_dotenv()

# JWT Security - Must be set via environment, minimum 32 bytes for HS256
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    logger.error("FATAL: SECRET_KEY environment variable is required but not set!")
    raise RuntimeError("SECRET_KEY environment variable is required")
if len(SECRET_KEY) < 32:
    logger.error(f"FATAL: SECRET_KEY must be at least 32 characters for HS256, got {len(SECRET_KEY)}")
    raise RuntimeError("SECRET_KEY must be at least 32 characters for HS256")

ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "mediguide_db")

# CORS Configuration
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8000").split(",")

# File Upload Configuration
MAX_UPLOAD_SIZE = int(os.getenv("MAX_UPLOAD_SIZE", "10485760"))  # 10MB default
MAX_JSON_SIZE = int(os.getenv("MAX_JSON_SIZE", "1048576"))  # 1MB default

# Allowed file extensions for prescription uploads
ALLOWED_PRESCRIPTION_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

# Allowed content types for validation
ALLOWED_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_PRESCRIPTION_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}

# Blocked extensions (executables, scripts)
BLOCKED_EXTENSIONS = {".exe", ".bat", ".cmd", ".com", ".pif", ".scr", ".vbs", ".js", ".jar", ".php", ".asp", ".aspx", ".jsp", ".sh", ".py", ".pl", ".rb"}

# Security Headers CSP
CSP_POLICY = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:; font-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https://overpass-api.de; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

# ── Database & Auth Setup ───────────────────────────────────────────────────
client = AsyncIOMotorClient(MONGODB_URL)
db = client[DATABASE_NAME]
users_collection = db["users"]
audit_collection = db["audit_logs"]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

async def log_audit(action: str, user: str = "anonymous", resource: str = ""):
    audit_entry = {
        "action": action,
        "user": user,
        "resource": resource,
        "timestamp": datetime.utcnow().isoformat(),
    }
    await audit_collection.insert_one(audit_entry)

setup_audit_logger(db)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")

    user = await users_collection.find_one({"email": email})
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    user["_id"] = str(user["_id"])
    return user

async def get_current_user_optional(request: Request) -> Optional[dict]:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth.replace("Bearer ", "").strip()
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email:
            user = await users_collection.find_one({"email": email})
            if user:
                user["_id"] = str(user["_id"])
                return user
    except Exception:
        pass
    return None

def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user

# ── Security Headers Middleware ─────────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = CSP_POLICY
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


# ── Request Size Limit Middleware ───────────────────────────────────────────
class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, max_json_size: int = MAX_JSON_SIZE, max_upload_size: int = MAX_UPLOAD_SIZE):
        super().__init__(app)
        self.max_json_size = max_json_size
        self.max_upload_size = max_upload_size

    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        content_type = request.headers.get("content-type", "")

        if content_length:
            cl = int(content_length)
            if "multipart/form-data" in content_type:
                if cl > MAX_UPLOAD_SIZE:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": f"File upload exceeds maximum size of {MAX_UPLOAD_SIZE} bytes"}
                    )
            elif cl > MAX_JSON_SIZE:
                return JSONResponse(
                    status_code=413,
                    content={"detail": f"Request body exceeds maximum size of {MAX_JSON_SIZE} bytes"}
                )

        response = await call_next(request)
        return response


# ── App ─────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="MediGuide AI API",
    description="India's CDSCO-approved medicine information system",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── Security Middleware (order matters - applied last = executed first) ──────
app.add_middleware(RequestSizeLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

# ── Rate Limiting ────────────────────────────────────────────────────────────
app.state.limiter = auth_limiter
app.add_exception_handler(429, rate_limit_exceeded_handler)

# ── CORS ────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ── Phase 2 API Routes ────────────────────────────────────────────────────────
from .api.routes import dosage, interactions
app.include_router(dosage.router, prefix="")
app.include_router(interactions.router, prefix="")

# ── Upload directories ───────────────────────────────────────────────────────
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
(UPLOAD_DIR / "medicine_images").mkdir(exist_ok=True)
(UPLOAD_DIR / "prescriptions").mkdir(exist_ok=True)

FRONTEND_DIR = Path(__file__).parent.parent

# Medicine dataset (12 CDSCO-approved medicines) imported from api.deps
# MEDICINES, MEDICINES_BY_ID, COMPANIES are now in api.deps

# ── Pydantic models ──────────────────────────────────────────────────────────


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    consent: bool


class LoginRequest(BaseModel):
    email: str
    password: str

class PrescriptionAnalyzeRequest(BaseModel):
    text: str
    med_id: Optional[int] = None
    dosage: Optional[float] = None
    frequency: Optional[str] = None


class ChatRequest(BaseModel):
    message: str
    medicine_context: Optional[str] = None


class MedicineCreateRequest(BaseModel):
    name: str
    generic_name: str
    active_ingredient: str
    strength: str
    dosage_form: str
    mfg: str
    category: str
    description: str
    regulatory_status: str = "APPROVED"

class SymptomCheckRequest(BaseModel):
    symptoms: List[str]
    duration_days: int
    severity: str  # mild, moderate, severe

# ── Medication Reminders (Feature 5) ──────────────────────────────────────────


class ReminderCreateRequest(BaseModel):
    medicine: str
    dose: Optional[str] = ""
    times: List[str]  # ["08:00", "14:00"]
    start_date: str
    days: Optional[int] = None


class ReminderUpdateRequest(BaseModel):
    active: Optional[bool] = None
    times: Optional[List[str]] = None
    days: Optional[int] = None


@app.post("/api/reminders", tags=["Reminders"])
async def create_reminder(req: ReminderCreateRequest, current_user: dict = Depends(get_current_user)):
    """Create a new medication reminder."""
    reminder_doc = {
        "user_email": current_user["email"],
        "medicine": req.medicine,
        "dose": req.dose,
        "times": req.times,
        "start_date": req.start_date,
        "days": req.days,
        "active": True,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    result = await db["reminders"].insert_one(reminder_doc)
    reminder_doc["_id"] = str(result.inserted_id)
    await log_audit("REMINDER_CREATE", current_user["email"], f"Med: {req.medicine}")
    return {"reminder": reminder_doc, "message": "Reminder created successfully"}


@app.get("/api/reminders", tags=["Reminders"])
async def list_reminders(current_user: dict = Depends(get_current_user)):
    """List all reminders for the current user."""
    reminders = []
    async for doc in db["reminders"].find({"user_email": current_user["email"]}).sort("created_at", -1):
        doc["_id"] = str(doc["_id"])
        reminders.append(doc)
    return {"reminders": reminders, "total": len(reminders)}


@app.put("/api/reminders/{reminder_id}", tags=["Reminders"])
async def update_reminder(reminder_id: str, req: ReminderUpdateRequest, current_user: dict = Depends(get_current_user)):
    """Update a reminder."""
    from bson import ObjectId
    try:
        oid = ObjectId(reminder_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reminder ID")

    update_data = {k: v for k, v in req.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.utcnow().isoformat()

    result = await db["reminders"].update_one(
        {"_id": oid, "user_email": current_user["email"]},
        {"$set": update_data}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Reminder not found")

    await log_audit("REMINDER_UPDATE", current_user["email"], f"Reminder: {reminder_id}")
    return {"message": "Reminder updated successfully"}


@app.delete("/api/reminders/{reminder_id}", tags=["Reminders"])
async def delete_reminder(reminder_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a reminder."""
    from bson import ObjectId
    try:
        oid = ObjectId(reminder_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reminder ID")

    result = await db["reminders"].delete_one({"_id": oid, "user_email": current_user["email"]})

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Reminder not found")

    await log_audit("REMINDER_DELETE", current_user["email"], f"Reminder: {reminder_id}")
    return {"message": "Reminder deleted successfully"}


# ── Emergency Profile & QR Card (Feature 10) ──────────────────────────────────


class EmergencyProfileRequest(BaseModel):
    blood_group: Optional[str] = None  # A+, B-, O+, AB+, etc.
    allergies: List[str] = []
    conditions: List[str] = []
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    emergency_contact_relation: Optional[str] = None
    current_medications: List[str] = []  # medication names
    notes: Optional[str] = None


@app.post("/api/emergency/profile", tags=["Emergency"])
async def save_emergency_profile(req: EmergencyProfileRequest, current_user: dict = Depends(get_current_user)):
    """Save or update emergency medical profile."""
    profile_doc = {
        "user_email": current_user["email"],
        "blood_group": req.blood_group,
        "allergies": req.allergies,
        "conditions": req.conditions,
        "emergency_contact_name": req.emergency_contact_name,
        "emergency_contact_phone": req.emergency_contact_phone,
        "emergency_contact_relation": req.emergency_contact_relation,
        "current_medications": req.current_medications,
        "notes": req.notes,
        "updated_at": datetime.utcnow().isoformat(),
    }
    await db["emergency_profiles"].update_one(
        {"user_email": current_user["email"]},
        {"$set": profile_doc},
        upsert=True
    )
    await log_audit("EMERGENCY_PROFILE_SAVE", current_user["email"], "Emergency profile updated")
    return {"message": "Emergency profile saved successfully"}


@app.get("/api/emergency/profile", tags=["Emergency"])
async def get_emergency_profile(current_user: dict = Depends(get_current_user)):
    """Get emergency medical profile."""
    profile = await db["emergency_profiles"].find_one({"user_email": current_user["email"]})
    if not profile:
        return {"profile": None}
    profile["_id"] = str(profile["_id"])
    return {"profile": profile}


@app.get("/api/emergency/qr", tags=["Emergency"])
async def generate_emergency_qr(current_user: dict = Depends(get_current_user)):
    """Generate QR code for emergency medical information."""
    import base64
    import json
    import qrcode
    from io import BytesIO

    # Get emergency profile
    profile = await db["emergency_profiles"].find_one({"user_email": current_user["email"]})

    # Get current medications from schedules
    schedules = []
    async for s in db["medication_schedules"].find({"user_email": current_user["email"], "active": True}):
        schedules.append({"name": s["med_name"], "dosage": s["dosage"], "times": s["times"]})

    # Build emergency data
    emergency_data = {
        "name": current_user.get("name", ""),
        "email": current_user.get("email", ""),
        "blood_group": profile.get("blood_group") if profile else None,
        "allergies": profile.get("allergies", []) if profile else [],
        "conditions": profile.get("conditions", []) if profile else [],
        "emergency_contact": {
            "name": profile.get("emergency_contact_name") if profile else None,
            "phone": profile.get("emergency_contact_phone") if profile else None,
            "relation": profile.get("emergency_contact_relation") if profile else None
        } if profile else None,
        "current_medications": schedules,
        "notes": profile.get("notes") if profile else None,
        "generated_at": datetime.utcnow().isoformat()
    }

    # Create QR code
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(json.dumps(emergency_data, separators=(',', ':')))
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)

    # Return as base64
    img_base64 = base64.b64encode(buffer.getvalue()).decode()

    await log_audit("EMERGENCY_QR_GENERATE", current_user["email"], "QR code generated")

    return {
        "qr_code": f"data:image/png;base64,{img_base64}",
        "emergency_data": emergency_data,
        "message": "QR code generated successfully"
    }


@app.get("/api/emergency/view/{user_email}", tags=["Emergency"])
async def view_emergency_info(user_email: str):
    """Public endpoint to view emergency info via QR code (no auth required)."""
    # Get user
    user = await users_collection.find_one({"email": user_email})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Get emergency profile
    profile = await db["emergency_profiles"].find_one({"user_email": user_email})

    # Get current medications from schedules
    schedules = []
    async for s in db["medication_schedules"].find({"user_email": user_email, "active": True}):
        schedules.append({"name": s["med_name"], "dosage": s["dosage"], "times": s["times"]})

    emergency_data = {
        "name": user.get("name", ""),
        "blood_group": profile.get("blood_group") if profile else "Not specified",
        "allergies": profile.get("allergies", []) if profile else [],
        "conditions": profile.get("conditions", []) if profile else [],
        "emergency_contact": {
            "name": profile.get("emergency_contact_name") if profile else None,
            "phone": profile.get("emergency_contact_phone") if profile else None,
            "relation": profile.get("emergency_contact_relation") if profile else None
        } if profile else None,
        "current_medications": schedules,
        "notes": profile.get("notes") if profile else None,
    }

    await log_audit("EMERGENCY_VIEW", user_email, "Emergency info viewed via QR")

    return {"emergency_data": emergency_data}


# ── Patient Safety Score (Feature 8) ─────────────────────────────────────────


# Patient Safety Score (Feature 8) - moved to api/routes/dosage.py
# The routes are now handled by the dosage router

# ── Routes ───────────────────────────────────────────────────────────────────

# ... (rest of the routes)

# ── Symptom Checker ───────────────────────────────────────────────────────────

@app.post("/api/symptom-check", tags=["Health"])
async def symptom_check(req: SymptomCheckRequest, current_user: Optional[dict] = Depends(get_current_user_optional)):
    report_doc = {
        "user_email": current_user["email"] if current_user else "guest",
        "symptoms": req.symptoms,
        "duration_days": req.duration_days,
        "severity": req.severity,
        "timestamp": datetime.utcnow().isoformat(),
    }
    await db["symptom_checks"].insert_one(report_doc)
    await log_audit("SYMPTOM_CHECK", report_doc["user_email"], str(req.symptoms))
    return {"message": "Symptom report recorded successfully. Please consult a doctor for a proper diagnosis."}


# ── Adverse Drug Reaction Reporting (Feature 7) ──────────────────────────────


class ADRCreateRequest(BaseModel):
    medication: str
    med_id: Optional[int] = None
    reaction: str
    severity: str = Field(..., pattern="^(mild|moderate|severe|critical)$")
    start_date: str
    end_date: Optional[str] = None
    notes: Optional[str] = None
    outcome: Optional[str] = None  # recovered, recovering, not_recovered, fatal, unknown


class ADRUpdateRequest(BaseModel):
    severity: Optional[str] = None
    end_date: Optional[str] = None
    notes: Optional[str] = None
    outcome: Optional[str] = None


@app.post("/api/adr", tags=["Adverse Drug Reactions"])
async def create_adr(req: ADRCreateRequest, current_user: dict = Depends(get_current_user)):
    """Report an adverse drug reaction."""
    adr_doc = {
        "user_email": current_user["email"],
        "medication": req.medication,
        "med_id": req.med_id,
        "reaction": req.reaction,
        "severity": req.severity,
        "start_date": req.start_date,
        "end_date": req.end_date,
        "notes": req.notes,
        "outcome": req.outcome,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    result = await db["adverse_events"].insert_one(adr_doc)
    adr_doc["_id"] = str(result.inserted_id)
    await log_audit("ADR_CREATE", current_user["email"], f"Med: {req.medication}, Severity: {req.severity}")
    return {"adr": adr_doc, "message": "Adverse reaction reported successfully"}


@app.get("/api/adr", tags=["Adverse Drug Reactions"])
async def list_adrs(
    severity: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """List ADR reports for the current user."""
    query = {"user_email": current_user["email"]}
    if severity:
        query["severity"] = severity

    adrs = []
    async for doc in db["adverse_events"].find(query).sort("created_at", -1):
        doc["_id"] = str(doc["_id"])
        adrs.append(doc)

    return {"adrs": adrs, "total": len(adrs)}


@app.get("/api/adr/stats", tags=["Adverse Drug Reactions"])
async def adr_stats(current_user: dict = Depends(get_current_user)):
    """Get ADR statistics for the current user."""
    pipeline = [
        {"$match": {"user_email": current_user["email"]}},
        {"$group": {"_id": "$severity", "count": {"$sum": 1}}}
    ]
    severity_counts = {}
    async for doc in db["adverse_events"].aggregate(pipeline):
        severity_counts[doc["_id"]] = doc["count"]

    # Most reported reactions
    reaction_pipeline = [
        {"$match": {"user_email": current_user["email"]}},
        {"$group": {"_id": "$reaction", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10}
    ]
    top_reactions = []
    async for doc in db["adverse_events"].aggregate(reaction_pipeline):
        top_reactions.append({"reaction": doc["_id"], "count": doc["count"]})

    return {
        "severity_counts": severity_counts,
        "top_reactions": top_reactions,
        "total_reports": sum(severity_counts.values())
    }


@app.put("/api/adr/{adr_id}", tags=["Adverse Drug Reactions"])
async def update_adr(adr_id: str, req: ADRUpdateRequest, current_user: dict = Depends(get_current_user)):
    """Update an ADR report."""
    from bson import ObjectId
    try:
        oid = ObjectId(adr_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ADR ID")

    update_data = {k: v for k, v in req.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.utcnow().isoformat()

    result = await db["adverse_events"].update_one(
        {"_id": oid, "user_email": current_user["email"]},
        {"$set": update_data}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="ADR report not found")

    await log_audit("ADR_UPDATE", current_user["email"], f"ADR: {adr_id}")
    return {"message": "ADR report updated successfully"}


@app.delete("/api/adr/{adr_id}", tags=["Adverse Drug Reactions"])
async def delete_adr(adr_id: str, current_user: dict = Depends(get_current_user)):
    """Delete an ADR report."""
    from bson import ObjectId
    try:
        oid = ObjectId(adr_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ADR ID")

    result = await db["adverse_events"].delete_one({"_id": oid, "user_email": current_user["email"]})

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="ADR report not found")

    await log_audit("ADR_DELETE", current_user["email"], f"ADR: {adr_id}")
    return {"message": "ADR report deleted successfully"}


# ── Medication Schedules (Feature 4) ───────────────────────────────────────────

class ScheduleCreateRequest(BaseModel):
    med_id: int
    med_name: str
    dosage: str
    times: List[str]  # e.g., ["08:00", "14:00", "20:00", "22:00"]
    days: List[int] = [0, 1, 2, 3, 4, 5, 6]  # 0=Sun, 6=Sat, default all days
    start_date: str
    end_date: Optional[str] = None
    notes: Optional[str] = None


class ScheduleUpdateRequest(BaseModel):
    times: Optional[List[str]] = None
    days: Optional[List[int]] = None
    end_date: Optional[str] = None
    notes: Optional[str] = None
    active: Optional[bool] = None


class LogCreateRequest(BaseModel):
    scheduled_time: str  # ISO datetime
    status: str = "taken"  # taken, skipped, missed
    notes: Optional[str] = None


@app.post("/api/schedules", tags=["Medication Tracker"])
async def create_schedule(req: ScheduleCreateRequest, current_user: dict = Depends(get_current_user)):
    """Create a new medication schedule."""
    schedule_doc = {
        "user_email": current_user["email"],
        "med_id": req.med_id,
        "med_name": req.med_name,
        "dosage": req.dosage,
        "times": req.times,
        "days": req.days,
        "start_date": req.start_date,
        "end_date": req.end_date,
        "notes": req.notes,
        "active": True,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    result = await db["medication_schedules"].insert_one(schedule_doc)
    schedule_doc["_id"] = str(result.inserted_id)
    await log_audit("SCHEDULE_CREATE", current_user["email"], f"Med: {req.med_name}")
    return {"schedule": schedule_doc, "message": "Schedule created successfully"}


@app.get("/api/schedules", tags=["Medication Tracker"])
async def list_schedules(
    active_only: bool = True,
    current_user: dict = Depends(get_current_user)
):
    """List all medication schedules for the current user."""
    query = {"user_email": current_user["email"]}
    if active_only:
        query["active"] = True

    schedules = []
    async for doc in db["medication_schedules"].find(query).sort("created_at", -1):
        doc["_id"] = str(doc["_id"])
        schedules.append(doc)

    return {"schedules": schedules, "total": len(schedules)}


@app.get("/api/schedules/{schedule_id}", tags=["Medication Tracker"])
async def get_schedule(schedule_id: str, current_user: dict = Depends(get_current_user)):
    """Get a specific schedule with its logs."""
    from bson import ObjectId
    try:
        oid = ObjectId(schedule_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid schedule ID")

    schedule = await db["medication_schedules"].find_one({"_id": oid, "user_email": current_user["email"]})
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    schedule["_id"] = str(schedule["_id"])

    # Get recent logs
    logs = []
    async for log in db["medication_logs"].find({"schedule_id": schedule_id}).sort("scheduled_time", -1).limit(50):
        log["_id"] = str(log["_id"])
        logs.append(log)

    return {"schedule": schedule, "logs": logs}


@app.put("/api/schedules/{schedule_id}", tags=["Medication Tracker"])
async def update_schedule(schedule_id: str, req: ScheduleUpdateRequest, current_user: dict = Depends(get_current_user)):
    """Update a medication schedule."""
    from bson import ObjectId
    try:
        oid = ObjectId(schedule_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid schedule ID")

    update_data = {k: v for k, v in req.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.utcnow().isoformat()

    result = await db["medication_schedules"].update_one(
        {"_id": oid, "user_email": current_user["email"]},
        {"$set": update_data}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Schedule not found")

    await log_audit("SCHEDULE_UPDATE", current_user["email"], f"Schedule: {schedule_id}")
    return {"message": "Schedule updated successfully"}


@app.delete("/api/schedules/{schedule_id}", tags=["Medication Tracker"])
async def delete_schedule(schedule_id: str, current_user: dict = Depends(get_current_user)):
    """Delete (deactivate) a medication schedule."""
    from bson import ObjectId
    try:
        oid = ObjectId(schedule_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid schedule ID")

    result = await db["medication_schedules"].update_one(
        {"_id": oid, "user_email": current_user["email"]},
        {"$set": {"active": False, "updated_at": datetime.utcnow().isoformat()}}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Schedule not found")

    await log_audit("SCHEDULE_DELETE", current_user["email"], f"Schedule: {schedule_id}")
    return {"message": "Schedule deactivated successfully"}


@app.post("/api/schedules/{schedule_id}/log", tags=["Medication Tracker"])
async def log_dose(schedule_id: str, req: LogCreateRequest, current_user: dict = Depends(get_current_user)):
    """Log a dose as taken/skipped/missed."""
    from bson import ObjectId
    try:
        oid = ObjectId(schedule_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid schedule ID")

    # Verify schedule belongs to user
    schedule = await db["medication_schedules"].find_one({"_id": oid, "user_email": current_user["email"]})
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    log_doc = {
        "schedule_id": schedule_id,
        "user_email": current_user["email"],
        "scheduled_time": req.scheduled_time,
        "status": req.status,
        "notes": req.notes,
        "logged_at": datetime.utcnow().isoformat(),
    }
    result = await db["medication_logs"].insert_one(log_doc)
    log_doc["_id"] = str(result.inserted_id)

    await log_audit("DOSE_LOG", current_user["email"], f"Schedule: {schedule_id}, Status: {req.status}")
    return {"log": log_doc, "message": "Dose logged successfully"}


@app.get("/api/schedules/{schedule_id}/adherence", tags=["Medication Tracker"])
async def get_adherence(schedule_id: str, days: int = 30, current_user: dict = Depends(get_current_user)):
    """Get adherence statistics for a schedule."""
    from bson import ObjectId
    try:
        oid = ObjectId(schedule_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid schedule ID")

    schedule = await db["medication_schedules"].find_one({"_id": oid, "user_email": current_user["email"]})
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    # Calculate date range
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)

    # Get logs in range
    logs = []
    async for log in db["medication_logs"].find({
        "schedule_id": schedule_id,
        "scheduled_time": {"$gte": start_date.isoformat(), "$lte": end_date.isoformat()}
    }):
        logs.append(log)

    total_scheduled = len(logs)
    taken = len([l for l in logs if l.get("status") == "taken"])
    skipped = len([l for l in logs if l.get("status") == "skipped"])
    missed = len([l for l in logs if l.get("status") == "missed"])

    adherence_pct = (taken / total_scheduled * 100) if total_scheduled > 0 else 0

    return {
        "schedule_id": schedule_id,
        "period_days": days,
        "total_scheduled": total_scheduled,
        "taken": taken,
        "skipped": skipped,
        "missed": missed,
        "adherence_percentage": round(adherence_pct, 1),
        "message": f"Adherence: {round(adherence_pct, 1)}% ({taken}/{total_scheduled} doses taken)"
    }

# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/", tags=["Health"])
async def root():
    return {"message": "MediGuide AI Backend is running", "version": "1.0.0"}

@app.get("/health", tags=["Health"])
async def health():
    users_count = await users_collection.count_documents({})
    return {
        "status": "ok",
        "medicines": len(MEDICINES),
        "companies": len(COMPANIES),
        "users": users_count,
        "ai": True,  # Indicates AI/chat backend is available
        "timestamp": datetime.utcnow().isoformat(),
    }

@app.get("/api/medicines/uses", tags=["Medicine"])
async def get_medicine_uses():
    """Return medicine uses mapping for frontend (optional enhancement)."""
    uses_map = {}
    for med in MEDICINES:
        uses_map[med["id"]] = med.get("uses", [])
    return {"uses": uses_map}

# ── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/api/auth/register", tags=["Auth"])
@auth_limiter.limit("5/minute")
async def register(req: RegisterRequest):
    email = req.email.lower()
    existing_user = await users_collection.find_one({"email": email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    if not req.consent:
        raise HTTPException(status_code=400, detail="You must accept the disclaimer")
    # Strong password validation: minimum 12 characters
    if len(req.password) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters")
    # Check password strength
    pwd_validation = validate_password_strength(req.password)
    if not pwd_validation["is_valid"]:
        raise HTTPException(status_code=400, detail=f"Password too weak: {', '.join(pwd_validation['errors'])}")
    if "@" not in req.email:
        raise HTTPException(status_code=400, detail="Invalid email address")

    user_doc = {
        "id": str(uuid.uuid4()),
        "name": req.name,
        "email": email,
        "password_hash": hash_password(req.password),
        "role": "user",
        "created_at": datetime.utcnow().isoformat(),
        "last_login": None,
        "age": None,
        "weight": None,
        "conditions": [],
        "allergies": []
    }

    result = await users_collection.insert_one(user_doc)
    user_doc["_id"] = str(result.inserted_id)

    access_token = create_access_token(data={"sub": user_doc["email"], "role": user_doc["role"]})
    await log_audit("REGISTER", email, "auth")

    safe_user = {k: v for k, v in user_doc.items() if k != "password_hash"}
    return {
        "accessToken": access_token,
        "expiresIn": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": safe_user,
        "message": f"Welcome, {req.name}! Account created successfully.",
    }

@app.post("/api/auth/login", tags=["Auth"])
@auth_limiter.limit("5/minute")
async def login(req: LoginRequest):
    email = req.email.lower()
    user = await users_collection.find_one({"email": email})
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    last_login = datetime.utcnow().isoformat()
    await users_collection.update_one({"_id": user["_id"]}, {"$set": {"last_login": last_login}})
    user["last_login"] = last_login
    user["_id"] = str(user["_id"])

    access_token = create_access_token(data={"sub": user["email"], "role": user.get("role", "user")})
    await log_audit("LOGIN", email, "auth")

    safe_user = {k: v for k, v in user.items() if k != "password_hash"}
    return {
        "accessToken": access_token,
        "expiresIn": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": safe_user,
        "message": f"Welcome back, {user['name']}!",
    }

@app.post("/api/auth/logout", tags=["Auth"])
async def logout(current_user: dict = Depends(get_current_user)):
    await log_audit("LOGOUT", current_user["email"], "auth")
    return {"message": "Logged out successfully"}


@app.get("/api/auth/me", tags=["Auth"])
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    """Get current authenticated user info (for session resume)."""
    safe_user = {k: v for k, v in current_user.items() if k != "password_hash"}
    return {"user": safe_user}


@app.post("/api/auth/refresh", tags=["Auth"])
async def refresh_token(response: Response, current_user: dict = Depends(get_current_user)):
    """Refresh access token. Returns new access token with same expiry and user info."""
    access_token = create_access_token(data={"sub": current_user["email"], "role": current_user.get("role", "user")})
    await log_audit("TOKEN_REFRESH", current_user["email"], "auth")
    safe_user = {k: v for k, v in current_user.items() if k != "password_hash"}
    return {"accessToken": access_token, "expiresIn": ACCESS_TOKEN_EXPIRE_MINUTES * 60, "user": safe_user}


# ── Places / Nearby Clinic Finder ────────────────────────────────────────────
class NearbyPlaceRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    radius: int = Field(default=5000, ge=100, le=50000)  # meters, default 5km
    type: str = Field(default="clinic", pattern="^(clinic|hospital|pharmacy|emergency)$")


@app.get("/api/places/nearby", tags=["Places"])
async def get_nearby_places(
    latitude: float,
    longitude: float,
    radius: int = 5000,
    type: str = "clinic",
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Find nearby healthcare facilities using OpenStreetMap Overpass API."""
    import httpx

    # Validate coordinates
    if not (-90 <= latitude <= 90) or not (-180 <= longitude <= 180):
        raise HTTPException(status_code=400, detail="Invalid coordinates")

    # Validate radius
    radius = max(100, min(50000, radius))

    # Validate type
    valid_types = {"clinic", "hospital", "pharmacy", "emergency"}
    if type not in valid_types:
        raise HTTPException(status_code=400, detail="Invalid facility type. Must be one of: clinic, hospital, pharmacy, emergency")

    # Map facility type to Overpass tags
    type_tags = {
        "clinic": '["amenity"="clinic"]',
        "hospital": '["amenity"="hospital"]',
        "pharmacy": '["amenity"="pharmacy"]',
        "emergency": '["emergency"="yes"]'
    }

    overpass_query = f"""
    [out:json][timeout:25];
    (
      node{type_tags[type]}(around:{radius},{latitude},{longitude});
      way{type_tags[type]}(around:{radius},{latitude},{longitude});
      relation{type_tags[type]}(around:{radius},{latitude},{longitude});
    );
    out center;
    """

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://overpass-api.de/api/interpreter",
                data={"data": overpass_query},
                headers={"User-Agent": "MediGuide-AI/1.0"}
            )
            response.raise_for_status()
            data = response.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Request to Overpass API timed out")
    except httpx.RequestError as e:
        await log_audit("PLACES_ERROR", current_user["email"] if current_user else "guest", str(e))
        raise HTTPException(status_code=502, detail="Could not reach places service")
    except Exception as e:
        await log_audit("PLACES_ERROR", current_user["email"] if current_user else "guest", str(e))
        raise HTTPException(status_code=500, detail="Places service error")

    # Process results
    places = []
    for element in data.get("elements", []):
        if element.get("type") == "node":
            lat, lon = element["lat"], element["lon"]
        elif "center" in element:
            lat, lon = element["center"]["lat"], element["center"]["lon"]
        else:
            continue

        tags = element.get("tags", {})
        name = tags.get("name", "Unnamed Facility")
        address_parts = []
        for key in ["addr:housenumber", "addr:street", "addr:city", "addr:postcode", "addr:suburb"]:
            if key in tags:
                address_parts.append(tags[key])
        address = ", ".join(address_parts) if address_parts else "Address not available"

        # Calculate distance (approximate)
        from math import radians, cos, sin, sqrt, atan2
        R = 6371000  # Earth radius in meters
        lat1, lon1 = radians(latitude), radians(longitude)
        lat2, lon2 = radians(lat), radians(lon)
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        distance = int(R * 2 * atan2(sqrt(a), sqrt(1-a)))

        places.append({
            "name": name,
            "type": type,
            "address": address,
            "distance": distance,
            "latitude": lat,
            "longitude": lon,
            "directions_url": f"https://www.google.com/maps?q={lat},{lon}"
        })

    # Sort by distance
    places.sort(key=lambda p: p["distance"])

    # Audit log
    user_email = current_user["email"] if current_user else "guest"
    await log_audit("PLACES_SEARCH", user_email, f"type={type}, radius={radius}, results={len(places)}")

    return {"places": places, "total": len(places)}

# ── Medicine ─────────────────────────────────────────────────────────────────

@app.get("/api/medicine/search", tags=["Medicine"])
async def search_medicine(q: str = "", category: str = "", limit: int = 20):
    results = MEDICINES
    q_lower = q.strip().lower()
    if q_lower:
        results = [
            m for m in MEDICINES
            if q_lower in m["name"].lower()
            or q_lower in m["generic_name"].lower()
            or q_lower in m["active_ingredient"].lower()
            or q_lower in m["mfg"].lower()
            or q_lower in m["category"].lower()
            or q_lower in m["description"].lower()
        ]
    if category:
        results = [m for m in results if m["category"] == category]
    return {"results": results[:limit], "total": len(results)}

@app.get("/api/medicine/{med_id}", tags=["Medicine"])
async def get_medicine(med_id: int):
    med = MEDICINES_BY_ID.get(med_id)
    if not med:
        raise HTTPException(status_code=404, detail="Medicine not found")
    return med

@app.get("/api/medicine/{med_id}/alternatives", tags=["Medicine"])
async def get_alternatives(med_id: int):
    med = MEDICINES_BY_ID.get(med_id)
    if not med:
        raise HTTPException(status_code=404, detail="Medicine not found")
    ingredient = med["active_ingredient"].lower()
    alts = [
        m for m in MEDICINES
        if m["id"] != med_id and ingredient in m["active_ingredient"].lower()
    ]
    return {
        "medicine": med["name"],
        "active_ingredient": med["active_ingredient"],
        "alternatives": alts,
        "disclaimer": "Do not substitute a prescribed medicine without consulting your doctor or pharmacist.",
    }

# Upload endpoints use configuration constants defined at top
MAX_FILE_SIZE = MAX_UPLOAD_SIZE

@app.post("/api/medicine/upload", tags=["Medicine"])
async def upload_medicine_image(
    file: UploadFile = File(...),
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    # Validate content type
    if file.content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type. Upload JPEG, PNG or WEBP.")

    # Validate file extension
    if file.filename:
        ext = file.filename.rsplit(".", 1)[-1].lower()
        if f".{ext}" not in ALLOWED_IMAGE_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Unsupported file extension.")

    # Check for blocked extensions
    if file.filename:
        ext = file.filename.rsplit(".", 1)[-1].lower()
        if f".{ext}" in BLOCKED_EXTENSIONS:
            raise HTTPException(status_code=400, detail="File type not allowed for security reasons.")

    # Sanitize filename (prevent path traversal)
    if file.filename:
        # Only keep the basename, remove any path components
        safe_filename = os.path.basename(file.filename)
        # Remove any remaining dangerous characters
        safe_filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', safe_filename)
    else:
        safe_filename = "unknown"

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File exceeds {MAX_FILE_SIZE // (1024*1024)} MB limit.")

    file_id = str(uuid.uuid4())
    ext = safe_filename.rsplit(".", 1)[-1].lower() if "." in safe_filename else "jpg"
    save_path = UPLOAD_DIR / "medicine_images" / f"{file_id}.{ext}"
    save_path.write_bytes(content)

    user_email = current_user["email"] if current_user else "guest"
    await log_audit("MEDICINE_IMAGE_UPLOAD", user_email, safe_filename)

    return {
        "file_id": file_id,
        "filename": safe_filename,
        "size_bytes": len(content),
        "status": "uploaded",
        "ocr_status": "pending",
        "message": "Image uploaded. Use MediChat AI assistant for image analysis.",
        "disclaimer": "Image-based medicine identification is for reference only. Always verify with a pharmacist.",
    }

@app.post("/api/prescription/upload", tags=["Prescription"])
async def upload_prescription(
    file: UploadFile = File(...),
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    # Validate content type
    if file.content_type not in ALLOWED_PRESCRIPTION_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported type. Upload JPEG, PNG, WEBP or PDF.")

    # Validate file extension
    if file.filename:
        ext = file.filename.rsplit(".", 1)[-1].lower()
        if f".{ext}" not in ALLOWED_PRESCRIPTION_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Unsupported file extension.")

    # Check for blocked extensions
    if file.filename:
        ext = file.filename.rsplit(".", 1)[-1].lower()
        if f".{ext}" in BLOCKED_EXTENSIONS:
            raise HTTPException(status_code=400, detail="File type not allowed for security reasons.")

    # Sanitize filename (prevent path traversal)
    if file.filename:
        safe_filename = os.path.basename(file.filename)
        safe_filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', safe_filename)
    else:
        safe_filename = "unknown"

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File exceeds {MAX_FILE_SIZE // (1024*1024)} MB limit.")

    file_id = str(uuid.uuid4())
    ext = "pdf" if file.content_type == "application/pdf" else safe_filename.rsplit(".", 1)[-1].lower()
    save_path = UPLOAD_DIR / "prescriptions" / f"{file_id}.{ext}"
    save_path.write_bytes(content)

    user_email = current_user["email"] if current_user else "guest"
    await log_audit("PRESCRIPTION_UPLOAD", user_email, safe_filename)

    return {
        "file_id": file_id,
        "filename": safe_filename,
        "content_type": file.content_type,
        "size_bytes": len(content),
        "status": "uploaded",
        "message": "Prescription uploaded. Use /api/prescription/analyze or MediChat for analysis.",
        "disclaimer": "Prescription analysis is informational only. Never alter doses without professional advice.",
    }

@app.post("/api/prescription/analyze-full", tags=["Prescription"])
async def analyze_prescription_full(req: PrescriptionAnalyzeRequest, current_user: Optional[dict] = Depends(get_current_user_optional)):
    """Enhanced prescription analysis with safety checks."""
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="No text provided for analysis")

    # Extract medicines from text
    found_medicines = []
    for med in MEDICINES:
        patterns = [med["name"].lower(), med["generic_name"].lower(), med["active_ingredient"].lower()]
        for pat in patterns:
            if re.search(r"\b" + re.escape(pat) + r"\b", text.lower()):
                found_medicines.append({
                    "id": med["id"],
                    "name": med["name"],
                    "generic_name": med["generic_name"],
                    "strength": med["strength"],
                    "dosage_form": med["dosage_form"],
                    "mfg": med["mfg"],
                    "matched_term": pat,
                    "category": med["category"],
                    "rx": med.get("regulatory_status") == "APPROVED",
                })
                break

    # Extract dosage patterns
    dosage_patterns = re.findall(
        r"(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|units?|tablet|tab|cap|capsule)",
        text, re.IGNORECASE
    )

    # Extract frequency keywords
    frequency_keywords = []
    freq_map = {
        "once daily": "OD", "twice daily": "BD", "twice a day": "BD",
        "thrice daily": "TDS", "three times": "TDS", "four times": "QID",
        "every 6 hours": "Q6H", "every 8 hours": "Q8H", "every 12 hours": "Q12H",
        "at night": "HS", "at bedtime": "HS", "morning": "AM", "afternoon": "PM",
    }
    for kw, abbr in freq_map.items():
        if kw.lower() in text.lower():
            frequency_keywords.append({"term": kw, "abbreviation": abbr})

    # Run safety checks for each found medicine
    safety_results = []
    interactions = []

    if found_medicines and req.med_id:
        # If specific med_id provided, check that one
        med_to_check = next((m for m in found_medicines if m["id"] == req.med_id), None)
        if med_to_check:
            # Get medication safety data from DB
            med_data = await db["medications"].find_one({"id": req.med_id})
            if not med_data:
                fallback = MEDICINES_BY_ID.get(req.med_id)
                if fallback:
                    med_data = {
                        "name": fallback["name"],
                        "safe_min": 100.0,
                        "safe_max": 2000.0,
                        "sourceName": "DailyMed",
                        "evidenceTier": 1,
                        "confidenceScore": 95
                    }

            if med_data:
                # Build patient profile
                patient = None
                if current_user and current_user.get("profile"):
                    p = current_user["profile"]
                    patient = {
                        "age": p.get("age"),
                        "weight": p.get("weight"),
                        "conditions": p.get("conditions", []),
                        "pregnant": p.get("pregnant", False)
                    }

                dosage = req.dosage if req.dosage else (dosage_patterns[0][0] if dosage_patterns else 500.0)
                frequency = req.frequency if req.frequency else (frequency_keywords[0]["abbreviation"] if frequency_keywords else "OD")

                # Check interactions with other found medicines
                other_meds = [m["name"] for m in found_medicines if m["id"] != req.med_id]
                if other_meds:
                    query = {
                        "$or": [
                            {"med_a": med_data.get("name"), "med_b": {"$in": other_meds}},
                            {"med_b": med_data.get("name"), "med_a": {"$in": other_meds}}
                        ]
                    }
                    interactions_cursor = db["interactions"].find(query)
                    interactions = await interactions_cursor.to_list(length=50)

                # Run safety assessment
                from .models.safety import DosageRequest, PatientProfile
                from .safety_engine import DosageSafetyEngine

                dosage_req = DosageRequest(
                    med_id=req.med_id,
                    dosage=dosage,
                    frequency=frequency,
                    patient=PatientProfile(**patient) if patient else None
                )
                assessment = safety_engine.evaluate(dosage_req, med_data, interactions=interactions)
                safety_results.append(assessment)

    await log_audit("PRESCRIPTION_ANALYZE_FULL", current_user["email"] if current_user else "guest", f"Meds found: {len(found_medicines)}")

    return {
        "input_text": text,
        "medicines_found": found_medicines,
        "dosage_patterns_found": [{"value": d[0], "unit": d[1]} for d in dosage_patterns],
        "frequency_keywords": frequency_keywords,
        "total_medicines_identified": len(found_medicines),
        "safety_results": safety_results,
        "interactions": interactions,
        "confidence": "LOW" if not found_medicines else "MEDIUM",
        "disclaimer": "This is automated extraction. Results may be incomplete. Always verify with your doctor.",
        "note": "For handwritten prescriptions, use MediChat with an image attachment for better accuracy."
    }


@app.post("/api/prescription/analyze", tags=["Prescription"])
async def analyze_prescription(req: PrescriptionAnalyzeRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="No text provided for analysis")

    found_medicines = []
    for med in MEDICINES:
        patterns = [med["name"].lower(), med["generic_name"].lower(), med["active_ingredient"].lower()]
        for pat in patterns:
            if re.search(r"\b" + re.escape(pat) + r"\b", text.lower()):
                found_medicines.append({
                    "name": med["name"],
                    "generic_name": med["generic_name"],
                    "strength": med["strength"],
                    "dosage_form": med["dosage_form"],
                    "mfg": med["mfg"],
                    "matched_term": pat,
                })
                break

    dosage_patterns = re.findall(
        r"(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|units?|tablet|tab|cap|capsule)",
        text, re.IGNORECASE
    )

    frequency_keywords = []
    freq_map = {
        "once daily": "OD", "twice daily": "BD", "twice a day": "BD",
        "thrice daily": "TDS", "three times": "TDS", "four times": "QID",
        "every 6 hours": "Q6H", "every 8 hours": "Q8H", "every 12 hours": "Q12H",
        "at night": "HS", "at bedtime": "HS", "morning": "AM", "afternoon": "PM",
    }
    for kw, abbr in freq_map.items():
        if kw.lower() in text.lower():
            frequency_keywords.append({"term": kw, "abbreviation": abbr})

    return {
        "input_text": text,
        "medicines_found": found_medicines,
        "dosage_patterns_found": [{"value": d[0], "unit": d[1]} for d in dosage_patterns],
        "frequency_keywords": frequency_keywords,
        "total_medicines_identified": len(found_medicines),
        "confidence": "LOW" if not found_medicines else "MEDIUM",
        "disclaimer": "This is automated extraction. Results may be incomplete. Always verify with your doctor.",
        "note": "For handwritten prescriptions, use MediChat with an image attachment for better accuracy.",
    }

# ── AI Chat ──────────────────────────────────────────────────────────────────

@app.post("/api/chat", tags=["AI"])
async def chat(req: ChatRequest, current_user: Optional[dict] = Depends(get_current_user_optional)):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    user_email = current_user["email"] if current_user else "guest"
    await log_audit("CHAT", user_email, req.message[:50])

    dangerous_terms = ["how to overdose", "kill myself", "suicide", "lethal dose"]
    msg_lower = req.message.lower()
    for term in dangerous_terms:
        if term in msg_lower:
            return {
                "role": "assistant",
                "content": "I cannot assist with that query. If you are in crisis, call iCall: 9152987821 or emergency: 112.",
                "safety_blocked": True,
            }

    relevant = [med for med in MEDICINES if med["name"].lower() in req.message.lower()]
    context_note = f"User is viewing: {req.medicine_context}. " if req.medicine_context else ""

    return {
        "role": "assistant",
        "content": (
            f"{context_note}For AI-powered responses, provide your Gemini API key in the MediChat panel. "
            "The backend is ready for RAG integration in the next phase."
        ),
        "relevant_medicines": relevant,
        "disclaimer": "This is informational only. Consult a licensed doctor or pharmacist before taking any medication.",
    }

# ── Companies ─────────────────────────────────────────────────────────────────

@app.get("/api/company", tags=["Company"])
async def list_companies():
    return {"companies": list(COMPANIES.keys()), "total": len(COMPANIES)}

@app.get("/api/company/{company_name}", tags=["Company"])
async def get_company(company_name: str):
    company = COMPANIES.get(company_name)
    if not company:
        for key, val in COMPANIES.items():
            if key.lower() == company_name.lower():
                return val
        raise HTTPException(status_code=404, detail="Company not found")
    return company

# ── Profile ───────────────────────────────────────────────────────────────────

@app.get("/api/profile", tags=["Profile"])
async def get_profile(current_user: dict = Depends(get_current_user)):
    return {k: v for k, v in current_user.items() if k != "password_hash"}

@app.put("/api/profile", tags=["Profile"])
async def update_profile(request: Request, current_user: dict = Depends(get_current_user)):
    body = await request.json()
    allowed = {"name", "age", "weight", "conditions", "allergies"}
    update_data = {k: v for k, v in body.items() if k in allowed}

    if update_data:
        await users_collection.update_one(
            {"email": current_user["email"]},
            {"$set": update_data}
        )
        current_user.update(update_data)

    await log_audit("PROFILE_UPDATE", current_user["email"], "profile")
    return {"message": "Profile updated", "user": {k: v for k, v in current_user.items() if k != "password_hash"}}

# ── Admin ─────────────────────────────────────────────────────────────────────

@app.get("/api/admin/stats", tags=["Admin"])
async def admin_stats(admin_user: dict = Depends(require_admin)):
    med_img_count = len(list((UPLOAD_DIR / "medicine_images").glob("*")))
    rx_count = len(list((UPLOAD_DIR / "prescriptions").glob("*")))
    users_count = await users_collection.count_documents({})
    audit_count = await audit_collection.count_documents({})

    recent_audit_cursor = audit_collection.find({}, {"_id": 0}).sort("_id", -1).limit(10)
    recent_audit_events = await recent_audit_cursor.to_list(length=10)

    return {
        "total_users": users_count,
        "total_medicines": len(MEDICINES),
        "total_companies": len(COMPANIES),
        "total_uploads_medicine": med_img_count,
        "total_uploads_prescription": rx_count,
        "total_audit_events": audit_count,
        "recent_audit_events": recent_audit_events,
        "timestamp": datetime.utcnow().isoformat(),
    }

@app.get("/api/admin/users", tags=["Admin"])
async def admin_list_users(admin_user: dict = Depends(require_admin)):
    users_cursor = users_collection.find({}, {"password_hash": 0})
    users_list = []
    async for u in users_cursor:
        u["_id"] = str(u["_id"])
        users_list.append(u)
    return {"users": users_list, "total": len(users_list)}

@app.post("/api/admin/medicines", tags=["Admin"])
async def admin_add_medicine(req: MedicineCreateRequest, admin_user: dict = Depends(require_admin)):
    new_id = max((m["id"] for m in MEDICINES), default=0) + 1
    new_med = {
        "id": new_id,
        "name": req.name,
        "generic_name": req.generic_name,
        "active_ingredient": req.active_ingredient,
        "strength": req.strength,
        "dosage_form": req.dosage_form,
        "mfg": req.mfg,
        "category": req.category,
        "description": req.description,
        "regulatory_status": req.regulatory_status,
        "cdsco": req.regulatory_status == "APPROVED",
        "dosage": req.strength,
        "frequency": "As prescribed",
        "side_effects": [],
        "contraindications": [],
        "source": "Admin Entry",
        "source_date": datetime.utcnow().date().isoformat(),
    }
    MEDICINES.append(new_med)
    MEDICINES_BY_ID[new_id] = new_med
    await log_audit("MEDICINE_ADDED", admin_user["email"], req.name)
    return {"message": f"Medicine '{req.name}' added", "id": new_id, "medicine": new_med}

@app.get("/api/admin/audit", tags=["Admin"])
async def admin_audit_log(limit: int = 50, admin_user: dict = Depends(require_admin)):
    audit_count = await audit_collection.count_documents({})
    events_cursor = audit_collection.find({}, {"_id": 0}).sort("_id", -1).limit(limit)
    events = await events_cursor.to_list(length=limit)
    return {"events": events, "total": audit_count}


@app.get("/api/admin/database/status", tags=["Admin"])
async def admin_database_status(admin_user: dict = Depends(require_admin)):
    """Get database status: collections, counts, indexes."""
    try:
        collections = await db.list_collection_names()
        status = {"collections": {}}

        for coll_name in collections:
            coll = db[coll_name]
            count = await coll.count_documents({})
            indexes = await coll.index_information()
            status["collections"][coll_name] = {
                "count": count,
                "indexes": len(indexes)
            }

        # Total documents
        total_docs = sum(c["count"] for c in status["collections"].values())
        status["total_documents"] = total_docs
        status["total_collections"] = len(collections)

        await log_audit("ADMIN_DB_STATUS", admin_user["email"], f"Collections: {len(collections)}")
        return status
    except Exception as e:
        logger.error(f"Database status error: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve database status")


@app.post("/api/admin/database/validate", tags=["Admin"])
async def admin_database_validate(admin_user: dict = Depends(require_admin)):
    """Validate all documents against schemas."""
    try:
        from database import validate_all_documents
        report = await validate_all_documents(db)

        await log_audit("ADMIN_DB_VALIDATE", admin_user["email"], f"Validated collections")
        return {"report": report, "validated_at": datetime.utcnow().isoformat()}
    except Exception as e:
        logger.error(f"Database validation error: {e}")
        raise HTTPException(status_code=500, detail="Failed to validate database")


@app.post("/api/admin/database/reindex", tags=["Admin"])
async def admin_database_reindex(admin_user: dict = Depends(require_admin)):
    """Recreate all indexes."""
    try:
        from database import initialize_indexes
        result = await initialize_indexes(db)

        await log_audit("ADMIN_DB_REINDEX", admin_user["email"], f"Reindexed collections")
        return {"result": result, "reindexed_at": datetime.utcnow().isoformat()}
    except Exception as e:
        logger.error(f"Database reindex error: {e}")
        raise HTTPException(status_code=500, detail="Failed to reindex database")


@app.post("/api/admin/database/migrate", tags=["Admin"])
async def admin_database_migrate(admin_user: dict = Depends(require_admin)):
    """Run pending migrations."""
    try:
        from database import run_migrations
        applied = await run_migrations(db)

        await log_audit("ADMIN_DB_MIGRATE", admin_user["email"], f"Migrations: {len(applied)}")
        return {"applied": applied, "migrated_at": datetime.utcnow().isoformat()}
    except Exception as e:
        logger.error(f"Database migration error: {e}")
        raise HTTPException(status_code=500, detail="Failed to run database migrations")


# ── Startup Event ─────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup_event():
    # Initialize database (collections, indexes, migrations)
    init_result = await initialize_database(db)
    logger.info(f"Database initialized: {init_result['total_collections']} collections")

    # Initialize shared database for API routes
    init_db(db)

    # Log migration results
    if init_result.get("migrations_applied"):
        for migration in init_result["migrations_applied"]:
            logger.info(f"Migration applied: {migration}")

    # Create admin user if not exists
    admin_email = os.getenv("ADMIN_EMAIL", "admin@mediguide.ai")
    admin_password = os.getenv("ADMIN_PASSWORD")
    if not admin_password:
        logger.warning("ADMIN_PASSWORD not set, admin user will not be created. Set ADMIN_PASSWORD in environment.")
    else:
        existing_admin = await users_collection.find_one({"email": admin_email})
        if not existing_admin:
            admin_doc = {
                "id": "admin-001",
                "name": "MediGuide Admin",
                "email": admin_email,
                "password_hash": hash_password(admin_password),
                "role": "admin",
                "created_at": datetime.utcnow().isoformat(),
                "last_login": None,
                "profile": {
                    "age": None,
                    "weight": None,
                    "height": None,
                    "blood_group": "",
                    "gender": "",
                    "conditions": [],
                    "allergies": [],
                    "is_pregnant": False,
                    "is_lactating": False
                },
                "settings": {
                    "elderly_mode": False,
                    "high_contrast": False,
                    "font_scale": 1,
                    "notifications": True,
                    "language": "en"
                }
            }
            await users_collection.insert_one(admin_doc)
            logger.info("Admin user created")

# ── Serve frontend ───────────────────────────────────────────────────────────

@app.get("/app", include_in_schema=False)
async def serve_frontend():
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return JSONResponse({"message": "Frontend not found. Open index.html directly in your browser."})
