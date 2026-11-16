from pydantic import BaseModel
from typing import Optional, List
from models.safety import EvidenceAttribution

class ClinicalFinding(BaseModel):
    ruleType: str
    severity: str  # LOW, MODERATE, HIGH, CRITICAL
    finding: str
    recommendation: str
    evidence: EvidenceAttribution
    confidenceScore: int
    triggered: bool
    ruleVersion: str = "1.0.0"

class ClinicalContext(BaseModel):
    patient: Any
    medication: Dict[str, Any]
    dosageRequest: Any
    dosageAssessment: Any
