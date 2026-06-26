"""On-demand egov.kz / stat.gov.kz BIN lookup.

Spec: docs/aistart360/07-product-redesign.md §6 Source 3 + §11 PR #8

Public lookup-by-BIN does not have one canonical OAS-described URL. The most
reliable public endpoint at time of writing is Stats KZ:
    https://stat.gov.kz/api/juridical/?bin={bin}&lang=ru
(the egov BIN portal itself proxies a similar payload behind a captcha).

The default URL is overridable via the `EGOV_LOOKUP_URL` env var so we can
swap in a kgd.gov.kz / nuhd mirror without a code change.

Cache strategy:
  - Redis key  egov:bin:{bin}              TTL 30d on hit
  - Redis key  egov:bin:{bin}:missing      TTL 1d  sentinel for known-404
The sentinel exists to avoid hammering the upstream when a BIN genuinely
does not resolve (or the API is temporarily routing 404 → missing).

The service is intentionally conservative:
  - 3 retries with exponential backoff (0.5s, 2s, 8s)
  - 10s per-request timeout
  - One blocking lock per-BIN is *not* implemented — the worst case is N
    parallel calls all writing the same cache key, which is benign.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import asdict, dataclass
from datetime import date
from typing import Any

import httpx

from app.core.logging import get_logger

logger = get_logger(__name__)


# ────────────────────────────────────────────────────────────────────
# Constants
# ────────────────────────────────────────────────────────────────────


DEFAULT_EGOV_LOOKUP_URL = "https://stat.gov.kz/api/juridical/"

# Cache TTLs (seconds)
CACHE_TTL_HIT_SECONDS = 30 * 24 * 3600   # 30 days
CACHE_TTL_MISS_SECONDS = 24 * 3600       # 1 day for known-missing BINs

# HTTP behaviour
HTTP_TIMEOUT_SECONDS = 10.0
HTTP_MAX_RETRIES = 3
BACKOFF_SCHEDULE = (0.5, 2.0, 8.0)        # exponential-ish

# Sentinel payload written to cache when upstream returned 404.
_MISSING_SENTINEL = b'{"__missing__": true}'

# BIN: exactly 12 digits in KZ.
_BIN_RE = re.compile(r"^\d{12}$")


# ────────────────────────────────────────────────────────────────────
# Result type
# ────────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class EgovEnrichmentResult:
    """Normalised egov.kz response. Any field may be None."""

    director_name: str | None = None
    registration_status: str | None = None
    registration_date: date | None = None
    legal_form: str | None = None
    address_full: str | None = None
    oked_code: str | None = None

    def to_jsonable(self) -> dict[str, Any]:
        d = asdict(self)
        if self.registration_date is not None:
            d["registration_date"] = self.registration_date.isoformat()
        return d

    @classmethod
    def from_jsonable(cls, payload: dict[str, Any]) -> EgovEnrichmentResult:
        reg = payload.get("registration_date")
        if isinstance(reg, str):
            try:
                reg_parsed: date | None = date.fromisoformat(reg)
            except ValueError:
                reg_parsed = None
        else:
            reg_parsed = None
        return cls(
            director_name=payload.get("director_name"),
            registration_status=payload.get("registration_status"),
            registration_date=reg_parsed,
            legal_form=payload.get("legal_form"),
            address_full=payload.get("address_full"),
            oked_code=payload.get("oked_code"),
        )


# ────────────────────────────────────────────────────────────────────
# Public entrypoint
# ────────────────────────────────────────────────────────────────────


def _lookup_url() -> str:
    return os.environ.get("EGOV_LOOKUP_URL") or DEFAULT_EGOV_LOOKUP_URL


def _cache_key(bin_code: str) -> str:
    return f"egov:bin:{bin_code}"


async def enrich_by_bin(
    bin_code: str,
    *,
    http_client: httpx.AsyncClient | None = None,
) -> EgovEnrichmentResult | None:
    """Look up a BIN against egov.kz / stat.gov.kz.

    Returns parsed `EgovEnrichmentResult` or `None` if the BIN is not found.
    Raises `httpx.HTTPStatusError` / `httpx.HTTPError` after retries on
    persistent upstream failures (caller decides how to surface that).
    """
    if not _BIN_RE.fullmatch(bin_code or ""):
        # Not a valid BIN — treat as a hard miss without hitting upstream.
        return None

    # 1) Cache
    cached = await _cache_get(bin_code)
    if cached is _CACHE_MISS_SENTINEL:
        return None
    if cached is not None:
        return cached

    # 2) Upstream
    payload = await _fetch_with_retry(bin_code, http_client=http_client)
    if payload is None:
        await _cache_put_missing(bin_code)
        return None

    parsed = _parse_response(payload)
    if parsed is None:
        # Upstream returned 200 but the body had no usable fields.
        await _cache_put_missing(bin_code)
        return None

    await _cache_put(bin_code, parsed)
    return parsed


# ────────────────────────────────────────────────────────────────────
# Cache helpers
# ────────────────────────────────────────────────────────────────────


class _MissSentinel:
    """Distinguish 'cached as missing' from 'cache cold'."""


_CACHE_MISS_SENTINEL = _MissSentinel()


async def _redis() -> Any:
    """Lazy redis import — keeps this module testable without a redis pool."""
    from app.ai.cache import get_redis

    return await get_redis()


async def _cache_get(bin_code: str) -> EgovEnrichmentResult | _MissSentinel | None:
    try:
        r = await _redis()
        raw = await r.get(_cache_key(bin_code))
    except Exception as exc:
        logger.debug("egov_cache_get_failed", bin=bin_code, error=str(exc))
        return None
    if raw is None:
        return None
    try:
        payload = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if isinstance(payload, dict) and payload.get("__missing__") is True:
        return _CACHE_MISS_SENTINEL
    if not isinstance(payload, dict):
        return None
    return EgovEnrichmentResult.from_jsonable(payload)


async def _cache_put(bin_code: str, result: EgovEnrichmentResult) -> None:
    try:
        r = await _redis()
        await r.setex(
            _cache_key(bin_code),
            CACHE_TTL_HIT_SECONDS,
            json.dumps(result.to_jsonable(), ensure_ascii=False).encode("utf-8"),
        )
    except Exception as exc:
        logger.debug("egov_cache_put_failed", bin=bin_code, error=str(exc))


async def _cache_put_missing(bin_code: str) -> None:
    try:
        r = await _redis()
        await r.setex(_cache_key(bin_code), CACHE_TTL_MISS_SECONDS, _MISSING_SENTINEL)
    except Exception as exc:
        logger.debug("egov_cache_put_missing_failed", bin=bin_code, error=str(exc))


# ────────────────────────────────────────────────────────────────────
# Fetch with retry
# ────────────────────────────────────────────────────────────────────


async def _fetch_with_retry(
    bin_code: str,
    *,
    http_client: httpx.AsyncClient | None,
) -> dict[str, Any] | None:
    """Hit upstream up to HTTP_MAX_RETRIES times.

    Returns parsed JSON dict on 2xx, None on 404, raises after retries on
    other persistent failures.
    """
    last_exc: Exception | None = None
    owns_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS)
    try:
        for attempt in range(HTTP_MAX_RETRIES):
            try:
                resp = await client.get(
                    _lookup_url(),
                    params={"bin": bin_code, "lang": "ru"},
                    headers={"Accept": "application/json"},
                )
            except httpx.HTTPError as exc:
                last_exc = exc
                logger.warning(
                    "egov_http_error",
                    bin=bin_code,
                    attempt=attempt + 1,
                    error=str(exc),
                )
                await _sleep_backoff(attempt)
                continue

            if resp.status_code == 404:
                return None
            if 500 <= resp.status_code < 600 or resp.status_code == 429:
                last_exc = httpx.HTTPStatusError(
                    f"egov upstream {resp.status_code}",
                    request=resp.request,
                    response=resp,
                )
                logger.warning(
                    "egov_upstream_status",
                    bin=bin_code,
                    attempt=attempt + 1,
                    status=resp.status_code,
                )
                await _sleep_backoff(attempt)
                continue
            if resp.status_code >= 400:
                # 4xx other than 404 → don't retry, surface
                resp.raise_for_status()

            try:
                return resp.json()  # type: ignore[no-any-return]
            except (ValueError, json.JSONDecodeError) as exc:
                last_exc = exc
                logger.warning(
                    "egov_invalid_json",
                    bin=bin_code,
                    attempt=attempt + 1,
                )
                await _sleep_backoff(attempt)
                continue
    finally:
        if owns_client:
            await client.aclose()

    assert last_exc is not None
    raise last_exc


async def _sleep_backoff(attempt: int) -> None:
    if attempt >= len(BACKOFF_SCHEDULE):
        return
    await asyncio.sleep(BACKOFF_SCHEDULE[attempt])


# ────────────────────────────────────────────────────────────────────
# Parser
# ────────────────────────────────────────────────────────────────────


# Stats KZ historically returned snake_case fields; egov sometimes camelCase.
# We accept either by checking a list of candidate keys per logical field.
_FIELD_MAP: dict[str, tuple[str, ...]] = {
    "director_name": ("director", "director_name", "head", "ceo", "chief"),
    "registration_status": ("status", "registration_status", "state"),
    "legal_form": ("legal_form", "opf", "legalForm", "form"),
    "address_full": ("address", "address_full", "registered_address", "addressRu"),
    "oked_code": ("oked", "oked_code", "okedCode", "activity_code"),
}


def _parse_response(payload: dict[str, Any]) -> EgovEnrichmentResult | None:
    """Map a raw upstream JSON body to EgovEnrichmentResult.

    Returns None if no usable fields were present.
    """
    # Stats KZ sometimes wraps the entity under `result` / `data` / `obj`.
    body = payload
    for wrapper in ("result", "data", "obj", "company"):
        if isinstance(body.get(wrapper), dict):
            body = body[wrapper]
            break

    if not isinstance(body, dict):
        return None

    extracted: dict[str, Any] = {}
    for logical, candidates in _FIELD_MAP.items():
        for key in candidates:
            if key in body and body[key] not in (None, ""):
                extracted[logical] = body[key]
                break

    # Registration date — try several keys + ISO/EU formats.
    reg_date: date | None = None
    for key in ("registration_date", "registered_at", "regDate", "date_registration"):
        raw = body.get(key)
        if not raw:
            continue
        reg_date = _parse_date(str(raw))
        if reg_date is not None:
            break

    if not extracted and reg_date is None:
        return None

    return EgovEnrichmentResult(
        director_name=_as_str(extracted.get("director_name")),
        registration_status=_as_str(extracted.get("registration_status")),
        registration_date=reg_date,
        legal_form=_as_str(extracted.get("legal_form")),
        address_full=_as_str(extracted.get("address_full")),
        oked_code=_as_str(extracted.get("oked_code")),
    )


def _as_str(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _parse_date(raw: str) -> date | None:
    raw = raw.strip()
    # ISO 8601 first
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        pass
    # DD.MM.YYYY (common in KZ public data)
    parts = raw.split(".")
    if len(parts) == 3:
        try:
            d, m, y = (int(p) for p in parts)
            return date(y, m, d)
        except ValueError:
            return None
    return None
