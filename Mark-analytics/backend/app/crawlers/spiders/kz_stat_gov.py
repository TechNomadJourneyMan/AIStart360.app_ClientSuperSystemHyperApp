"""KZ stat.gov.kz — Statistical Business Register (SBR).

Strategy:
  Public BIN search at https://stat.gov.kz/api/sbr/iAccessdata?bin=<BIN>
  Returns JSON with fields: bin, name, oked, oked2 (secondary), kato_code,
  krp_code (size), legal_form, registered_at, address, etc.

  We also support bulk discovery by paging the open-data list at
  https://stat.gov.kz/api/sbr/find?term=<query>&size=100

Rate-limit: 30 RPM. No API key required for read-only endpoints.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator

import httpx

from app.core.logging import get_logger
from app.crawlers.base import FetchedPage, SimpleHttpSpider

log = get_logger("crawler.kz_stat_gov")

BASE = "https://stat.gov.kz/api/sbr"
WEB_BASE = "https://stat.gov.kz/ru/jur-search-form"

# Fallback HTML endpoint when JSON API blocks; we render-parse it.
# (Implementation kept basic; real prod would use selectolax.)


class KzStatGovSpider(SimpleHttpSpider):
    source_key = "kz_stat_gov"
    rate_limit_rpm = 30
    upload_to_r2 = False  # JSON responses small; we just parse and upsert
    headers = {
        "User-Agent": "Mozilla/5.0 (AIStart360 Market Intelligence crawler; contact: ops@aistart360.app)",
        "Accept": "application/json",
        "Accept-Language": "ru,en;q=0.9",
    }

    async def make_seeds(self) -> list[str]:
        """For the periodic enrichment task we use explicit BIN list instead.
        This method returns the discovery endpoint as a single seed.
        """
        return [f"{BASE}/find?size=50&page=0"]

    async def parse(self, page: FetchedPage) -> AsyncIterator[dict[str, Any]]:
        """Yields company dicts. Caller (runner) decides what to upsert."""
        if page.http_status != 200 or not page.body:
            return
        try:
            data = json.loads(page.body)
        except json.JSONDecodeError:
            self.log.warning("non_json_response", url=page.url)
            return

        items = (
            data.get("items")
            or data.get("data")
            or data.get("rows")
            or (data if isinstance(data, list) else [])
        )
        if isinstance(items, dict):
            items = [items]

        for item in items:
            mapped = _map_sbr_to_company(item)
            if mapped:
                yield mapped

    async def fetch_by_bin(self, client: httpx.AsyncClient, bin_code: str) -> dict[str, Any] | None:
        """Direct BIN lookup. Returns mapped dict or None on miss."""
        url = f"{BASE}/iAccessdata?bin={bin_code}"
        try:
            r = await client.get(url, headers=self.headers, timeout=20)
        except httpx.HTTPError as e:
            self.log.warning("bin_fetch_failed", bin=bin_code, error=str(e))
            return None
        if r.status_code != 200:
            self.log.info("bin_no_data", bin=bin_code, status=r.status_code)
            return None
        try:
            data = r.json()
        except json.JSONDecodeError:
            return None
        return _map_sbr_to_company(data)


def _map_sbr_to_company(item: dict[str, Any]) -> dict[str, Any] | None:
    """Normalize stat.gov.kz field names to our Company schema."""
    if not item:
        return None
    bin_code = (
        item.get("bin")
        or item.get("BIN")
        or item.get("iin_bin")
        or item.get("idnum")
    )
    name = (
        item.get("nameRu")
        or item.get("name_ru")
        or item.get("namekz")
        or item.get("name")
        or item.get("orgname")
    )
    if not name:
        return None
    return {
        "bin": str(bin_code).strip() if bin_code else None,
        "name": name.strip(),
        "name_normalized": name.lower().replace("«", "").replace("»", "").strip(),
        "country": "KZ",
        "industry_code": item.get("oked") or item.get("okedCode") or item.get("oked_pri"),
        "industry_label": item.get("okedName") or item.get("oked_name"),
        "oked_secondary": (item.get("oked2") or item.get("oked_sec") or "").split(",")
                          if (item.get("oked2") or item.get("oked_sec")) else None,
        "legal_form": item.get("opf") or item.get("opfName"),
        "registered_at": item.get("registerDate") or item.get("regDate") or item.get("registered_at"),
        "status": _map_status(item.get("statusName") or item.get("status")),
        "kato_code": item.get("katoCode") or item.get("kato"),
        "krp_code": str(item.get("krpCode")) if item.get("krpCode") else None,
        "size_category": _krp_to_size(item.get("krpCode")),
        "ownership_type_detail": _map_ownership(item.get("foundType") or item.get("kfsName")),
        "raw": item,
        "data_source": "stat.gov.kz",
        "source_confidence": 0.95,
    }


def _map_status(s: str | None) -> str:
    if not s:
        return "active"
    s = s.lower()
    if "ликвидир" in s or "liquidat" in s:
        return "liquidated"
    if "реорганиз" in s or "reorgan" in s:
        return "reorganizing"
    if "приостан" in s or "suspend" in s:
        return "suspended"
    return "active"


def _krp_to_size(krp: int | str | None) -> str | None:
    """KRP code (КРП — Классификатор размерности предприятия)."""
    if krp is None:
        return None
    try:
        k = int(krp)
    except (TypeError, ValueError):
        return None
    if k in (1, 2): return "micro"
    if k in (3, 4): return "small"
    if k in (5, 6): return "medium"
    if k == 7: return "large"
    if k >= 8: return "enterprise"
    return None


def _map_ownership(s: str | None) -> str | None:
    if not s:
        return None
    s = s.lower()
    if "государств" in s or "state" in s:
        return "state"
    if "иностран" in s or "foreign" in s:
        return "foreign"
    if "частн" in s or "private" in s:
        return "private"
    return s
