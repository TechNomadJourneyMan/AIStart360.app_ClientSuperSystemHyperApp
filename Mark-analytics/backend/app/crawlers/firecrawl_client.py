"""Firecrawl client — anti-bot-resistant scraping + structured extraction.

Why Firecrawl: KZ commercial registries (kompra.kz, adata.kz, ranker.kz) actively
block raw httpx. Firecrawl renders JS, rotates proxies, handles captchas, and
returns clean markdown — much easier to feed to the LLM extractor.

API docs: https://docs.firecrawl.dev/api-reference

This client supports:
  - scrape(url, formats=['markdown','html'])
  - extract(urls, schema, prompt)
  - map(url) — discover URLs on a domain
  - crawl(url, limit) — recursive

Falls back to a structured ProviderError when FIRECRAWL_API_KEY is not set,
so callers can degrade gracefully.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import settings
from app.core.logging import get_logger

logger = get_logger("crawler.firecrawl")


class FirecrawlError(Exception):
    pass


class FirecrawlNotConfigured(FirecrawlError):
    pass


@dataclass(slots=True)
class ScrapeResult:
    url: str
    success: bool
    markdown: str | None = None
    html: str | None = None
    structured: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None
    error: str | None = None


@dataclass(slots=True)
class ExtractResult:
    success: bool
    data: list[dict[str, Any]] | dict[str, Any] | None = None
    sources: list[str] | None = None
    error: str | None = None


class FirecrawlClient:
    """Async Firecrawl HTTP client. One instance per process is fine."""

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None
        self._lock = asyncio.Lock()

    def _require_key(self) -> str:
        if not settings.FIRECRAWL_API_KEY:
            raise FirecrawlNotConfigured(
                "FIRECRAWL_API_KEY not set — add it to backend/.env "
                "(get one at https://firecrawl.dev or run self-hosted)."
            )
        return settings.FIRECRAWL_API_KEY

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            async with self._lock:
                if self._client is None:
                    self._client = httpx.AsyncClient(
                        base_url=settings.FIRECRAWL_BASE_URL,
                        timeout=httpx.Timeout(settings.FIRECRAWL_TIMEOUT_S, connect=10),
                    )
        return self._client

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._require_key()}",
            "Content-Type": "application/json",
        }

    # ─── Scrape ────────────────────────────────────────────────────

    async def scrape(
        self,
        url: str,
        *,
        formats: list[str] | None = None,
        only_main: bool = True,
        wait_for: int = 0,
    ) -> ScrapeResult:
        """Scrape a single URL. Returns markdown + optional HTML / metadata."""
        try:
            self._require_key()
        except FirecrawlNotConfigured as e:
            return ScrapeResult(url=url, success=False, error=str(e))

        body = {
            "url": url,
            "formats": formats or ["markdown"],
            "onlyMainContent": only_main,
        }
        if wait_for > 0:
            body["waitFor"] = wait_for

        try:
            client = await self._http()
            r = await client.post("/v1/scrape", headers=self._headers(), json=body)
        except httpx.HTTPError as e:
            logger.warning("firecrawl_http_failed", url=url, err=str(e))
            return ScrapeResult(url=url, success=False, error=f"HTTP error: {e}")

        if r.status_code >= 400:
            return ScrapeResult(url=url, success=False,
                                  error=f"{r.status_code}: {r.text[:300]}")
        payload = r.json()
        data = payload.get("data") or payload
        return ScrapeResult(
            url=url,
            success=bool(payload.get("success", True)) and bool(data),
            markdown=data.get("markdown"),
            html=data.get("html"),
            metadata=data.get("metadata"),
        )

    # ─── Extract (structured, schema-driven) ──────────────────────

    async def extract(
        self,
        urls: list[str],
        *,
        schema: dict[str, Any] | None = None,
        prompt: str | None = None,
        enable_web_search: bool = False,
    ) -> ExtractResult:
        """Run structured extraction on a list of URLs via Firecrawl's /extract."""
        try:
            self._require_key()
        except FirecrawlNotConfigured as e:
            return ExtractResult(success=False, error=str(e))

        body: dict[str, Any] = {"urls": urls}
        if schema:
            body["schema"] = schema
        if prompt:
            body["prompt"] = prompt
        if enable_web_search:
            body["enableWebSearch"] = True

        try:
            client = await self._http()
            r = await client.post("/v1/extract", headers=self._headers(), json=body)
        except httpx.HTTPError as e:
            return ExtractResult(success=False, error=f"HTTP error: {e}")

        if r.status_code >= 400:
            return ExtractResult(success=False,
                                  error=f"{r.status_code}: {r.text[:300]}")
        payload = r.json()
        # Firecrawl returns either immediate data or a job ID for polling.
        if payload.get("id") and not payload.get("data"):
            # Async job — poll
            return await self._poll_extract(payload["id"])
        return ExtractResult(
            success=bool(payload.get("success", True)),
            data=payload.get("data"),
            sources=payload.get("sources"),
        )

    async def _poll_extract(self, job_id: str, max_wait_s: int = 120) -> ExtractResult:
        client = await self._http()
        elapsed = 0
        while elapsed < max_wait_s:
            await asyncio.sleep(3)
            elapsed += 3
            r = await client.get(f"/v1/extract/{job_id}", headers=self._headers())
            if r.status_code >= 400:
                return ExtractResult(success=False, error=f"poll {r.status_code}")
            p = r.json()
            if p.get("status") == "completed":
                return ExtractResult(success=True, data=p.get("data"), sources=p.get("sources"))
            if p.get("status") == "failed":
                return ExtractResult(success=False, error=p.get("error", "extract failed"))
        return ExtractResult(success=False, error="timeout waiting for extract job")

    # ─── Map ────────────────────────────────────────────────────────

    async def map_urls(self, url: str, *, limit: int = 100, search: str | None = None) -> list[str]:
        """Discover URLs on a domain. Cheap call — no full page rendering."""
        self._require_key()
        body: dict[str, Any] = {"url": url, "limit": limit}
        if search:
            body["search"] = search
        client = await self._http()
        r = await client.post("/v1/map", headers=self._headers(), json=body)
        if r.status_code >= 400:
            raise FirecrawlError(f"{r.status_code}: {r.text[:300]}")
        return r.json().get("links") or r.json().get("data", {}).get("links") or []

    # ─── Crawl ──────────────────────────────────────────────────────

    async def crawl(
        self, url: str, *, limit: int = 50,
        include_paths: list[str] | None = None,
        exclude_paths: list[str] | None = None,
    ) -> str:
        """Start a recursive crawl. Returns crawl job ID — poll separately for results."""
        self._require_key()
        body: dict[str, Any] = {"url": url, "limit": limit}
        if include_paths:
            body["includePaths"] = include_paths
        if exclude_paths:
            body["excludePaths"] = exclude_paths
        client = await self._http()
        r = await client.post("/v1/crawl", headers=self._headers(), json=body)
        if r.status_code >= 400:
            raise FirecrawlError(f"{r.status_code}: {r.text[:300]}")
        return r.json().get("id")

    async def crawl_status(self, job_id: str) -> dict[str, Any]:
        client = await self._http()
        r = await client.get(f"/v1/crawl/{job_id}", headers=self._headers())
        return r.json()

    async def healthcheck(self) -> bool:
        """Cheap probe: tries a no-op scrape against firecrawl.dev itself."""
        if not settings.FIRECRAWL_API_KEY:
            return False
        try:
            r = await self.scrape("https://firecrawl.dev", formats=["markdown"])
            return r.success
        except Exception:  # noqa: BLE001
            return False


