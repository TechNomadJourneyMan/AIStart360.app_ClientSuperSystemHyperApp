"""Forecasting endpoints — see docs/aistart360/03-forecasting-engine.md."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body

from app.billing.quota import check_and_increment
from app.billing.tier import Tier, get_user_tier, require_min_tier
from app.core.deps import CurrentUserDep
from app.core.errors import envelope
from app.forecasting import models  # noqa: F401  triggers @register
from app.forecasting.base import ForecastCtx, get_forecast, list_forecasts
from app.schemas.envelope import ResponseEnvelope
from app.schemas.forecasts import (
    ForecastMeta,
    ForecastRunResult,
    ForecastSimulateResult,
    ForecastType,
)

router = APIRouter()


@router.get(
    "",
    summary="List available forecast types",
    response_model=ResponseEnvelope[list[ForecastType]],
)
async def list_types() -> dict[str, Any]:
    return envelope(data=list_forecasts())


@router.get(
    "/{type_slug}",
    summary="Get forecast metadata + default inputs",
    response_model=ResponseEnvelope[ForecastMeta],
)
async def get_forecast_meta(type_slug: str, user: CurrentUserDep) -> dict[str, Any]:
    f = get_forecast(type_slug)
    tier = await get_user_tier(user)
    ctx = ForecastCtx(user_id=user.user_id, tier=tier.value)
    defaults = await f.defaults(ctx)
    return envelope(data={
        "type": f.type,
        "title": f.title,
        "description": f.description,
        "input_schema": f.inputs_schema.model_json_schema(),
        "output_schema": f.outputs_schema.model_json_schema(),
        "defaults": defaults,
    })


@router.post(
    "/{type_slug}",
    summary="Run a forecast with user inputs",
    response_model=ResponseEnvelope[ForecastRunResult],
)
async def run_forecast(
    type_slug: str,
    user: CurrentUserDep,
    inputs: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    f = get_forecast(type_slug)
    tier = await get_user_tier(user)
    # DEV: tier gate + quota disabled while in development.
    # require_min_tier(tier, Tier.STARTER)
    # await check_and_increment(user.user_id, tier, "forecasts")

    validated = f.validate_inputs(inputs)
    ctx = ForecastCtx(user_id=user.user_id, tier=tier.value)
    output = await f.compute(validated, ctx)
    chart = f.chart_shape(output)

    return envelope(
        data={
            "type": f.type,
            "output": output.model_dump(),
            "chart": chart,
        },
        meta={"tier": tier.value},
    )


@router.post(
    "/{type_slug}/simulate",
    summary="Re-run with tweaked inputs (no quota charge)",
    response_model=ResponseEnvelope[ForecastSimulateResult],
)
async def simulate(
    type_slug: str,
    user: CurrentUserDep,
    inputs: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    f = get_forecast(type_slug)
    tier = await get_user_tier(user)
    validated = f.validate_inputs(inputs)
    ctx = ForecastCtx(user_id=user.user_id, tier=tier.value)
    output = await f.compute(validated, ctx)
    return envelope(data={"output": output.model_dump(), "chart": f.chart_shape(output)})
