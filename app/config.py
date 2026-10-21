from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    secret_key: str
    database_url: str = "sqlite:///./mediguide.db"
    upload_dir: str = "./private_uploads"
    max_upload_mb: int = 5
    access_token_minutes: int = 30
    environment: str = "development"
    public_origin: str = "http://127.0.0.1:8000"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, value: str) -> str:
        if len(value.encode("utf-8")) < 32 or value.lower().startswith(("change-me", "replace-me", "unsafe-")):
            raise ValueError("SECRET_KEY must be a unique random value at least 32 bytes long.")
        return value

    @field_validator("max_upload_mb")
    @classmethod
    def validate_upload_size(cls, value: int) -> int:
        if value < 1 or value > 25:
            raise ValueError("MAX_UPLOAD_MB must be between 1 and 25.")
        return value


settings = Settings()
