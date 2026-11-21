"""Shared dependencies and utilities for API routes.

This module breaks circular imports between main.py and route modules.
"""

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorDatabase
from typing import Optional, Dict
import jwt
from datetime import datetime
from passlib.context import CryptContext
import os

# Load environment
from dotenv import load_dotenv
load_dotenv()

# JWT Security - Must be set via environment, minimum 32 bytes for HS256
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is required but not set")
if len(SECRET_KEY) < 32:
    raise RuntimeError("SECRET_KEY must be at least 32 characters for HS256")

ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# These will be initialized by main.py
db: Optional[AsyncIOMotorDatabase] = None
users_collection = None
audit_collection = None


def init_db(database: AsyncIOMotorDatabase):
    """Initialize database collections - called from main.py"""
    global db, users_collection, audit_collection
    db = database
    users_collection = database["users"]
    audit_collection = database["audit_logs"]


async def log_audit(action: str, user: str = "anonymous", resource: str = ""):
    """Log an action to audit collection."""
    if audit_collection is None:
        return
    audit_entry = {
        "action": action,
        "user": user,
        "resource": resource,
        "timestamp": datetime.utcnow().isoformat(),
    }
    await audit_collection.insert_one(audit_entry)


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Get current authenticated user from JWT token."""
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")

    if users_collection is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Database not initialized")

    user = await users_collection.find_one({"email": email})
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    user["_id"] = str(user["_id"])
    return user


async def get_current_user_optional(request: Request) -> Optional[dict]:
    """Get current user if token provided, otherwise return None."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth.replace("Bearer ", "").strip()
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email and users_collection is not None:
            user = await users_collection.find_one({"email": email})
            if user:
                user["_id"] = str(user["_id"])
                return user
    except Exception:
        pass
    return None


def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Require admin role."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict, expires_delta=None) -> str:
    from datetime import timedelta
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# In-memory medicine data (moved from main.py to break circular import)
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