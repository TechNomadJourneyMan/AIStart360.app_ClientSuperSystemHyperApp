"""KZ stat.gov.kz — Bulk BIN registry downloader.

This is NOT a Scrapy spider. It is a scheduled HTTP downloader that pulls the
official open-data bulk export of active legal entities (БИН registry) from
stat.gov.kz and bulk-upserts into ``companies`` by ``bin``.

Per ``docs/aistart360/07-product-redesign.md`` §6 Source 1:
  - Free, official, no auth.
  - ~400K active legal entities; realistic to land 200K in week 1.
  - Pure pipeline (no scraping, no anti-bot).

Quirks observed in the wild:
  - stat.gov.kz frequently rotates the dataset URL path on each refresh.
    Discovery is deferred — we hardcode the landing page (``LANDING_PAGE``)
    and parse out the first CSV/XLSX link via selectolax. If discovery
    fails, the operator can pass ``dataset_url=...`` directly to
    :func:`run_kz_stat_download`.
  - Columns are in Russian. We do case-insensitive match.
  - The dataset is delivered as a UTF-8 CSV with ``;`` delimiter (Excel-RU style).
  - The site occasionally serves a captcha page (HTML) instead of the CSV
    when the WAF flips. We detect content-type / 4xx and bail with status
    ``blocked``; the cron retries in 6h.

Rate limit: a single download per run. Cron: weekly, Wed 03:00 KZ time (UTC+5).
"""

from __future__ import annotations

import csv
import io
import re
import tempfile
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from app.core.logging import get_logger

log = get_logger("crawler.kz_stat")

# Hardcoded landing page (URL discovery deferred — see module docstring).
LANDING_PAGE = "https://stat.gov.kz/api/sbr/download"
# Backup direct candidate the platform team has observed working for ~6 months;
# only used if discovery fails to surface anything on the landing page.
FALLBACK_DATASET_URL = (
    "https://stat.gov.kz/api/sbr/download/active_legal_entities.csv"
)

SOURCE_KEY = "kz_stat"
DOWNLOAD_TIMEOUT_SECS = 300  # 5min — large CSV can take a while over residential proxy
CHUNK_SIZE = 5_000
USER_AGENT = (
    "Mozilla/5.0 (Mark Analytics BIN-registry downloader; "
    "contact: ops@mark-analytics.app)"
)

# ─── Schema ────────────────────────────────────────────────────────────────
# Required canonical columns. We match case-insensitively against the actual
# CSV header. The KZ open-data file uses these (sometimes mixed Russian/English).
REQUIRED_COLUMNS = {
    "bin": ["бин", "bin"],
    "name": ["наименование", "name_ru", "name", "наименование_ru"],
    "oked": ["окэд", "oked", "okedcode", "oked_pri"],
    "kato": ["като", "kato", "katocode", "kato_code"],
    "status": ["статус", "status"],
    "address": ["адрес", "address"],
    "head": ["руководитель", "директор", "head", "ceo"],
}


class KzStatSchemaError(ValueError):
    """Raised when the downloaded CSV/XLSX is missing required columns."""


class KzStatBlockedError(RuntimeError):
    """Raised when the source returns a captcha / 4xx / 403 etc.

    Caller should mark the ingest_job as ``blocked`` and schedule a retry.
    """


@dataclass(slots=True)
class DownloadResult:
    rows_processed: int = 0
    rows_inserted: int = 0
    rows_updated: int = 0
    rows_failed: int = 0
    dataset_url: str | None = None
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "rows_processed": self.rows_processed,
            "rows_inserted": self.rows_inserted,
            "rows_updated": self.rows_updated,
            "rows_failed": self.rows_failed,
            "dataset_url": self.dataset_url,
            "errors": self.errors[:20],  # cap to avoid bloating payload
        }


# ─── Discovery ─────────────────────────────────────────────────────────────


def discover_dataset_url(html: str, base_url: str = LANDING_PAGE) -> str | None:
    """Parse the landing page HTML for the first CSV/XLSX link.

    Returns None if nothing found (caller should fall back).
    """
    # Cheap regex pass — landing page rarely has many anchors. Avoids pulling
    # selectolax just for this.
    matches = re.findall(r'href="([^"]+\.(?:csv|xlsx|xls))"', html, flags=re.I)
    if not matches:
        return None
    href = matches[0]
    if href.startswith("http"):
        return href
    # naive join
    if href.startswith("/"):
        # https://stat.gov.kz + /...
        m = re.match(r"^(https?://[^/]+)", base_url)
        if m:
            return m.group(1) + href
    return base_url.rstrip("/") + "/" + href.lstrip("/")


# ─── Schema validation ─────────────────────────────────────────────────────


