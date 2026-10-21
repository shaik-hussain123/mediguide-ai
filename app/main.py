from pathlib import Path
import csv
import io
import re
import time
from collections import defaultdict, deque
from threading import Lock
from uuid import uuid4
from fastapi import Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session
from .config import settings
from .database import Base, SessionLocal, engine, get_db
from .models import AuditLog, Company, Medicine, TokenRevocation, Upload, User
from .schemas import ChatIn, LoginIn, MedicineIn, ProfileUpdate, RegisterIn
from .security import admin_user, create_token, current_user, hash_password, revoke_token, verify_password

Base.metadata.create_all(bind=engine)
app = FastAPI(title="MediGuide AI", version="0.1.0", description="Medicine information prototype. Not medical advice.")
UPLOAD_DIR = Path(settings.upload_dir).resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf"}
AUTH_ATTEMPTS: dict[str, deque[float]] = defaultdict(deque)
AUTH_ATTEMPTS_LOCK = Lock()


@app.middleware("http")
async def security_headers_and_request_guards(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.cookies.get("mediguide_access"):
        if request.headers.get("origin") != settings.public_origin:
            return JSONResponse({"detail": "Request origin could not be verified."}, status_code=403)
    if settings.environment.lower() != "production" and request.url.path in {"/api/auth/login", "/api/auth/register"} and request.method == "POST":
        client_ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        with AUTH_ATTEMPTS_LOCK:
            attempts = AUTH_ATTEMPTS[client_ip]
            while attempts and now - attempts[0] > 300:
                attempts.popleft()
            if len(attempts) >= 10:
                return JSONResponse({"detail": "Too many sign-in attempts. Wait a few minutes and try again."}, status_code=429, headers={"Retry-After": "300"})
            attempts.append(now)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if not request.url.path.startswith("/docs") and request.url.path != "/openapi.json":
        response.headers.setdefault("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; connect-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
    return response


def set_session_cookie(response: Response, user: User) -> None:
    response.set_cookie(
        "mediguide_access",
        create_token(user),
        max_age=settings.access_token_minutes * 60,
        httponly=True,
        secure=settings.environment.lower() == "production",
        samesite="strict",
        path="/api",
    )


def matches_file_signature(content_type: str, data: bytes) -> bool:
    signatures = {
        "image/jpeg": data.startswith(b"\xff\xd8\xff"),
        "image/png": data.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP",
        "application/pdf": data.startswith(b"%PDF-"),
    }
    return signatures.get(content_type, False)


def seed_demo_data():
    with SessionLocal() as db:
        data_dir = Path(__file__).resolve().parent.parent / "data"
        catalog_files = (data_dir / "india_nlem_2022.csv", data_dir / "cdsco_new_drugs_2025_2026.csv")
        existing = {(m.name, m.source_url) for m in db.scalars(select(Medicine)).all()}
        for catalog_file in catalog_files:
            with catalog_file.open(encoding="utf-8-sig", newline="") as source:
                for row in csv.DictReader(source):
                    key = (row["name"], row["source_url"])
                    if key not in existing:
                        db.add(Medicine(**row))
                        existing.add(key)
                    elif row["source_name"] in {"India NLEM 2022 (CDSCO/MoHFW)", "CDSCO New Drug Approvals 2025", "CDSCO New Drug Approvals 2026"} or row["name"] == "Dolo 650":
                        # Keep source-owned seed rows in sync while leaving admin entries untouched.
                        catalog_record = db.scalar(select(Medicine).where(Medicine.name == row["name"], Medicine.source_url == row["source_url"]))
                        if catalog_record:
                            for field in ("generic_name", "active_ingredient", "strength", "dosage_form", "description", "warnings", "regulatory_status", "source_name", "source_date"):
                                setattr(catalog_record, field, row[field])
        # Remove only the known fake development placeholder so searches show
        # genuine sourced records; preserve any other existing catalog entries.
        for placeholder in db.scalars(select(Medicine).where(Medicine.source_name == "Unverified development seed")).all():
            db.delete(placeholder)
        company = db.scalar(select(Company).where(Company.name == "Micro Labs Ltd."))
        if not company:
            company = Company(name="Micro Labs Ltd.", website="https://www.microlabsltd.com/")
            db.add(company)
            db.flush()
        # The NPPA record identifies Micro Labs Ltd. as the manufacturer.
        # Attach it on every startup so existing seeded databases are repaired too.
        dolo = db.scalar(select(Medicine).where(Medicine.name == "Dolo 650", Medicine.source_url == "https://nppa.gov.in/uploads/tender/20a806e04d7983589b93c06d1aaf28d3.pdf"))
        if dolo:
            dolo.manufacturer_id = company.id
        db.commit()


seed_demo_data()


# These are source registries, not a declaration that a product is currently
# licensed for sale. CDSCO separates central approvals, brand reporting,
# prohibitions, and state licensing; each record must retain its own provenance.
REGULATORY_SOURCES = [
    {"id": "cdsco-new-drugs", "name": "CDSCO Approved New Drugs", "url": "https://cdsco.gov.in/opencms/en/Approval_new/Approved-New-Drugs/", "scope": "Annual central new-drug approval lists, including 2025 and 2026-to-date records", "limitation": "Only selected finished-product entries from the 2025 list (through 2025-08-19) and 2026 list (through 2026-03-10) are imported here. Central approval does not prove a current product-specific state licence or market availability."},
    {"id": "cdsco-sugam-approved-products", "name": "CDSCO SUGAM Approved Drugs/Vaccines/r-DNA/Blood Products", "url": "https://cdscoonline.gov.in/CDSCO/cdscoAppDrugs", "scope": "CDSCO searchable approved drugs, vaccines, r-DNA and blood products", "limitation": "Search portal, not a verified downloadable register of current state manufacturing and sale licences; not bulk-imported into this catalog."},
    {"id": "cdsco-fdc", "name": "CDSCO Fixed Dose Combinations", "url": "https://www.cdsco.gov.in/opencms/opencms/en/Drugs/FDC/", "scope": "FDC approvals, prohibitions, restrictions, and related notices", "limitation": "Lists have different legal effects and dates; confirm the specific Gazette notification and current court/status updates."},
    {"id": "cdsco-banned", "name": "CDSCO Banned Drugs", "url": "https://www.cdsco.gov.in/opencms/opencms/en/consumer/List-Of-Banned-Drugs/", "scope": "CDSCO's public prohibited-drugs list", "limitation": "The page's linked list is dated 2018; it is not a complete current prohibition feed."},
    {"id": "cdsco-sugam-brands", "name": "CDSCO SUGAM Approved Brand Names", "url": "https://cdscoonline.gov.in/CDSCO/brandNames", "scope": "Searchable approved brand names under Rule 84AB", "limitation": "Search interface, not a complete downloadable product and licence database."},
    {"id": "state-licensing", "name": "State Drug Licensing Authorities", "url": "https://www.cdsco.gov.in/opencms/opencms/en/State-Drugs-Control/", "scope": "State and UT licensing authorities", "limitation": "State-issued manufacturing and sale licences are needed to establish current market legality; coverage is not consolidated here."},
]


@app.get("/api/regulatory/sources")
def regulatory_sources():
    return {"jurisdiction": "India", "as_of": __import__("datetime").date.today().isoformat(), "sources": REGULATORY_SOURCES, "legal_status_note": "This catalog cannot certify that a medicine is currently legal to manufacture, sell, or use. Central approval, state licences, prohibitions, product identity, and current amendments must be checked separately. UNKNOWN means not verified."}


@app.post("/api/admin/medicines/import-csv")
async def import_medicines_csv(file: UploadFile = File(...), admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    """Import a reviewed CSV export; never use an LLM to infer legal status.

    Required columns: name,generic_name,active_ingredient,strength,dosage_form,
    regulatory_status,source_name,source_url. Optional: description,warnings,source_date.
    APPROVED imports are stored as UNKNOWN because approval alone cannot prove
    current product-level state licensing. PROHIBITED remains explicit.
    """
    if file.filename and not file.filename.lower().endswith(".csv"):
        raise HTTPException(415, "Upload a CSV export.")
    raw = await file.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(413, "CSV exceeds the 5 MB limit.")
    try:
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    except UnicodeDecodeError:
        raise HTTPException(400, "CSV must use UTF-8 encoding.")
    required = {"name", "generic_name", "active_ingredient", "strength", "dosage_form", "regulatory_status", "source_name", "source_url"}
    if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
        raise HTTPException(422, "CSV is missing required columns: " + ", ".join(sorted(required - set(reader.fieldnames or []))))
    allowed_status = {"UNKNOWN", "APPROVED", "PROHIBITED", "RESTRICTED"}
    created = updated = 0
    for line, row in enumerate(reader, start=2):
        values = {k: (row.get(k) or "").strip() for k in required | {"description", "warnings", "source_date"}}
        if not all(values[k] for k in required):
            raise HTTPException(422, f"CSV row {line} has a blank required value.")
        status = values["regulatory_status"].upper()
        if status not in allowed_status:
            raise HTTPException(422, f"CSV row {line} has an unsupported status.")
        if not values["source_url"].startswith("https://"):
            raise HTTPException(422, f"CSV row {line} must cite an HTTPS source URL.")
        # Central approvals are not evidence of a current product-specific state licence.
        if status == "APPROVED":
            status = "UNKNOWN"
        m = db.scalar(select(Medicine).where(Medicine.name == values["name"], Medicine.source_url == values["source_url"]))
        payload = {k: values[k] for k in ("name", "generic_name", "active_ingredient", "strength", "dosage_form", "description", "warnings", "source_name", "source_url", "source_date")}
        payload["regulatory_status"] = status
        if m:
            for key, value in payload.items():
                setattr(m, key, value)
            updated += 1
        else:
            db.add(Medicine(**payload)); created += 1
    db.add(AuditLog(user_id=admin.id, action="medicine.csv_import", resource=f"created={created},updated={updated}"))
    db.commit()
    return {"created": created, "updated": updated, "note": "Imports labeled APPROVED were saved as UNKNOWN; central approval does not verify current state licensing. Source and date are retained."}


@app.get("/api/health")
def health():
    return {"status": "ok", "environment": settings.environment}


@app.post("/api/auth/register", status_code=201)
def register(body: RegisterIn, response: Response, db: Session = Depends(get_db)):
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists.")
    user = User(name=body.name.strip(), email=email, password_hash=hash_password(body.password))
    db.add(user); db.commit(); db.refresh(user)
    set_session_cookie(response, user)
    return {"token_type": "cookie", "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role}}


@app.post("/api/auth/login")
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Email or password is incorrect.")
    set_session_cookie(response, user)
    return {"token_type": "cookie", "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role}}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    token = request.cookies.get("mediguide_access")
    authorization = request.headers.get("authorization", "")
    if not token and authorization.lower().startswith("bearer "):
        token = authorization[7:]
    if token:
        revoke_token(token, db)
        db.execute(delete(TokenRevocation).where(TokenRevocation.expires_at < datetime.now(timezone.utc)))
        db.commit()
    response.delete_cookie("mediguide_access", path="/api", httponly=True, secure=settings.environment.lower() == "production", samesite="strict")
    return {"message": "Signed out."}


@app.get("/api/profile")
def profile(user: User = Depends(current_user)):
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role}


@app.put("/api/profile")
def update_profile(body: ProfileUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.name = body.name.strip(); db.commit()
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role}


def medicine_json(m: Medicine, company: Company | None = None):
    return {"id": m.id, "name": m.name, "generic_name": m.generic_name, "active_ingredient": m.active_ingredient, "strength": m.strength, "dosage_form": m.dosage_form, "manufacturer": company.name if company else None, "description": m.description, "warnings": m.warnings, "regulatory_status": m.regulatory_status, "source_name": m.source_name, "source_url": m.source_url, "source_date": m.source_date}


@app.get("/api/medicine/search")
def search_medicines(q: str = "", db: Session = Depends(get_db)):
    if len(q) > 120:
        raise HTTPException(422, "Search text is too long.")
    stmt = select(Medicine).outerjoin(Company, Medicine.manufacturer_id == Company.id)
    if q.strip():
        term = f"%{q.strip()}%"
        compact_term = f"%{q.strip().replace(' ', '').lower()}%"
        stmt = stmt.where(or_(Medicine.name.ilike(term), func.replace(func.lower(Medicine.name), " ", "").ilike(compact_term), Medicine.generic_name.ilike(term), Medicine.active_ingredient.ilike(term), Company.name.ilike(term), Medicine.strength.ilike(term), Medicine.dosage_form.ilike(term)))
    rows = db.scalars(stmt.order_by(Medicine.name).limit(30)).all()
    return [medicine_json(m, db.get(Company, m.manufacturer_id) if m.manufacturer_id else None) for m in rows]


@app.get("/api/medicine/{medicine_id}")
def medicine_detail(medicine_id: int, db: Session = Depends(get_db)):
    m = db.get(Medicine, medicine_id)
    if not m: raise HTTPException(404, "Medicine not found.")
    return medicine_json(m, db.get(Company, m.manufacturer_id) if m.manufacturer_id else None)


@app.get("/api/medicine/{medicine_id}/alternatives")
def alternatives(medicine_id: int, db: Session = Depends(get_db)):
    m = db.get(Medicine, medicine_id)
    if not m: raise HTTPException(404, "Medicine not found.")
    rows = db.scalars(select(Medicine).where(Medicine.id != m.id, Medicine.active_ingredient.ilike(m.active_ingredient), Medicine.strength == m.strength, Medicine.dosage_form == m.dosage_form).order_by(Medicine.name).limit(20)).all()
    return {"notice": "These are catalog records with matching ingredient, strength, and form; this is not a recommendation or confirmation of interchangeability. Ask a pharmacist or prescriber before switching.", "items": [medicine_json(x, db.get(Company, x.manufacturer_id) if x.manufacturer_id else None) for x in rows]}


@app.get("/api/admin/stats")
def admin_stats(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    status_counts = dict(db.execute(select(Medicine.regulatory_status, func.count()).group_by(Medicine.regulatory_status)).all())
    return {
        "users": db.scalar(select(func.count()).select_from(User)) or 0,
        "medicines": db.scalar(select(func.count()).select_from(Medicine)) or 0,
        "uploads": db.scalar(select(func.count()).select_from(Upload)) or 0,
        "status_counts": status_counts,
    }


@app.get("/api/company/{company_id}")
def company_detail(company_id: int, db: Session = Depends(get_db)):
    c = db.get(Company, company_id)
    if not c: raise HTTPException(404, "Company not found.")
    medicines = db.scalars(select(Medicine).where(Medicine.manufacturer_id == c.id)).all()
    return {"id": c.id, "name": c.name, "website": c.website, "description": c.description, "medicines": [medicine_json(m) for m in medicines]}


@app.post("/api/uploads", status_code=201)
async def upload_document(file: UploadFile = File(...), purpose: str = "document", user: User = Depends(current_user), db: Session = Depends(get_db)):
    if file.content_type not in ALLOWED:
        raise HTTPException(415, "Upload a JPG, PNG, WEBP, or PDF file.")
    data = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File exceeds the {settings.max_upload_mb} MB limit.")
    if not data:
        raise HTTPException(400, "The selected file is empty.")
    if not matches_file_signature(file.content_type, data):
        raise HTTPException(415, "The file contents do not match the selected file type.")
    stored = f"{uuid4().hex}{ALLOWED[file.content_type]}"
    (UPLOAD_DIR / stored).write_bytes(data)
    row = Upload(user_id=user.id, stored_name=stored, original_name=(file.filename or "upload")[:255], content_type=file.content_type, purpose=purpose[:30])
    db.add(row); db.commit(); db.refresh(row)
    db.add(AuditLog(user_id=user.id, action="upload.created", resource=str(row.id))); db.commit()
    return {"id": row.id, "filename": row.original_name, "purpose": row.purpose, "status": "received", "message": "File stored privately. OCR is not configured; no medicine or dosage has been identified."}


@app.post("/api/prescription/analyze")
def analyze_prescription(upload_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.get(Upload, upload_id)
    if not row or row.user_id != user.id:
        raise HTTPException(404, "Document not found.")
    return {"upload_id": row.id, "status": "needs_review", "extracted_fields": [], "message": "Prescription OCR is not configured. No instructions were inferred. Please consult your prescriber or pharmacist about unclear directions."}


@app.get("/api/uploads/{upload_id}/download")
def download_upload(upload_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.get(Upload, upload_id)
    if not row or (row.user_id != user.id and user.role != "admin"):
        raise HTTPException(404, "Document not found.")
    return FileResponse(UPLOAD_DIR / row.stored_name, media_type=row.content_type, filename=row.original_name)


def retrieve_medicine_matches(question: str, db: Session) -> list[Medicine]:
    # Match a medicine identity, never generic catalog prose. Otherwise a broad
    # question such as "show medicine details" can retrieve arbitrary NLEM rows.
    stop_words = {
        "what", "which", "about", "does", "this", "that", "have", "with", "from", "tell", "show", "find", "give", "used", "use", "for", "the", "and", "are", "can", "you",
        "medicine", "medicines", "drug", "drugs", "details", "detail", "information", "info", "catalog", "listed", "list", "please", "me", "is", "of", "in", "on", "to", "my", "its", "it",
    }
    words = [w for w in re.findall(r"[a-z0-9]+", question.lower()) if len(w) > 2 and w not in stop_words]
    columns = (Medicine.name, Medicine.generic_name, Medicine.active_ingredient, Medicine.strength, Medicine.dosage_form, Medicine.description, Medicine.warnings)
    conditions = [column.ilike(f"%{word}%") for word in words for column in columns]
    compact_query = re.sub(r"[^a-z0-9]", "", question.lower())
    if compact_query:
        compact_name = func.replace(func.replace(func.replace(func.lower(Medicine.name), " ", ""), "-", ""), ".", "")
        conditions.append(compact_name.ilike(f"%{compact_query}%"))
    rows = db.scalars(select(Medicine).where(or_(*conditions)).order_by(Medicine.name).limit(100)).all() if conditions else []
    def relevance(m: Medicine) -> tuple[int, int]:
        identity = re.sub(r"[^a-z0-9]", "", f"{m.name} {m.generic_name} {m.active_ingredient}".lower())
        record = re.sub(r"[^a-z0-9]", "", f"{m.name} {m.generic_name} {m.active_ingredient} {m.strength} {m.dosage_form}".lower())
        identity_hits = sum(word in identity for word in words)
        total_hits = sum(word in record for word in words)
        name_exact = bool(compact_query and compact_query in re.sub(r"[^a-z0-9]", "", m.name.lower()))
        return identity_hits, total_hits + 5 * name_exact
    scored = [(relevance(m), m) for m in rows]
    # A single best identity match avoids mixing nearby/partial catalog entries.
    # Ask the user to name a medicine if no identity term matched.
    matched = [(score, medicine) for score, medicine in scored if score[0] > 0]
    if not matched:
        return []
    matched.sort(key=lambda pair: (-pair[0][0], -pair[0][1], pair[1].name))
    return [matched[0][1]]


@app.post("/api/chat")
def chat(body: ChatIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    matches = retrieve_medicine_matches(body.question, db)
    if not matches:
        answer = "I couldn't identify a specific medicine in your question. Please enter its name or active ingredient so I can show the matching catalog record."
    else:
        summaries = []
        for m in matches:
            company = db.get(Company, m.manufacturer_id) if m.manufacturer_id else None
            summaries.append("\n".join([
                f"Medicine: {m.name}",
                f"Generic name: {m.generic_name}",
                f"Active ingredient: {m.active_ingredient}",
                f"Strength: {m.strength}",
                f"Dosage form: {m.dosage_form}",
                f"Manufacturer: {company.name if company else 'Not listed in this record'}",
                f"Catalog description: {m.description or 'Not provided in this record'}",
                f"Warnings / notes: {m.warnings or 'Not provided in this record'}",
                f"Regulatory status: {m.regulatory_status or 'UNKNOWN'}",
                f"Source: {m.source_name or 'Not provided'}",
                f"Source date/data period: {m.source_date or 'Not provided'}",
                "Clinical uses, patient-specific instructions, dosage, side effects, and storage: Not provided by this record.",
            ]))
        answer = "\n\n---\n\n".join(summaries) + "\n\nThis is catalog information, not medical advice."
    citations = [{"id": m.id, "title": m.name, "source": m.source_name, "url": m.source_url, "source_date": m.source_date, "regulatory_status": m.regulatory_status} for m in matches]
    db.add(AuditLog(user_id=user.id, action="chat.request", resource="catalog retrieval")); db.commit()
    return {"answer": answer, "citations": citations, "uncertainty": True, "disclaimer": "Informational prototype; not medical advice. No prescription changes or dosage recommendations are provided."}


@app.get("/api/admin/medicines")
def admin_medicines(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    return [medicine_json(m) for m in db.scalars(select(Medicine).order_by(Medicine.name)).all()]


@app.post("/api/admin/medicines", status_code=201)
def create_medicine(body: MedicineIn, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    payload = body.model_dump()
    if payload["regulatory_status"] == "APPROVED":
        payload["regulatory_status"] = "UNKNOWN"
    m = Medicine(**payload)
    db.add(m); db.flush(); db.add(AuditLog(user_id=admin.id, action="medicine.created", resource=str(m.id))); db.commit(); db.refresh(m)
    return medicine_json(m)


@app.get("/api/admin/audit-logs")
def admin_audit(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    return [{"id": x.id, "user_id": x.user_id, "action": x.action, "resource": x.resource, "created_at": x.created_at.isoformat()} for x in db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(100)).all()]


app.mount("/", StaticFiles(directory=Path(__file__).parent.parent / "web", html=True), name="web")
