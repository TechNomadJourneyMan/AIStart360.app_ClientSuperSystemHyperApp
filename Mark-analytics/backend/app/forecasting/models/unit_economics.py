"""Per-unit P&L."""

from __future__ import annotations

from typing import Any, ClassVar

from pydantic import BaseModel, Field

from app.forecasting.base import Assumption, Forecast, ForecastCtx, register


class UnitEconomicsInputs(BaseModel):
    revenue_per_unit_usd: float = Field(gt=0)
    cogs_per_unit_usd: float = Field(ge=0)
    opex_per_unit_usd: float = Field(ge=0)
    tax_rate_pct: float = Field(default=0.20, ge=0, le=1)


class UnitEconomicsOutput(BaseModel):
    gross_profit_usd: float
    gross_margin_pct: float
    operating_profit_usd: float
    operating_margin_pct: float
    net_profit_usd: float
    net_margin_pct: float
    assumptions: list[Assumption]


@register
class UnitEconomicsForecast(Forecast[UnitEconomicsInputs, UnitEconomicsOutput]):
    type: ClassVar[str] = "unit_economics"
    title: ClassVar[str] = "Unit Economics"
    description: ClassVar[str] = "Gross / Operating / Net margin per unit sold."
    inputs_schema: ClassVar[type[BaseModel]] = UnitEconomicsInputs
    outputs_schema: ClassVar[type[BaseModel]] = UnitEconomicsOutput

    async def defaults(self, ctx: ForecastCtx) -> dict[str, Any]:
        return {"revenue_per_unit_usd": 100, "cogs_per_unit_usd": 40,
                "opex_per_unit_usd": 25, "tax_rate_pct": 0.20}

    async def compute(self, inputs: UnitEconomicsInputs, ctx: ForecastCtx) -> UnitEconomicsOutput:
        rev = inputs.revenue_per_unit_usd
        gp = rev - inputs.cogs_per_unit_usd
        op = gp - inputs.opex_per_unit_usd
        net = op * (1 - inputs.tax_rate_pct)
        return UnitEconomicsOutput(
            gross_profit_usd=round(gp, 2),
            gross_margin_pct=round(gp / rev, 4) if rev else 0,
            operating_profit_usd=round(op, 2),
            operating_margin_pct=round(op / rev, 4) if rev else 0,
            net_profit_usd=round(net, 2),
            net_margin_pct=round(net / rev, 4) if rev else 0,
            assumptions=[Assumption(key=k, value=v, source="user")
                         for k, v in inputs.model_dump().items()],
        )
