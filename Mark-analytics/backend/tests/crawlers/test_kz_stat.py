"""Tests for the kz_stat BIN registry downloader.

We exercise the parsing + orchestration without touching the database or the
real stat.gov.kz endpoint. Discovery + download is mocked at the
``httpx.AsyncClient`` boundary; ``run_kz_stat_download`` accepts a stub
``upserter`` callable so we never hit Postgres.

RUF001 (ambiguous unicode characters) is suppressed for the whole file: the
test fixtures intentionally use Cyrillic to mirror the real stat.gov.kz CSV.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.crawlers.spiders import kz_stat as mod
from app.crawlers.spiders.kz_stat import (
    KzStatBlockedError,
    KzStatSchemaError,
    discover_dataset_url,
    iter_csv_chunks,
    run_kz_stat_download,
    validate_schema,
)

# ─── Sample data ───────────────────────────────────────────────────────────

GOOD_HEADER = "БИН;Наименование;ОКЭД;КАТО;Статус;Адрес;Руководитель"

GOOD_ROWS = [
    "111111111111;ТОО Альфа;6201;750000000;Действующее;г. Алматы, ул. Абая 1;Иванов И.И.",
    "222222222222;АО Бета;5610;511010000;Ликвидировано;г. Нур-Султан, ул. Достык 5;Петров П.П.",
    "333333333333;ИП Гамма;4711;751120000;Действующее;г. Шымкент, ул. Тауке 9;Сидоров С.С.",
    "444444444444;ТОО Дельта;4321;750000000;Приостановлено;г. Алматы, мкр. Самал 12;Кенжебаев К.",
    "555555555555;ТОО Эпсилон;7022;750000000;Действующее;г. Алматы, пр. Достык 7;Абдрахманов А.",
    "666666666666;ТОО Зета;4711;751120000;Действующее;г. Шымкент, ул. Кунаева 3;Бекетов Б.",
    "777777777777;ТОО Эта;6201;511010000;Действующее;г. Астана, ул. Кенесары 10;Жанибеков Ж.",
    "888888888888;АО Тета;6420;511010000;Действующее;г. Астана, пр. Республики 5;Кенжетаев К.",
    "999999999999;ТОО Йота;4711;230000000;Действующее;г. Актобе, ул. Тургенева 8;Мухамеджанов М.",
    "121212121212;ТОО Каппа;5510;230000000;Реорганизация;г. Актобе, Алтынсарина 22;Жумабеков Ж.",
]


def _good_csv() -> str:
    return "\n".join([GOOD_HEADER, *GOOD_ROWS]) + "\n"


def _missing_status_csv() -> str:
    header = "БИН;Наименование;ОКЭД;КАТО;Адрес;Руководитель"
    rows = [
        "111111111111;ТОО Альфа;6201;750000000;г. Алматы, ул. Абая 1;Иванов И.И.",
    ]
    return "\n".join([header, *rows]) + "\n"


# ─── validate_schema ───────────────────────────────────────────────────────


def test_validate_schema_accepts_russian_headers() -> None:
    mapping = validate_schema(GOOD_HEADER.split(";"))
    assert mapping["bin"] == "БИН"
    assert mapping["name"] == "Наименование"
    assert mapping["oked"] == "ОКЭД"
    assert mapping["kato"] == "КАТО"
    assert mapping["status"] == "Статус"
    assert mapping["address"] == "Адрес"
    assert mapping["head"] == "Руководитель"


def test_validate_schema_raises_on_missing_required_column() -> None:
    header = ["БИН", "Наименование", "ОКЭД", "КАТО", "Адрес", "Руководитель"]  # no Статус
    with pytest.raises(KzStatSchemaError) as exc:
        validate_schema(header)
    assert "status" in str(exc.value)


# ─── iter_csv_chunks ───────────────────────────────────────────────────────


def test_iter_csv_chunks_yields_mapped_companies() -> None:
    fp = io.StringIO(_good_csv())
    chunks = list(iter_csv_chunks(fp, chunk_size=4))
    assert len(chunks) == 3  # 10 rows / 4 per chunk → 4 + 4 + 2

    first_mapping, first_chunk = chunks[0]
    assert first_mapping["bin"] == "БИН"
    assert len(first_chunk) == 4

    sample = first_chunk[0]
    assert sample == {
        "bin": "111111111111",
        "name": "ТОО Альфа",
        "name_normalized": "тоо альфа",
        "country": "KZ",
        "industry_code": "6201",
        "kato_code": "750000000",
        "status": "active",
        "data_source": "stat.gov.kz",
        "source_confidence": 0.95,
        "raw": {
            "address": "г. Алматы, ул. Абая 1",
            "head": "Иванов И.И.",
        },
    }


def test_iter_csv_chunks_maps_status_keywords() -> None:
    fp = io.StringIO(_good_csv())
    all_rows = [row for _, chunk in iter_csv_chunks(fp, chunk_size=100) for row in chunk]
    statuses = {row["bin"]: row["status"] for row in all_rows}
    assert statuses["111111111111"] == "active"
    assert statuses["222222222222"] == "liquidated"
    assert statuses["444444444444"] == "suspended"
    assert statuses["121212121212"] == "reorganizing"


def test_iter_csv_chunks_raises_on_bad_schema() -> None:
    fp = io.StringIO(_missing_status_csv())
    with pytest.raises(KzStatSchemaError):
        list(iter_csv_chunks(fp, chunk_size=100))


# ─── discover_dataset_url ──────────────────────────────────────────────────


def test_discover_dataset_url_picks_csv_anchor() -> None:
    html = """
    <html><body>
      <a href="/static/bin_registry_2026_05.csv">скачать</a>
      <a href="/other.pdf">manual</a>
    </body></html>
    """
    url = discover_dataset_url(html, base_url="https://stat.gov.kz/api/sbr/download")
    assert url == "https://stat.gov.kz/static/bin_registry_2026_05.csv"


def test_discover_dataset_url_none_when_no_match() -> None:
    assert discover_dataset_url("<html>nothing here</html>") is None


# ─── stream download (httpx mock) ──────────────────────────────────────────


def _build_mock_transport(
    *,
    landing_html: str | None = None,
    csv_body: str | bytes | None = None,
    csv_status: int = 200,
    csv_content_type: str = "text/csv; charset=utf-8",
) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/download") and "static" not in str(request.url):
            return httpx.Response(
                200,
                text=landing_html or "",
                headers={"content-type": "text/html"},
            )
        if csv_body is None:
            return httpx.Response(404)
        body_bytes = csv_body.encode("utf-8") if isinstance(csv_body, str) else csv_body
        return httpx.Response(
            csv_status, content=body_bytes,
            headers={"content-type": csv_content_type},
        )

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_run_kz_stat_download_happy_path_upserts_10_rows() -> None:
    landing = '<a href="/static/bin_registry.csv">download</a>'
    transport = _build_mock_transport(landing_html=landing, csv_body=_good_csv())

    upsert_calls: list[list[dict[str, Any]]] = []

    async def fake_upserter(chunk: list[dict[str, Any]]) -> dict[str, int]:
        upsert_calls.append(chunk)
        return {"inserted": len(chunk), "updated": 0}

    async with httpx.AsyncClient(transport=transport) as client:
        result = await run_kz_stat_download(
            upserter=fake_upserter, client=client,
        )

    assert result.dataset_url == "https://stat.gov.kz/static/bin_registry.csv"
    total = sum(len(c) for c in upsert_calls)
    assert total == 10
    assert result.rows_processed == 10
    assert result.rows_inserted == 10
    assert result.rows_updated == 0
    assert result.rows_failed == 0


@pytest.mark.asyncio
async def test_run_kz_stat_download_raises_on_missing_column() -> None:
    transport = _build_mock_transport(csv_body=_missing_status_csv())

    async def fake_upserter(chunk: list[dict[str, Any]]) -> dict[str, int]:
        return {"inserted": 0, "updated": 0}

    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(KzStatSchemaError):
            await run_kz_stat_download(
                dataset_url="https://stat.gov.kz/static/bin_registry.csv",
                upserter=fake_upserter,
                client=client,
            )


@pytest.mark.asyncio
async def test_run_kz_stat_download_raises_blocked_on_403() -> None:
    transport = _build_mock_transport(csv_body="", csv_status=403)

    async def fake_upserter(chunk: list[dict[str, Any]]) -> dict[str, int]:
        return {"inserted": 0, "updated": 0}

    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(KzStatBlockedError):
            await run_kz_stat_download(
                dataset_url="https://stat.gov.kz/static/bin_registry.csv",
                upserter=fake_upserter,
                client=client,
            )


@pytest.mark.asyncio
async def test_run_kz_stat_download_raises_blocked_on_html_captcha() -> None:
    transport = _build_mock_transport(
        csv_body="<html><body>captcha</body></html>",
        csv_content_type="text/html; charset=utf-8",
    )

    async def fake_upserter(chunk: list[dict[str, Any]]) -> dict[str, int]:
        return {"inserted": 0, "updated": 0}

    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(KzStatBlockedError):
            await run_kz_stat_download(
                dataset_url="https://stat.gov.kz/static/bin_registry.csv",
                upserter=fake_upserter,
                client=client,
            )


@pytest.mark.asyncio
async def test_run_kz_stat_download_is_idempotent_on_rerun() -> None:
    """Second run with same data → 0 inserts, 10 updates (stub upserter
    decides this by tracking which BINs it has already seen).
    """
    transport = _build_mock_transport(csv_body=_good_csv())

    seen_bins: set[str] = set()

    async def fake_upserter(chunk: list[dict[str, Any]]) -> dict[str, int]:
        inserted = 0
        updated = 0
        for row in chunk:
            if row["bin"] in seen_bins:
                updated += 1
            else:
                seen_bins.add(row["bin"])
                inserted += 1
        return {"inserted": inserted, "updated": updated}

    url = "https://stat.gov.kz/static/bin_registry.csv"
    async with httpx.AsyncClient(transport=transport) as client:
        first = await run_kz_stat_download(
            dataset_url=url, upserter=fake_upserter, client=client,
        )
        second = await run_kz_stat_download(
            dataset_url=url, upserter=fake_upserter, client=client,
        )

    assert first.rows_inserted == 10
    assert first.rows_updated == 0
    assert second.rows_inserted == 0
    assert second.rows_updated == 10


# ─── stream_dataset_to_tempfile cleanup ────────────────────────────────────


@pytest.mark.asyncio
async def test_run_kz_stat_download_cleans_up_tempfile(tmp_path: Path) -> None:
    """After a successful run, the tempfile that backed the streamed CSV
    must be removed so the worker disk doesn't fill up over weeks of crons.
    """
    transport = _build_mock_transport(csv_body=_good_csv())

    captured_paths: list[Path] = []
    original_stream = mod.stream_dataset_to_tempfile

    async def spy_stream(client: httpx.AsyncClient, url: str) -> Path:
        p = await original_stream(client, url)
        captured_paths.append(p)
        return p

    mod.stream_dataset_to_tempfile = spy_stream  # type: ignore[assignment]
    try:
        async def fake_upserter(chunk: list[dict[str, Any]]) -> dict[str, int]:
            return {"inserted": len(chunk), "updated": 0}

        async with httpx.AsyncClient(transport=transport) as client:
            await run_kz_stat_download(
                dataset_url="https://stat.gov.kz/static/bin_registry.csv",
                upserter=fake_upserter,
                client=client,
            )
    finally:
        mod.stream_dataset_to_tempfile = original_stream  # type: ignore[assignment]

    assert captured_paths, "spy never captured a tempfile path"
    for p in captured_paths:
        assert not p.exists(), f"leftover tempfile: {p}"
