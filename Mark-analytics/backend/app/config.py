"""Application configuration loaded from environment.

All settings live in one place. Do not read env vars directly — use `settings`.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # ----- Core -----
    APP_ENV: Literal["development", "staging", "production"] = "development"
    LOG_LEVEL: str = "INFO"
    SECRET_KEY: str = "change-me"
    API_PREFIX: str = "/api/v1"

    # ----- Supabase -----
    SUPABASE_URL: AnyHttpUrl | None = None
    SUPABASE_ANON_KEY: str | None = None
    SUPABASE_SERVICE_ROLE_KEY: str | None = None
    SUPABASE_JWT_SECRET: str | None = None
    SUPABASE_WEBHOOK_SECRET: str | None = None

    # ----- Postgres -----
    DATABASE_URL: str
    DATABASE_URL_DIRECT: str | None = None

    # ----- Redis -----
    REDIS_URL: str = "redis://localhost:6379/0"

    # ----- Object storage -----
    R2_ENDPOINT_URL: str | None = None
    R2_ACCESS_KEY_ID: str | None = None
    R2_SECRET_ACCESS_KEY: str | None = None
    R2_BUCKET: str = "mark-raw"
    R2_REGION: str = "auto"
    R2_ACCOUNT_ID: str | None = None

    # ----- Neo4j -----
    NEO4J_URI: str | None = None
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str | None = None

    # ----- AI providers -----
    OPENROUTER_API_KEY: str | None = None
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    OPENROUTER_HTTP_REFERER: str | None = None
    OPENROUTER_APP_NAME: str = "Mark Analytics"

    GOOGLE_AI_STUDIO_API_KEY: str | None = None

    AI_FEATURE_KEY_CACHE: bool = True
    AI_FEATURE_SEMANTIC_CACHE: bool = True
    AI_FEATURE_FALLBACK: bool = True
    AI_DAILY_COST_CEILING_USD: float = 100.0
    AI_DEFAULT_TIMEOUT_SECONDS: int = 60

    EMBED_MODEL: str = "BAAI/bge-m3"
    EMBED_CACHE_DIR: str = ".cache/fastembed"

    # ----- CORS -----
    # Comma-separated list of explicit allowed origins. Covers Next.js dev (3000),
    # Vite dev (5173), Vite preview (5174), the AIStart360 portal dev origin
    # (53000), and any prod portal domain.
    ALLOWED_ORIGINS: str = (
        "http://localhost:3000,"
        "http://localhost:5173,"
        "http://localhost:5174,"
        "http://localhost:53000"
    )
    # Optional regex to allow preview deployments (e.g. Vercel branch URLs).
    # Example: r"^https://.*\.vercel\.app$"
    CORS_ORIGIN_REGEX: str | None = None

    @field_validator("ALLOWED_ORIGINS")
    @classmethod
    def _split_origins(cls, v: str | list[str]) -> list[str]:  # noqa: D401
        if isinstance(v, list):
            return v
        return [o.strip() for o in v.split(",") if o.strip()]

    @field_validator("CORS_ORIGIN_REGEX")
    @classmethod
    def _normalize_cors_regex(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    # ----- Firecrawl (web scraping with anti-bot bypass) -----
    FIRECRAWL_API_KEY: str | None = None
    FIRECRAWL_BASE_URL: str = "https://api.firecrawl.dev"
    FIRECRAWL_TIMEOUT_S: int = 120

    # ----- Crawling -----
    CRAWLER_USER_AGENT_POOL_PATH: str | None = None
    CRAWLER_DEFAULT_RATE_LIMIT_RPM: int = 30
    PROXY_PROVIDER: Literal["none", "brightdata", "iproyal"] = "none"
    PROXY_USERNAME: str | None = None
    PROXY_PASSWORD: str | None = None
    PROXY_ENDPOINT: str | None = None

    # ----- Observability -----
    SENTRY_DSN: str | None = None
    OTEL_EXPORTER_OTLP_ENDPOINT: str | None = None
    OTEL_SERVICE_NAME: str = "mark-backend"

    @property
    def is_prod(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def cors_origins(self) -> list[str]:
        # Already split by validator
        return self.ALLOWED_ORIGINS  # type: ignore[return-value]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings: Settings = get_settings()
