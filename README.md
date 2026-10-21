# MediGuide AI

An informational medicine reference MVP built with FastAPI and a responsive HTML/CSS/JavaScript interface. It includes secure accounts, catalog search, source and regulatory labels, private document intake, prescription review scaffolding, and a retrieval-grounded assistant with explicit safety boundaries.

> This project is an educational prototype. It does not diagnose, prescribe, verify treatment, or replace a doctor or pharmacist. Seed records are illustrative and must not be treated as verified medical advice.

## Run locally

1. Install Python 3.11+.
2. Create and activate a virtual environment.
3. Run `pip install -r requirements.txt`.
4. Copy `.env.example` to `.env`; set `SECRET_KEY` to a unique random value (at least 32 bytes), set `DB_PASSWORD`, and keep `.env` private. For local setup, Python can generate values with `secrets.token_urlsafe(48)`.
5. Run `uvicorn app.main:app --reload` from this directory.
6. Open `http://127.0.0.1:8000`. API docs are at `/docs`.

The default database is SQLite for an easy local demo. Set `DATABASE_URL` to PostgreSQL for deployment. Do not use the development secret or SQLite default for production.

To enable an administrator after registering the account, run `python -m app.create_admin user@example.com` in the same environment as the application database. For Docker Compose, set `PUBLIC_ORIGIN` to the exact public HTTPS origin, set `SECRET_KEY` and `DB_PASSWORD`, then run `docker compose up --build`. Put the Nginx proxy behind a TLS-enabled ingress or configure TLS before exposing it publicly.

## Included

- Registration, login, logout, HttpOnly same-site session cookies, Argon2 password hashing, and user profile.
- Medicine search with result counts, source-backed record details, cautious exact-match catalog comparisons, a company lookup endpoint, and clearly labeled pharmacy search links.
- Private image/PDF upload with file type and size checks; extraction is intentionally left unverified pending OCR configuration and human review.
- Text assistant that retrieves matching catalog records and cites them. It abstains when the catalog cannot support an answer; no external LLM is called by default.
- Admin-only catalog creation, import and audit-log access, plus aggregate user/catalog/upload counts. No personal upload content is included in dashboard totals.
- Docker and Nginx deployment starter.

## Repository workflow

This project is initialized with a `main` branch and a GitHub Actions verification workflow. Create feature branches from `main`, open a pull request, and merge after the automated syntax checks pass. Before the first push, add a GitHub remote for the repository you create in your GitHub account.

The browser assistant remains catalog-backed by default. A third-party model is not enabled until a server-only API key, provider privacy settings, medical guardrails, and a reviewed response policy are configured.

## Before real-world use

The app bootstraps 403 source-linked catalog entries: 384 NLEM 2022 medicines, one separately sourced Dolo 650 entry, and 18 finished-product entries selected from CDSCO's 2025 and 2026 year-to-date new-drug approval lists. The included 2025 list has entries through 2025-08-19; the included 2026 list has entries through 2026-03-10. This is a reference catalog, not a complete list of medicines currently legal for sale. NLEM listing and central new-drug approval do not establish a current product-specific state licence or market availability. Keep unverified product-level legality as `UNKNOWN`. The official CDSCO SUGAM approved-drugs search is linked as a source but is not bulk-imported because this project has no verified complete downloadable register from that portal. The Lovable SQL example includes unsupported dosage/usage claims and an `Approved` default; those records and claims were not imported. Uploads are private and stored under random server filenames, but production use still requires malware scanning, a tested retention/deletion policy, backups, monitoring, and legal/regulatory review. Run behind TLS. Sign-in requests are rate limited; browser sessions use HttpOnly, SameSite cookies, origin checks, CSP, and security headers. The in-process development limiter is not a substitute for edge protection; Docker Nginx applies an IP-based sign-in limit. Audio/video processing and live pharmacy inventory lookup are not implemented in this MVP.

## Main routes

`POST /api/auth/register`, `/api/auth/login`, `/api/auth/logout`; `GET/PUT /api/profile`; `GET /api/medicine/search?q=...`; `GET /api/medicine/{id}`; `POST /api/uploads`; `POST /api/prescription/analyze`; `POST /api/chat`; `GET /api/medicine/{id}/alternatives`; `GET /api/company/{id}`; `/api/admin/*`.

## India regulatory catalog: scope and imports

`GET /api/regulatory/sources` publishes the official source register and its limitations. It covers CDSCO's approved new-drug lists, SUGAM approved drugs/vaccines search and brand-name search, FDC approvals/prohibitions, the older banned-drug list, and the state licensing-authority directory. These sources are not a single comprehensive, machine-readable list. In particular, CDSCO's general banned-drug list page links a 2018 list, while the FDC area has later notices and Gazette notifications. SUGAM offers searchable portals, but the app has not verified a public complete bulk export. The app therefore does not claim to contain all drugs that are legal in India.

An administrator can import a reviewed, source-derived CSV through `POST /api/admin/medicines/import-csv` (multipart field `file`). Required headers: `name,generic_name,active_ingredient,strength,dosage_form,regulatory_status,source_name,source_url`; optional headers: `description,warnings,source_date`. Status values are `UNKNOWN`, `APPROVED`, `PROHIBITED`, and `RESTRICTED`. `APPROVED` is deliberately stored as `UNKNOWN`, because a central approval entry alone does not establish a current product-specific manufacturing/sale licence from the relevant state authority. Do not use a model to classify legality. Preserve the source row's wording and date, and review later amendments/court orders before marking a prohibition current. Import upserts on the source URL and exact medicine name.

The project includes the 384 medicine entries in India's NLEM 2022, extracted from the CDSCO-hosted official PDF into `data/india_nlem_2022.csv`, plus selected finished products from the official CDSCO new-drug lists in `data/cdsco_new_drugs_2025_2026.csv`. Where source tables provide a date, strength, or form, the row retains it and links to the source PDF. Records that are only ingredient or bulk-drug approvals are not represented as finished products. These sources are useful additions, not a complete national register of every medicine or proof that a particular product is currently licensed for sale. Status remains `UNKNOWN` throughout. `scripts/build_nlem_catalog.py` rebuilds the NLEM CSV from its official PDF and requires `pypdf`.
