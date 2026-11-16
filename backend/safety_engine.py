from typing import Dict, Any, List
from models.safety import DosageRequest, PatientProfile, DosageAssessment, EvidenceAttribution
from clinical_rules.context import ClinicalContext
from clinical_rules.rule_engine import ClinicalRulesEngine

class DosageSafetyEngine:
    def __init__(self):
        self.rules_engine = ClinicalRulesEngine()

    def calculate_daily_exposure(self, dosage: float, frequency: str) -> float:
        freq = frequency.upper().strip()
        freq_map = {
            "OD": 1, "ONCE DAILY": 1,
            "BD": 2, "TWICE DAILY": 2,
            "TDS": 3, "THRICE DAILY": 3,
            "QID": 4, "FOUR TIMES DAILY": 4,
            "Q6H": 4, "Q8H": 3, "Q12H": 2,
            "HS": 1, "BEDTIME": 1,
        }
        return dosage * freq_map.get(freq, 1)

    def evaluate(self, request: DosageRequest, med_data: Dict[str, Any], interactions: List[Dict[str, Any]] = None, source_conflicts: List[Dict[str, Any]] = None) -> DosageAssessment:
        daily_exposure = self.calculate_daily_exposure(request.dosage, request.frequency)
        patient = request.patient or PatientProfile(age=30)

        notes: List[str] = []
        warnings: List[str] = []

        safe_min = float(med_data.get("safe_min", 100.0))
        safe_max = float(med_data.get("safe_max", 1000.0))

        if daily_exposure > safe_max:
            risk_level = "CRITICAL_REVIEW_REQUIRED"
            warnings.append(f"Daily exposure ({daily_exposure}mg) exceeds maximum safe limit ({safe_max}mg).")
        elif daily_exposure > (safe_max * 0.9):
            risk_level = "HIGH_RISK"
        elif daily_exposure > (safe_max * 0.75):
            risk_level = "ELEVATED_RISK"
        elif daily_exposure > (safe_max * 0.5):
            risk_level = "CAUTION"
        else:
            risk_level = "INFORMATIONAL"

        evidence = EvidenceAttribution(
            sourceName=med_data.get("sourceName", "DailyMed"),
            sourceUrl=med_data.get("sourceUrl", "https://dailymed.nlm.nih.gov"),
            sourceVersion=med_data.get("sourceVersion", "2026.1"),
            evidenceTier=med_data.get("evidenceTier", 1),
            confidenceScore=med_data.get("confidenceScore", 95),
            retrievalDate=med_data.get("retrievalDate", "2026-11-14")
        )

        initial_assessment = DosageAssessment(
            med_name=med_data.get("name", "Unknown Medicine"),
            input_dosage=request.dosage,
            unit=request.unit,
            frequency=request.frequency,
            daily_exposure=daily_exposure,
            reference_min=safe_min,
            reference_max=safe_max,
            risk_level=risk_level,
            safety_notes=notes,
            warnings=warnings,
            evidence=evidence
        )

        # Run Clinical Rules Engine Pipeline
        context = ClinicalContext(
            patient=patient,
            medication=med_data,
            dosageRequest=request,
            dosageAssessment=initial_assessment,
            interactions=interactions,
            sourceConflicts=source_conflicts
        )
        rule_results = self.rules_engine.evaluate(context)

        # Attach findings and overall clinical severity to assessment response
        initial_assessment.overallClinicalSeverity = rule_results["overallClinicalSeverity"]
        initial_assessment.findings = rule_results["findings"]

        return initial_assessment
