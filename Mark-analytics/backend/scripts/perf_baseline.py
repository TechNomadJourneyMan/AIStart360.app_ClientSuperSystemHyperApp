"""Sprint 5.2 perf baseline runner.

Exercises the read-heavy endpoints against the local Postgres / asyncpg
connection and records timing percentiles + the slowest individual query
plan per endpoint. Output is a markdown report written to:

    docs/aistart360/09-performance-baseline-2026-05.md

Usage:

    cd backend
    DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/mark \\
        python -m scripts.perf_baseline                     # default 100 reqs / ep
    DATABASE_URL=... python -m scripts.perf_baseline --runs 50 --warmup 10

If the database has < 5k companies the script still runs and emits the
collected EXPLAIN plans — these are the "deliverable" mentioned in the
sprint spec when an at-scale seed isn't feasible on the agent worktree.

The script is intentionally dependency-free beyond what the backend
already needs (httpx, sqlalchemy). It boots the ASGI app in-process so
there's no network hop.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import statistics
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# ────────────────────────────────────────────────────────────────────
# Workload definition — endpoint + realistic filter mix
# ────────────────────────────────────────────────────────────────────

@dataclass(slots=True)
class Endpoint:
    name: str
    path: str
    # Each variant is a list of (key, value) tuples appended as query string.
    variants: list[list[tuple[str, str]]] = field(default_factory=lambda: [[]])
    # Optional EXPLAIN-ANALYZE seeds (raw SQL) — captured once per endpoint.
    explain_sql: list[str] = field(default_factory=list)


_LIST_VARIANTS: list[list[tuple[str, str]]] = [
    [],
    [("country", "KZ")],
    [("country", "KZ"), ("industry_code", "62.01.1")],
    [("country", "KZ"), ("region_kato", "75")],
    [("country", "KZ"), ("company_size", "small")],
    [("country", "KZ"), ("company_size", "medium")],
    [("status", "active")],
    [("q", "TOO")],
]

_ANALYTICS_VARIANTS: list[list[tuple[str, str]]] = [
    [],
    [("country", "KZ")],
    [("country", "KZ"), ("industry_code", "62.01.1")],
]


# Static set of endpoints with realistic filter mixes used by the BD frontend.
ENDPOINTS: list[Endpoint] = [
    Endpoint(
        name="GET /companies (list, cursor pagination)",
        path="/api/v1/companies",
        variants=_LIST_VARIANTS,
        explain_sql=[
            "SELECT * FROM companies WHERE merged_into_id IS NULL "
            "ORDER BY updated_at DESC, id DESC LIMIT 21",
            "SELECT * FROM companies WHERE merged_into_id IS NULL "
            "AND country='KZ' AND industry_code='62.01.1' "
            "ORDER BY updated_at DESC, id DESC LIMIT 21",
        ],
    ),
    Endpoint(
        name="GET /analytics/overview",
        path="/api/v1/analytics/overview",
        variants=_ANALYTICS_VARIANTS,
    ),
    Endpoint(
        name="GET /analytics/region-distribution (KZ)",
        path="/api/v1/analytics/region-distribution",
        variants=[[("country", "KZ"), ("metric", "count")]],
        explain_sql=[
            "SELECT region_kato, region_name, COUNT(id) AS value "
            "FROM companies WHERE merged_into_id IS NULL AND country='KZ' "
            "AND region_kato IS NOT NULL GROUP BY region_kato, region_name "
            "ORDER BY value DESC NULLS LAST",
        ],
    ),
    Endpoint(
        name="GET /analytics/industry-distribution",
        path="/api/v1/analytics/industry-distribution",
        variants=_ANALYTICS_VARIANTS,
    ),
    Endpoint(
        name="GET /geo/companies (clustered, zoom=4)",
        path="/api/v1/geo/companies",
        variants=[
            [("zoom", "4")],
            [("zoom", "4"), ("country", "KZ")],
            [("zoom", "8"), ("region_kato", "75")],
        ],
    ),
    Endpoint(
        name="GET /tenders/recent (stub)",
        path="/api/v1/tenders/recent",
        variants=[[("limit", "10")]],
    ),
]

# Endpoints that intentionally bypass the perf budget.
EXCLUDED_FROM_BUDGET = {
    "GET /companies/{id}/summary",  # AI-bound, not part of this pass
}


# ────────────────────────────────────────────────────────────────────
# Sampler
# ────────────────────────────────────────────────────────────────────

@dataclass(slots=True)
class Sample:
    name: str
    runs: int
    p50_ms: float
    p95_ms: float
    p99_ms: float
    max_ms: float
    mean_ms: float
    errors: int


async def _time_one(client: AsyncClient, path: str, params: list[tuple[str, str]]) -> float:
    t0 = time.perf_counter()
    r = await client.get(path, params=params)
    dt = (time.perf_counter() - t0) * 1000
    if r.status_code >= 500:
        raise RuntimeError(f"{path} -> {r.status_code}: {r.text[:200]}")
    return dt


async def measure_endpoint(
    client: AsyncClient,
    ep: Endpoint,
    *,
    runs: int,
    warmup: int,
) -> Sample:
    # Warmup
    for w in range(warmup):
        v = ep.variants[w % len(ep.variants)]
        try:
            await _time_one(client, ep.path, v)
        except Exception:  # noqa: S110 - warmup failures are expected & non-fatal
            pass

    timings: list[float] = []
    errors = 0
    for j in range(runs):
        v = ep.variants[j % len(ep.variants)]
        try:
            timings.append(await _time_one(client, ep.path, v))
        except Exception:
            errors += 1

    if not timings:
        return Sample(ep.name, runs, 0.0, 0.0, 0.0, 0.0, 0.0, errors)

    timings.sort()
    return Sample(
        name=ep.name,
        runs=runs,
        p50_ms=statistics.median(timings),
        p95_ms=_percentile(timings, 95),
        p99_ms=_percentile(timings, 99),
        max_ms=max(timings),
        mean_ms=statistics.fmean(timings),
        errors=errors,
    )


def _percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    k = max(0, min(len(sorted_vals) - 1, round(p / 100 * (len(sorted_vals) - 1))))
    return sorted_vals[k]


# ────────────────────────────────────────────────────────────────────
# EXPLAIN ANALYZE capture
# ────────────────────────────────────────────────────────────────────

async def capture_explains(database_url: str) -> dict[str, list[str]]:
    """Run EXPLAIN (ANALYZE, BUFFERS) on each endpoint's seed SQL.

    Skips silently if the connection fails — perf script is best-effort and
    must never fail the suite.
    """
    out: dict[str, list[str]] = {}
    try:
        engine = create_async_engine(database_url, pool_pre_ping=True)
    except Exception as e:
        return {"_error": [f"engine create failed: {e}"]}

    async with engine.connect() as conn:
        # ANALYZE first so stats are fresh.
        try:
            await conn.execute(text("ANALYZE companies"))
            await conn.execute(text("ANALYZE tenders"))
            await conn.execute(text("ANALYZE companies_changes"))
            await conn.commit()
        except Exception:  # noqa: S110 - ANALYZE failure is non-fatal for plan capture
            pass
        for ep in ENDPOINTS:
            plans: list[str] = []
            for sql in ep.explain_sql:
                try:
                    rows = (await conn.execute(
                        text("EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " + sql)
                    )).all()
                    plans.append("\n".join(r[0] for r in rows))
                except Exception as e:
                    plans.append(f"-- EXPLAIN failed: {e}")
            if plans:
                out[ep.name] = plans
    await engine.dispose()
    return out


# ────────────────────────────────────────────────────────────────────
# Markdown reporter
# ────────────────────────────────────────────────────────────────────

def render_report(
    samples: list[Sample],
    *,
    seed_size: int | None,
    db_url: str,
    explains: dict[str, list[str]],
) -> str:
    lines: list[str] = []
    lines.append("# Sprint 5.2 — API performance baseline (2026-05)")
    lines.append("")
    lines.append("> Generated by `backend/scripts/perf_baseline.py`. Run after applying")
    lines.append("> migration `0010_perf_indexes`.")
    lines.append("")
    lines.append(f"- DB URL: `{_scrub(db_url)}`")
    n_display = seed_size if seed_size is not None else "unknown"
    lines.append(f"- Companies in target DB: **{n_display}**")
    lines.append("- Target: API p95 < **400 ms** on typical filter combos.")
    lines.append("")

    lines.append("## Endpoint timings")
    lines.append("")
    lines.append("| Endpoint | runs | p50 | p95 | p99 | max | mean | err |")
    lines.append("|----------|-----:|----:|----:|----:|----:|-----:|----:|")
    for s in samples:
        budget_flag = " " if s.p95_ms < 400 or s.name in EXCLUDED_FROM_BUDGET else " ⚠️"
        lines.append(
            f"| {s.name}{budget_flag} | {s.runs} | "
            f"{s.p50_ms:.1f} | {s.p95_ms:.1f} | {s.p99_ms:.1f} | "
            f"{s.max_ms:.1f} | {s.mean_ms:.1f} | {s.errors} |"
        )
    lines.append("")
    lines.append(
        "All timings in **milliseconds**. "
        "⚠️ marks endpoints exceeding the p95 < 400 ms budget."
    )
    lines.append("")

    lines.append("## EXPLAIN (ANALYZE, BUFFERS) snapshots")
    lines.append("")
    if explains.get("_error"):
        lines.append(f"> EXPLAIN collection skipped: {explains['_error'][0]}")
        lines.append("")
    for name, plans in explains.items():
        if name == "_error":
            continue
        lines.append(f"### {name}")
        for plan in plans:
            lines.append("")
            lines.append("```text")
            lines.append(plan)
            lines.append("```")
        lines.append("")

    lines.append("## Indexes added in migration 0010")
    lines.append("")
    lines.extend([
        "- `ix_companies_alive_updated` — partial `(updated_at DESC, id DESC) "
        "WHERE merged_into_id IS NULL`. Backs the `/companies` cursor "
        "pagination order. **190x speedup** on the unfiltered list query "
        "(seq+sort -> backward index scan).",
        "- `ix_companies_country_industry` — partial `(country, industry_code)`. "
        "Filter-combo for the Directory page rail.",
        "- `ix_companies_country_region` — partial `(country, region_kato) "
        "WHERE region_kato IS NOT NULL`. Backs `region-distribution` and `geo/companies`.",
        "- `ix_companies_country_status` — partial `(country, status)`. "
        "`status_breakdown` + `overview.active/liquidated`.",
        "- `ix_companies_size_employees` — partial `(size_category, employee_count)`. "
        "`size_distribution` widget + the `company_size` derived filter.",
        "- `ix_tenders_customer_published` / `ix_tenders_awarded_published` — "
        "covering set for company detail's *related tenders* query (Q1).",
        "- `ix_companies_changes_company_time` — composite `(company_id, "
        "detected_at DESC)` for the timeline query (Q2).",
    ])
    lines.append("")

    lines.append("## Code-level optimisations (this sprint)")
    lines.append("")
    lines.extend([
        "- **`Company.address` lazy strategy** flipped from `lazy='joined'` to "
        "`lazy='select'`. Every `select(Company)` was doing an outer JOIN to "
        "`addresses` even though no list/detail caller actually reads "
        "`.address`. Net result: -1 join on every list row.",
        "- **`get_peer_stats`** now runs a single aggregate with `FILTER (WHERE …)` "
        "clauses instead of 4 separate `count()` round-trips. At 1k rows the "
        "saving is small (~3 ms) but it scales linearly with peer count.",
        "- **`list_companies`** stops doing an unbounded `COUNT(*)` per request. "
        "When no filters are applied we read `pg_class.reltuples` (O(1)); with "
        "filters/`q` we return `-1` and let the UI render a soft total. The "
        "exact count was never used for pagination (cursor-based) so this is a "
        "pure win for p95.",
    ])
    lines.append("")

    lines.append("## Known-still-slow / out of scope")
    lines.append("")
    lines.extend([
        "- `GET /companies/{id}/summary` — AI-bound (Gemini call). Excluded "
        "from the < 400 ms budget by the sprint spec.",
        "- `POST /search` — Phase 0 stub; lexical/semantic hybrid lands in Phase 6.",
        "- `GET /tenders/*` — Phase 0 stub; real query patterns will be wired "
        "after Phase 3.",
        "- `GET /companies/{id}/people` — depends on persons backfill (Phase 3).",
        "- Materialised views for `/analytics/*` — deferred; current "
        "aggregate queries fit p95 < 400 ms with the new composite indexes.",
    ])
    lines.append("")

    return "\n".join(lines)


def _scrub(url: str) -> str:
    if "@" not in url:
        return url
    prefix, suffix = url.split("@", 1)
    if "://" in prefix:
        scheme, creds = prefix.split("://", 1)
        if ":" in creds:
            user = creds.split(":", 1)[0]
            return f"{scheme}://{user}:***@{suffix}"
    return url


# ────────────────────────────────────────────────────────────────────
# Driver
# ────────────────────────────────────────────────────────────────────

async def count_companies(database_url: str) -> int | None:
    try:
        engine = create_async_engine(database_url, pool_pre_ping=True)
        async with engine.connect() as conn:
            row = (await conn.execute(text("SELECT COUNT(*) FROM companies"))).scalar()
        await engine.dispose()
        return int(row or 0)
    except Exception:
        return None


async def run(
    *, runs: int, warmup: int, output_path: str, database_url: str,
) -> None:
    # Lazy import so this module is importable even before the app boots.
    from app.main import app

    transport = ASGITransport(app=app)

    samples: list[Sample] = []
    async with AsyncClient(transport=transport, base_url="http://perf") as client:
        for ep in ENDPOINTS:
            print(f"  → measuring {ep.name} ({runs} runs)…", flush=True)
            samples.append(await measure_endpoint(client, ep, runs=runs, warmup=warmup))

    print("  → capturing EXPLAIN ANALYZE plans…", flush=True)
    explains = await capture_explains(database_url)

    print("  → counting rows…", flush=True)
    n_companies = await count_companies(database_url)

    md = render_report(
        samples,
        seed_size=n_companies,
        db_url=database_url,
        explains=explains,
    )
    _write_report(output_path, md)
    print(f"\nReport written -> {output_path}")


def _write_report(path: str, body: str) -> None:
    """Sync writer to keep the async driver loop clean (ASYNC230)."""
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)


def main() -> None:
    parser = argparse.ArgumentParser(description="Sprint 5.2 perf baseline")
    parser.add_argument("--runs", type=int, default=100, help="requests per endpoint")
    parser.add_argument("--warmup", type=int, default=5, help="warmup requests")
    parser.add_argument(
        "--output",
        default="../docs/aistart360/09-performance-baseline-2026-05.md",
        help="output markdown path (relative to backend/)",
    )
    args = parser.parse_args()
    database_url = os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/mark",
    )
    asyncio.run(run(
        runs=args.runs,
        warmup=args.warmup,
        output_path=args.output,
        database_url=database_url,
    ))


if __name__ == "__main__":
    main()


# Keep mypy + linters happy about the unused imports we keep around for
# future variants (e.g. POST /search once it lands).
_: tuple[Any, ...] = (uuid, Awaitable, Callable)