# Singleton — instantiated lazily on first import
firecrawl = FirecrawlClient()


# ─── Convenience: structured company extraction ─────────────────────

COMPANY_EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "name":            {"type": "string", "description": "Company official name"},
        "bin":             {"type": "string", "description": "12-digit KZ BIN if present"},
        "legal_form":      {"type": "string", "description": "ТОО / АО / ИП / etc."},
        "status":          {"type": "string", "description": "active / liquidated / etc."},
        "industry_code":   {"type": "string", "description": "OKED code XX.YY"},
        "industry_label":  {"type": "string"},
        "address":         {"type": "string"},
        "phone":           {"type": "string"},
        "email":           {"type": "string"},
        "website":         {"type": "string"},
        "employee_count":  {"type": "integer"},
        "revenue_usd":     {"type": "number"},
        "registered_at":   {"type": "string", "description": "ISO date YYYY-MM-DD"},
        "directors":       {"type": "array", "items": {"type": "object",
                              "properties": {"name": {"type": "string"}, "role": {"type": "string"}}}},
        "founders":        {"type": "array", "items": {"type": "object",
                              "properties": {"name": {"type": "string"}, "share_pct": {"type": "number"}}}},
        "description":     {"type": "string"},
    },
    "required": ["name"],
}


async def extract_company_from_url(url: str) -> dict[str, Any] | None:
    """One-call helper: extract a normalized Company dict from any company page."""
    result = await firecrawl.extract(
        [url],
        schema=COMPANY_EXTRACT_SCHEMA,
        prompt=(
            "Extract structured company information from this page. "
            "Look for: BIN (КЗ 12 цифр), official name, legal form (ТОО/АО), "
            "OKED industry code, status, address, contacts, employees, revenue, "
            "directors, founders. Return null for fields you cannot find."
        ),
    )
    if not result.success or not result.data:
        return None
    # Firecrawl /extract returns either a dict (single URL) or list
    data = result.data[0] if isinstance(result.data, list) and result.data else result.data
    if isinstance(data, list):
        data = data[0] if data else None
    return data
