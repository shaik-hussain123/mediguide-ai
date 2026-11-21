
from .base_rule import BaseRule
from ..models.clinical import ClinicalFinding, ClinicalContext
from ..models.safety import EvidenceAttribution

class SourceConflictRule(BaseRule):
    def evaluate(self, context: ClinicalContext) -> ClinicalFinding:
        conflicts = context.sourceConflicts

        if not conflicts:
            return ClinicalFinding(
                ruleType="Source Conflict",
                severity="LOW",
                finding="No source conflicts detected.",
                recommendation="Standard evidence pathway applies.",
                evidence=EvidenceAttribution(sourceName="MediGuide", evidenceTier=1, confidenceScore=100),
                confidenceScore=100,
                triggered=False,
                ruleVersion="1.0.0"
            )

        # Aggregate conflicts
        dosage_conflicts = [c for c in conflicts if c.get("type") == "dosage"]
        interaction_conflicts = [c for c in conflicts if c.get("type") == "interaction"]

        if not dosage_conflicts and not interaction_conflicts:
            triggered = False
            severity = "LOW"
            finding_text = "No actionable source conflicts detected."
            rec_text = "Proceed with standard clinical pathway."
        else:
            triggered = True
            # Find highest severity conflict
            severity_rank = {"LOW": 1, "MODERATE": 2, "HIGH": 3, "CRITICAL": 4}
            max_sev = "LOW"
            for c in conflicts:
                sev = c.get("severity", "LOW")
                if severity_rank.get(sev, 1) > severity_rank.get(max_sev, 1):
                    max_sev = sev

            severity = max_sev
            conflict_count = len(conflicts)
            finding_text = f"{conflict_count} source conflict(s) detected across {len(dosage_conflicts)} dosage and {len(interaction_conflicts)} interaction references."
            rec_text = "Apply conservative recommendation due to conflicting evidence sources. Verify with authoritative source (DailyMed, FDA)."

        evidence = EvidenceAttribution(
            sourceName="MediGuide Conflict Engine",
            sourceUrl="internal",
            evidenceTier=1,
            confidenceScore=90
        )

        return ClinicalFinding(
            ruleType="Source Conflict",
            severity=severity,
            finding=finding_text,
            recommendation=rec_text,
            evidence=evidence,
            confidenceScore=evidence.confidenceScore,
            triggered=triggered,
            ruleVersion="1.0.0"
        )
