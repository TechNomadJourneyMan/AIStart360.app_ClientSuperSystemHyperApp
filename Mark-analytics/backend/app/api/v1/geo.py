"""Geo endpoints for MapLibre + deck.gl frontend.

Three routes:

  GET /geo/companies              → GeoJSON FeatureCollection of companies
                                    (server-side clustered at low zoom)
  GET /geo/regions/kz             → KZ region boundaries (17 oblasts + 3 cities)
  GET /geo/companies/cluster-stats → per-region aggregate stats for tooltip
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Request

from app.core.deps import OptionalUserDep, SessionDep
from app.core.errors import envelope
from app.filters.registry import parse_filters
from app.services.geo import (
    BBox,
    CACHE_TTL_SECONDS,
    cache_key,
    companies_feature_collection,
    get_cached,
    put_cached,
    region_cluster_stats,
    regions_geojson,
)

router = APIRouter()


# ────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────


_GEO_ONLY_PARAMS = {"bbox", "zoom", "region_kato"}


def _filters_from_request(request: Request) -> dict[str, Any]:
    """Run query params through the central registry; strip geo-only keys.

    `region_kato`, `bbox`, `zoom` are handled by this router directly and
    are NOT in the filter registry — so they must be removed before we hand
    off to `parse_filters` (which would raise on unknown keys).
    """
    raw = {k: v for k, v in request.query_params.items() if k not in _GEO_ONLY_PARAMS}
    return parse_filters(raw)


# ────────────────────────────────────────────────────────────────────
# A) GET /geo/companies
# ────────────────────────────────────────────────────────────────────


@router.get("/companies", summary="Companies as GeoJSON (clustered at low zoom)")
async def companies_geojson(
    request: Request,
    session: SessionDep,
    _user: OptionalUserDep = None,
    bbox: str | None = Query(default=None, description="lon1,lat1,lon2,lat2"),
    zoom: int | None = Query(default=None, ge=0, le=22),
    region_kato: str | None = Query(default=None),
) -> dict[str, Any]:
    filters = _filters_from_request(request)
    parsed_bbox = BBox.parse(bbox)

    key = cache_key(
        bbox=parsed_bbox, zoom=zoom, filters=filters, region_kato=region_kato,
    )
    cached = await get_cached(key)
    if cached is not None:
        meta = cached.pop("_meta", {})
        return envelope(data=cached, meta={**meta, "cache_hit": True})

    fc = await companies_feature_collection(
        session,
        bbox=parsed_bbox,
        zoom=zoom,
        filters=filters,
        region_kato=region_kato,
    )
    meta = fc.pop("_meta", {})
    # Stash _meta back into the cached payload so subsequent hits keep the same shape.
    to_cache = dict(fc)
    to_cache["_meta"] = meta
    await put_cached(key, to_cache, ttl=CACHE_TTL_SECONDS)

    return envelope(
        data=fc,
        meta={
            **meta,
            "cache_hit": False,
            "cache_ttl_seconds": CACHE_TTL_SECONDS,
            "filters_applied": list(filters.keys()),
        },
    )


# ────────────────────────────────────────────────────────────────────
# B) GET /geo/regions/kz  (static)
# ────────────────────────────────────────────────────────────────────


@router.get("/regions/kz", summary="KZ admin regions (17 oblasts + 3 cities)")
async def kz_regions(_user: OptionalUserDep = None) -> dict[str, Any]:
    fc = regions_geojson()
    return envelope(
        data=fc,
        meta={
            "count": len(fc.get("features", [])),
            "cache": "forever",
            "source": "app/data/kz_regions.geojson",
        },
    )


# ────────────────────────────────────────────────────────────────────
# C) GET /geo/companies/cluster-stats
# ────────────────────────────────────────────────────────────────────


@router.get("/companies/cluster-stats", summary="Per-region aggregate stats")
async def companies_cluster_stats(
    request: Request,
    session: SessionDep,
    _user: OptionalUserDep = None,
    region_kato: str | None = Query(default=None),
) -> dict[str, Any]:
    filters = _filters_from_request(request)
    stats = await region_cluster_stats(
        session, region_kato=region_kato, filters=filters,
    )
    return envelope(
        data=stats,
        meta={
            "region_kato": region_kato,
            "filters_applied": list(filters.keys()),
        },
    )
