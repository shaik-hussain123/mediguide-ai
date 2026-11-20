import pytest
from backend.safety_engine import DosageSafetyEngine
from backend.models.safety import DosageRequest

def test_dosage_engine_risk_levels():
    engine = DosageSafetyEngine()
    med_data = {"name": "TestMed", "safe_min": 100.0, "safe_max": 1000.0, "source": "TestMed"}

    # Test Informational (low dose)
    req1 = DosageRequest(med_id=1, dosage=200, unit="mg", frequency="OD", route="oral")
    res1 = engine.evaluate(req1, med_data)
    assert res1.risk_level == "INFORMATIONAL"

    # Test High Risk (above 90% threshold)
    req2 = DosageRequest(med_id=1, dosage=901, unit="mg", frequency="OD", route="oral")
    res2 = engine.evaluate(req2, med_data)
    assert res2.risk_level == "HIGH_RISK"

    # Test Elevated Risk (75-90% range)
    req2b = DosageRequest(med_id=1, dosage=800, unit="mg", frequency="OD", route="oral")
    res2b = engine.evaluate(req2b, med_data)
    assert res2b.risk_level == "ELEVATED_RISK"

    # Test Critical
    req3 = DosageRequest(med_id=1, dosage=1100, unit="mg", frequency="OD", route="oral")
    res3 = engine.evaluate(req3, med_data)
    assert res3.risk_level == "CRITICAL_REVIEW_REQUIRED"

def test_frequency_calculation():
    engine = DosageSafetyEngine()
    assert engine.calculate_daily_exposure(500, "BD") == 1000
    assert engine.calculate_daily_exposure(500, "TDS") == 1500
