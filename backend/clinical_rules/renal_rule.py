from .base_rule import BaseRule
from ..models.clinical import ClinicalFinding, ClinicalContext
from ..models.safety import EvidenceAttribution

class RenalRule(BaseRule):
    def evaluate(self, context: ClinicalContext) -> ClinicalFinding:
        patient = context.patient
        med = context.medication

        triggered = False
        severity = "LOW"
        finding_text = "Renal function within safe parameters."
        rec_text = "Standard dosing protocols apply."

        has_renal = any("renal" in c.lower() or "kidney" in c.lower() for c in patient.conditions)
        if has_renal and med.get("renal_adjustment", False):
            triggered = True
            severity = "HIGH"
            finding_text = "Renal impairment detected; medication requires adjustment."
            rec_text = "Dose reduction or monitoring suggested. Consult prescribing information."

        evidence = EvidenceAttribution(
            sourceName=med.get("sourceName", "DailyMed"),
            sourceUrl=med.get("sourceUrl", "https://dailymed.nlm.nih.gov"),
            evidenceTier=med.get("evidenceTier", 1),
            confidenceScore=med.get("confidenceScore", 95)
        )

        return ClinicalFinding(
            ruleType="Renal",
            severity=severity,
            finding=finding_text,
            recommendation=rec_text,
            evidence=evidence,
            confidenceScore=95,
            triggered=triggered,
            ruleVersion="1.0.0"
        )
