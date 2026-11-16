from typing import List, Dict, Any
from models.clinical import ClinicalFinding, ClinicalContext
from clinical_rules.base_rule import BaseRule
from clinical_rules.pediatric_rule import PediatricRule
from clinical_rules.weight_rule import WeightRule
from clinical_rules.elderly_rule import ElderlyRule
from clinical_rules.pregnancy_rule import PregnancyRule
from clinical_rules.renal_rule import RenalRule
from clinical_rules.hepatic_rule import HepaticRule
from clinical_rules.interaction_rule import InteractionRule
from clinical_rules.source_conflict_rule import SourceConflictRule

class ClinicalRulesEngine:
    def __init__(self):
        self.rules: List[BaseRule] = [
            PediatricRule(),
            WeightRule(),
            ElderlyRule(),
            PregnancyRule(),
            RenalRule(),
            HepaticRule(),
            InteractionRule(),
            SourceConflictRule()
        ]

    def register_rule(self, rule: BaseRule):
        self.rules.append(rule)

    def evaluate(self, context: ClinicalContext) -> Dict[str, Any]:
        findings: List[ClinicalFinding] = []
        severity_rank = {"LOW": 1, "MODERATE": 2, "HIGH": 3, "CRITICAL": 4}
        highest_severity = "LOW"

        for rule in self.rules:
            finding = rule.evaluate(context)
            if finding.triggered:
                findings.append(finding)
                if severity_rank.get(finding.severity, 1) > severity_rank.get(highest_severity, 1):
                    highest_severity = finding.severity

        if not findings:
            highest_severity = "LOW"

        return {
            "overallClinicalSeverity": highest_severity,
            "findings": [f.dict() for f in findings]
        }
