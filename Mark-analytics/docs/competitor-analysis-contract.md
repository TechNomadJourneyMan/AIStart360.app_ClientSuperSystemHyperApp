# Competitor & Market Analysis — API Contract (v1)

Shared contract between backend and frontend agents. Niche-based competitor &
market analysis: user picks a niche via an interactive survey, then sees their
market (volume, competitors, concentration) on a dashboard + map + charts in
real time.

All endpoints are **auth-optional in dev** (`OptionalUserDep`), **no tier gate**,
and wrapped in the standard `ResponseEnvelope`:
`{ "data": <T> | null, "meta": {...} | null, "errors": [...] | null }`.

Base path: `/api/v1/competitors`.

---

## 1. `GET /competitors/options` (already exists — keep)

```json
{ "data": {
  "categories": [{"key":"saas","label":"SaaS / Разработка ПО"}, ...],
  "audiences":  [{"key":"b2b","label":"B2B — продаёте бизнесу"}, ...],
  "stages":     [{"key":"idea","label":"Идея / pre-MVP"}, ...],
  "prices":     [{"key":"low","label":"Бюджетный"}, ...],
  "regions":    [{"key":"KZ","label":"Казахстан"}, ...]
}}
```

## 2. `POST /competitors/wizard` (EXTEND existing)

Request body (`WizardAnswers`):
```json
{ "category":"healthcare", "audience":"b2c", "stage":"growth",
  "regions":["KZ"], "price":"mid", "limit":12,
  "addressable_pct":0.30, "obtainable_pct":0.05 }
```
`addressable_pct` / `obtainable_pct` optional (defaults 0.30 / 0.05).

Response `data` (`CompetitorWizardResult`):
```jsonc
{
  "matched_niche": {
    "category":"healthcare", "category_label":"Медицина / Pharma",
    "industries":["86.10"], "nace_sections":["Q"],
    "audience":"b2c", "stage":"Рост", "regions":["KZ"],
    "price_segment":"Средний", "tags_required":["healthcare","pharma","b2c"]
  },
  "competitors": [
    { "id":"uuid", "name":"ТОО Алем Pharma", "country":"KZ",
      "industry_code":"86.10", "industry_label":"Медицина",
      "employee_count":145, "revenue_usd":4300000.0, "website":null,
      "tags":["pharma","b2b","b2c"], "tag_match_score":2,
      "latitude":43.25, "longitude":76.91, "region_name":"Алматы",
      "city_name":"Алматы", "size_category":"medium",
      "market_share_pct":12.4 }            // share of niche-universe revenue
  ],
  "total": 12,
  "market": {                              // NEW — real DB aggregates over the
                                           // FULL niche universe (industry+region),
                                           // not just the top-N competitors
    "company_count_total": 84,
    "market_volume_usd": 152300000.0,      // sum(revenue_usd) of niche universe
    "tam_usd": 152300000.0,                // total addressable (= market volume, annualized)
    "sam_usd": 45690000.0,                 // serviceable (addressable_pct * tam, audience-scoped)
    "som_usd": 2284500.0,                  // obtainable (obtainable_pct * sam)
    "avg_revenue_usd": 1813095.0,
    "median_revenue_usd": 900000.0,
    "avg_employee_count": 64,
    "total_employees": 5376,
    "hhi": 0.083,                          // Herfindahl index 0..1 (sum of share^2)
    "concentration_top3_pct": 41.2,        // top-3 revenue share %
    "competition_level": "moderate",       // "low" | "moderate" | "high" — derived from HHI
    "size_distribution": [
      {"key":"micro","label":"Микро","count":30},
      {"key":"small","label":"Малый","count":24},
      {"key":"medium","label":"Средний","count":20},
      {"key":"large","label":"Крупный","count":10}
    ],
    "region_distribution": [
      {"region_kato":"75","region_name":"Алматы","count":22,"revenue_usd":61000000.0},
      ...
    ],
    "revenue_buckets": [                   // histogram for a bar chart
      {"label":"<0.5M","min":0,"max":500000,"count":18},
      {"label":"0.5–2M","min":500000,"max":2000000,"count":31},
      ...
    ],
    "top_shares": [                        // for donut/treemap: top competitors + "Прочие"
      {"name":"ТОО X","revenue_usd":18900000.0,"share_pct":12.4},
      ...,
      {"name":"Прочие","revenue_usd":...,"share_pct":...}
    ]
  },
  "summary": { "status":"ok", "message":"...", "competitor_count":12,
               "total_revenue_usd":..., "leader":{"name":"...","revenue_usd":...} }
}
```

### Matching rules (IMPORTANT — data reality)
The DB has TWO industry-code formats:
- ~121 real companies use full OKED codes (`62.01`, `86.10`, `64.19`...).
- ~939 synthetic companies use NACE single-letter sections (`C`, `G`, `Q`...).

So niche matching MUST match **either** the category's full OKED codes **or**
its NACE letter section(s). Extend `CATEGORY_MAP` with a `nace` list per
category. The "niche universe" used for `market` aggregates = all
non-merged companies in `regions` whose `industry_code` is in the category's
OKED codes OR NACE sections. `stage`/`price` narrow only the ranked
`competitors` list, NOT the market universe.

## 3. `POST /competitors/market-map` (NEW)

Body: same as wizard (`category`, `audience`, `regions`, ...). Returns GeoJSON
of the **full niche universe** (cap 2000) for the competitor map:
```json
{ "data": {
  "type":"FeatureCollection",
  "features":[
    {"type":"Feature","geometry":{"type":"Point","coordinates":[76.91,43.25]},
     "properties":{"id":"uuid","name":"...","industry_code":"86.10",
        "industry_label":"Медицина","revenue_usd":4300000.0,
        "employee_count":145,"region_name":"Алматы","size_category":"medium"}}
  ],
  "total": 84
}}
```
(properties shape matches `CompanyGeoFeature` in `frontend/src/hooks/useCompaniesGeo.ts`
so the existing map layer can render them.)

---

## Frontend surface
- Route `/competitors` (`frontend/src/app/routes/competitors.tsx`).
- Header nav: "Карта" (`/`) + "Анализ рынка" (`/competitors`).
- Hook `frontend/src/hooks/useCompetitors.ts` with explicit TS interfaces
  mirroring the shapes above (do not depend solely on generated `api.ts`).
- Survey (stepper) → results dashboard (KPI cards + map + recharts charts + table).
- Localize via `ru.json` / `en.json` / `kz.json` under namespace `competitors.*`.
