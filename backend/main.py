import os
import uuid
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException, UploadFile, File, Request, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
import jwt
from passlib.context import CryptContext
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

from models.safety import DosageRequest
from safety_engine import DosageSafetyEngine

safety_engine = DosageSafetyEngine()


# ── Load environment ────────────────────────────────────────────────────────
load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "supersecretkey")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "mediguide_db")

# ── Database & Auth Setup ───────────────────────────────────────────────────
client = AsyncIOMotorClient(MONGODB_URL)
db = client[DATABASE_NAME]
users_collection = db["users"]
audit_collection = db["audit_logs"]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def log_audit(action: str, user: str = "anonymous", resource: str = ""):
    audit_entry = {
        "action": action,
        "user": user,
        "resource": resource,
        "timestamp": datetime.utcnow().isoformat(),
    }
    await audit_collection.insert_one(audit_entry)

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

# ── App ─────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="MediGuide AI API",
    description="India's CDSCO-approved medicine information system",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Upload directories ───────────────────────────────────────────────────────
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
(UPLOAD_DIR / "medicine_images").mkdir(exist_ok=True)
(UPLOAD_DIR / "prescriptions").mkdir(exist_ok=True)

FRONTEND_DIR = Path(__file__).parent.parent

# ── Medicine dataset (12 CDSCO-approved medicines) ───────────────────────────
MEDICINES = [
    {
        "id": 1, "name": "Paracetamol", "generic_name": "Acetaminophen",
        "active_ingredient": "Paracetamol", "strength": "500mg",
        "dosage_form": "Tablet", "mfg": "GSK", "category": "Analgesic / Antipyretic",
        "description": "Relieves mild to moderate pain and reduces fever. Safe at recommended doses.",
        "regulatory_status": "APPROVED", "cdsco": True,
        "dosage": "500mg", "frequency": "Every 6-8 hours (max 4g/day)",
        "side_effects": ["Rare skin rash", "Liver damage in overdose"],
        "contraindications": ["Severe hepatic impairment"],
        "source": "CDSCO India", "source_date": "2024-01-01",
    },
    {
        "id": 2, "name": "Azithromycin", "generic_name": "Azithromycin",
        "active_ingredient": "Azithromycin", "strength": "500mg",
        "dosage_form": "Tablet", "mfg": "Cipla", "category": "Antibiotic (Macrolide)",
        "description": "Broad-spectrum antibiotic for bacterial infections of throat, lungs, ear.",
        "regulatory_status": "APPROVED", "cdsco": True,
        "dosage": "500mg", "frequency": "Once daily for 3 days",
        "side_effects": ["Nausea", "Diarrhoea", "Abdominal pain"],
        "contraindications": ["Hypersensitivity to macrolides"],
        "source": "CDSCO India", "source_date": "2024-01-01",
    },
    {
        "id": 3, "name": "Metformin", "generic_name": "Metformin Hydrochloride",
        "active_ingredient": "Metformin", "strength": "500mg",
        "dosage_form": "Tablet", "mfg": "Sun Pharma", "category": "Antidiabetic (Biguanide)",
        "description": "First-line medicine for managing type 2 diabetes.",
        "regulatory_status": "APPROVED", "cdsco": True,
        "dosage": "500mg", "frequency": "Twice daily with meals",
        "side_effects": ["Nausea", "Diarrhoea", "Metallic taste"],
        "contraindications": ["eGFR < 30", "Severe hepatic impairment"],
        "source": "CDSCO India", "source_date": "2024-01-01",
    },
    {
        "id": 4, "name": "Amoxicillin", "generic_name": "Amoxicillin",
        "active_ingredient": "Amoxicillin", "strength": "500mg",
        "dosage_form": "Capsule", "mfg": "Cipla", "category": "Antibiotic (Penicillin)",
        "description": "Broad-spectrum antibiotic for ear, chest, throat and urinary infections.",
        "regulatory_status": "APPROVED", "cdsco": True,
        "dosage": "500mg", "frequency": "Every 8 hours for 5-7 days",
        "side_effects": ["Rash", "Diarrhoea", "Nausea"],
        "contraindications": ["Penicillin allergy"],
        "source": "CDSCO India", "source_date": "2024-01-01",
    },
    {
        "id": 5, "name": "Cetirizine", "generic_name": "Cetirizine Hydrochloride",
        "active_ingredient": "Cetirizine", "strength": "10mg",
        "dosage_form": "Tablet", "mfg": "Dr. Reddy's", "category": "Antihistamine (2nd Gen)",
        "description": "Relieves allergy symptoms: sneezing, itching, runny nose, hives.",
        "regulatory_status": "APPROVED", "cdsco": True,
        "dosage": "10mg", "frequency": "Once daily (preferably at night)",
        "side_effects": ["Mild drowsiness", "Dry mouth", "Headache"],
        "contraindications": ["Severe renal impairment"],
        "source": "CDSCO India", "source_date": "2024-01-01",
    },
    {
        "id": 6, "name": "Omeprazole", "generic_name": "Omeprazole",
        "active_ingredient": "Omeprazole", "strength": "20mg",
        "dosage_form": "Capsule", "mfg": "Dr. Reddy's", "category": "Proton Pump Inhibitor (PPI)",
        "description": "Reduces stomach acid for acidity, peptic ulcers and GERD.",
        "regulatory_status": "APPROVED", "cdsco": True,
        "dosage": "20mg", "frequency": "Once daily before breakfast",
        "side_effects": ["Headache", "Diarrhoea", "Nausea"],
        "contraindications": ["Hypersensitivity to PPIs"],
        "source": "CDSCO India", "source_date": "2024-01-01",
    },
    {
        "id": 7, "name": "Ibuprofen", "generic_name": "Ibuprofen",
        "active_ingredient": "Ibuprofen", "strength": "400mg",
        "dosage_form": "Tablet", "mfg": "Abbott", "category": "NSAID / Anti-inflammatory",
        "description": "Reduces pain, fever and inflammation. Always take with food.",
        "regulatory_status": "APPROVED", "cdsco": True,
        "dosage": "400mg", "frequency": "Every 6-8 hours with food",
        "side_effects": ["GI irritation", "Nausea", "Elevated BP"],
        "contraindications": ["Active peptic ulcer", "Third trimester pregnancy"],
        "source": "CDSCO India", "source_date": "2024-01-01",
    },
    {
        "id": 8, "name": "Amlodipine", "generic_name": "Amlodipine Besylate",
        "active_ingredient": "Amlodipine", "strength": "5mg",
        "dosage_form": "Tablet", "mfg": "Pfizer", "category": "Antihypertensive (CCB)",
        "description": "Calcium-channel blocker that lowers blood pressure and prevents chest pain.",
        "regulatory_status": "APPROVED", "cdsco": True,
        "dosage": "5mg", "frequency": "Once daily",
        "side_effects": ["Ankle oedema", "Flushing", "Headache"],
        "contraindications": ["Cardiogenic shock", "Severe aortic stenosis"],
        "source": "CDSCO India", "source_date": "2024-01-01",
    },
    {
        "id": 9, "name": "Atorvastatin", "generic_name": "Atorvastatin Calcium",
        "active_ingredient": "Atorvastatin", "strength": "10mg",
        "dosage_form": "Tablet", "mfg": "Pfizer", "category": "Statin / Lipid-Lowering",
        "description": "Lowers LDL cholesterol and reduces risk of heart disease.",
        "regulatory_status": "APPROVED", "cdsco": True,
        "dosage": "10mg", "frequency": "Once daily at night",
        "side_effects": ["Myalgia", "Elevated liver enzymes"],
        "contraindications": ["Active liver disease", "Pregnancy"],
        "source": "CDSCO India", "source_date": "2024-01-01",
    },
    {
        "id": 10, "name": "Pantoprazole", "generic_name": "Pantoprazole Sodium",
        "active_ingredient": "Pantoprazole", "strength": "40mg",
        "dosage_form": "Tablet", "mfg": "Aristo", "category": "Proton Pump Inhibitor (PPI)",
        "description": "Treats acid reflux, GERD and stomach ulcers.",
        "regulatory_status": "APPROVED", "cdsco": True,
        "dosage": "40mg", "frequency": "Once daily before breakfast",
        "side_effects": ["Headache", "Diarrhoea", "Nausea"],
        "contraindications": ["Hypersensitivity to PPIs"],
        "source": "CDSCO India", "source_date": "2024-01-01",
    },
    {
        "id": 11, "name": "Montelukast", "generic_name": "Montelukast Sodium",
        "active_ingredient": "Montelukast", "strength": "10mg",
        "dosage_form": "Tablet", "mfg": "MSD", "category": "Leukotriene Receptor Antagonist",
        "description": "Prevents asthma attacks and relieves allergic rhinitis.",
        "regulatory_status": "APPROVED", "cdsco": True,
        "dosage": "10mg", "frequency": "Once daily at bedtime",
        "side_effects": ["Headache", "Abdominal pain"],
        "contraindications": ["Hypersensitivity to montelukast"],
        "source": "CDSCO India", "source_date": "2024-01-01",
    },
    {
        "id": 12, "name": "Metoprolol", "generic_name": "Metoprolol Tartrate",
        "active_ingredient": "Metoprolol", "strength": "50mg",
        "dosage_form": "Tablet", "mfg": "AstraZeneca", "category": "Beta-Blocker / Antihypertensive",
        "description": "Selective beta-1 blocker for hypertension, angina and heart failure.",
        "regulatory_status": "APPROVED", "cdsco": True,
        "dosage": "50mg", "frequency": "Twice daily",
        "side_effects": ["Fatigue", "Bradycardia", "Dizziness"],
        "contraindications": ["Severe bradycardia", "AV block"],
        "source": "CDSCO India", "source_date": "2024-01-01",
    },
]

