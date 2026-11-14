from functools import lru_cache
import os
from pathlib import Path
import secrets
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = BACKEND_DIR / "unimeet.db"
JWT_SECRET_FILE = BACKEND_DIR / ".jwt_secret"
INSECURE_DEFAULT_SECRET = "dev-only-insecure-secret-change-in-production"


def _resolve_jwt_secret(configured_secret: str, environment: str) -> str:
    if configured_secret and configured_secret != INSECURE_DEFAULT_SECRET:
        return configured_secret
    if environment.lower() == "test":
        return INSECURE_DEFAULT_SECRET
    try:
        if JWT_SECRET_FILE.is_file():
            stored = JWT_SECRET_FILE.read_text(encoding="utf-8").strip()
            if len(stored) >= 32:
                return stored
        generated = secrets.token_urlsafe(48)
        JWT_SECRET_FILE.write_text(generated, encoding="utf-8")
        os.chmod(JWT_SECRET_FILE, 0o600)
        return generated
    except OSError:
        return secrets.token_urlsafe(48)


class Settings(BaseSettings):
    """Environment-based application configuration."""

    APP_NAME: str = "UniMeet API"
    APP_VERSION: str = "0.1.0"
    API_PREFIX: str = "/api"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False

    DATABASE_URL: str = f"sqlite:///{DEFAULT_DB_PATH}"
    CORS_ORIGINS: str = (
        "http://localhost:3000,"
        "http://127.0.0.1:3000,"
        "http://localhost:5500,"
        "http://127.0.0.1:5500,"
        "https://localhost,"
        "http://localhost,"
        "capacitor://localhost,"
        "ionic://localhost"
    )

    JWT_SECRET_KEY: str = INSECURE_DEFAULT_SECRET
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

    def model_post_init(self, __context) -> None:
        self.JWT_SECRET_KEY = _resolve_jwt_secret(self.JWT_SECRET_KEY, self.ENVIRONMENT)

    @property
    def cors_origins_list(self) -> List[str]:
        origins = [origin.strip().rstrip("/") for origin in self.CORS_ORIGINS.split(",") if origin.strip()]
        for env_key in ("APP_URL", "FRONTEND_URL"):
            extra = os.getenv(env_key, "").strip().rstrip("/")
            if extra and extra not in origins:
                origins.append(extra)
        return origins


@lru_cache
def get_settings() -> Settings:
    return Settings()
