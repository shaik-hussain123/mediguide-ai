from clinical_rules.base_rule import BaseRule
from models.clinical import ClinicalFinding, ClinicalContext
from models.safety import EvidenceAttribution

class PregnancyRule(BaseRule):
    def evaluate(self, context: ClinicalContext) -> ClinicalFinding:
        patient = context.patient
        med = context.medication

        triggered = False
        severity = "LOW"
        finding_text = "Pregnancy status considerations not triggered."
        rec_text = "Standard dosing protocols apply."

        if patient.is_pregnant:
            cat = med.get("pregnancy_category", "C")
            if cat in ["D", "X"]:
                triggered = True
                severity = "CRITICAL"
                finding_text = f"Medication Category {cat} is contraindicated in pregnancy."
                rec_text = "Use alternative therapy immediately. Clinical review mandatory."
            elif cat == "C":
                triggered = True
                severity = "HIGH"
                finding_text = f"Medication Category C requires careful risk-benefit analysis."
                rec_text = "Evaluate therapy necessity and consult physician."

        evidence = EvidenceAttribution(
            sourceName=med.get("sourceName", "DailyMed"),
            sourceUrl=med.get("sourceUrl", "https://dailymed.nlm.nih.gov"),
            evidenceTier=med.get("evidenceTier", 1),
            confidenceScore=med.get("confidenceScore", 95)
        )

        return ClinicalFinding(
            ruleType="Pregnancy",
            severity=severity,
            finding=finding_text,
            recommendation=rec_text,
            evidence=evidence,
            confidenceScore=95,
            triggered=triggered,
            ruleVersion="1.0.0"
        )