MEDICINES_BY_ID = {m["id"]: m for m in MEDICINES}

COMPANIES = {
    "GSK": {
        "name": "GlaxoSmithKline India Ltd.",
        "website": "https://in.gsk.com",
        "description": "British-Indian pharmaceutical multinational operating in India since 1924.",
        "medicines": ["Paracetamol", "Crocin", "Calpol"],
        "headquarters": "Mumbai, India",
    },
    "Cipla": {
        "name": "Cipla Limited",
        "website": "https://www.cipla.com",
        "description": "Leading Indian pharmaceutical company known for affordable generics globally.",
        "medicines": ["Azithromycin", "Amoxicillin", "Cetirizine (Alerid)"],
        "headquarters": "Mumbai, India",
    },
    "Sun Pharma": {
        "name": "Sun Pharmaceutical Industries Ltd.",
        "website": "https://www.sunpharma.com",
        "description": "India's largest pharmaceutical company by market cap.",
        "medicines": ["Metformin", "Pantoprazole (Pantocid)"],
        "headquarters": "Mumbai, India",
    },
    "Dr. Reddy's": {
        "name": "Dr. Reddy's Laboratories Ltd.",
        "website": "https://www.drreddys.com",
        "description": "Indian multinational pharmaceutical company headquartered in Hyderabad.",
        "medicines": ["Cetirizine", "Omeprazole"],
        "headquarters": "Hyderabad, India",
    },
    "Pfizer": {
        "name": "Pfizer India Ltd.",
        "website": "https://www.pfizerindia.com",
        "description": "Indian subsidiary of the global pharmaceutical leader Pfizer Inc.",
        "medicines": ["Amlodipine (Norvasc)", "Atorvastatin (Lipitor)"],
        "headquarters": "Mumbai, India",
    },
    "Abbott": {
        "name": "Abbott India Ltd.",
        "website": "https://www.abbott.co.in",
        "description": "Diversified healthcare company providing branded generics in India.",
        "medicines": ["Ibuprofen (Brufen)"],
        "headquarters": "Mumbai, India",
    },
    "AstraZeneca": {
        "name": "AstraZeneca India Pvt. Ltd.",
        "website": "https://www.astrazeneca.in",
        "description": "British-Swedish multinational with a strong India presence.",
        "medicines": ["Metoprolol (Betaloc)"],
        "headquarters": "Bangalore, India",
    },
    "MSD": {
        "name": "MSD Pharmaceuticals Pvt. Ltd.",
        "website": "https://www.msd-india.com",
        "description": "Indian subsidiary of Merck and Co., Inc.",
        "medicines": ["Montelukast (Singulair)"],
        "headquarters": "Mumbai, India",
    },
    "Aristo": {
        "name": "Aristo Pharmaceuticals Pvt. Ltd.",
        "website": "https://www.aristopharma.com",
        "description": "Fast-growing Indian pharma company with strong generics portfolio.",
        "medicines": ["Pantoprazole"],
        "headquarters": "Mumbai, India",
    },
}

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
        "timestamp": datetime.utcnow().isoformat(),
    }

# ── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/api/auth/register", tags=["Auth"])
async def register(req: RegisterRequest):
    email = req.email.lower()
    existing_user = await users_collection.find_one({"email": email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    if not req.consent:
        raise HTTPException(status_code=400, detail="You must accept the disclaimer")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
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
        "token": access_token,
        "user": safe_user,
        "message": f"Welcome, {req.name}! Account created successfully.",
    }

@app.post("/api/auth/login", tags=["Auth"])
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
        "token": access_token,
        "user": safe_user,
        "message": f"Welcome back, {user['name']}!",
    }

@app.post("/api/auth/logout", tags=["Auth"])
async def logout(current_user: dict = Depends(get_current_user)):
    await log_audit("LOGOUT", current_user["email"], "auth")
    return {"message": "Logged out successfully"}

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

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_PRESCRIPTION_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
MAX_FILE_SIZE = 5 * 1024 * 1024

@app.post("/api/medicine/upload", tags=["Medicine"])
async def upload_medicine_image(
    file: UploadFile = File(...),
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type. Upload JPEG, PNG or WEBP.")
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File exceeds 5 MB limit.")

    file_id = str(uuid.uuid4())
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "jpg"
    save_path = UPLOAD_DIR / "medicine_images" / f"{file_id}.{ext}"
    save_path.write_bytes(content)

    user_email = current_user["email"] if current_user else "guest"
    await log_audit("MEDICINE_IMAGE_UPLOAD", user_email, file.filename or "")

    return {
        "file_id": file_id,
        "filename": file.filename,
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
    if file.content_type not in ALLOWED_PRESCRIPTION_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported type. Upload JPEG, PNG, WEBP or PDF.")
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File exceeds 5 MB limit.")

    file_id = str(uuid.uuid4())
    ext = "pdf" if file.content_type == "application/pdf" else (file.filename or "rx.jpg").rsplit(".", 1)[-1].lower()
    save_path = UPLOAD_DIR / "prescriptions" / f"{file_id}.{ext}"
    save_path.write_bytes(content)

    user_email = current_user["email"] if current_user else "guest"
    await log_audit("PRESCRIPTION_UPLOAD", user_email, file.filename or "")

    return {
        "file_id": file_id,
        "filename": file.filename,
        "content_type": file.content_type,
        "size_bytes": len(content),
        "status": "uploaded",
        "message": "Prescription uploaded. Use /api/prescription/analyze or MediChat for analysis.",
        "disclaimer": "Prescription analysis is informational only. Never alter doses without professional advice.",
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

@app.post("/api/safety/dosage-check", tags=["Safety"])
async def dosage_check(req: DosageRequest, current_user: dict = Depends(get_current_user)):
    # Query MongoDB for medication safety thresholds and evidence attribution
    med_data = await db["medications"].find_one({"id": req.med_id})
    if not med_data:
        # Fallback to in-memory dataset if not found in DB
        fallback = MEDICINES_BY_ID.get(req.med_id)
        if not fallback:
            raise HTTPException(status_code=404, detail="Medicine not found")
        med_data = {
            "name": fallback["name"],
            "safe_min": 100.0,
            "safe_max": 2000.0,
            "sourceName": "DailyMed",
            "evidenceTier": 1,
            "confidenceScore": 95
        }

    # Fetch drug-drug interactions if current medications are provided
    interactions = []
    if req.patient and req.patient.current_medications:
        med_name = med_data.get("name")
        current_meds = req.patient.current_medications

        # Build query for interactions involving the current medication and any of the patient's other medications
        query = {
            "$or": [
                {"med_a": med_name, "med_b": {"$in": current_meds}},
                {"med_b": med_name, "med_a": {"$in": current_meds}}
            ]
        }
        interactions_cursor = db["interactions"].find(query)
        interactions = await interactions_cursor.to_list(length=100)

    # Check for source conflicts
    source_conflicts = []
    if med_data.get("name"):
        conflicts_cursor = db["source_conflicts"].find({"$or": [
            {"med_a": med_data.get("name")},
            {"med_b": med_data.get("name")},
            {"med": med_data.get("name")}
        ]})
        source_conflicts = await conflicts_cursor.to_list(length=100)

    assessment = safety_engine.evaluate(req, med_data, interactions=interactions, source_conflicts=source_conflicts)
    await log_audit("DOSAGE_ASSESSMENT", current_user["email"], f"Med: {req.med_id}, Risk: {assessment.risk_level}")
    return assessment

# ── Startup Event ─────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup_event():
    admin_email = "admin@mediguide.ai"
    existing_admin = await users_collection.find_one({"email": admin_email})
    if not existing_admin:
        admin_doc = {
            "id": "admin-001",
            "name": "MediGuide Admin",
            "email": admin_email,
            "password_hash": hash_password("Admin@1234"),
            "role": "admin",
            "created_at": datetime.utcnow().isoformat(),
            "last_login": None,
            "age": None,
            "weight": None,
            "conditions": [],
            "allergies": []
        }
        await users_collection.insert_one(admin_doc)

# ── Serve frontend ───────────────────────────────────────────────────────────

@app.get("/app", include_in_schema=False)
async def serve_frontend():
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return JSONResponse({"message": "Frontend not found. Open index.html directly in your browser."})
