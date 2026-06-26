"""Competitor wizard — niche-based discovery."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.core.deps import OptionalUserDep, SessionDep
from app.core.errors import ValidationError, envelope
from app.schemas.competitors import (
    CompetitorWizardOptions,
    CompetitorWizardResult,
)
from app.schemas.envelope import ResponseEnvelope
from app.services.competitors import (
    CATEGORY_MAP,
    PRICE_PROFILE,
    STAGE_PROFILE,
    find_competitors,
    list_categories,
    niche_feature_collection,
)

router = APIRouter()


class WizardAnswers(BaseModel):
    category: str = Field(description="One of: " + ", ".join(CATEGORY_MAP.keys()))
    audience: Literal["b2b", "b2c", "b2g", "mixed"] = "mixed"
    stage: Literal["idea", "mvp", "growth", "scale"] = "growth"
    regions: list[str] = Field(default_factory=lambda: ["KZ"])
    price: Literal["low", "mid", "premium"] = "mid"
    limit: int = Field(default=12, ge=1, le=50)
    addressable_pct: float = Field(default=0.30, ge=0.0, le=1.0)
    obtainable_pct: float = Field(default=0.05, ge=0.0, le=1.0)


class MarketMapRequest(BaseModel):
    category: str = Field(description="One of: " + ", ".join(CATEGORY_MAP.keys()))
    audience: Literal["b2b", "b2c", "b2g", "mixed"] = "mixed"
    regions: list[str] = Field(default_factory=lambda: ["KZ"])
    limit: int = Field(default=2000, ge=1, le=2000)


@router.get(
    "/options",
    summary="List wizard options (categories, audiences, stages, prices)",
    response_model=ResponseEnvelope[CompetitorWizardOptions],
)
async def options() -> dict[str, Any]:
    return envelope(data={
        "categories": list_categories(),
        "audiences": [
            {"key": "b2b", "label": "B2B — продаёте бизнесу"},
            {"key": "b2c", "label": "B2C — конечному клиенту"},
            {"key": "b2g", "label": "B2G — государству"},
            {"key": "mixed", "label": "Смешанная"},
        ],
        "stages": [{"key": k, "label": v["label"]} for k, v in STAGE_PROFILE.items()],
        "prices": [{"key": k, "label": v["label"]} for k, v in PRICE_PROFILE.items()],
        "regions": [
            {"key": "KZ", "label": "Казахстан"},
            {"key": "RU", "label": "Россия"},
            {"key": "UZ", "label": "Узбекистан"},
            {"key": "KG", "label": "Киргизия"},
            {"key": "BY", "label": "Беларусь"},
        ],
    })


@router.post(
    "/wizard",
    summary="Find competitors based on wizard answers",
    response_model=ResponseEnvelope[CompetitorWizardResult],
)
async def wizard(
    answers: WizardAnswers, session: SessionDep, _user: OptionalUserDep = None,
) -> dict[str, Any]:
    try:
        result = await find_competitors(
            session,
            category=answers.category,
            audience=answers.audience,
            stage=answers.stage,
            regions=answers.regions,
            price=answers.price,
            limit=answers.limit,
            addressable_pct=answers.addressable_pct,
            obtainable_pct=answers.obtainable_pct,
        )
    except ValueError as e:
        raise ValidationError(str(e)) from e
    return envelope(data=result)


@router.post(
    "/market-map",
    summary="GeoJSON of the full niche universe for the competitor map",
)
async def market_map(
    req: MarketMapRequest, session: SessionDep, _user: OptionalUserDep = None,
) -> dict[str, Any]:
    try:
        fc = await niche_feature_collection(
            session,
            category=req.category,
            regions=req.regions,
            limit=req.limit,
        )
    except ValueError as e:
        raise ValidationError(str(e)) from e
    return envelope(data=fc)
