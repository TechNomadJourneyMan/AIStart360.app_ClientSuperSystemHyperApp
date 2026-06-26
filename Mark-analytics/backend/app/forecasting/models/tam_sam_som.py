"""TAM / SAM / SOM calculator.

Inputs: industry + region + addressable / obtainable percentages.
Outputs: three USD numbers + breakdown + Sankey-friendly chart shape.
"""

from __future__ import annotations

from typing import Any, ClassVar

from pydantic import BaseModel, Field

from app.forecasting.base import Assumption, Forecast, ForecastCtx, register


class TamSamSomInputs(BaseModel):
    industry_code: str = Field(description="ОКЭД/ОКВЭД top-level or full code")
    regions: list[str] = Field(default_factory=lambda: ["KZ"])
    target_segment: str = Field(default="all",
                                 description="all | smb | mid_market | enterprise")
    addressable_pct: float = Field(default=0.30, ge=0, le=1)
    obtainable_pct: float = Field(default=0.05, ge=0, le=1)
    horizon_years: int = Field(default=3, ge=1, le=10)


class TamSamSomOutput(BaseModel):
    tam_usd: float
    sam_usd: float
    som_usd: float
    breakdown: list[dict[str, Any]]
    assumptions: list[Assumption]


@register
class TamSamSomForecast(Forecast[TamSamSomInputs, TamSamSomOutput]):
    type: ClassVar[str] = "tam_sam_som"
    title: ClassVar[str] = "TAM / SAM / SOM"
    description: ClassVar[str] = (
        "Total / Serviceable / Obtainable market sizing for an industry + region + segment combo."
    )
    inputs_schema: ClassVar[type[BaseModel]] = TamSamSomInputs
    outputs_schema: ClassVar[type[BaseModel]] = TamSamSomOutput

    async def defaults(self, ctx: ForecastCtx) -> dict[str, Any]:
        return {
            "industry_code": "62.01",
            "regions": ["KZ"],
            "target_segment": "smb",
            "addressable_pct": 0.30,
            "obtainable_pct": 0.05,
            "horizon_years": 3,
        }

    async def compute(self, inputs: TamSamSomInputs, ctx: ForecastCtx) -> TamSamSomOutput:
        # MVP — placeholder math. Real impl queries `companies.revenue_usd`
        # aggregated by industry+region. Stubbed with industry-mean assumptions.
        avg_revenue_per_company = 2_500_000.0      # USD per year, industry-mean placeholder
        companies_in_industry_region = 5_000        # placeholder until DB-backed
        tam = avg_revenue_per_company * companies_in_industry_region * inputs.horizon_years
        sam = tam * inputs.addressable_pct
        som = sam * inputs.obtainable_pct

        breakdown = [
            {"label": "Industry size", "value": tam},
            {"label": "Addressable", "value": sam},
            {"label": "Obtainable", "value": som},
        ]
        assumptions = [
            Assumption(key="avg_revenue_per_company_usd", value=avg_revenue_per_company,
                       source="data:industry_median:placeholder"),
            Assumption(key="companies_in_industry_region", value=companies_in_industry_region,
                       source="data:count:placeholder"),
            Assumption(key="addressable_pct", value=inputs.addressable_pct, source="user"),
            Assumption(key="obtainable_pct", value=inputs.obtainable_pct, source="user"),
        ]
        return TamSamSomOutput(
            tam_usd=tam, sam_usd=sam, som_usd=som,
            breakdown=breakdown, assumptions=assumptions,
        )

    def chart_shape(self, outputs: TamSamSomOutput) -> dict[str, Any]:
        return {
            "type": "sankey",
            "nodes": [{"id": "TAM"}, {"id": "SAM"}, {"id": "SOM"}],
            "links": [
                {"source": "TAM", "target": "SAM", "value": outputs.sam_usd},
                {"source": "SAM", "target": "SOM", "value": outputs.som_usd},
            ],
        }
