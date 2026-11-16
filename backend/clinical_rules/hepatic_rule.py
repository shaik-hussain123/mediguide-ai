from clinical_rules.base_rule import BaseRule
from models.clinical import ClinicalFinding, ClinicalContext
from models.safety import EvidenceAttribution

class HepaticRule(BaseRule):
    def evaluate(self, context: ClinicalContext) -> ClinicalFinding:
        patient = context.patient
        med = context.medication

        triggered = False
        severity = "LOW"
        finding_text = "Hepatic function within safe parameters."
        rec_text = "Standard dosing protocols apply."

        has_hepatic = any("hepatic" in c.lower() or "liver" in c.lower() for c in patient.conditions)
        if has_hepatic and med.get("hepatic_adjustment", False):
            triggered = True
            severity = "HIGH"
            finding_text = "Hepatic impairment detected; medication requires caution/adjustment."
            rec_text = "Liver function tests recommended; evaluate dose reduction."

        evidence = EvidenceAttribution(
            sourceName=med.get("sourceName", "DailyMed"),
            sourceUrl=med.get("sourceUrl", "https://dailymed.nlm.nih.gov"),
            evidenceTier=med.get("evidenceTier", 1),
            confidenceScore=med.get("confidenceScore", 95)
        )

        return ClinicalFinding(
            ruleType="Hepatic",
            severity=severity,
            finding=finding_text,
            recommendation=rec_text,
            evidence=evidence,
            confidenceScore=95,
            triggered=triggered,
            ruleVersion="1.0.0"
        )
