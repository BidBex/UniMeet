from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-based application configuration."""

    APP_NAME: str = "UniMeet API"
    APP_VERSION: str = "0.1.0"
    API_PREFIX: str = "/api"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    DATABASE_URL: str = "sqlite:///./unimeet.db"
    CORS_ORIGINS: str = (
        "http://localhost:3000,"
        "http://127.0.0.1:3000,"
        "http://localhost:5500,"
        "http://127.0.0.1:5500"
    )

    JWT_SECRET_KEY: str = "dev-only-insecure-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    COOKIE_NAME: str = "unimeet_access_token"
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
