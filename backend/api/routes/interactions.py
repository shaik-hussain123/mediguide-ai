"""Drug Interaction API Routes for MediGuide AI."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

from ...models.safety import PatientProfile, DrugInteractionResponse, InteractionCheckResponse
from ...api.db import db
from ...api.deps import log_audit, get_current_user, MEDICINES_BY_ID as FALLBACK_MEDICINES
from ...utils.rate_limiter import general_limiter


router = APIRouter(
    prefix="/api/interactions",
    tags=["Interactions"]
)


class InteractionCheckRequest(BaseModel):
    """Request model for drug interaction check."""
    med_ids: List[int] = Field(
        ...,
        description="List of medication IDs to check interactions for",
        min_length=2,
        max_length=10
    )
    patient: Optional[PatientProfile] = Field(
        None,
        description="Optional patient profile for personalized interaction assessment"
    )


@router.post("/check", response_model=InteractionCheckResponse, summary="Check drug-drug interactions")
@general_limiter.limit("60/minute")
async def check_interactions(
    req: InteractionCheckRequest,
    current_user: dict = Depends(get_current_user)
):
    """Check for drug-drug interactions among provided medications."""
    if len(req.med_ids) < 2:
        raise HTTPException(
            status_code=400,
            detail="At least 2 medication IDs required for interaction check"
        )

    assessments = []
    all_interactions = []
    total_risk = 0

    for i, med_id_i in enumerate(req.med_ids):
        med_data_i = await db["medications"].find_one({"id": med_id_i})
        if not med_data_i:
            fallback = FALLBACK_MEDICINES.get(med_id_i)
            if fallback:
                med_data_i = {
                    "name": fallback["name"],
                    "safe_min": 100.0,
                    "safe_max": 2000.0,
                    "sourceName": "DailyMed",
                    "evidenceTier": 1,
                    "confidenceScore": 95
                }
            else:
                raise HTTPException(
                    status_code=404,
                    detail=f"Medication ID {med_id_i} not found"
                )

        for med_id_j in req.med_ids[i+1:]:
            med_data_j = await db["medications"].find_one({"id": med_id_j})
            if not med_data_j:
                fallback = FALLBACK_MEDICINES.get(med_id_j)
                if fallback:
                    med_data_j = {
                        "name": fallback["name"],
                        "safe_min": 100.0,
                        "safe_max": 2000.0,
                        "sourceName": "DailyMed",
                        "evidenceTier": 1,
                        "confidenceScore": 95
                    }
                else:
                    continue

            if not med_data_i.get("name") or not med_data_j.get("name"):
                continue

            query = {
                "$or": [
                    {"med_a": med_data_i["name"], "med_b": med_data_j["name"]},
                    {"med_b": med_data_i["name"], "med_a": med_data_j["name"]},
                    {"med_a": med_data_j["name"], "med_b": med_data_i["name"]},
                    {"med_b": med_data_j["name"], "med_a": med_data_i["name"]}
                ]
            }
            interactions_cursor = db["interactions"].find(query)
            interactions = await interactions_cursor.to_list(length=50)

            interaction_findings = []
            for interaction in interactions:
                severity = interaction.get("severity", "Minor")
                risk_weights = {
                    "Minor": 0,
                    "Moderate": 10,
                    "Major": 25,
                    "Contraindicated": 50
                }
                total_risk += risk_weights.get(severity, 0)
                interaction_findings.append({
                    "med_a": interaction.get("med_a"),
                    "med_b": interaction.get("med_b"),
                    "severity": severity,
                    "description": interaction.get("description", ""),
                    "recommendation": interaction.get("recommendation", "")
                })

            assessments.append({
                "med_1": med_data_i["name"],
                "med_2": med_data_j["name"],
                "interactions": interaction_findings
            })
            all_interactions.extend(interaction_findings)

    severity_order = {"Minor": 0, "Moderate": 1, "Major": 2, "Contraindicated": 3}
    highest_severity = "Minor"
    for interaction in all_interactions:
        sev = interaction.get("severity", "Minor")
        if severity_order.get(sev, 0) > severity_order.get(highest_severity, 0):
            highest_severity = sev

    result = DrugInteractionResponse(
        interactions=all_interactions,
        total_interactions=len(all_interactions),
        severity_breakdown={
            "Minor": len([i for i in all_interactions if i.get("severity") == "Minor"]),
            "Moderate": len([i for i in all_interactions if i.get("severity") == "Moderate"]),
            "Major": len([i for i in all_interactions if i.get("severity") == "Major"]),
            "Contraindicated": len([i for i in all_interactions if i.get("severity") == "Contraindicated"]),
        },
        highest_severity=highest_severity,
        recommendations=[]
    )

    await log_audit("INTERACTION_CHECK", current_user["email"], f"Meds: {len(req.med_ids)}, Interactions: {len(all_interactions)}")

    return InteractionCheckResponse(data=result)
