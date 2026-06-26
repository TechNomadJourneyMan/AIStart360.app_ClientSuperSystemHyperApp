# AIStart360 — Filter Taxonomy

> The Market Intelligence dashboard supports filtering across **40+ dimensions**. This document is the source of truth for filter keys, types, value lists, default values, and which backend column/derived field powers each filter. Frontend uses this to build the filter UI; backend uses this to validate query parameters.

## 1. Design principles

1. **Layered filtering**: not all 40+ filters shown at once. UI exposes 6–8 "popular" filters by default; "Advanced filters" drawer reveals the rest. Power users can save filter presets.
2. **Server-side validation**: every filter key + value is whitelisted in `backend/app/filters/registry.py`. Unknown keys → 422.
3. **Semantic + structural co-use**: free-text query (semantic) + structural filters compose with AND. Each filter contributes to SQL `WHERE` or vector pre-filter.
4. **Faceted counts**: every filter returns its current cardinality in the response meta (`meta.facets`), so UI can show counts next to options.
5. **Defaults via user prefs**: if user has saved preset, applied automatically. If anonymous, defaults to "Kazakhstan, active companies".

## 2. Filter catalog

Below: `key` is the API query param key (snake_case). `type` is one of: `enum` (fixed list), `multi-enum`, `range[number]`, `range[date]`, `bool`, `text`. `backed_by` is the SQL column or derived computation.

### 2.1 Geography

| Key | Type | Values / Range | Backed by |
|-----|------|----------------|-----------|
| `country` | multi-enum | `KZ, RU, UZ, KG, TJ, BY, AM, AZ, GE` | `companies.country` |
| `region` | multi-text | KZ oblasts / RU subjects | `companies.address.region` (denorm) |
| `city` | multi-text | dynamic from `addresses.city` distinct | `addresses.city` |
| `geo_radius_km` | composite | `{lat,lng,km}` | postgis `ST_DWithin` |

### 2.2 Industry

| Key | Type | Values | Backed by |
|-----|------|--------|-----------|
| `industry` | multi-enum | ОКЭД/ОКВЭД top-2-digit codes | `companies.industry_code` (LIKE `XX%`) |
| `sub_industry` | multi-enum | ОКЭД/ОКВЭД full code | `companies.industry_code` |
| `niche_tags` | multi-text | free-form (`saas, marketplace, edtech, …`) | `companies.tags` GIN |
| `economic_sector` | enum | `primary, secondary, tertiary, quaternary` | derived from industry_code |

### 2.3 Company size & maturity

| Key | Type | Values / Range | Backed by |
|-----|------|----------------|-----------|
| `company_size` | enum | `micro, small, medium, large, enterprise` | derived from employee_count + revenue |
| `employee_count` | range[number] | 0–500000 | `companies.employee_count` |
| `revenue_usd` | range[number] | 0–10B | `companies.revenue_usd` |
| `capitalization_usd` | range[number] | 0–100B | `companies.capitalization_usd` (if public) |
| `business_age_years` | range[number] | 0–200 | derived from `registered_at` |
| `growth_rate_pct` | range[number] | -100 — +1000 | derived from revenue YoY |
| `profitability` | enum | `unknown, loss, low, healthy, high` | derived |

### 2.4 Ownership & legal

| Key | Type | Values | Backed by |
|-----|------|--------|-----------|
| `legal_form` | multi-enum | `ТОО, АО, ИП, ОсОО, ООО, ЗАО, ПАО, …` | `companies.legal_form` |
| `ownership_type` | enum | `private, public, state, mixed, foreign_owned` | derived |
| `status` | enum | `active, liquidated, reorganizing, bankrupt, suspended` | `companies.status` |
| `is_public` | bool | — | derived |

### 2.5 Business model

| Key | Type | Values | Backed by |
|-----|------|--------|-----------|
| `b2_orientation` | multi-enum | `B2B, B2C, B2G, P2P, D2C` | `companies.tags` |
| `online_offline` | enum | `online_only, offline_only, hybrid` | derived (web presence + locations) |
| `import_export` | multi-enum | `importer, exporter, both, domestic_only` | derived from customs data |
| `lifecycle_stage` | enum | `startup, growth, stable, decline, exit, defunct` | derived |
| `investment_stage` | enum | `bootstrap, pre_seed, seed, series_a, series_b, series_c, growth, late, ipo, post_ipo` | derived from funding events |

### 2.6 Digital & innovation

