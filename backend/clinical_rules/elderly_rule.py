from clinical_rules.base_rule import BaseRule
from models.clinical import ClinicalFinding, ClinicalContext
from models.safety import EvidenceAttribution

class ElderlyRule(BaseRule):
    def evaluate(self, context: ClinicalContext) -> ClinicalFinding:
        patient = context.patient
        med = context.medication

        triggered = False
        severity = "LOW"
        finding_text = "Age safety profile acceptable."
        rec_text = "Standard dosing protocols apply."

        if patient.age >= 65:
            triggered = True
            severity = "MODERATE"
            finding_text = f"Patient is geriatric (Age {patient.age})."
            rec_text = "Monitor for increased drug sensitivity and reduce initial dose if appropriate."

        evidence = EvidenceAttribution(
            sourceName=med.get("sourceName", "DailyMed"),
            sourceUrl=med.get("sourceUrl", "https://dailymed.nlm.nih.gov"),
            evidenceTier=med.get("evidenceTier", 1),
            confidenceScore=med.get("confidenceScore", 95)
        )

        return ClinicalFinding(
            ruleType="Elderly",
            severity=severity,
            finding=finding_text,
            recommendation=rec_text,
            evidence=evidence,
            confidenceScore=95,
            triggered=triggered,
            ruleVersion="1.0.0"
        )
