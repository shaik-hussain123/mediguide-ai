"""Dosage Safety API Routes for MediGuide AI."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List

from ...models.safety import (
    DosageRequest, PatientProfile, DosageAssessment, SafetyScoreRequest,
    SafetyScoreResponse, DosageCheckResponse, SafetyScoreResponseWrapper,
    EvidenceAttribution, ClinicalFinding
)
from ...safety_engine import DosageSafetyEngine
from ...api.db import db
from ...api.deps import log_audit, get_current_user, MEDICINES_BY_ID as FALLBACK_MEDICINES
from ...utils.rate_limiter import general_limiter


router = APIRouter(
    prefix="/api/safety",
    tags=["Safety"]
)

safety_engine = DosageSafetyEngine()


class DosageCheckRequest(BaseModel):
    """Request model for single dosage check."""
    med_id: int = Field(..., description="Medication ID")
    dosage: float = Field(..., gt=0, description="Dosage amount")
    frequency: str = Field("OD", description="Dosage frequency (OD, BD, TDS, QID, Q8H, Q12H, HS)")
    patient: Optional[PatientProfile] = Field(None, description="Optional patient profile")


@router.post("/dosage-check", response_model=DosageCheckResponse, summary="Check dosage safety for a single medication")
@general_limiter.limit("60/minute")
async def check_dosage_safety(req: DosageCheckRequest, current_user: dict = Depends(get_current_user)):
    """Perform dosage safety assessment for a single medication."""
    med_data = await db["medications"].find_one({"id": req.med_id})
    if not med_data:
        fallback = FALLBACK_MEDICINES.get(req.med_id)
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

    dosage_req = DosageRequest(
        med_id=req.med_id,
        dosage=req.dosage,
        frequency=req.frequency,
        patient=PatientProfile(**req.patient) if req.patient else None
    )

    assessment = safety_engine.evaluate(dosage_req, med_data)
    await log_audit("DOSAGE_ASSESSMENT", current_user["email"], f"Med: {req.med_id}, Dosage: {req.dosage}{req.frequency}")

    return DosageCheckResponse(data=assessment)


@router.post("/score", response_model=SafetyScoreResponseWrapper, summary="Calculate overall medication safety score")
@general_limiter.limit("60/minute")
async def calculate_safety_score(req: SafetyScoreRequest, current_user: dict = Depends(get_current_user)):
    """Generate overall medication safety score for a patient's medication list."""
    if not req.med_ids:
        raise HTTPException(status_code=400, detail="At least one medication ID required")

    patient = req.patient or {}
    if not patient and current_user.get("profile"):
        p = current_user["profile"]
        patient = {
            "age": p.get("age"),
            "weight": p.get("weight"),
            "conditions": p.get("conditions", []),
            "pregnant": p.get("pregnant", False),
            "current_medications": []
        }

    all_assessments = []
    all_findings = []
    total_risk = 0

    for med_id in req.med_ids:
        med_data = await db["medications"].find_one({"id": med_id})
        if not med_data:
            fallback_from_main = FALLBACK_MEDICINES.get(med_id)
            if fallback_from_main:
                med_data = {
                    "name": fallback_from_main["name"],
                    "safe_min": 100.0,
                    "safe_max": 2000.0,
                    "sourceName": "DailyMed",
                    "evidenceTier": 1,
                    "confidenceScore": 95
                }

        if med_data:
            dosage = 500.0
            frequency = "OD"

            other_meds = [FALLBACK_MEDICINES.get(mid, {}).get("name", "") for mid in req.med_ids if mid != med_id]
            other_meds = [m for m in other_meds if m]

            interactions = []
            if other_meds:
                query = {
                    "$or": [
                        {"med_a": med_data.get("name"), "med_b": {"$in": other_meds}},
                        {"med_b": med_data.get("name"), "med_a": {"$in": other_meds}}
                    ]
                }
                interactions_cursor = db["interactions"].find(query)
                interactions = await interactions_cursor.to_list(length=50)

            source_conflicts = []
            if med_data.get("name"):
                conflicts_cursor = db["source_conflicts"].find({"$or": [
                    {"med_a": med_data.get("name")},
                    {"med_b": med_data.get("name")},
                    {"med": med_data.get("name")}
                ]})
                source_conflicts = await conflicts_cursor.to_list(length=100)

            from ...models.safety import DosageRequest, PatientProfile
            dosage_req = DosageRequest(
                med_id=med_id,
                dosage=dosage,
                frequency=frequency,
                patient=PatientProfile(**patient) if patient else None
            )
            assessment = safety_engine.evaluate(dosage_req, med_data, interactions=interactions, source_conflicts=source_conflicts)
            all_assessments.append((med_id, assessment))

            for finding in assessment.findings:
                all_findings.append({
                    "medication": med_data.get("name"),
                    "rule_type": finding.rule_type,
                    "severity": finding.severity,
                    "finding": finding.finding,
                    "recommendation": finding.recommendation
                })

            risk_weights = {
                "INFORMATIONAL": 0,
                "CAUTION": 10,
                "ELEVATED_RISK": 25,
                "CRITICAL_REVIEW_REQUIRED": 50
            }
            total_risk += risk_weights.get(assessment.risk_level, 0)

    max_possible_risk = len(req.med_ids) * 50
    safety_score = max(0, 100 - (total_risk / max_possible_risk * 100)) if max_possible_risk > 0 else 100

    if safety_score >= 80:
        risk_category = "LOW"
        gauge_color = "var(--good)"
    elif safety_score >= 60:
        risk_category = "MODERATE"
        gauge_color = "var(--warn)"
    elif safety_score >= 30:
        risk_category = "HIGH"
        gauge_color = "var(--warn)"
    else:
        risk_category = "CRITICAL"
        gauge_color = "var(--bad)"

    severity_counts = {"LOW": 0, "MODERATE": 0, "HIGH": 0, "CRITICAL": 0}
    for f in all_findings:
        severity_counts[f["severity"]] = severity_counts.get(f["severity"], 0) + 1

    gauge_data = SafetyScoreResponse(
        score=round(safety_score, 1),
        risk_category=risk_category,
        gauge_color=gauge_color,
        total_medications=len(req.med_ids),
        total_findings=len(all_findings),
        severity_breakdown=severity_counts,
        assessments=[{
            "med_id": med_id,
            "risk_level": a.risk_level,
            "daily_exposure": a.daily_exposure
        } for med_id, a in all_assessments],
        top_concerns=sorted(all_findings, key=lambda x: {"CRITICAL": 4, "HIGH": 3, "MODERATE": 2, "LOW": 1}.get(x["severity"], 0), reverse=True)[:5]
    )

    await log_audit("SAFETY_SCORE", current_user["email"], f"Meds: {len(req.med_ids)}, Score: {safety_score:.1f}")

    return SafetyScoreResponseWrapper(data=gauge_data)
