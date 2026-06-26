"""Competitor wizard — maps niche-test answers to industry + tags, returns top peers.

Mini-test answers:
  - category: 'saas' | 'marketplace' | 'fintech' | 'logistics' | 'horeca'
              | 'healthcare' | 'education' | 'manufacturing' | 'retail' | 'services'
  - audience: 'b2b' | 'b2c' | 'b2g' | 'mixed'
  - stage:    'idea' | 'mvp' | 'growth' | 'scale'
  - region:   list of country codes
  - price:    'low' | 'mid' | 'premium'

The mapping below is rule-based for MVP. In Phase 2 we'd train a classifier on
real interactions (which competitor the user actually clicked).

DATA REALITY: the DB has two industry-code formats. Real companies use full
OKED codes (`62.01`, `86.10`...), synthetic ones use NACE single-letter
sections (`C`, `G`, `Q`...). The niche universe matches EITHER the category's
OKED codes OR its NACE section letters. `stage`/`price` narrow ONLY the ranked
competitor list — never the market universe used for aggregates.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Numeric, and_, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company import Company

# ─────────────────────────────────────────────────────────────
# Static mapping: category → OKED codes + NACE sections + required tags
# ─────────────────────────────────────────────────────────────

CATEGORY_MAP: dict[str, dict[str, Any]] = {
    "saas": {
        "label": "SaaS / Разработка ПО",
        "industries": ["62.01"],
        "nace": ["J"],  # Информация и связь / ICT
        "tags": ["saas"],
    },
    "marketplace": {
        "label": "Маркетплейс / E-commerce",
        "industries": ["47.91"],
        "nace": ["G"],  # Оптовая и розничная торговля
        "tags": ["marketplace", "ecommerce"],
    },
    "fintech": {
        "label": "FinTech / Финансы",
        "industries": ["64.19", "62.01"],
        "nace": ["K"],  # Финансовая и страховая деятельность
        "tags": ["fintech", "banking"],
    },
    "logistics": {
        "label": "Логистика / Перевозки",
        "industries": ["49.41"],
        "nace": ["H"],  # Транспорт и складирование
        "tags": ["logistics"],
    },
    "horeca": {
        "label": "Рестораны / HoReCa",
        "industries": ["56.10"],
        "nace": ["I"],  # Услуги по проживанию и питанию
        "tags": ["horeca"],
    },
    "healthcare": {
        "label": "Медицина / Pharma",
        "industries": ["86.10", "21.20", "47.73"],
        "nace": ["Q"],  # Здравоохранение и соцуслуги
        "tags": ["healthcare", "pharma"],
    },
    "education": {
        "label": "Образование / EdTech",
        "industries": ["85.32", "85.42", "62.01"],
        "nace": ["P"],  # Образование
        "tags": ["edtech", "education"],
    },
    "manufacturing": {
        "label": "Производство",
        "industries": ["25.11", "71.12"],
        "nace": ["C"],  # Обрабатывающая промышленность
        "tags": ["engineering"],
    },
    "retail": {
        "label": "Розничная торговля",
        "industries": ["47.11", "47.91"],
        "nace": ["G"],  # Оптовая и розничная торговля
        "tags": ["retail", "ecommerce"],
    },
    "services": {
        "label": "B2B-услуги",
        "industries": ["70.22", "71.12", "62.01"],
        "nace": ["M", "N"],  # Профессиональная / административная деятельность
        "tags": ["b2b"],
    },
}

AUDIENCE_TAG_BIAS: dict[str, list[str]] = {
    "b2b": ["b2b", "enterprise"],
    "b2c": ["b2c"],
    "b2g": ["b2g"],
    "mixed": [],
}

# Stage → recommended company size + business_age window
STAGE_PROFILE: dict[str, dict[str, Any]] = {
    "idea":   {"emp_max": 5,   "label": "Идея / pre-MVP"},
    "mvp":    {"emp_max": 20,  "label": "MVP / поиск product-market-fit"},
    "growth": {"emp_min": 20,  "emp_max": 200, "label": "Рост"},
    "scale":  {"emp_min": 200, "label": "Масштабирование / Enterprise"},
}

PRICE_PROFILE: dict[str, dict[str, Any]] = {
    "low":     {"revenue_max": 1_000_000,                                    "label": "Бюджетный"},
    "mid":     {"revenue_min": 1_000_000,    "revenue_max": 25_000_000,      "label": "Средний"},
    "premium": {"revenue_min": 25_000_000,                                    "label": "Premium / Enterprise"},
}

# Size category RU labels
SIZE_LABELS: dict[str, str] = {
    "micro": "Микро",
    "small": "Малый",
    "medium": "Средний",
    "large": "Крупный",
    "enterprise": "Корпорация",
}
SIZE_ORDER = ["micro", "small", "medium", "large", "enterprise"]

# Revenue histogram bins (USD): (label, min, max-exclusive or None)
REVENUE_BUCKETS: list[tuple[str, float, float | None]] = [
    ("<0.5M", 0.0, 500_000.0),
    ("0.5–2M", 500_000.0, 2_000_000.0),
    ("2–10M", 2_000_000.0, 10_000_000.0),
    ("10–50M", 10_000_000.0, 50_000_000.0),
    ("50M+", 50_000_000.0, None),
]

# Competition level thresholds keyed on HHI (0..1).
#   low      hhi < 0.15   — fragmented / many small players
#   moderate 0.15 ≤ hhi ≤ 0.25
#   high     hhi > 0.25   — concentrated / oligopoly
HHI_LOW = 0.15
HHI_HIGH = 0.25

TOP_SHARES_LIMIT = 8


def list_categories() -> list[dict[str, str]]:
    return [{"key": k, "label": v["label"]} for k, v in CATEGORY_MAP.items()]


# ─────────────────────────────────────────────────────────────
# Pure helpers (unit-testable, no DB)
# ─────────────────────────────────────────────────────────────

def derive_size_category(size_category: str | None, employee_count: int | None) -> str:
    """Return a size bucket, deriving from employee_count when size_category is null."""
    if size_category in SIZE_LABELS:
        return size_category
    emp = employee_count or 0
    if emp < 10:
        return "micro"
    if emp < 50:
        return "small"
    if emp < 250:
        return "medium"
    return "large"


def compute_hhi(revenues: list[float]) -> float:
    """Herfindahl-Hirschman index normalized to 0..1 (sum of revenue-share squares)."""
    total = sum(r for r in revenues if r and r > 0)
    if total <= 0:
        return 0.0
    return sum((r / total) ** 2 for r in revenues if r and r > 0)


def competition_level(hhi: float) -> str:
    if hhi < HHI_LOW:
        return "low"
    if hhi <= HHI_HIGH:
        return "moderate"
    return "high"


def bucket_revenue(revenues: list[float]) -> list[dict[str, Any]]:
    """Histogram counts over REVENUE_BUCKETS bins. Companies w/o revenue excluded."""
    out: list[dict[str, Any]] = []
    for label, lo, hi in REVENUE_BUCKETS:
        count = sum(
            1
            for r in revenues
            if r is not None and r >= lo and (hi is None or r < hi)
        )
        out.append({"label": label, "min": lo, "max": hi, "count": count})
    return out


# ─────────────────────────────────────────────────────────────
# Niche-universe WHERE clause
# ─────────────────────────────────────────────────────────────

def _niche_conditions(cat: dict[str, Any], regions: list[str]) -> list[Any]:
    """Conditions defining the FULL niche universe (industry + region, non-merged)."""
    codes = list(cat.get("industries") or [])
    nace = list(cat.get("nace") or [])
    industry_match = or_(
        Company.industry_code.in_(codes) if codes else func.false(),
        Company.industry_code.in_(nace) if nace else func.false(),
    )
    return [
        Company.merged_into_id.is_(None),
        Company.country.in_(regions),
        industry_match,
    ]


async def find_competitors(
    session: AsyncSession,
    *,
    category: str,
    audience: str = "mixed",
    stage: str = "growth",
    regions: list[str] | None = None,
    price: str = "mid",
    limit: int = 12,
    addressable_pct: float = 0.30,
    obtainable_pct: float = 0.05,
) -> dict[str, Any]:
    """Return matched industry, applied filters, a ranked competitor list, and the
    market block aggregated over the FULL niche universe."""
    cat = CATEGORY_MAP.get(category)
    if not cat:
        raise ValueError(f"Unknown category: {category}")

    regions = regions or ["KZ"]
    tags_required = (cat["tags"] or []) + AUDIENCE_TAG_BIAS.get(audience, [])

    # Market block first — over the full niche universe (industry + region only).
    market = await compute_market(
        session,
        category=category,
        audience=audience,
        regions=regions,
        addressable_pct=addressable_pct,
        obtainable_pct=obtainable_pct,
    )
    market_volume = market.get("market_volume_usd") or 0.0

    # Ranked competitors — narrowed by stage + price on top of the niche.
    conds = _niche_conditions(cat, regions)

    stage_p = STAGE_PROFILE.get(stage, {})
    if "emp_min" in stage_p:
        conds.append(Company.employee_count >= stage_p["emp_min"])
    if "emp_max" in stage_p:
        conds.append(Company.employee_count <= stage_p["emp_max"])

    price_p = PRICE_PROFILE.get(price, {})
    if "revenue_min" in price_p:
        conds.append(Company.revenue_usd >= price_p["revenue_min"])
    if "revenue_max" in price_p:
        conds.append(Company.revenue_usd <= price_p["revenue_max"])

    stmt = (
        select(Company)
        .where(and_(*conds))
        .order_by(Company.revenue_usd.desc().nulls_last(),
                  Company.employee_count.desc().nulls_last())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).scalars().all()

    def score(c: Company) -> int:
        if not tags_required or not c.tags:
            return 0
        return sum(1 for t in tags_required if t in c.tags)

    ranked = sorted(rows, key=score, reverse=True)

    competitors = []
    for c in ranked:
        rev = float(c.revenue_usd) if c.revenue_usd is not None else None
        share = round((rev or 0.0) / market_volume * 100, 2) if market_volume > 0 else 0.0
        competitors.append({
            "id": str(c.id),
            "name": c.name,
            "country": c.country,
            "industry_code": c.industry_code,
            "industry_label": c.industry_label,
            "employee_count": c.employee_count,
            "revenue_usd": rev,
            "website": c.website,
            "tags": c.tags or [],
            "tag_match_score": score(c),
            "latitude": float(c.latitude) if c.latitude is not None else None,
            "longitude": float(c.longitude) if c.longitude is not None else None,
            "region_name": c.region_name,
            "city_name": c.city_name,
            "size_category": derive_size_category(c.size_category, c.employee_count),
            "market_share_pct": share,
        })

    return {
        "matched_niche": {
            "category": category,
            "category_label": cat["label"],
            "industries": cat["industries"],
            "nace_sections": cat.get("nace", []),
            "audience": audience,
            "stage": stage_p.get("label", stage),
            "regions": regions,
            "price_segment": price_p.get("label", price),
            "tags_required": tags_required,
        },
        "competitors": competitors,
        "total": len(competitors),
        "market": market,
        "summary": _build_summary(competitors, cat["label"], regions),
    }


# ─────────────────────────────────────────────────────────────
# Market aggregation over the full niche universe
# ─────────────────────────────────────────────────────────────

def _empty_market(addressable_pct: float, obtainable_pct: float) -> dict[str, Any]:
    return {
        "company_count_total": 0,
        "market_volume_usd": 0.0,
        "tam_usd": 0.0,
        "sam_usd": 0.0,
        "som_usd": 0.0,
        "avg_revenue_usd": 0.0,
        "median_revenue_usd": 0.0,
        "avg_employee_count": 0,
        "total_employees": 0,
        "hhi": 0.0,
        "concentration_top3_pct": 0.0,
        "competition_level": "low",
        "size_distribution": [],
        "region_distribution": [],
        "revenue_buckets": bucket_revenue([]),
        "top_shares": [],
        "addressable_pct": addressable_pct,
        "obtainable_pct": obtainable_pct,
        "status": "empty",
        "message": "В этой нише под выбранные регионы пока нет данных.",
    }


async def compute_market(
    session: AsyncSession,
    *,
    category: str,
    audience: str = "mixed",
    regions: list[str] | None = None,
    addressable_pct: float = 0.30,
    obtainable_pct: float = 0.05,
) -> dict[str, Any]:
    """Aggregate the FULL niche universe (industry + region, before stage/price)
    into the `market` contract block. Never divides by zero."""
    cat = CATEGORY_MAP.get(category)
    if not cat:
        raise ValueError(f"Unknown category: {category}")
    regions = regions or ["KZ"]
    conds = _niche_conditions(cat, regions)

    # Pull the columns we need for all niche companies in one query.
    stmt = select(
        Company.id,
        Company.name,
        Company.revenue_usd,
        Company.employee_count,
        Company.size_category,
        Company.region_kato,
        Company.region_name,
    ).where(and_(*conds))
    rows = (await session.execute(stmt)).all()

    if not rows:
        return _empty_market(addressable_pct, obtainable_pct)

    revenues = [float(r.revenue_usd) for r in rows if r.revenue_usd is not None]
    employees = [int(r.employee_count) for r in rows if r.employee_count is not None]

    company_count = len(rows)
    market_volume = sum(revenues)
    total_employees = sum(employees)
    avg_revenue = market_volume / len(revenues) if revenues else 0.0
    avg_employee = total_employees / len(employees) if employees else 0.0

    # Median revenue via SQL percentile_cont for correctness/perf parity w/ analytics.
    median_revenue = float((await session.execute(
        select(func.coalesce(
            func.percentile_cont(0.5).within_group(cast(Company.revenue_usd, Numeric)), 0,
        )).where(and_(*conds), Company.revenue_usd.isnot(None))
    )).scalar() or 0.0)

    hhi = compute_hhi(revenues)
    sorted_rev = sorted(revenues, reverse=True)
    top3 = sum(sorted_rev[:3])
    concentration_top3 = round(top3 / market_volume * 100, 2) if market_volume > 0 else 0.0

    # Size distribution (derive bucket when null).
    size_counts: dict[str, int] = {}
    for r in rows:
        bucket = derive_size_category(r.size_category, r.employee_count)
        size_counts[bucket] = size_counts.get(bucket, 0) + 1
    size_distribution = [
        {"key": k, "label": SIZE_LABELS[k], "count": size_counts[k]}
        for k in SIZE_ORDER
        if k in size_counts
    ]

    # Region distribution (group by kato + name, count + revenue), count desc.
    region_agg: dict[tuple[str | None, str | None], dict[str, Any]] = {}
    for r in rows:
        key = (r.region_kato, r.region_name)
        agg = region_agg.setdefault(
            key, {"region_kato": r.region_kato, "region_name": r.region_name,
                  "count": 0, "revenue_usd": 0.0})
        agg["count"] += 1
        agg["revenue_usd"] += float(r.revenue_usd) if r.revenue_usd is not None else 0.0
    region_distribution = sorted(
        region_agg.values(), key=lambda x: x["count"], reverse=True)

    revenue_buckets = bucket_revenue(revenues)

    # Top shares (top N by revenue) + "Прочие".
    by_revenue = sorted(
        ((r.name, float(r.revenue_usd)) for r in rows if r.revenue_usd is not None),
        key=lambda x: x[1], reverse=True)
    top_shares: list[dict[str, Any]] = []
    for name, rev in by_revenue[:TOP_SHARES_LIMIT]:
        share = round(rev / market_volume * 100, 2) if market_volume > 0 else 0.0
        top_shares.append({"name": name, "revenue_usd": rev, "share_pct": share})
    rest = by_revenue[TOP_SHARES_LIMIT:]
    if rest:
        rest_rev = sum(rev for _, rev in rest)
        rest_share = round(rest_rev / market_volume * 100, 2) if market_volume > 0 else 0.0
        top_shares.append({"name": "Прочие", "revenue_usd": rest_rev, "share_pct": rest_share})

    tam = market_volume
    sam = tam * addressable_pct
    som = sam * obtainable_pct

    return {
        "company_count_total": company_count,
        "market_volume_usd": round(market_volume, 2),
        "tam_usd": round(tam, 2),
        "sam_usd": round(sam, 2),
        "som_usd": round(som, 2),
        "avg_revenue_usd": round(avg_revenue, 2),
        "median_revenue_usd": round(median_revenue, 2),
        "avg_employee_count": round(avg_employee),
        "total_employees": total_employees,
        "hhi": round(hhi, 4),
        "concentration_top3_pct": concentration_top3,
        "competition_level": competition_level(hhi),
        "size_distribution": size_distribution,
        "region_distribution": region_distribution,
        "revenue_buckets": revenue_buckets,
        "top_shares": top_shares,
        "addressable_pct": addressable_pct,
        "obtainable_pct": obtainable_pct,
        "status": "ok",
        "message": (
            f"Ниша: {company_count} компаний, "
            f"совокупная выручка ${market_volume / 1e6:.1f}M."
        ),
    }


# ─────────────────────────────────────────────────────────────
# Niche map (GeoJSON)
# ─────────────────────────────────────────────────────────────

async def niche_feature_collection(
    session: AsyncSession,
    *,
    category: str,
    regions: list[str] | None = None,
    limit: int = 2000,
) -> dict[str, Any]:
    """GeoJSON FeatureCollection of the full niche universe (cap `limit` points
    with non-null lat/lng). Properties match CompanyGeoFeature."""
    cat = CATEGORY_MAP.get(category)
    if not cat:
        raise ValueError(f"Unknown category: {category}")
    regions = regions or ["KZ"]
    conds = _niche_conditions(cat, regions)
    conds.append(Company.latitude.isnot(None))
    conds.append(Company.longitude.isnot(None))

    stmt = (
        select(
            Company.id,
            Company.name,
            Company.industry_code,
            Company.industry_label,
            Company.revenue_usd,
            Company.employee_count,
            Company.region_name,
            Company.size_category,
            Company.latitude,
            Company.longitude,
        )
        .where(and_(*conds))
        .order_by(Company.revenue_usd.desc().nulls_last())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    features = [
        {
            "type": "Feature",
            "id": str(r.id),
            "geometry": {"type": "Point", "coordinates": [float(r.longitude), float(r.latitude)]},
            "properties": {
                "id": str(r.id),
                "name": r.name,
                "industry_code": r.industry_code,
                "industry_label": r.industry_label,
                "revenue_usd": float(r.revenue_usd) if r.revenue_usd is not None else None,
                "employee_count": r.employee_count,
                "region_name": r.region_name,
                "size_category": derive_size_category(r.size_category, r.employee_count),
            },
        }
        for r in rows
    ]
    return {
        "type": "FeatureCollection",
        "features": features,
        "total": len(features),
    }


def _build_summary(competitors: list[dict[str, Any]], category_label: str,
                   regions: list[str]) -> dict[str, Any]:
    """Aggregate market summary for the matched niche (top-N competitor list)."""
    if not competitors:
        return {
            "status": "low_density",
            "message": f"В выборке {category_label} ({', '.join(regions)}) "
                       f"мало игроков под ваши параметры — низкая конкуренция "
                       f"или мы пока не покрыли источники.",
        }
    total_rev = sum(c["revenue_usd"] or 0 for c in competitors)
    avg_emp = sum(c["employee_count"] or 0 for c in competitors) / max(len(competitors), 1)
    top = competitors[0]
    return {
        "status": "ok",
        "competitor_count": len(competitors),
        "total_revenue_usd": total_rev,
        "avg_employee_count": round(avg_emp),
        "leader": {"name": top["name"], "revenue_usd": top["revenue_usd"]},
        "concentration": (top["revenue_usd"] / total_rev * 100) if total_rev else 0,
        "message": (
            f"Под ваши параметры — {len(competitors)} конкурентов. "
            f"Лидер: {top['name']}. "
            f"Совокупная выручка ${total_rev / 1e6:.1f}M."
        ),
    }
