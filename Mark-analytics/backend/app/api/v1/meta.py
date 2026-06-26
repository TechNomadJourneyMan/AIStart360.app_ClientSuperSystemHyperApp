"""Public `/meta` endpoint.

Returns a runtime capability snapshot the frontend reads at boot to decide
which modules to render and which forecast types / crawler sources to surface.

Public endpoint — no JWT required. Wrapped in the standard `{data, meta, errors}`
envelope.
"""

from __future__ import annotations

from importlib import import_module
from typing import Any

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import __version__
from app.config import settings
from app.core.deps import SessionDep
from app.core.errors import envelope
from app.core.logging import get_logger
from app.schemas.meta import (
    AIModelInfo,
    CrawlerSourceInfo,
    ForecastTypeInfo,
    MetaResponse,
)

router = APIRouter()
logger = get_logger("api.meta")


# Modules considered for `features_enabled`. Each entry maps a feature key to
# the module that must be importable (and non-empty) for the feature to count.
_FEATURE_PROBES: list[tuple[str, str]] = [
    ("companies", "app.api.v1.companies"),
    ("persons", "app.api.v1.persons"),
    ("tenders", "app.api.v1.tenders"),
    ("search", "app.api.v1.search"),
    ("alerts", "app.api.v1.alerts"),
    ("trends", "app.api.v1.trends"),
    ("forecasts", "app.api.v1.forecasts"),
    ("uploads", "app.api.v1.uploads"),
    ("filters", "app.api.v1.filters"),
    ("analytics", "app.api.v1.analytics"),
    ("export", "app.api.v1.export"),
    ("competitors", "app.api.v1.competitors"),
]


def _detect_features() -> list[str]:
    """Capability check by module presence — a feature is enabled iff its
    router module imports cleanly and exposes a `router` symbol."""
    enabled: list[str] = []
    for feature, module_name in _FEATURE_PROBES:
        try:
            module = import_module(module_name)
        except ImportError:
            continue
        if hasattr(module, "router"):
            enabled.append(feature)
    return enabled


def _available_forecast_types() -> list[ForecastTypeInfo]:
    """Pull the forecast registry. Importing `app.forecasting.models` triggers
    `@register` side-effects."""
    try:
        import_module("app.forecasting.models")  # registers all forecasts
        from app.forecasting.base import FORECAST_REGISTRY
    except ImportError:
        return []
    return [
        ForecastTypeInfo(
            type=cls.type,
            title=cls.title,
            description=cls.description,
        )
        for cls in FORECAST_REGISTRY.values()
    ]


async def _crawler_sources(session: AsyncSession) -> list[CrawlerSourceInfo]:
    """Prefer DB-backed `sources` (operational truth); fall back to in-code
    `SPIDER_REGISTRY` when the table is empty or unavailable."""
    db_sources: list[CrawlerSourceInfo] = []
    try:
        from app.models.source import Source

        rows = (await session.execute(select(Source))).scalars().all()
        db_sources = [
            CrawlerSourceInfo(
                key=row.key,
                name=row.name,
                kind=row.kind,
                enabled=row.enabled,
            )
            for row in rows
        ]
    except Exception as exc:  # noqa: BLE001
        logger.warning("meta_sources_db_unavailable", error=str(exc))

    if db_sources:
        return db_sources

    # Fallback: registered spiders (importing the package triggers registration).
    try:
        spiders_mod = import_module("app.crawlers.spiders")
        registry: dict[str, Any] = getattr(spiders_mod, "SPIDER_REGISTRY", {})
    except ImportError:
        return []
    return [
        CrawlerSourceInfo(key=key, name=key, kind=None, enabled=True)
        for key in registry.keys()
    ]


def _ai_models_active() -> list[AIModelInfo]:
    """Best-effort: list models whose provider is reachable given current env.

    The AI router does not expose a `list_active_models()` helper, so we
    derive activity from the model catalog + provider readiness:
      - OpenRouter active iff OPENROUTER_API_KEY is set
      - Google AI Studio active iff GOOGLE_AI_STUDIO_API_KEY is set
      - Local (embeddings) always active
      - Mock provider is excluded from the public surface
    """
    try:
        from app.ai.registry import MODEL_CATALOG
        from app.ai.types import Provider
    except ImportError:
        return []

    provider_active: dict[Any, bool] = {
        Provider.OPENROUTER: bool(settings.OPENROUTER_API_KEY),
        Provider.GOOGLE_AI_STUDIO: bool(settings.GOOGLE_AI_STUDIO_API_KEY),
        Provider.LOCAL: True,
    }

    out: list[AIModelInfo] = []
    for qualified, meta in MODEL_CATALOG.items():
        if meta.provider == Provider.MOCK:
            continue
        out.append(
            AIModelInfo(
                qualified=qualified,
                provider=meta.provider.value,
                active=provider_active.get(meta.provider, False),
            )
        )
    return out


@router.get("", summary="Public capability + version snapshot")
async def get_meta(session: SessionDep) -> dict[str, Any]:
    payload = MetaResponse(
        version=__version__,
        api_prefix=settings.API_PREFIX,
        features_enabled=_detect_features(),
        available_forecast_types=_available_forecast_types(),
        crawler_sources=await _crawler_sources(session),
        ai_models_active=_ai_models_active(),
    )
    return envelope(data=payload.model_dump(mode="json"))
