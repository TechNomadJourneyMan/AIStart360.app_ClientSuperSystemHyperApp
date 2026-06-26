"""Dev-only endpoints used by the built-in dashboard.

Lets the demo dashboard run forecasts without needing a Supabase JWT.
Disabled when APP_ENV=production.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.core.errors import envelope
from app.forecasting import models  # noqa: F401 — register types
from app.forecasting.base import ForecastCtx, get_forecast

router = APIRouter()


@router.post("/forecast")
async def dev_forecast(type: str, inputs: dict[str, Any]) -> dict[str, Any]:
    if settings.is_prod:
        raise HTTPException(status_code=404)
    f = get_forecast(type)
    validated = f.validate_inputs(inputs)
    ctx = ForecastCtx(user_id="dev")
    output = await f.compute(validated, ctx)
    return envelope(data={
        "type": f.type,
        "output": output.model_dump(),
        "chart": f.chart_shape(output),
    })
