from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

class PatientProfile(BaseModel):
    age: int = Field(..., ge=0, le=120)
    weight_kg: Optional[float] = Field(None, gt=0)
    is_pregnant: bool = False
    is_lactating: bool = False
    conditions: List[str] = Field(default_factory=list)
    current_medications: List[str] = Field(default_factory=list)

class DosageRequest(BaseModel):
    med_id: int
    dosage: float = Field(..., gt=0)
    unit: str = "mg"
    frequency: str = "OD"
    route: str = "oral"
    patient: Optional[PatientProfile] = None

class EvidenceAttribution(BaseModel):
    sourceName: str
    sourceUrl: Optional[str] = None
    sourceVersion: Optional[str] = "2026.1"
    evidenceTier: int = Field(1, ge=1, le=4)
    confidenceScore: int = Field(95, ge=0, le=100)
    retrievalDate: str = "2026-11-14"

class ClinicalFinding(BaseModel):
    ruleType: str
    severity: str
    finding: str
    recommendation: str
    evidence: EvidenceAttribution
    confidenceScore: int
    triggered: bool
    ruleVersion: str = "1.0.0"

class SafetyScoreRequest(BaseModel):
    med_ids: List[int]
    patient: Optional[PatientProfile] = None

class SafetyScoreResponse(BaseModel):
    score: float
    risk_category: str
    gauge_color: str
    total_medications: int
    total_findings: int
    severity_breakdown: dict
    assessments: List[dict]
    top_concerns: List[dict]
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())

class DosageSafetyRequest(BaseModel):
    med_id: int
    dosage: float
    frequency: str
    patient: Optional[PatientProfile] = None

class DosageSafetyResponse(BaseModel):
    med_name: str
    input_dosage: float
    unit: str
    frequency: str
    daily_exposure: float
    reference_min: float
    reference_max: float
    risk_level: str
    overallClinicalSeverity: str
    findings: List[ClinicalFinding]
    evidence_tier: int
    confidence_score: int
    disclaimer: str

class DrugInteractionRequest(BaseModel):
    med_ids: List[int]
    patient: Optional[PatientProfile] = None

class DrugInteractionResponse(BaseModel):
    interactions: List[dict]
    total_interactions: int
    severity_breakdown: dict
    highest_severity: str
    recommendations: List[str]

class DosageAssessment(BaseModel):
    med_name: str
    input_dosage: float
    unit: str
    frequency: str
    daily_exposure: float
    reference_min: float
    reference_max: float
    risk_level: str
    overallClinicalSeverity: Optional[str] = "LOW"
    findings: List[ClinicalFinding] = Field(default_factory=list)
    safety_notes: List[str]
    warnings: List[str] = Field(default_factory=list)
    evidence: EvidenceAttribution
    disclaimer: str = "For educational and clinical decision-support purposes only. Always verify recommendations using official prescribing information and qualified healthcare professionals."


class DosageCheckResponse(BaseModel):
    """Response wrapper for dosage safety check."""
    success: bool = True
    data: DosageAssessment
    message: str = "Dosage safety check completed"
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class SafetyScoreResponseWrapper(BaseModel):
    """Response wrapper for safety score."""
    success: bool = True
    data: SafetyScoreResponse
    message: str = "Safety score calculated"
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class InteractionCheckResponse(BaseModel):
    """Response wrapper for drug interaction check."""
    success: bool = True
    data: DrugInteractionResponse
    message: str = "Interaction check completed"
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
