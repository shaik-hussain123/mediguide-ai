# MediGuide AI Sprint 1 Task Board

## Sprint goal

Finish a safe, usable first slice of the existing MediGuide app: complete medicine details, show cautious alternatives, improve pharmacy search links, make the text assistant clearer, and prepare an image intake path that does not claim to identify a pill. Keep the current FastAPI and vanilla HTML/CSS/JavaScript architecture during this sprint.

**Length:** 10 working days
**Estimated load:** 25 story points
**Estimation note:** Story points describe relative effort, not hours. Re-estimate after Day 1 once repository access and the local run environment are confirmed.

## Current project baseline

- **Done in code:** 403 source-linked catalog records; startup seeding; medicine search with a 300 ms debounce, clear action, and name/ingredient/company/strength/form matching.
- **Partial:** Detail cards show available source-backed fields; alternatives are retrieved by exact ingredient, strength, and form but are not yet a comparison table; one pharmacy search link is present; text assistant answers from catalog records and cites its source.
- **Partial:** Private document uploads validate file type and size. OCR and image analysis are not configured.
- **Not verified:** Browser behavior, responsive widths, accessibility, performance targets, and acceptance checks have not been run.
- **Repository setup:** The current workspace does not have a Git repository. GitHub hosting and CI therefore need to be set up before CI acceptance can be met.

## Day-by-day board

| Day | Ticket | Work item | Points | Depends on | Status |
|---|---|---|---:|---|---|
| 1 | S1-01 | Repository and delivery baseline | 2 | None | Not started |
| 2 | S1-02 | Complete safe medicine detail view | 3 | Catalog provenance | Partial |
| 3 | S1-03 | Alternatives comparison table | 3 | S1-02 | Partial |
| 4 | S1-04 | Pharmacy search links | 3 | Provider URLs reviewed | Partial |
| 5 | S1-05 | Text assistant interaction and guardrails | 3 | Catalog retrieval | Partial |
| 6–7 | S1-06 | Image upload and safe text extraction path | 5 | S1-01, privacy review | Partial |
| 8 | S1-07 | Elderly-friendly display controls | 2 | Existing design tokens | Not started |
| 9 | S1-08 | Mobile and accessibility review | 2 | S1-02 through S1-07 | Not started |
| 10 | S1-09 | Sprint verification and release notes | 2 | All sprint tickets | Not started |
|  |  | **Total** | **25** |  |  |

## Ticket details

### S1-01 — Repository and delivery baseline

**Tasks:** Create or connect the GitHub repository; document `main` and development-branch workflow; verify `.gitignore`; add a license only after the owner chooses one; add a CI workflow for safe static checks.

**Acceptance:** The repository can be cloned; setup and run steps work from a clean checkout; secrets, local databases, and private uploads are ignored; CI reports pass/fail on a pull request. Do not commit `.env`, credentials, or uploaded files.

### S1-02 — Complete safe medicine detail view

**Tasks:** Present brand/catalog name, generic name, manufacturer when sourced, strength, form, source and date, and regulatory status. Display “Not listed” or “Unknown” for unavailable fields. Keep uses, side effects, age suitability, and dosage absent unless supported by a reviewed source and an approved product scope.

**Acceptance:** Every displayed medicine fact has a source or an explicit unavailable label; no “approved” badge is inferred from NLEM or central new-drug approval; the medical-information disclaimer is visible with the record.

### S1-03 — Alternatives comparison table

**Tasks:** Render catalog matches in a responsive, screen-reader-friendly table with name, manufacturer if available, ingredient, strength, form, status, and source. Retain the existing exact-match criteria.

**Acceptance:** The table does not describe matches as interchangeable or recommend switching. Pros/cons remain absent unless separately supported by reviewed clinical evidence. On narrow screens, users can still read every column without losing its label.

### S1-04 — Pharmacy search links

**Tasks:** Keep Apollo and add retailer search links only after the target domains and query behavior are reviewed. Include medicine name in each search. Open external pages in a new tab with safe link attributes.

**Acceptance:** Each link opens the correct retailer search with the intended medicine query; the UI labels these as searches and says stock, location, prescription requirements, and seller licensing must be checked on the retailer or with a pharmacist. No price or stock claim is made by MediGuide.

### S1-05 — Text assistant interaction and guardrails

**Tasks:** Make user and assistant turns visually distinct; show a clear loading state and actionable error; preserve source citations and the disclaimer. Describe the current assistant accurately as catalog-grounded retrieval. If a model is later added, keep its key on the server and only let it explain retrieved public records.

**Acceptance:** An unsupported medicine question receives an abstention; a supported question cites its record; every answer includes the safety disclaimer; the assistant does not diagnose, calculate dosage, or suggest changing a prescription.

### S1-06 — Image upload and safe text extraction path

**Tasks:** Add an image-specific path for package/label intake, using the existing private upload handling. If OCR or a model is configured, extract visible package text for user review; do not identify loose pills or present a confidence score as proof of identity. Confirm image size limits and data handling before enabling any external service.

**Acceptance:** Reject invalid file signatures and files over the documented limit; keep files private; show extracted text as unverified and require user confirmation; never say an image match proves what a pill is. If no reviewed OCR provider is configured, show that extraction is unavailable rather than fabricating a result.

### S1-07 — Elderly-friendly display controls

**Tasks:** Add a readable larger-text setting and a high-contrast option, with clear labels and a simple way to restore defaults. Store display preferences only; do not store health information in browser storage.

**Acceptance:** Controls work by keyboard and touch; text and control sizes visibly change; settings do not alter medicine facts or safety labels.

### S1-08 — Mobile and accessibility review

**Tasks:** Review layouts at 320, 480, 768, and 1440 CSS pixels; check keyboard operation, focus visibility, labels, live status messages, zoom, and horizontal overflow. Fix issues found in the sprint scope.

**Acceptance:** Search, details, alternatives, pharmacy links, and chat remain usable at each width; no clipped controls or horizontal page scrolling; unresolved WCAG issues are recorded instead of claiming compliance without an audit.

### S1-09 — Sprint verification and release notes

**Tasks:** Run the agreed functional, security, and accessibility checks; verify source links and pharmacy search behavior; record failures, limitations, and how to launch the app locally.

**Acceptance:** The checklist has a result and evidence for each check; release notes distinguish verified behavior from untested behavior; no production-readiness or medical-safety claim is made without evidence.

## Explicitly out of scope for Sprint 1

- Patient-specific dosage, age-based dosing, diagnosis, or treatment recommendations.
- “Pros” and “cons” for alternatives without reviewed clinical sources.
- Definitive identification of a loose tablet from an image.
- Sending prescriptions, uploaded images, or personal health details to a free-tier model.
- Storing an API key in `localStorage` or exposing it in browser code.
- Claiming the catalog is a complete list of drugs currently legal for sale in India.

## Sprint exit checklist

- [ ] S1-01 repository and CI baseline is available.
- [ ] S1-02 medicine details preserve source provenance and unknown values.
- [ ] S1-03 alternatives compare catalog attributes without implying substitution.
- [ ] S1-04 pharmacy searches open the reviewed retailer pages.
- [ ] S1-05 text assistant abstains when records do not support an answer.
- [ ] S1-06 image intake is private and does not claim pill identification.
- [ ] S1-07 display controls work without storing health data.
- [ ] S1-08 mobile and accessibility checks are recorded.
- [ ] S1-09 verification evidence and known limits are documented.