| Key | Type | Values | Backed by |
|-----|------|--------|-----------|
| `digital_maturity` | enum 1-5 | `1=non-digital … 5=ai-native` | composite score |
| `ai_adoption_level` | enum 0-3 | `0=none, 1=using_tools, 2=integrated, 3=ai_first` | composite score |
| `innovation_index` | range[number] | 0-100 | composite (patents + R&D + signals) |
| `web_traffic_monthly` | range[number] | 0-1B | external SEO data (later phase) |

### 2.7 Market position

| Key | Type | Values | Backed by |
|-----|------|--------|-----------|
| `market_saturation` | enum | `nascent, growing, saturated, declining` | computed per industry+region |
| `competition_intensity` | enum 1-5 | — | computed (HHI-like) |
| `market_share_pct` | range[number] | 0-100 | computed per industry+region |

### 2.8 Signals / activity

| Key | Type | Values / Range | Backed by |
|-----|------|----------------|-----------|
| `hiring_activity` | enum | `none, low, medium, high, very_high` | rolling 90d vacancy count |
| `media_presence` | enum | `low, medium, high` | rolling mentions count |
| `web_traffic_trend` | enum | `falling, flat, growing, exploding` | derived |
| `search_trend` | enum | `falling, flat, growing, exploding` | Google/Yandex Trends |
| `social_trend` | enum | `falling, flat, growing, exploding` | derived |
| `sentiment` | enum | `negative, mixed, neutral, positive` | aggregated reviews/news sentiment |
| `m_a_activity` | enum | `none, target, acquirer, merger, exit` | events log |

### 2.9 Government / public sector

| Key | Type | Values / Range | Backed by |
|-----|------|----------------|-----------|
| `government_participation` | enum | `none, contractor, recipient, state_owned, mixed` | derived |
| `procurement_volume_usd` | range[number] | 0-1B | aggregated from tenders |
| `procurement_recent_count` | range[number] | 0-10000 | aggregated rolling 12m |
| `subsidies_received` | range[number] | 0-1B | derived from public records |

### 2.10 Risk & compliance

| Key | Type | Values | Backed by |
|-----|------|--------|-----------|
| `risk_level` | enum 1-5 | composite | `companies.risk_score` |
| `sanctions_flag` | bool | — | join with `sanctions_list` |
| `litigation_active` | bool | — | court data |
| `tax_debt_flag` | bool | — | gov registry |
| `kyc_status` | enum | `unknown, light, full, enhanced` | internal verification |

### 2.11 Demographics (customers, not company)

| Key | Type | Values | Backed by |
|-----|------|--------|-----------|
| `target_customer_age` | multi-enum | `gen_z, millennial, gen_x, boomer` | derived from product/category |
| `target_income_band` | multi-enum | `low, middle, upper_middle, high` | derived |
| `b2b_segment` | multi-enum | `smb, mid_market, enterprise, government` | derived |

### 2.12 Operational

| Key | Type | Values | Backed by |
|-----|------|--------|-----------|
| `operational_efficiency` | enum 1-5 | composite | derived |
| `seasonality` | enum | `none, low, moderate, high` | revenue variance |
| `has_physical_locations` | bool | — | derived |
| `locations_count` | range[number] | 0-10000 | count rows in `locations` |

## 3. Filter combinator semantics

- Same key with multi values → OR within key (`country IN ('KZ','RU')`).
- Different keys → AND between keys.
- Free-text `q` → applies to vector + trigram on name+description, AND with structural filters.
- `geo_radius_km` → must be combined with `country`.
- Negation: any key with `!` suffix means NOT IN (`industry!=62.01`).

## 4. Implementation contract

`backend/app/filters/registry.py` exposes:

```python
from app.filters.registry import FILTER_REGISTRY, parse_filters, build_where

filters = parse_filters(query_params)        # dict[FilterKey, FilterValue], raises on unknown
where_sql, params = build_where(filters)     # SQL fragment + bind params
```

Each `FilterDef` in the registry has:

```python
class FilterDef:
    key: str
    type: FilterType                          # ENUM, MULTI_ENUM, RANGE_NUMBER, …
    values: list[str] | None                  # for enum
    backed_by: str                            # SQL column or function call
    derive: Callable | None                   # for derived computations
    public_in_facets: bool = True
```

## 5. Faceted counts

For every filter visible in the UI, the list endpoint returns counts under the current filter set minus that one (so the user sees "if I unselect this, this many more would match"). Computed via parallel `COUNT(*) GROUP BY` per facet — cached in Redis 5 minutes.

## 6. Saved presets

`user_filter_presets(id, user_id, name, filters JSONB, is_default)` — frontend lists presets in a dropdown above filters. POST/PATCH/DELETE endpoints provided in `/api/v1/me/presets`.
