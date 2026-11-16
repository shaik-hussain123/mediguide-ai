from clinical_rules.base_rule import BaseRule
from models.clinical import ClinicalFinding, ClinicalContext
from models.safety import EvidenceAttribution

class PediatricRule(BaseRule):
    def evaluate(self, context: ClinicalContext) -> ClinicalFinding:
        patient = context.patient
        med = context.medication
        req = context.dosageRequest

        triggered = False
        severity = "LOW"
        finding_text = "Patient is of adult age or appropriate pediatric status."
        rec_text = "No pediatric dosing adjustments triggered."

        if patient.age < 18:
            triggered = True
            ped_max = med.get("pediatric_max")
            if ped_max and req.dosage > ped_max:
                severity = "HIGH"
                finding_text = f"Pediatric dose ({req.dosage}mg) exceeds recommended pediatric ceiling ({ped_max}mg)."
                rec_text = "Reduce dosage to meet pediatric reference guidelines."
            else:
                severity = "MODERATE"
                finding_text = f"Pediatric patient detected (Age {patient.age})."
                rec_text = "Verify weight-based dosing and pediatric administration form."

        evidence = EvidenceAttribution(
            sourceName=med.get("sourceName", "DailyMed"),
            sourceUrl=med.get("sourceUrl", "https://dailymed.nlm.nih.gov"),
            evidenceTier=med.get("evidenceTier", 1),
            confidenceScore=med.get("confidenceScore", 95)
        )

        return ClinicalFinding(
            ruleType="Pediatric",
            severity=severity,
            finding=finding_text,
            recommendation=rec_text,
            evidence=evidence,
            confidenceScore=95,
            triggered=triggered,
            ruleVersion="1.0.0"
        )
