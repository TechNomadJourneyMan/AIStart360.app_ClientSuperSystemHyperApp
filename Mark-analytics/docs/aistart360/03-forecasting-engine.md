# AIStart360 — Forecasting & Calculator Engine

> Quantitative tools that turn raw market data into decisions. Every calculator is a **deterministic computation with editable assumptions** + an optional AI-generated interpretation.

## 1. Architecture

```
┌──────────────────────────────────────────────────────────┐
│  /api/v1/forecasts/{type}    GET — open + sample inputs  │
│                              POST — run with user inputs │
│                              POST .../simulate — what-if │
└──────────────────────┬───────────────────────────────────┘
                       │
            ┌──────────▼─────────┐
            │ ForecastEngine     │
            │ - resolve_inputs   │  ← merges defaults + user_inputs + DB lookups
            │ - validate         │
            │ - compute          │  ← deterministic NumPy
            │ - explain (AI?)    │  ← optional Task.ANOMALY_EXPLANATION
            │ - persist          │
            └──────────┬─────────┘
                       ▼
                  Saved to `forecasts` table
                  (versioned, shareable)
```

Each forecast type is a class implementing:

```python
class Forecast(ABC):
    type: str                            # 'tam_sam_som', 'cac_ltv', ...
    title: str
    description: str
    input_schema: type[BaseModel]
    output_schema: type[BaseModel]

    def defaults(self, ctx: ForecastCtx) -> dict: ...
    def compute(self, inputs: BaseModel, ctx: ForecastCtx) -> BaseModel: ...
    def chart_shape(self, output: BaseModel) -> dict: ...
```

All implementations live in `backend/app/forecasting/models/`.

## 2. Catalog (Phase 1–2)

| Slug | What it computes | Inputs (key ones) | Output |
|------|------------------|-------------------|--------|
| `tam_sam_som` | TAM/SAM/SOM | industry, region, target_segment, conversion_assumptions | 3 numbers + breakdown chart |
| `market_growth` | Forecast 1–5y industry growth | industry, region, horizon, model (`linear, holt, arima`) | series + uncertainty band |
| `cac_ltv` | CAC, LTV, LTV/CAC, payback | acquisition_cost, conversion_rate, arpu, churn, gross_margin | scalar metrics + cohort table |
| `pricing_simulation` | Price elasticity, revenue at price | demand_curve, current_price, ranges | curve + recommended price |
| `unit_economics` | Per-unit P&L | revenue_per_unit, COGS, opex_per_unit | margin breakdown |
| `competitive_pressure_index` | Pressure score 0–100 | industry, region | scalar + drivers list |
| `market_saturation` | Saturation stage | industry, region, demand_proxy, supply_count | enum + chart |
| `profitability_forecast` | 1–3y net margin | company_id or manual inputs | series + drivers |
| `risk_assessment` | Composite risk 0–100 | company_id (auto pulls factors) | scalar + factor breakdown |
| `expansion_feasibility` | Score for entering city/country | from_city, to_city, industry, capex_budget | score + recommended_actions |
| `hiring_demand_forecast` | Job market demand 12m | industry, region, role | series |
| `ai_adoption_score` | 0–100 + recommendations | company_id | scalar + heatmap of areas |
| `demand_elasticity` | Elasticity coefficient | product_category, region | coefficient + chart |
| `customer_segmentation_intel` | Segment recommendations | company description, target customer | segments + size estimates |
| `investment_attractiveness` | Composite score for a market | industry, region | scalar + drivers |

## 3. Common design rules

