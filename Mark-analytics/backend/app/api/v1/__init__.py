"""API v1 router aggregator.

Individual routers are appended here. Sub-routers live in sibling modules
and are filled in by the api-engineer agent.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

api_router = APIRouter()


def _try_include(module_name: str, prefix: str, tag: str) -> None:
    """Best-effort include a sub-router by module name.

    Only a *missing* router module is tolerated (and logged loudly so it shows
    up in startup output). Any other error — SyntaxError, AttributeError,
    runtime import-time failures — is a real bug and must crash the app
    instead of silently disappearing from the API surface.
    """
    try:
        module = __import__(f"app.api.v1.{module_name}", fromlist=["router"])
    except ModuleNotFoundError as e:
        # Only swallow when the *target* module itself is absent. If the
        # missing module is some transitive dep, that's a real bug.
        if e.name == f"app.api.v1.{module_name}":
            logger.warning(
                "router_not_available",
                module=module_name,
                prefix=prefix,
                error=str(e),
            )
            return
        raise
    except ImportError as e:
        # Anything else (circular import, missing symbol) is a real bug.
        logger.error(
            "router_import_failed",
            module=module_name,
            prefix=prefix,
            error=str(e),
        )
        raise

    router = getattr(module, "router", None)
    if router is None:
        logger.error(
            "router_missing_attribute",
            module=module_name,
            prefix=prefix,
        )
        raise AttributeError(
            f"app.api.v1.{module_name} does not expose `router: APIRouter`"
        )

    api_router.include_router(router, prefix=prefix, tags=[tag])


# Serverless (Vercel read-API) builds its own curated router set in
# app.api.v1.read_api and must NOT trigger the full eager aggregation below —
# importing every router here would pull crawler/worker/AI/redis deps that are
# absent from the slim function runtime. The full always-on backend (main.py,
# SERVERLESS unset) still wires everything.
if not settings.SERVERLESS:
    # `/companies/{id}/people` lives in the persons module (see Sprint 4.2).
    # Mount it before the loop so it sits beside the canonical companies surface
    # without forcing a circular import between the two routers.
    try:
        from app.api.v1.persons import companies_people_router as _persons_companies_router

        api_router.include_router(
            _persons_companies_router, prefix="/companies", tags=["persons"]
        )
    except ImportError as _e:  # pragma: no cover — persons module always ships
        logger.warning("persons_companies_router_missing", error=str(_e))

    for _name, _prefix, _tag in [
    ("auth", "/auth", "auth"),
    ("me", "/me", "me"),
    ("meta", "/meta", "meta"),
    ("companies", "/companies", "companies"),
    ("forecasts", "/forecasts", "forecasts"),
    ("uploads", "/uploads", "uploads"),
    ("filters", "/filters", "filters"),
    ("ai_test", "/ai", "ai"),
    ("analytics", "/analytics", "analytics"),
    ("geo", "/geo", "geo"),
    ("regions", "/regions", "regions"),
    ("export", "/export", "export"),
    ("competitors", "/competitors", "competitors"),
    ("admin_ingest", "/admin", "admin"),
    ("admin_sources", "/admin/sources", "admin"),
    ("events", "/events", "events"),
    # Track F (Saved Companies lists) of docs/aistart360/08-world-monitor-feature-parity.md §5.
    ("saved_lists", "/lists", "lists"),
    # Phase 0 stubs — return empty data so frontend doesn't 404 during dev.
    # Full implementation lands in Phase 2/3.
    ("persons", "/persons", "persons"),
    ("tenders", "/tenders", "tenders"),
    ("alerts", "/alerts", "alerts"),
    ("trends", "/trends", "trends"),
    ("search", "/search", "search"),
    # AI Digest jobs (Track B of docs/aistart360/08-world-monitor-feature-parity.md §5).
    ("digests", "/digests", "digests"),
    # MK Analyst chat (Track A of docs/aistart360/08-world-monitor-feature-parity.md §5).
    ("analyst", "/analyst", "analyst"),
    # Widget builder (Track G of docs/aistart360/08-world-monitor-feature-parity.md §5).
    ("widgets", "/widgets", "widgets"),
        # Ph2 E — news feed aggregator.
        ("news", "/news", "news"),
    ]:
        _try_include(_name, _prefix, _tag)
