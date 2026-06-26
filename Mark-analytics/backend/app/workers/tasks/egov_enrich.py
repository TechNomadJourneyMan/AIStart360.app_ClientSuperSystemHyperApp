"""Arq task: on-demand egov.kz / stat.gov.kz enrichment for a single company.

Spec: docs/aistart360/07-product-redesign.md §6 Source 3 + §11 PR #8

Triggered from `app.services.companies` after `get_company` if the row has
a `bin` but no director information. Conservative by design:

  - skip if `enriched_at_egov` < 30 days old
  - patch only fields where the company currently has no value
    (never overwrite higher-confidence sources)
  - record per-field changes in `companies_changes` when the table exists
  - return a small dict for arq result inspection
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.core.logging import get_logger
from app.models.company import Company, CompanyChange
from app.services.egov_enrichment import EgovEnrichmentResult, enrich_by_bin

logger = get_logger(__name__)


# Fields we map from EgovEnrichmentResult → Company columns. The order also
# determines what the trigger considers "missing director" — see
# `enqueue_egov_enrich_if_needed` below.
_FIELD_TO_COMPANY_COLUMN: dict[str, str] = {
    "registration_status": "status",
    "registration_date": "registered_at",
    "legal_form": "legal_form",
    "oked_code": "industry_code",
    # director_name and address_full are stored in adjacent structures
    # (directors JSONB / addresses FK) — handled specially.
}

ENRICHMENT_FRESH_WINDOW = timedelta(days=30)


# ────────────────────────────────────────────────────────────────────
# Arq entrypoint
# ────────────────────────────────────────────────────────────────────


async def egov_enrich(ctx: dict[str, Any], company_id: str) -> dict[str, Any]:
    """Look up a company on egov.kz and patch missing fields.

    `company_id` arrives as a string (arq serializes UUIDs as str).
    """
    cid = UUID(str(company_id))
    session_factory = _session_factory(ctx)

    async with session_factory() as session:
        company = (
            await session.execute(select(Company).where(Company.id == cid))
        ).scalar_one_or_none()

        if company is None:
            return {"enriched": False, "reason": "not_found", "fields_set": []}

        if not company.bin:
            return {"enriched": False, "reason": "no_bin", "fields_set": []}

        if _recently_enriched(company):
            return {
                "enriched": False,
                "reason": "fresh",
                "fields_set": [],
                "enriched_at_egov": company.enriched_at_egov.isoformat()
                if company.enriched_at_egov
                else None,
            }

        try:
            result = await enrich_by_bin(company.bin)
        except Exception as exc:
            logger.warning("egov_enrich_upstream_failed", company_id=str(cid), error=str(exc))
            return {"enriched": False, "reason": "upstream_error", "fields_set": []}

        if result is None:
            company.enriched_at_egov = datetime.now(UTC)
            await session.commit()
            return {"enriched": False, "reason": "not_found_upstream", "fields_set": []}

        fields_set = await _patch_company(session, company, result)
        company.enriched_at_egov = datetime.now(UTC)
        await session.commit()
        return {"enriched": True, "fields_set": fields_set}


def _recently_enriched(company: Company) -> bool:
    last = company.enriched_at_egov
    if last is None:
        return False
    if last.tzinfo is None:
        last = last.replace(tzinfo=UTC)
    return (datetime.now(UTC) - last) < ENRICHMENT_FRESH_WINDOW


# ────────────────────────────────────────────────────────────────────
# Patch logic
# ────────────────────────────────────────────────────────────────────


async def _patch_company(
    session: AsyncSession, company: Company, result: EgovEnrichmentResult,
) -> list[str]:
    """Patch the company row with non-null fields only.

    Skip any column that already has a value — egov.kz is a fallback source
    and must never clobber a higher-confidence row from goszakup / kgd.
    """
    fields_set: list[str] = []

    for egov_field, col_name in _FIELD_TO_COMPANY_COLUMN.items():
        new_value = getattr(result, egov_field)
        if new_value is None:
            continue
        current = getattr(company, col_name, None)
        if current not in (None, ""):
            continue
        setattr(company, col_name, new_value)
        fields_set.append(col_name)
        _record_change(session, company.id, col_name, current, new_value)

    # Director: stored as JSONB list of {name, role, since}. Append only if empty.
    if result.director_name and not (company.directors or []):
        company.directors = [{"name": result.director_name, "role": "director", "since": None}]
        fields_set.append("directors")
        _record_change(session, company.id, "directors", None, company.directors)

    # Address full text — write to `raw.egov_address` if we don't have an address.
    if result.address_full and company.address_id is None:
        raw = dict(company.raw or {})
        if not raw.get("egov_address"):
            raw["egov_address"] = result.address_full
            company.raw = raw
            fields_set.append("raw.egov_address")
            _record_change(session, company.id, "raw.egov_address", None, result.address_full)

    return fields_set


def _record_change(
    session: AsyncSession, company_id: UUID, field: str, old: Any, new: Any,
) -> None:
    """Append a CDC row if the companies_changes table is present in the model.

    Safe to call when the migration hasn't run — we only build the ORM
    object, the commit will surface any schema mismatch as an error.
    """
    try:
        session.add(
            CompanyChange(
                company_id=company_id,
                field=field,
                old_value={"value": _jsonable(old)} if old is not None else None,
                new_value={"value": _jsonable(new)},
            )
        )
    except Exception as exc:
        # Don't let a CDC write failure abort the enrichment.
        logger.debug("egov_cdc_write_failed", field=field, error=str(exc))


def _jsonable(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (list, dict, str, int, float, bool)) or value is None:
        return value
    return str(value)


# ────────────────────────────────────────────────────────────────────
# Session bootstrap (when called outside the FastAPI request context)
# ────────────────────────────────────────────────────────────────────


_engine_cache: dict[str, Any] = {}


def _session_factory(ctx: dict[str, Any]) -> async_sessionmaker[AsyncSession]:
    """Re-use the engine across task invocations within a worker process."""
    if "db_session_factory" in ctx and callable(ctx["db_session_factory"]):
        return ctx["db_session_factory"]  # type: ignore[no-any-return]

    factory = _engine_cache.get("factory")
    if factory is not None:
        return factory  # type: ignore[no-any-return]

    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    _engine_cache["engine"] = engine
    _engine_cache["factory"] = factory
    return factory


# ────────────────────────────────────────────────────────────────────
# Trigger helper
# ────────────────────────────────────────────────────────────────────


async def enqueue_egov_enrich_if_needed(
    company: Company,
    *,
    user_id: str | None = None,
    tier: str | None = None,
    arq_pool: Any | None = None,
) -> bool:
    """Enqueue egov enrichment for a company if it looks under-enriched.

    Returns True iff a job was enqueued. Bails silently on missing pool /
    rate-limit hit / freshness window / no BIN so callers can wire this in
    without try/except.
    """
    if not _needs_egov_enrichment(company):
        return False

    if user_id is not None:
        allowed = await _consume_rate_token(user_id=user_id, tier=tier or "free")
        if not allowed:
            logger.info("egov_enrich_rate_limited", user_id=user_id, tier=tier)
            return False

    pool = arq_pool
    if pool is None:
        try:
            from app.workers.queue import get_arq_pool  # type: ignore[import-not-found]
        except ImportError:
            return False
        try:
            pool = await get_arq_pool()
        except Exception as exc:
            logger.debug("egov_arq_pool_unavailable", error=str(exc))
            return False

    try:
        await pool.enqueue_job(
            "egov_enrich",
            str(company.id),
            _job_id=f"egov_enrich:{company.id}",
        )
    except Exception as exc:
        logger.debug("egov_enqueue_failed", company_id=str(company.id), error=str(exc))
        return False
    return True


def _needs_egov_enrichment(company: Company) -> bool:
    if not getattr(company, "bin", None):
        return False
    if _recently_enriched(company):
        return False
    # Treat missing director information as the canonical "needs enrichment"
    # signal — that's the marquee field egov.kz adds over goszakup.
    directors = company.directors or []
    has_director = any(
        isinstance(d, dict) and (d.get("name") or "").strip() for d in directors
    )
    if has_director:
        return False
    # Bail if the SQLAlchemy state has unflushed changes other than what we
    # set (defensive — we don't want to enqueue mid-transaction).
    try:
        state = inspect(company)
        if state.detached:
            return False
    except Exception:  # noqa: S110 — inspector best-effort
        pass
    return True


# ────────────────────────────────────────────────────────────────────
# Per-user rate limit (free 100/day, paid 1000/day)
# ────────────────────────────────────────────────────────────────────


RATE_LIMIT_PER_DAY = {"free": 100}
RATE_LIMIT_DEFAULT_PAID = 1000


async def _consume_rate_token(*, user_id: str, tier: str) -> bool:
    """Return True if a token was consumed, False if cap was hit."""
    cap = RATE_LIMIT_PER_DAY.get(tier, RATE_LIMIT_DEFAULT_PAID)
    key = _rate_key(user_id=user_id)
    try:
        from app.ai.cache import get_redis

        r = await get_redis()
        current = await r.incr(key)
        if int(current) == 1:
            # First hit today — expire at end of day (86400s rolling is fine).
            await r.expire(key, 86400)
        return int(current) <= cap
    except Exception as exc:
        logger.debug("egov_rate_limit_redis_unavailable", error=str(exc))
        # Fail-open: don't block enrichment when Redis is down.
        return True


def _rate_key(*, user_id: str) -> str:
    today = datetime.now(UTC).strftime("%Y%m%d")
    return f"egov_enrich_per_user_day:{user_id}:{today}"
