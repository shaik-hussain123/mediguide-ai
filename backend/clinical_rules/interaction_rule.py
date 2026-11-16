
from clinical_rules.base_rule import BaseRule
from models.clinical import ClinicalFinding, ClinicalContext
from models.safety import EvidenceAttribution

class InteractionRule(BaseRule):
    def evaluate(self, context: ClinicalContext) -> ClinicalFinding:
        med = context.medication
        med_name = med.get("name")
        interactions = context.interactions

        triggered = False
        severity = "LOW"
        finding_text = "No significant drug interactions detected."
        rec_text = "Standard usage."
        evidence = EvidenceAttribution(
            sourceName="MediGuide Database",
            evidenceTier=1,
            confidenceScore=95
        )

        for interaction in interactions:
            if interaction["med_a"] == med_name or interaction["med_b"] == med_name:
                triggered = True
                sev_map = {
                    "Minor": "LOW",
                    "Moderate": "MODERATE",
                    "Major": "HIGH",
                    "Contraindicated": "CRITICAL"
                }
                severity = sev_map.get(interaction["severity"], "MODERATE")
                finding_text = f"Interaction detected with {interaction['med_a'] if interaction['med_b'] == med_name else interaction['med_b']}: {interaction['description']}"
                rec_text = f"Consult a doctor regarding potential {interaction['severity']} interaction."
                evidence = EvidenceAttribution(**interaction["evidence"])
                break

        return ClinicalFinding(
            ruleType="Drug Interaction",
            severity=severity,
            finding=finding_text,
            recommendation=rec_text,
            evidence=evidence,
            confidenceScore=evidence.confidenceScore,
            triggered=triggered,
            ruleVersion="1.0.0"
        )
