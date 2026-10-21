"""Build the searchable NLEM 2022 catalogue CSV from the official PDF."""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

from pypdf import PdfReader

PDF = Path(sys.argv[1])
OUT = Path(__file__).resolve().parents[1] / "data" / "india_nlem_2022.csv"
SOURCE = "https://cdsco.gov.in/opencms/opencms/system/modules/CDSCO.WEB/elements/download_file_division.jsp?num_id=OTAxMQ=="
SOURCE_DATE = "2022-09-13"

pages = PdfReader(PDF).pages
# NLEM therapeutic tables span printed pages 3 to 83 (PDF page indices 3..82).
text = "\n".join(page.extract_text() or "" for page in pages[3:83])
lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]

# Table records begin with section numbers such as 2.1.5. The medicine and
# care-level columns may wrap, so locate the record row and collect its form
# lines until the next record row. Keep only each medicine's first occurrence
# where it is repeated across therapeutic sections.
record_start = re.compile(r"^(\d+(?:\.\d+)+)\s+")
care_level = re.compile(r"\b((?:P|S|T)(?:\s*,\s*[PST])+)(?:\s+|$)")
form_start = re.compile(r"^(?:Tablet|Capsule|Oral liquid|Oral Liquid|Solid oral dosage form|Injection|Powder for|Liquid for|Topical forms|Cream|Ointment|Eye drops|Drops|Suppository|Inhaler|Solution|Suspension|Patch|Transdermal)")
records: dict[str, dict[str, str]] = {}
matches = 0
code_rows = [line for line in lines if re.match(r"^\d+(?:\.\d+)+\s+", line)]
for index, line in enumerate(lines):
    row = record_start.match(line)
    if not row:
        continue
    segment = [line[row.end():]]
    cursor = index + 1
    while cursor < len(lines) and not record_start.match(lines[cursor]):
        segment.append(lines[cursor])
        cursor += 1
    joined = " ".join(part for part in segment if part)
    level = care_level.search(joined)
    if not level:
        continue
    name = joined[:level.start()].strip().rstrip("*").strip()
    if not name:
        continue
    matches += 1
    level_line_index = next((n for n, part in enumerate(segment) if care_level.search(part)), 0)
    level_match = care_level.search(segment[level_line_index])
    form_lines: list[str] = []
    if level_match:
        inline = segment[level_line_index][level_match.end():].strip()
        if inline and form_start.match(inline):
            form_lines.append(inline)
    form_lines.extend(part.strip() for part in segment[level_line_index + 1:] if form_start.match(part.strip()))
    extracted = "; ".join(dict.fromkeys(form_lines))
    existing = records.get(name.casefold())
    if existing is None or (extracted and not existing["forms"]):
        records[name.casefold()] = {"forms": extracted}

# The NLEM's alphabetical index is the canonical 384-item roster. Table
# extraction provides formulations when a table row is text-readable; entries
# without a parsed row remain searchable but explicitly point to the PDF.
alpha_text = "\n".join(page.extract_text() or "" for page in pages[85:101])
names = []
for line in alpha_text.splitlines():
    item = re.match(r"^\s*\d+\.\s*(.+?)\s*$", line)
    if item:
        names.append(item.group(1).strip())
if len(names) != 384:
    raise SystemExit(f"Expected 384 NLEM index entries, found {len(names)}; refusing to write an incomplete catalogue.")

OUT.parent.mkdir(parents=True, exist_ok=True)
if "--debug" in sys.argv:
    print(f"coded table lines={len(code_rows)}, parsed rows={matches}, parsed medicines={len(records)}")
    print("\n".join(code_rows[:40]))
with OUT.open("w", newline="", encoding="utf-8") as file:
    writer = csv.DictWriter(file, fieldnames=["name", "generic_name", "active_ingredient", "strength", "dosage_form", "description", "warnings", "regulatory_status", "source_name", "source_url", "source_date"])
    writer.writeheader()
    for name in names:
        record = records.get(name.casefold(), {})
        form_text = record.get("forms", "")
        # Preserve a parsed formulation list verbatim in the description;
        # never infer extra brands or patient dosing instructions.
        detail_text = f" Listed NLEM formulations/strengths: {form_text}" if form_text else " Consult the linked NLEM PDF for dosage forms and strengths."
        writer.writerow({
            "name": name,
            "generic_name": name,
            "active_ingredient": name,
            "strength": "See official NLEM source",
            "dosage_form": "See official NLEM source",
            "description": "Listed in India's National List of Essential Medicines (NLEM) 2022. This is an essential-medicines reference, not confirmation of current product-level sale licensing." + detail_text,
            "warnings": "Consult the official source and a qualified healthcare professional; this entry does not provide patient-specific advice.",
            "regulatory_status": "UNKNOWN",
            "source_name": "India NLEM 2022 (CDSCO/MoHFW)",
            "source_url": SOURCE,
            "source_date": SOURCE_DATE,
        })
    writer.writerow({
        "name": "Dolo 650",
        "generic_name": "Paracetamol",
        "active_ingredient": "Paracetamol",
        "strength": "650 mg",
        "dosage_form": "Tablet",
        "description": "NPPA's DPCO ceiling-price dataset based on July 2022 data lists DOLO 650 MG TABLET (pack of 15), with Paracetamol as the ingredient and MICRO LABS LTD as the manufacturer. This historical price record does not establish a current product-specific licence or availability.",
        "warnings": "The NPPA source is a historical price dataset and does not provide product instructions. Consult the package leaflet or a healthcare professional for use-related questions.",
        "regulatory_status": "UNKNOWN",
        "source_name": "NPPA DPCO ceiling-price dataset",
        "source_url": "https://nppa.gov.in/uploads/tender/20a806e04d7983589b93c06d1aaf28d3.pdf",
        "source_date": "July 2022",
    })
print(f"Wrote {len(names) + 1} medicine entries to {OUT}; {sum(bool(value['forms']) for value in records.values())} NLEM entries had extracted form/strength text")
