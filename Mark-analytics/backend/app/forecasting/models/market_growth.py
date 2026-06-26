"""Industry growth forecast (linear projection MVP; ARIMA/Holt later)."""

from __future__ import annotations

from typing import Any, ClassVar, Literal

from pydantic import BaseModel, Field

from app.forecasting.base import Assumption, Forecast, ForecastCtx, register


class MarketGrowthInputs(BaseModel):
    industry_code: str
    regions: list[str] = Field(default_factory=lambda: ["KZ"])
    horizon_years: int = Field(default=3, ge=1, le=10)
    model: Literal["linear", "holt"] = "linear"


class GrowthPoint(BaseModel):
    year: int
    value_usd: float
    p10: float | None = None
    p90: float | None = None


class MarketGrowthOutput(BaseModel):
    historical: list[GrowthPoint]
    forecast: list[GrowthPoint]
    cagr_pct: float
    assumptions: list[Assumption]


@register
class MarketGrowthForecast(Forecast[MarketGrowthInputs, MarketGrowthOutput]):
    type: ClassVar[str] = "market_growth"
    title: ClassVar[str] = "Market Growth Forecast"
    description: ClassVar[str] = "1-10 year industry growth forecast (USD value)."
    inputs_schema: ClassVar[type[BaseModel]] = MarketGrowthInputs
    outputs_schema: ClassVar[type[BaseModel]] = MarketGrowthOutput

    async def defaults(self, ctx: ForecastCtx) -> dict[str, Any]:
        return {"industry_code": "62.01", "regions": ["KZ"],
                "horizon_years": 3, "model": "linear"}

    async def compute(self, inputs: MarketGrowthInputs, ctx: ForecastCtx) -> MarketGrowthOutput:
        # Placeholder until SQL-backed historical aggregations land.
        from datetime import date
        current_year = date.today().year
        historical = [
            GrowthPoint(year=y, value_usd=1_000_000_000 * (1.08 ** (y - 2020)))
            for y in range(2020, current_year + 1)
        ]
        last = historical[-1].value_usd
        forecast = [
            GrowthPoint(
                year=current_year + i,
                value_usd=last * (1.10 ** i),
                p10=last * (1.05 ** i),
                p90=last * (1.15 ** i),
            )
            for i in range(1, inputs.horizon_years + 1)
        ]
        # Naive CAGR over historical
        years = historical[-1].year - historical[0].year
        cagr = ((historical[-1].value_usd / historical[0].value_usd) ** (1 / years)) - 1 if years else 0

        return MarketGrowthOutput(
            historical=historical, forecast=forecast,
            cagr_pct=round(cagr * 100, 2),
            assumptions=[
                Assumption(key="model", value=inputs.model, source="user"),
                Assumption(key="growth_assumption_annual_pct", value=10.0,
                            source="default", note="Replace with regressed value from data"),
            ],
        )

    def chart_shape(self, outputs: MarketGrowthOutput) -> dict[str, Any]:
        return {
            "type": "forecast_fan",
            "historical": [{"t": p.year, "v": p.value_usd} for p in outputs.historical],
            "forecast": [
                {"t": p.year, "p50": p.value_usd, "p10": p.p10, "p90": p.p90}
                for p in outputs.forecast
            ],
        }
