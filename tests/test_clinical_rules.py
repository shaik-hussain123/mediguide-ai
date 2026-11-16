import pytest
from backend.clinical_rules.context import ClinicalContext
from backend.clinical_rules.pediatric_rule import PediatricRule
from backend.clinical_rules.weight_rule import WeightRule
from backend.clinical_rules.elderly_rule import ElderlyRule
from backend.clinical_rules.pregnancy_rule import PregnancyRule
from backend.clinical_rules.renal_rule import RenalRule
from backend.clinical_rules.hepatic_rule import HepaticRule
from backend.clinical_rules.rule_engine import ClinicalRulesEngine
from backend.models.safety import PatientProfile, DosageRequest, DosageAssessment, EvidenceAttribution

def test_pediatric_rule():
    rule = PediatricRule()
    patient = PatientProfile(age=10)
    med = {"pediatric_max": 300, "sourceName": "FDA"}
    req = DosageRequest(med_id=1, dosage=400, frequency="OD")
    assessment = DosageAssessment(med_name="Test", input_dosage=400, unit="mg", frequency="OD", daily_exposure=400, reference_min=10, reference_max=500, risk_level="LOW", safety_notes=[], evidence=EvidenceAttribution(sourceName="FDA"))

    ctx = ClinicalContext(patient=patient, medication=med, dosageRequest=req, dosageAssessment=assessment)
    finding = rule.evaluate(ctx)
    assert finding.triggered is True
    assert finding.severity == "HIGH"

def test_weight_rule():
    rule = WeightRule()
    patient = PatientProfile(age=30, weight_kg=35.0)
    med = {"mg_per_kg_max": 10.0}
    req = DosageRequest(med_id=1, dosage=500, frequency="OD")
    assessment = DosageAssessment(med_name="Test", input_dosage=500, unit="mg", frequency="OD", daily_exposure=500, reference_min=10, reference_max=1000, risk_level="LOW", safety_notes=[], evidence=EvidenceAttribution(sourceName="FDA"))

    ctx = ClinicalContext(patient=patient, medication=med, dosageRequest=req, dosageAssessment=assessment)
    finding = rule.evaluate(ctx)
    assert finding.triggered is True
    assert finding.severity == "HIGH"

def test_elderly_rule():
    rule = ElderlyRule()
    patient = PatientProfile(age=70)
    med = {}
    req = DosageRequest(med_id=1, dosage=100, frequency="OD")
    assessment = DosageAssessment(med_name="Test", input_dosage=100, unit="mg", frequency="OD", daily_exposure=100, reference_min=10, reference_max=1000, risk_level="LOW", safety_notes=[], evidence=EvidenceAttribution(sourceName="FDA"))

    ctx = ClinicalContext(patient=patient, medication=med, dosageRequest=req, dosageAssessment=assessment)
    finding = rule.evaluate(ctx)
    assert finding.triggered is True
    assert finding.severity == "MODERATE"

def test_pregnancy_rule():
    rule = PregnancyRule()
    patient = PatientProfile(age=30, is_pregnant=True)
    med = {"pregnancy_category": "X"}
    req = DosageRequest(med_id=1, dosage=100, frequency="OD")
    assessment = DosageAssessment(med_name="Test", input_dosage=100, unit="mg", frequency="OD", daily_exposure=100, reference_min=10, reference_max=1000, risk_level="LOW", safety_notes=[], evidence=EvidenceAttribution(sourceName="FDA"))

    ctx = ClinicalContext(patient=patient, medication=med, dosageRequest=req, dosageAssessment=assessment)
    finding = rule.evaluate(ctx)
    assert finding.triggered is True
    assert finding.severity == "CRITICAL"

def test_renal_hepatic_rules():
    renal_rule = RenalRule()
    hepatic_rule = HepaticRule()
    patient = PatientProfile(age=40, conditions=["Renal Impairment", "Liver Disease"])
    med = {"renal_adjustment": True, "hepatic_adjustment": True}
    req = DosageRequest(med_id=1, dosage=100, frequency="OD")
    assessment = DosageAssessment(med_name="Test", input_dosage=100, unit="mg", frequency="OD", daily_exposure=100, reference_min=10, reference_max=1000, risk_level="LOW", safety_notes=[], evidence=EvidenceAttribution(sourceName="FDA"))

    ctx = ClinicalContext(patient=patient, medication=med, dosageRequest=req, dosageAssessment=assessment)

    r_finding = renal_rule.evaluate(ctx)
    h_finding = hepatic_rule.evaluate(ctx)

    assert r_finding.triggered is True
    assert r_finding.severity == "HIGH"
    assert h_finding.triggered is True
    assert h_finding.severity == "HIGH"

def test_rule_engine_aggregation():
    engine = ClinicalRulesEngine()
    patient = PatientProfile(age=10, is_pregnant=True)
    med = {"pediatric_max": 200, "pregnancy_category": "X"}
    req = DosageRequest(med_id=1, dosage=300, frequency="OD")
    assessment = DosageAssessment(med_name="Test", input_dosage=300, unit="mg", frequency="OD", daily_exposure=300, reference_min=10, reference_max=500, risk_level="LOW", safety_notes=[], evidence=EvidenceAttribution(sourceName="FDA"))

    ctx = ClinicalContext(patient=patient, medication=med, dosageRequest=req, dosageAssessment=assessment)
    result = engine.evaluate(ctx)

    assert result["overallClinicalSeverity"] == "CRITICAL"
    assert len(result["findings"]) > 0
