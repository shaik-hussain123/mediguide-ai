"""Validation utilities for MediGuide AI."""

from pydantic import BaseModel, Field, EmailStr, validator
from typing import Optional, List

class DosageRequestValidator(BaseModel):
    med_id: int = Field(..., gt=0)
    dosage: float = Field(..., gt=0)
    frequency: str = Field(..., pattern="^(OD|BD|TDS|QID|Q8H|Q12H|HS)$")
    patient: Optional[dict] = None

    @validator('patient')
    def validate_patient(cls, v):
        if v:
            if 'age' in v and (v['age'] < 0 or v['age'] > 120):
                raise ValueError('Age must be between 0 and 120')
            if 'weight_kg' in v and v['weight_kg'] <= 0:
                raise ValueError('Weight must be positive')
        return v

class AuthValidator:
    @staticmethod
    def validate_email(email: str) -> bool:
        try:
            BaseModel(email=EmailStr(email))
            return True
        except:
            return False

    @staticmethod
    def validate_password(password: str) -> bool:
        return len(password) >= 8

class SafetyScoreValidator(BaseModel):
    med_ids: List[int] = Field(..., min_items=1, max_items=10)
    patient: Optional[dict] = None

    @validator('med_ids')
    def validate_med_ids(cls, v):
        if any(m < 1 for m in v):
            raise ValueError('Medication IDs must be positive')
        return v
