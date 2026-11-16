from typing import List, Dict, Any
from models.safety import PatientProfile, DosageRequest, DosageAssessment, EvidenceAttribution
from models.clinical import ClinicalContext

class ClinicalContext:
    def __init__(
        self,
        patient: PatientProfile,
        medication: Dict[str, Any],
        dosageRequest: DosageRequest,
        dosageAssessment: DosageAssessment,
        interactions: List[Dict[str, Any]] = None,
        sourceConflicts: List[Dict[str, Any]] = None
    ):
        self.patient = patient
        self.medication = medication
        self.dosageRequest = dosageRequest
        self.dosageAssessment = dosageAssessment
        self.interactions = interactions or []
        self.sourceConflicts = sourceConflicts or []