def validate_schema(header: list[str]) -> dict[str, str]:
    """Map canonical-name → actual-header-name. Raise on missing required columns.

    Returns: ``{"bin": "БИН", "name": "Наименование", ...}``.
    """
    lower = {h.strip().lower(): h for h in header}
    mapping: dict[str, str] = {}
    missing: list[str] = []
    for canonical, candidates in REQUIRED_COLUMNS.items():
        for cand in candidates:
            if cand in lower:
                mapping[canonical] = lower[cand]
                break
        else:
            missing.append(canonical)
    if missing:
        raise KzStatSchemaError(
            f"kz_stat dataset missing required columns: {missing}. "
            f"Got: {list(lower.values())[:20]}"
        )
    return mapping


# ─── Parsing ───────────────────────────────────────────────────────────────


def _map_status(s: str | None) -> str:
    if not s:
        return "active"
    sl = s.lower()
    if "ликвидир" in sl or "liquidat" in sl:
        return "liquidated"
    if "реорганиз" in sl or "reorgan" in sl:
        return "reorganizing"
    if "приостан" in sl or "suspend" in sl:
        return "suspended"
    return "active"


def _row_to_company(row: dict[str, str], mapping: dict[str, str]) -> dict[str, Any] | None:
    bin_code = (row.get(mapping["bin"]) or "").strip()
    name = (row.get(mapping["name"]) or "").strip()
    if not bin_code or not name:
        return None
    director = (row.get(mapping["head"]) or "").strip() or None
    return {
        "bin": bin_code,
        "name": name,
        "name_normalized": name.lower().replace("«", "").replace("»", "").strip(),
        "country": "KZ",
        "industry_code": (row.get(mapping["oked"]) or "").strip() or None,
        "kato_code": (row.get(mapping["kato"]) or "").strip() or None,
        "status": _map_status(row.get(mapping["status"])),
        "data_source": "stat.gov.kz",
        "source_confidence": 0.95,
        "raw": {
            "address": (row.get(mapping["address"]) or "").strip() or None,
            "head": director,
        },
    }


def iter_csv_chunks(
    fp: io.TextIOBase, chunk_size: int = CHUNK_SIZE
) -> Iterator[tuple[dict[str, str], list[dict[str, Any]]]]:
    """Stream CSV → yield (mapping, chunk-of-company-dicts).

    First chunk yields the column mapping (caller already validated). Each
    subsequent yield is a list of mapped Company dicts (up to ``chunk_size``).
    """
    # KZ open-data uses ; as delimiter. csv.Sniffer is unreliable on RU headers
    # so we hardcode then fall back to ,.
    sample = fp.read(4096)
    fp.seek(0)
    delim = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.DictReader(fp, delimiter=delim)
    if reader.fieldnames is None:
        raise KzStatSchemaError("kz_stat dataset has no header row")
    mapping = validate_schema(list(reader.fieldnames))

    buf: list[dict[str, Any]] = []
    for row in reader:
        mapped = _row_to_company(row, mapping)
        if mapped is None:
            continue
        buf.append(mapped)
        if len(buf) >= chunk_size:
            yield mapping, buf
            buf = []
    if buf:
        yield mapping, buf


# ─── Download ──────────────────────────────────────────────────────────────