- **Defaults from data**: every forecast pre-fills inputs from DB (e.g., `cac_ltv` defaults `arpu` to the median in the user's selected industry). User overrides explicitly.
- **Assumptions visible**: response includes `assumptions: [{key, value, source, editable: true}]`. Frontend renders this as a sidebar — user can tweak and click "Recompute".
- **Scenario chaining**: forecast outputs can become inputs of other forecasts (e.g., `tam_sam_som.som` → `pricing_simulation.market_size`).
- **Versioning**: every saved forecast gets `forecast_id + version`. Editing creates a new version; old ones still browsable.
- **Explainability**: AI explanation behind a flag (`?explain=true`). The AI is shown the inputs, the computed output, and 1-paragraph context; it returns plain-language narrative — **never** rewrites numbers.
- **No hallucinated numbers**: AI explanations must reference numerical results, not generate new ones. Validated by post-check (regex matches numbers in explanation against output dict; mismatches → drop).

## 4. Input/output examples

### TAM/SAM/SOM

```python
class TamSamSomInputs(BaseModel):
    industry_code: str
    region: list[str]
    target_segment: Literal["all", "smb", "mid_market", "enterprise"]
    addressable_pct: float = Field(ge=0, le=1, description="% of TAM you can address")
    obtainable_pct: float = Field(ge=0, le=1, description="% of SAM you can win")
    horizon_years: int = 3

class TamSamSomOutput(BaseModel):
    tam_usd: float
    sam_usd: float
    som_usd: float
    breakdown: list[dict]            # per-segment / per-region
    chart: dict                      # canonical chart shape
    assumptions: list[Assumption]
```

`compute` joins `companies` filtered by inputs, sums `revenue_usd`, applies user multipliers, returns numbers + a Sankey chart shape (Industry → Region → Segment → SOM).

### CAC/LTV

```python
class CacLtvInputs(BaseModel):
    acquisition_cost_usd: float
    visitors_to_customer_rate: float    # 0..1
    arpu_monthly_usd: float
    monthly_churn_rate: float           # 0..1
    gross_margin_pct: float             # 0..1
    horizon_months: int = 36

class CacLtvOutput(BaseModel):
    cac_usd: float
    ltv_usd: float
    ltv_cac_ratio: float
    payback_months: float
    cohort_curve: list[dict]            # month → cumulative profit
    recommended_actions: list[str]
```

`recommended_actions` from rule-engine (`if ltv_cac < 3: ['reduce CAC', 'increase ARPU']`). NOT LLM-generated for MVP.

## 5. Persistence

```sql
CREATE TABLE forecasts (
    id              UUID PRIMARY KEY,
    user_id         UUID REFERENCES users(id),
    type            VARCHAR(64) NOT NULL,
    title           TEXT,
    inputs          JSONB NOT NULL,
    output          JSONB NOT NULL,
    assumptions     JSONB,
    ai_explanation  TEXT,
    parent_id       UUID REFERENCES forecasts(id),   -- versioning chain
    is_public       BOOLEAN DEFAULT FALSE,           -- shareable links
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX forecasts_user_type_idx ON forecasts(user_id, type, created_at DESC);
```

Sharing: Pro tier+ can generate `share_token` → public read-only view at `/shared/forecasts/{token}` (no auth required).

## 6. AI usage

- `Task.ANOMALY_EXPLANATION` — for narrative explanations (Gemini 2.5 Pro for high-tier users, Gemini Flash for free/starter).
- `Task.INVESTMENT_THESIS` — for `investment_attractiveness` premium output (Pro+).
- Cost ceiling per request: `$0.05` for explanations, `$0.10` for thesis.

All AI calls go through the standard `app.ai.gateway`. No new providers.

## 7. Roadmap

| Phase | Adds |
|-------|------|
| MVP (M1–M3) | TAM/SAM/SOM, CAC/LTV, unit_economics, market_growth (linear) |
| Phase 2 (M4–M6) | risk_assessment, competitive_pressure, profitability, pricing_simulation, scenario chaining |
| Phase 3 (M7–M9) | ARIMA / Holt forecasting, investment_attractiveness with AI, expansion_feasibility |
| Phase 4 | ML-based segmentation, ensemble forecasting, fine-tuned models per industry |

## 8. Validation & quality

- Every forecast type has a golden test set (~5 input scenarios with expected outputs ± tolerance).
- AI explanations validated by regex (numbers in explanation must appear in output).
- "Reasonableness checks" — if output exceeds bounds (e.g., LTV > $1B), warn user.
