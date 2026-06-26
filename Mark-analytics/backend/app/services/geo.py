"""Geo service — point queries, server-side clustering, region stats.

Assumes (after migration applied by the parallel agent) that `companies`
has columns: `latitude`, `longitude`, `region_kato`, `region_name`,
`city_name`. We access them via `getattr` so the module stays importable
before migration runs.

No PostGIS dependency: bbox filtering is plain `lat BETWEEN ... AND ...`.
Server-side clustering uses a snapping grid (`round(lat/cell)*cell`) which
is portable and cheap on a few hundred-thousand rows. Switch to PostGIS
`ST_SnapToGrid` once the column is on `geography(Point)`.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import Numeric, and_, cast, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.filters.registry import FILTERS, FilterType
from app.models.company import Company

# ────────────────────────────────────────────────────────────────────
# Constants
# ────────────────────────────────────────────────────────────────────

MAX_POINTS = 5000
CLUSTER_ZOOM_THRESHOLD = 10
SMALL_RESULT_THRESHOLD = 500
CACHE_TTL_SECONDS = 60
_CACHE_PREFIX = "geo:companies:"

# Static regions GeoJSON shipped under app/data/.
_REGIONS_PATH = Path(__file__).resolve().parent.parent / "data" / "kz_regions.geojson"
_REGIONS_CACHE: dict[str, Any] | None = None


# ────────────────────────────────────────────────────────────────────
# Bbox + filter clause helpers
# ────────────────────────────────────────────────────────────────────

@dataclass(frozen=True, slots=True)
class BBox:
    lon_min: float
    lat_min: float
    lon_max: float
    lat_max: float

    @classmethod
    def parse(cls, raw: str | None) -> "BBox | None":
        if not raw:
            return None
        parts = [p.strip() for p in raw.split(",")]
        if len(parts) != 4:
            return None
        try:
            lon1, lat1, lon2, lat2 = map(float, parts)
        except ValueError:
            return None
        return cls(
            lon_min=min(lon1, lon2),
            lat_min=min(lat1, lat2),
            lon_max=max(lon1, lon2),
            lat_max=max(lat1, lat2),
        )


def _lat_col() -> Any:
    return getattr(Company, "latitude", None)


def _lng_col() -> Any:
    return getattr(Company, "longitude", None)


def _apply_filters(stmt: Any, filters: dict[str, Any]) -> Any:
    """Reuse the central clause builder from companies service."""
    from app.services.companies import _build_clause, _build_derived_clause  # noqa: PLC0415

    for key, value in filters.items():
        negated = key.endswith("!")
        key_clean = key[:-1] if negated else key
        f = FILTERS.get(key_clean)
        if not f:
            continue
        clause = _build_derived_clause(key_clean, value, negated)
        if clause is not None:
            stmt = stmt.where(clause)
            continue
        if not f.backed_by.startswith("companies."):
            continue
        clause = _build_clause(f, value, negated)
        if clause is not None:
            stmt = stmt.where(clause)
    return stmt


def _apply_extra_geo_filters(stmt: Any, *, region_kato: str | None) -> Any:
    """Geo-specific filters not yet in the registry (region_kato column lives on companies)."""
    if region_kato:
        col = getattr(Company, "region_kato", None)
        if col is not None:
            stmt = stmt.where(col == region_kato)
    return stmt


def _apply_bbox(stmt: Any, bbox: BBox | None) -> Any:
    lat = _lat_col()
    lng = _lng_col()
    if lat is None or lng is None:
        return stmt
    stmt = stmt.where(lat.isnot(None), lng.isnot(None))
    if bbox is not None:
        stmt = stmt.where(
            lat >= bbox.lat_min,
            lat <= bbox.lat_max,
            lng >= bbox.lon_min,
            lng <= bbox.lon_max,
        )
    return stmt


# ────────────────────────────────────────────────────────────────────
# Cache key
# ────────────────────────────────────────────────────────────────────

def cache_key(
    *,
    bbox: BBox | None,
    zoom: int | None,
    filters: dict[str, Any],
    region_kato: str | None,
) -> str:
    payload = {
        "bbox": [bbox.lon_min, bbox.lat_min, bbox.lon_max, bbox.lat_max] if bbox else None,
        "zoom": zoom,
        "filters": dict(sorted(filters.items())),
        "region_kato": region_kato,
    }
    fp = hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode()
    ).hexdigest()[:24]
    return f"{_CACHE_PREFIX}{fp}"


async def get_cached(key: str) -> dict[str, Any] | None:
    try:
        from app.ai.cache import get_redis  # noqa: PLC0415

        r = await get_redis()
        raw = await r.get(key)
    except Exception:
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


async def put_cached(key: str, payload: dict[str, Any], ttl: int = CACHE_TTL_SECONDS) -> None:
    try:
        from app.ai.cache import get_redis  # noqa: PLC0415

        r = await get_redis()
        await r.setex(key, ttl, json.dumps(payload, default=str, ensure_ascii=False))
    except Exception:
        return


# ────────────────────────────────────────────────────────────────────
# Cell-size table for zoom-based grid clustering (degrees)
# ────────────────────────────────────────────────────────────────────

# Rough heuristic: cell size halves each zoom step. Tuned so that
# zoom 0 ≈ continent and zoom 9 ≈ small city block.
_ZOOM_CELL_DEG = {
    0: 30.0, 1: 20.0, 2: 12.0, 3: 8.0, 4: 5.0,
    5: 3.0, 6: 2.0, 7: 1.2, 8: 0.7, 9: 0.4,
}


def cell_size_deg(zoom: int | None) -> float:
    if zoom is None:
        return 2.0
    if zoom <= 0:
        return _ZOOM_CELL_DEG[0]
    if zoom >= 9:
        return _ZOOM_CELL_DEG[9]
    return _ZOOM_CELL_DEG[zoom]


def abbreviate_count(n: int) -> str:
    if n < 1000:
        return str(n)
    if n < 1_000_000:
        v = n / 1000
        return f"{v:.1f}k" if v < 10 else f"{int(round(v))}k"
    v = n / 1_000_000
    return f"{v:.1f}M" if v < 10 else f"{int(round(v))}M"


# ────────────────────────────────────────────────────────────────────
# Point queries (high zoom or small result)
# ────────────────────────────────────────────────────────────────────

async def fetch_points(
    session: AsyncSession,
    *,
    bbox: BBox | None,
    filters: dict[str, Any],
    region_kato: str | None,
    limit: int = MAX_POINTS,
) -> tuple[list[dict[str, Any]], bool]:
    """Return (rows, truncated)."""
    lat = _lat_col()
    lng = _lng_col()
    if lat is None or lng is None:
        # Migration not yet applied — silent empty.
        return [], False

    region_name_col = getattr(Company, "region_name", literal(None))
    city_name_col = getattr(Company, "city_name", literal(None))
    region_kato_col = getattr(Company, "region_kato", literal(None))

    stmt = select(
        Company.id,
        Company.name,
        Company.bin,
        Company.industry_code,
        Company.industry_label,
        Company.size_category,
        Company.revenue_usd,
        lat.label("lat"),
        lng.label("lng"),
        region_kato_col.label("region_kato"),
        region_name_col.label("region_name"),
        city_name_col.label("city_name"),
    ).where(Company.merged_into_id.is_(None))
    stmt = _apply_filters(stmt, filters)
    stmt = _apply_extra_geo_filters(stmt, region_kato=region_kato)
    stmt = _apply_bbox(stmt, bbox)
    stmt = stmt.limit(limit + 1)

    rows = (await session.execute(stmt)).all()
    truncated = len(rows) > limit
    if truncated:
        rows = rows[:limit]

    return [
        {
            "id": str(r.id),
            "name": r.name,
            "bin": r.bin,
            "industry_code": r.industry_code,
            "industry_label": r.industry_label,
            "size_category": r.size_category,
            "revenue_usd": float(r.revenue_usd) if r.revenue_usd is not None else None,
            "lat": float(r.lat),
            "lng": float(r.lng),
            "region_kato": r.region_kato,
            "region_name": r.region_name,
            "city_name": r.city_name,
        }
        for r in rows
    ], truncated


async def count_points(
    session: AsyncSession,
    *,
    bbox: BBox | None,
    filters: dict[str, Any],
    region_kato: str | None,
) -> int:
    lat = _lat_col()
    if lat is None:
        return 0
    stmt = select(func.count()).select_from(Company).where(Company.merged_into_id.is_(None))
    stmt = _apply_filters(stmt, filters)
    stmt = _apply_extra_geo_filters(stmt, region_kato=region_kato)
    stmt = _apply_bbox(stmt, bbox)
    return int((await session.execute(stmt)).scalar() or 0)


# ────────────────────────────────────────────────────────────────────
# Cluster query (low zoom)
# ────────────────────────────────────────────────────────────────────

async def fetch_clusters(
    session: AsyncSession,
    *,
    bbox: BBox | None,
    zoom: int | None,
    filters: dict[str, Any],
    region_kato: str | None,
) -> list[dict[str, Any]]:
    """Grid-snap clustering. No PostGIS required.

    For each non-null point, bucket by `(round(lat/cell)*cell, round(lng/cell)*cell)`
    and aggregate count + centroid (avg). Output is list of cluster dicts.
    """
    lat = _lat_col()
    lng = _lng_col()
    if lat is None or lng is None:
        return []

    cell = cell_size_deg(zoom)
    # Use Numeric cast to keep PostgreSQL happy with `round(numeric, int)`.
    lat_num = cast(lat, Numeric)
    lng_num = cast(lng, Numeric)
    snap_lat = (func.round(lat_num / cell) * cell).label("snap_lat")
    snap_lng = (func.round(lng_num / cell) * cell).label("snap_lng")

    stmt = select(
        snap_lat,
        snap_lng,
        func.count().label("point_count"),
        func.avg(lat_num).label("centroid_lat"),
        func.avg(lng_num).label("centroid_lng"),
    ).where(Company.merged_into_id.is_(None))
    stmt = _apply_filters(stmt, filters)
    stmt = _apply_extra_geo_filters(stmt, region_kato=region_kato)
    stmt = _apply_bbox(stmt, bbox)
    stmt = stmt.group_by(snap_lat, snap_lng).order_by(func.count().desc()).limit(MAX_POINTS)

    rows = (await session.execute(stmt)).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        cnt = int(r.point_count or 0)
        if cnt == 0:
            continue
        out.append({
            "cluster_id": f"{r.snap_lat}:{r.snap_lng}",
            "lat": float(r.centroid_lat),
            "lng": float(r.centroid_lng),
            "point_count": cnt,
            "point_count_abbreviated": abbreviate_count(cnt),
        })
    return out


# ────────────────────────────────────────────────────────────────────
# Top-level orchestrator → builds a GeoJSON-shaped dict.
# ────────────────────────────────────────────────────────────────────

async def companies_feature_collection(
    session: AsyncSession,
    *,
    bbox: BBox | None,
    zoom: int | None,
    filters: dict[str, Any],
    region_kato: str | None,
) -> dict[str, Any]:
    """Decide point vs cluster and return a GeoJSON FeatureCollection dict + meta."""
    # Decide whether to cluster. Cheap COUNT() first so we don't over-fetch
    # for a high-zoom view that turns out to be sparse.
    if zoom is None or zoom < CLUSTER_ZOOM_THRESHOLD:
        total = await count_points(
            session, bbox=bbox, filters=filters, region_kato=region_kato,
        )
        if total > SMALL_RESULT_THRESHOLD:
            clusters = await fetch_clusters(
                session, bbox=bbox, zoom=zoom, filters=filters, region_kato=region_kato,
            )
            features = [
                {
                    "type": "Feature",
                    "id": c["cluster_id"],
                    "geometry": {"type": "Point", "coordinates": [c["lng"], c["lat"]]},
                    "properties": {
                        "cluster": True,
                        "cluster_id": c["cluster_id"],
                        "point_count": c["point_count"],
                        "point_count_abbreviated": c["point_count_abbreviated"],
                    },
                }
                for c in clusters
            ]
            return {
                "type": "FeatureCollection",
                "features": features,
                "_meta": {
                    "mode": "clustered",
                    "zoom": zoom,
                    "cell_deg": cell_size_deg(zoom),
                    "total_points": total,
                    "cluster_count": len(features),
                    "truncated": False,
                },
            }

    rows, truncated = await fetch_points(
        session, bbox=bbox, filters=filters, region_kato=region_kato, limit=MAX_POINTS,
    )
    features = [
        {
            "type": "Feature",
            "id": r["id"],
            "geometry": {"type": "Point", "coordinates": [r["lng"], r["lat"]]},
            "properties": {
                "id": r["id"],
                "name": r["name"],
                "bin": r["bin"],
                "industry_code": r["industry_code"],
                "industry_label": r["industry_label"],
                "size_category": r["size_category"],
                "revenue_usd": r["revenue_usd"],
                "region_kato": r["region_kato"],
                "region_name": r["region_name"],
                "city_name": r["city_name"],
                "cluster": False,
            },
        }
        for r in rows
    ]
    return {
        "type": "FeatureCollection",
        "features": features,
        "_meta": {
            "mode": "points",
            "zoom": zoom,
            "returned": len(features),
            "truncated": truncated,
            "max_points": MAX_POINTS,
        },
    }


# ────────────────────────────────────────────────────────────────────
# Static KZ regions GeoJSON
# ────────────────────────────────────────────────────────────────────

def regions_geojson() -> dict[str, Any]:
    """Load + cache the static GeoJSON. Forever-cache (process lifetime)."""
    global _REGIONS_CACHE
    if _REGIONS_CACHE is None:
        try:
            with _REGIONS_PATH.open(encoding="utf-8") as f:
                _REGIONS_CACHE = json.load(f)
        except FileNotFoundError:
            _REGIONS_CACHE = {"type": "FeatureCollection", "features": []}
    return _REGIONS_CACHE


# ────────────────────────────────────────────────────────────────────
# Region cluster stats (for region-hover tooltip)
# ────────────────────────────────────────────────────────────────────

async def region_cluster_stats(
    session: AsyncSession,
    *,
    region_kato: str | None,
    filters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    filters = filters or {}
    region_col = getattr(Company, "region_kato", None)
    region_name_col = getattr(Company, "region_name", None)

    base = select(Company).where(Company.merged_into_id.is_(None))
    if region_col is not None and region_kato:
        base = base.where(region_col == region_kato)
    base = _apply_filters(base, filters)
    subq = base.subquery()

    # Total count + aggregate revenue/employees for the region's local market.
    totals_row = (await session.execute(
        select(
            func.count().label("cnt"),
            func.coalesce(func.sum(subq.c.revenue_usd), 0).label("revenue"),
            func.coalesce(func.sum(subq.c.employee_count), 0).label("employees"),
        ).select_from(subq)
    )).one()
    total = int(totals_row.cnt or 0)
    total_revenue = float(totals_row.revenue or 0)
    total_employees = int(totals_row.employees or 0)

    # By industry (top 10)
    by_industry_rows = (await session.execute(
        select(
            subq.c.industry_code,
            subq.c.industry_label,
            func.count().label("cnt"),
            func.coalesce(func.sum(subq.c.revenue_usd), 0).label("revenue"),
        )
        .where(subq.c.industry_code.isnot(None))
        .group_by(subq.c.industry_code, subq.c.industry_label)
        .order_by(func.count().desc())
        .limit(10)
    )).all()

    # By size_category
    by_size_rows = (await session.execute(
        select(
            func.coalesce(subq.c.size_category, "unknown").label("bucket"),
            func.count().label("cnt"),
        ).group_by(subq.c.size_category)
    )).all()

    # Top 5 by revenue
    top_rows = (await session.execute(
        select(subq.c.id, subq.c.name, subq.c.revenue_usd, subq.c.industry_label)
        .where(subq.c.revenue_usd.isnot(None))
        .order_by(subq.c.revenue_usd.desc())
        .limit(5)
    )).all()

    # Resolve region name (one row, if any)
    region_name: str | None = None
    if region_kato and region_name_col is not None:
        name_row = (await session.execute(
            select(region_name_col)
            .where(region_col == region_kato, region_name_col.isnot(None))
            .limit(1)
        )).scalar_one_or_none()
        region_name = name_row

    return {
        "region_kato": region_kato,
        "region_name": region_name,
        "total_companies": total,
        "total_revenue": total_revenue,
        "total_employees": total_employees,
        "by_industry": [
            {
                "code": r.industry_code,
                "label": r.industry_label,
                "count": int(r.cnt),
                "revenue_usd": float(r.revenue or 0),
            }
            for r in by_industry_rows
        ],
        "by_size": [
            {"bucket": r.bucket, "count": int(r.cnt)}
            for r in by_size_rows
        ],
        "top_5": [
            {
                "id": str(r.id),
                "name": r.name,
                "revenue_usd": float(r.revenue_usd) if r.revenue_usd is not None else None,
                "industry_label": r.industry_label,
            }
            for r in top_rows
        ],
    }


__all__ = [
    "BBox",
    "CACHE_TTL_SECONDS",
    "CLUSTER_ZOOM_THRESHOLD",
    "MAX_POINTS",
    "SMALL_RESULT_THRESHOLD",
    "abbreviate_count",
    "cache_key",
    "cell_size_deg",
    "companies_feature_collection",
    "count_points",
    "fetch_clusters",
    "fetch_points",
    "get_cached",
    "put_cached",
    "region_cluster_stats",
    "regions_geojson",
]

# Silence import-unused; or_ / and_ kept for future use.
_ = (or_, and_)
