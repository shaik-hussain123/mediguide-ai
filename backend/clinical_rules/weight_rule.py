from clinical_rules.base_rule import BaseRule
from models.clinical import ClinicalFinding, ClinicalContext
from models.safety import EvidenceAttribution

class WeightRule(BaseRule):
    def evaluate(self, context: ClinicalContext) -> ClinicalFinding:
        patient = context.patient
        med = context.medication
        req = context.dosageRequest

        triggered = False
        severity = "LOW"
        finding_text = "Weight is within normal operational parameters."
        rec_text = "Standard dosing applicable."

        if patient.weight_kg:
            mg_per_kg = req.dosage / patient.weight_kg
            max_mg_per_kg = med.get("mg_per_kg_max", 20.0)

            if mg_per_kg > max_mg_per_kg:
                triggered = True
                severity = "HIGH"
                finding_text = f"Calculated mg/kg exposure ({mg_per_kg:.2f} mg/kg) exceeds safe limit ({max_mg_per_kg} mg/kg)."
                rec_text = "Immediately recalculate dose based on patient weight."
            elif patient.weight_kg < 40:
                triggered = True
                severity = "MODERATE"
                finding_text = f"Underweight patient detected ({patient.weight_kg}kg)."
                rec_text = "Consider low-body-weight dosage adjustments."

        evidence = EvidenceAttribution(
            sourceName=med.get("sourceName", "DailyMed"),
            sourceUrl=med.get("sourceUrl", "https://dailymed.nlm.nih.gov"),
            evidenceTier=med.get("evidenceTier", 1),
            confidenceScore=med.get("confidenceScore", 95)
        )

        return ClinicalFinding(
            ruleType="Weight-Based",
            severity=severity,
            finding=finding_text,
            recommendation=rec_text,
            evidence=evidence,
            confidenceScore=95,
            triggered=triggered,
            ruleVersion="1.0.0"
        )