async def stream_dataset_to_tempfile(
    client: httpx.AsyncClient, dataset_url: str
) -> Path:
    """Stream-download dataset_url to a tempfile. Returns path.

    Raises :class:`KzStatBlockedError` on 4xx/captcha / unexpected content-type.
    """
    tmp = tempfile.NamedTemporaryFile(
        prefix="kz_stat_", suffix=".csv", delete=False
    )
    tmp_path = Path(tmp.name)
    tmp.close()

    async with client.stream(
        "GET",
        dataset_url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/csv,*/*"},
        timeout=DOWNLOAD_TIMEOUT_SECS,
        follow_redirects=True,
    ) as resp:
        if resp.status_code in (401, 403, 404, 429):
            raise KzStatBlockedError(
                f"kz_stat dataset {dataset_url} returned {resp.status_code} — likely WAF/captcha"
            )
        ct = (resp.headers.get("content-type") or "").lower()
        if "html" in ct:
            # captcha page or maintenance
            raise KzStatBlockedError(
                f"kz_stat returned HTML (not CSV) for {dataset_url} — likely captcha"
            )
        resp.raise_for_status()
        # The open() is technically blocking, but it's a single local-disk fd
        # opened once per run — the streamed write loop itself is async.
        with tmp_path.open("wb") as fout:  # noqa: ASYNC230
            async for chunk in resp.aiter_bytes(chunk_size=1024 * 64):
                fout.write(chunk)
    return tmp_path


async def discover_with_client(client: httpx.AsyncClient) -> str:
    """Hit landing page, parse out dataset URL. Falls back to FALLBACK_DATASET_URL.

    Raises :class:`KzStatBlockedError` on landing-page 4xx.
    """
    try:
        r = await client.get(
            LANDING_PAGE, headers={"User-Agent": USER_AGENT}, timeout=30,
            follow_redirects=True,
        )
    except httpx.HTTPError as e:
        log.warning("kz_stat_landing_failed", err=str(e))
        return FALLBACK_DATASET_URL
    if r.status_code in (401, 403, 429):
        raise KzStatBlockedError(
            f"kz_stat landing page returned {r.status_code} — likely blocked"
        )
    if r.status_code != 200:
        log.warning("kz_stat_landing_non_200", status=r.status_code)
        return FALLBACK_DATASET_URL
    url = discover_dataset_url(r.text, base_url=LANDING_PAGE)
    return url or FALLBACK_DATASET_URL


# ─── Orchestration ─────────────────────────────────────────────────────────


async def run_kz_stat_download(
    *,
    dataset_url: str | None = None,
    upserter: Upserter | None = None,
    client: httpx.AsyncClient | None = None,
) -> DownloadResult:
    """End-to-end: discover → download → stream-parse → upsert.

    ``upserter`` defaults to the real DB upserter (:func:`db_upsert_chunk`).
    Tests pass a stub.
    """
    result = DownloadResult()
    if upserter is None:
        upserter = db_upsert_chunk

    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient()
    try:
        if dataset_url is None:
            dataset_url = await discover_with_client(client)
        result.dataset_url = dataset_url
        log.info("kz_stat_download_start", url=dataset_url)
        tmp_path = await stream_dataset_to_tempfile(client, dataset_url)
    finally:
        if owns_client:
            await client.aclose()

    try:
        with tmp_path.open("r", encoding="utf-8-sig", newline="") as fp:
            for _mapping, chunk in iter_csv_chunks(fp):
                try:
                    stats = await upserter(chunk)
                except Exception as e:
                    result.rows_failed += len(chunk)
                    result.errors.append(f"chunk_upsert_failed: {e}")
                    log.warning("kz_stat_chunk_failed", err=str(e), chunk_size=len(chunk))
                    continue
                result.rows_processed += len(chunk)
                result.rows_inserted += stats.get("inserted", 0)
                result.rows_updated += stats.get("updated", 0)
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass

    log.info(
        "kz_stat_download_done",
        processed=result.rows_processed,
        inserted=result.rows_inserted,
        updated=result.rows_updated,
        failed=result.rows_failed,
    )
    return result


# ─── DB upsert ─────────────────────────────────────────────────────────────

# Type alias: async callable taking a chunk → returning {"inserted": N, "updated": M}
Upserter = Any  # forward type alias for documentation


async def db_upsert_chunk(chunk: list[dict[str, Any]]) -> dict[str, int]:
    """Upsert one chunk into ``companies`` via ON CONFLICT(bin) DO UPDATE.

    Returns row counts. We approximate ``inserted`` vs ``updated`` by
    pre-checking which BINs already exist in this chunk's keyspace — Postgres
    doesn't expose this directly via INSERT ... ON CONFLICT RETURNING without
    a system column trick.
    """
    if not chunk:
        return {"inserted": 0, "updated": 0}

    # Local import: avoid pulling SQLAlchemy on cold-paths (CLI --help, tests
    # that stub the upserter).
    from sqlalchemy import select
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from app.db.session import async_session_factory
    from app.models.company import Company

    bins = [row["bin"] for row in chunk if row.get("bin")]
    async with async_session_factory() as session:
        existing_rows = await session.execute(
            select(Company.bin).where(Company.bin.in_(bins))
        )
        existing: set[str] = {r[0] for r in existing_rows.all()}

        now = datetime.now(UTC)
        payload: list[dict[str, Any]] = []
        for row in chunk:
            row_db = dict(row)
            row_db.setdefault("confidence", 0.95)
            row_db["updated_at"] = now
            payload.append(row_db)

        stmt = pg_insert(Company).values(payload)
        update_cols = {
            c: stmt.excluded[c]
            for c in [
                "name", "name_normalized", "country", "industry_code", "kato_code",
                "status", "data_source", "source_confidence", "raw", "confidence",
                "updated_at",
            ]
        }
        stmt = stmt.on_conflict_do_update(index_elements=["bin"], set_=update_cols)
        await session.execute(stmt)
        await session.commit()

    return {
        "inserted": len(bins) - len(existing),
        "updated": len(existing),
    }
