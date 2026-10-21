from typing import Literal
from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)

    @field_validator("name")
    @classmethod
    def non_blank_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name cannot be blank.")
        return value.strip()


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class ProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def non_blank_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name cannot be blank.")
        return value.strip()


class ChatIn(BaseModel):
    question: str = Field(min_length=3, max_length=2000)


class MedicineIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    generic_name: str = Field(min_length=1, max_length=200)
    active_ingredient: str = Field(min_length=1, max_length=300)
    strength: str = Field(min_length=1, max_length=100)
    dosage_form: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=5000)
    warnings: str = Field(default="", max_length=5000)
    regulatory_status: Literal["UNKNOWN", "APPROVED", "PROHIBITED", "RESTRICTED"] = "UNKNOWN"
    source_name: str = Field(default="Needs review", max_length=200)
    source_url: str | None = Field(default=None, max_length=500)

    @field_validator("source_url")
    @classmethod
    def secure_source_url(cls, value: str | None) -> str | None:
        if value and not value.startswith("https://"):
            raise ValueError("Source URL must use HTTPS.")
        return value
