"""Curated, dependency-light FastAPI app for the Vercel read-API.

Includes ONLY routers whose import graph avoids crawler/worker/AI/graph deps
(scrapy, playwright, crawlee, fastembed, neo4j, boto3). Anything that needs
those (uploads, admin ingest/sources, ai/analyst/digests, events, export) is
intentionally excluded — those features run only on the full always-on backend.

The portal's «Рынок» section (map, niche calculator, insights, widgets, news)
is powered entirely by the routers listed below.
"""

from __future__ import annotations

from fastapi import APIRouter, FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.config import settings
from app.core.errors import (
    AppError,
    app_error_handler,
    http_handler,
    unhandled_handler,
    validation_handler,
)
from app.core.logging import get_logger

logger = get_logger(__name__)

# (module_name, prefix, tag) — light read/stub routers only.
READ_ROUTERS: list[tuple[str, str, str]] = [
    ("geo", "/geo", "geo"),
    ("regions", "/regions", "regions"),
    ("competitors", "/competitors", "competitors"),
    ("analytics", "/analytics", "analytics"),
    ("filters", "/filters", "filters"),
    ("saved_lists", "/lists", "lists"),
    ("widgets", "/widgets", "widgets"),
    ("news", "/news", "news"),
    ("persons", "/persons", "persons"),
    ("tenders", "/tenders", "tenders"),
    ("alerts", "/alerts", "alerts"),
    ("trends", "/trends", "trends"),
    ("search", "/search", "search"),
]


def _safe_include(router: APIRouter, module_name: str, prefix: str, tag: str) -> None:
    """Best-effort include: a router that (or whose dep) is unavailable in the
    slim serverless runtime is skipped with a warning instead of crashing the
    whole function."""
    try:
        mod = __import__(f"app.api.v1.{module_name}", fromlist=["router"])
    except ImportError as e:
        logger.warning("read_router_skipped", module=module_name, error=str(e))
        return
    sub = getattr(mod, "router", None)
    if sub is None:
        logger.warning("read_router_no_attribute", module=module_name)
        return
    router.include_router(sub, prefix=prefix, tags=[tag])


def build_read_app() -> FastAPI:
    app = FastAPI(
        title="Mark Analytics Read API",
        version=__version__,
        default_response_class=ORJSONResponse,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.CORS_ORIGIN_REGEX or None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-request-id", "x-took-ms"],
    )

    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, http_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_handler)  # type: ignore[arg-type]

    @app.get("/health", tags=["meta"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    v1 = APIRouter()
    for name, prefix, tag in READ_ROUTERS:
        _safe_include(v1, name, prefix, tag)
    app.include_router(v1, prefix=settings.API_PREFIX)

    return app
