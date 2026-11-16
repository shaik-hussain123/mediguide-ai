from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

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
