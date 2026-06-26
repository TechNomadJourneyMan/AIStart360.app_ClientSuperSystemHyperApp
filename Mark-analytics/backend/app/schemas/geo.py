"""GeoJSON schemas for /geo/* endpoints.

Conformant subset of RFC 7946. Uses Pydantic v2 generics so any
Properties payload can be typed at the call site:

    FeatureCollection[CompanyPointProperties]
    FeatureCollection[ClusterProperties]
    FeatureCollection[RegionProperties]
"""

from __future__ import annotations

from typing import Any, Generic, Literal, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ─── Geometry primitives ────────────────────────────────────────────

class PointGeometry(BaseModel):
    type: Literal["Point"] = "Point"
    # [lon, lat] per GeoJSON spec
    coordinates: list[float] = Field(..., min_length=2, max_length=3)


class PolygonGeometry(BaseModel):
    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[list[float]]]


class MultiPolygonGeometry(BaseModel):
    type: Literal["MultiPolygon"] = "MultiPolygon"
    coordinates: list[list[list[list[float]]]]


# Loose union — frontends only need the discriminator.
Geometry = PointGeometry | PolygonGeometry | MultiPolygonGeometry


# ─── Generic Feature / FeatureCollection ────────────────────────────

P = TypeVar("P", bound=BaseModel)


class GeoFeature(BaseModel, Generic[P]):
    type: Literal["Feature"] = "Feature"
    id: str | None = None
    geometry: PointGeometry | PolygonGeometry | MultiPolygonGeometry
    properties: P


class FeatureCollection(BaseModel, Generic[P]):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[GeoFeature[P]] = Field(default_factory=list)


# ─── Properties payloads ────────────────────────────────────────────

class CompanyPointProperties(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    name: str
    bin: str | None = None
    industry_code: str | None = None
    industry_label: str | None = None
    size_category: str | None = None
    revenue_usd: float | None = None
    region_kato: str | None = None
    region_name: str | None = None
    city_name: str | None = None
    cluster: Literal[False] = False


class ClusterProperties(BaseModel):
    """Aggregated cluster for low-zoom server-side clustering."""

    model_config = ConfigDict(extra="ignore")

    cluster: Literal[True] = True
    cluster_id: str
    point_count: int
    point_count_abbreviated: str
    # Optional region hint when we cluster by region_kato.
    region_kato: str | None = None
    region_name: str | None = None


class RegionProperties(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kato_code: str
    name_ru: str
    name_en: str | None = None
    name_kz: str | None = None


# ─── Cluster stats (tooltip on region hover) ────────────────────────

class IndustryCount(BaseModel):
    code: str | None = None
    label: str | None = None
    count: int
    revenue_usd: float = 0.0


class SizeCount(BaseModel):
    bucket: str
    count: int


class TopCompany(BaseModel):
    id: UUID
    name: str
    revenue_usd: float | None = None
    industry_label: str | None = None


class ClusterStats(BaseModel):
    region_kato: str | None = None
    region_name: str | None = None
    total_companies: int
    by_industry: list[IndustryCount] = Field(default_factory=list)
    by_size: list[SizeCount] = Field(default_factory=list)
    top_5: list[TopCompany] = Field(default_factory=list)


# Convenience aliases for FastAPI response_model hints
CompanyFeatureCollection = FeatureCollection[CompanyPointProperties]
ClusterFeatureCollection = FeatureCollection[ClusterProperties]
RegionFeatureCollection = FeatureCollection[RegionProperties]


# Forward-friendly mixed feature type used by /geo/companies
# (each feature is either a point or a cluster).
class MixedProperties(BaseModel):
    """Untyped properties bag; serializers decide per-feature."""
    model_config = ConfigDict(extra="allow")


MixedFeatureCollection = FeatureCollection[MixedProperties]


__all__ = [
    "ClusterFeatureCollection",
    "ClusterProperties",
    "ClusterStats",
    "CompanyFeatureCollection",
    "CompanyPointProperties",
    "FeatureCollection",
    "GeoFeature",
    "Geometry",
    "IndustryCount",
    "MixedFeatureCollection",
    "MixedProperties",
    "MultiPolygonGeometry",
    "PointGeometry",
    "PolygonGeometry",
    "RegionFeatureCollection",
    "RegionProperties",
    "SizeCount",
    "TopCompany",
]
