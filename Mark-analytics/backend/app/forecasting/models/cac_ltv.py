"""CAC / LTV / payback calculator."""

from __future__ import annotations

from typing import Any, ClassVar

from pydantic import BaseModel, Field

from app.forecasting.base import Assumption, Forecast, ForecastCtx, register


class CacLtvInputs(BaseModel):
    acquisition_cost_usd: float = Field(gt=0)
    visitors_to_customer_rate: float = Field(default=0.02, gt=0, le=1)
    arpu_monthly_usd: float = Field(gt=0)
    monthly_churn_rate: float = Field(default=0.05, gt=0, le=1)
    gross_margin_pct: float = Field(default=0.7, gt=0, le=1)
    horizon_months: int = Field(default=36, ge=1, le=120)


class CacLtvOutput(BaseModel):
    cac_usd: float
    ltv_usd: float
    ltv_cac_ratio: float
    payback_months: float
    cohort_curve: list[dict[str, float]]
    recommended_actions: list[str]
    assumptions: list[Assumption]


@register
class CacLtvForecast(Forecast[CacLtvInputs, CacLtvOutput]):
    type: ClassVar[str] = "cac_ltv"
    title: ClassVar[str] = "CAC / LTV / Payback"
    description: ClassVar[str] = "Unit economics: CAC, LTV, LTV:CAC ratio, payback period, cohort curve."
    inputs_schema: ClassVar[type[BaseModel]] = CacLtvInputs
    outputs_schema: ClassVar[type[BaseModel]] = CacLtvOutput

    async def defaults(self, ctx: ForecastCtx) -> dict[str, Any]:
        return {
            "acquisition_cost_usd": 50.0,
            "visitors_to_customer_rate": 0.02,
            "arpu_monthly_usd": 30.0,
            "monthly_churn_rate": 0.05,
            "gross_margin_pct": 0.7,
            "horizon_months": 36,
        }

    async def compute(self, inputs: CacLtvInputs, ctx: ForecastCtx) -> CacLtvOutput:
        cac = inputs.acquisition_cost_usd / inputs.visitors_to_customer_rate
        monthly_contribution = inputs.arpu_monthly_usd * inputs.gross_margin_pct
        # LTV = contribution / churn (perpetuity)
        ltv = monthly_contribution / inputs.monthly_churn_rate
        ratio = ltv / cac if cac > 0 else 0
        payback = cac / monthly_contribution if monthly_contribution > 0 else float("inf")

        # Cohort curve: cumulative profit per month
        retention = 1.0
        cum = -cac
        curve = []
        for m in range(1, inputs.horizon_months + 1):
            cum += monthly_contribution * retention
            curve.append({"month": float(m), "cum_profit_usd": round(cum, 2)})
            retention *= (1 - inputs.monthly_churn_rate)

        actions: list[str] = []
        if ratio < 3:
            actions.append("LTV:CAC ниже 3.0 — пересмотри acquisition cost или цену.")
        if payback > 18:
            actions.append("Payback больше 18 месяцев — рискованно для ранней стадии.")
        if inputs.monthly_churn_rate > 0.1:
            actions.append("Месячный churn > 10% — приоритет на удержание, не привлечение.")

        assumptions = [
            Assumption(key=k, value=v, source="user")
            for k, v in inputs.model_dump().items()
        ]
        return CacLtvOutput(
            cac_usd=round(cac, 2), ltv_usd=round(ltv, 2),
            ltv_cac_ratio=round(ratio, 2),
            payback_months=round(payback, 1),
            cohort_curve=curve, recommended_actions=actions,
            assumptions=assumptions,
        )

    def chart_shape(self, outputs: CacLtvOutput) -> dict[str, Any]:
        return {
            "type": "line",
            "series": [{
                "name": "Cumulative profit",
                "points": [{"t": p["month"], "v": p["cum_profit_usd"]} for p in outputs.cohort_curve],
            }],
            "annotations": [{"label": "CAC", "value": -outputs.cac_usd}],
        }
