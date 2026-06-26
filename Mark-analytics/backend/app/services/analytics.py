"""Analytics aggregation service for the Market Intelligence dashboard.

All queries respect the filter taxonomy via `app.filters.registry.parse_filters`,
so the dashboard widgets stay in sync with whatever the user has filtered.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, case, column, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.filters.registry import FILTERS, FilterType
from app.models.company import Company


def _col(name: str) -> Any:
    """Return ORM attribute if present, else a raw `companies.<name>` column ref.

    Lets analytics queries reference denormalized columns (region_name, city_name,
    region_kato) that may have been added by an out-of-band migration even when
    the Python model hasn't been updated yet (parallel worktrees).
    """
    attr = getattr(Company, name, None)
    if attr is not None:
        return attr
    return column(name)


def _apply_filters(stmt: Any, filters: dict[str, Any]) -> Any:
    """Reuse the same WHERE construction as companies service. Keeps widgets aligned."""
    # Delegate to the central clause builder for consistency with companies service.
    from app.services.companies import _build_clause, _build_derived_clause  # noqa: PLC0415

    for key, value in filters.items():
        negated = key.endswith("!")
        key_clean = key[:-1] if negated else key
        f = FILTERS.get(key_clean)
        if not f:
            continue
        # Try derived first (company_size, business_age_years, etc.)
        clause = _build_derived_clause(key_clean, value, negated)
        if clause is not None:
            stmt = stmt.where(clause)
            continue
        # Standard column-backed path
        if not f.backed_by.startswith("companies."):
            continue
        clause = _build_clause(f, value, negated)
        if clause is not None:
            stmt = stmt.where(clause)
    return stmt


async def overview(session: AsyncSession, *, filters: dict[str, Any]) -> dict[str, Any]:
    """High-level KPIs computed from `companies` table under the current filters."""
    base = select(Company).where(Company.merged_into_id.is_(None))
    base = _apply_filters(base, filters)
    subq = base.subquery()

    metrics_stmt = select(
        func.count().label("total"),
        func.count(subq.c.id).filter(subq.c.status == "active").label("active"),
        func.count(subq.c.id).filter(subq.c.status == "liquidated").label("liquidated"),
        func.coalesce(func.sum(subq.c.revenue_usd), 0).label("revenue_total"),
        func.coalesce(func.avg(subq.c.revenue_usd), 0).label("revenue_avg"),
        func.coalesce(func.percentile_cont(0.5).within_group(subq.c.revenue_usd), 0).label("revenue_median"),
        func.coalesce(func.sum(subq.c.employee_count), 0).label("employees_total"),
        func.coalesce(func.avg(subq.c.employee_count), 0).label("employees_avg"),
        func.count(func.distinct(subq.c.country)).label("countries"),
        func.count(func.distinct(subq.c.industry_code)).label("industries"),
    )
    row = (await session.execute(metrics_stmt)).one()

    # New this month (proxy = registered_at within last 30d; falls back to created_at)
    cutoff = datetime.now(timezone.utc).replace(day=1)
    new_this_month_stmt = select(func.count()).select_from(subq).where(
        or_(subq.c.registered_at >= cutoff.date(), subq.c.created_at >= cutoff)
    )
    new_this_month = (await session.execute(new_this_month_stmt)).scalar() or 0

    return {
        "total_companies": int(row.total or 0),
        "active": int(row.active or 0),
        "liquidated": int(row.liquidated or 0),
        "mortality_rate_pct": round((row.liquidated or 0) / max(row.total or 1, 1) * 100, 2),
        "revenue_total_usd": float(row.revenue_total or 0),
        "revenue_avg_usd": float(row.revenue_avg or 0),
        "revenue_median_usd": float(row.revenue_median or 0),
        "employees_total": int(row.employees_total or 0),
        "employees_avg": float(row.employees_avg or 0),
        "countries_count": int(row.countries or 0),
        "industries_count": int(row.industries or 0),
        "new_this_month": int(new_this_month),
    }


async def industry_distribution(
    session: AsyncSession, *, filters: dict[str, Any], limit: int = 10,
) -> list[dict[str, Any]]:
    """Top industries by company count + revenue. Powers the dashboard treemap/bar."""
    base = select(
        Company.industry_code,
        Company.industry_label,
        func.count(Company.id).label("companies"),
        func.coalesce(func.sum(Company.revenue_usd), 0).label("revenue"),
        func.coalesce(func.sum(Company.employee_count), 0).label("employees"),
    ).where(
        Company.merged_into_id.is_(None),
        Company.industry_code.isnot(None),
    ).group_by(Company.industry_code, Company.industry_label)
    base = _apply_filters(base, filters)
    base = base.order_by(func.count(Company.id).desc()).limit(limit)

    rows = (await session.execute(base)).all()
    return [
        {
            "industry_code": r.industry_code,
            "industry_label": r.industry_label,
            "companies": int(r.companies),
            "revenue_usd": float(r.revenue),
            "employees": int(r.employees),
        }
        for r in rows
    ]


async def country_distribution(
    session: AsyncSession, *, filters: dict[str, Any],
) -> list[dict[str, Any]]:
    """Companies / revenue by country. Powers the country comparison widget."""
    base = select(
        Company.country,
        func.count(Company.id).label("companies"),
        func.count(Company.id).filter(Company.status == "active").label("active"),
        func.coalesce(func.sum(Company.revenue_usd), 0).label("revenue"),
        func.coalesce(func.sum(Company.employee_count), 0).label("employees"),
    ).where(Company.merged_into_id.is_(None)).group_by(Company.country)
    base = _apply_filters(base, filters)
    base = base.order_by(func.count(Company.id).desc())

    rows = (await session.execute(base)).all()
    return [
        {
            "country": r.country,
            "companies": int(r.companies),
            "active": int(r.active or 0),
            "revenue_usd": float(r.revenue),
            "employees": int(r.employees),
        }
        for r in rows
    ]


async def growth_leaders(
    session: AsyncSession, *, filters: dict[str, Any], limit: int = 10,
) -> list[dict[str, Any]]:
    """Top companies by revenue. Placeholder for real YoY-growth (needs CDC data)."""
    base = select(Company).where(
        Company.merged_into_id.is_(None),
        Company.revenue_usd.isnot(None),
    )
    base = _apply_filters(base, filters)
    base = base.order_by(Company.revenue_usd.desc().nulls_last()).limit(limit)

    rows = (await session.execute(base)).scalars().all()
    return [
        {
            "id": str(c.id),
            "name": c.name,
            "country": c.country,
            "industry_label": c.industry_label,
            "revenue_usd": float(c.revenue_usd or 0),
            "employees": c.employee_count,
            "tags": c.tags or [],
        }
        for c in rows
    ]


async def size_distribution(
    session: AsyncSession, *, filters: dict[str, Any],
) -> list[dict[str, Any]]:
    """Bucketed employee distribution. Buckets: micro (<10), small (10-50), medium (50-250), large (250-1000), enterprise (1000+)."""
    base = select(Company).where(Company.merged_into_id.is_(None))
    base = _apply_filters(base, filters)
    subq = base.subquery()
    bucket_expr = case(
        (subq.c.employee_count.is_(None), "unknown"),
        (subq.c.employee_count < 10, "micro"),
        (subq.c.employee_count < 50, "small"),
        (subq.c.employee_count < 250, "medium"),
        (subq.c.employee_count < 1000, "large"),
        else_="enterprise",
    ).label("bucket")
    stmt = select(
        bucket_expr,
        func.count().label("companies"),
        func.coalesce(func.sum(subq.c.revenue_usd), 0).label("revenue"),
    ).select_from(subq).group_by(bucket_expr)

    rows = (await session.execute(stmt)).all()
    order = ["micro", "small", "medium", "large", "enterprise", "unknown"]
    out = [{"bucket": r.bucket, "companies": int(r.companies), "revenue_usd": float(r.revenue)} for r in rows]
    out.sort(key=lambda x: order.index(x["bucket"]) if x["bucket"] in order else 99)
    return out


async def status_breakdown(
    session: AsyncSession, *, filters: dict[str, Any],
) -> list[dict[str, Any]]:
    base = select(
        func.coalesce(Company.status, "unknown").label("status"),
        func.count(Company.id).label("companies"),
    ).where(Company.merged_into_id.is_(None)).group_by(Company.status)
    base = _apply_filters(base, filters)
    rows = (await session.execute(base)).all()
    return [{"status": r.status, "companies": int(r.companies)} for r in rows]


def generate_insights(overview_data: dict, industries: list[dict], countries: list[dict],
                       size_dist: list[dict]) -> list[dict[str, Any]]:
    """Rule-based insight cards — no AI key required. Each card has severity + text."""
    insights: list[dict[str, Any]] = []

    total = overview_data["total_companies"]
    if total == 0:
        return [{"severity": "info", "title": "Нет данных",
                  "body": "Под текущие фильтры ничего не найдено."}]

    # Concentration in top industry
    if industries and total > 0:
        top = industries[0]
        share = top["companies"] / total * 100
        if share > 40:
            insights.append({
                "severity": "warn",
                "title": "Высокая концентрация",
                "body": f"{share:.0f}% компаний — {top['industry_label']} ({top['industry_code']}). "
                         f"Стоит проверить, не перегрет ли сегмент.",
            })

    # Country dominance
    if countries and total > 0:
        top_c = countries[0]
        share = top_c["companies"] / total * 100
        if share > 60 and len(countries) > 1:
            insights.append({
                "severity": "info",
                "title": "Доминирует одна страна",
                "body": f"{share:.0f}% выборки — {top_c['country']}. "
                         f"Для бенчмарка имеет смысл сравнить с соседними рынками.",
            })

    # Mortality rate
    if overview_data["mortality_rate_pct"] > 10:
        insights.append({
            "severity": "danger",
            "title": "Повышенная смертность",
            "body": f"{overview_data['mortality_rate_pct']:.1f}% компаний в статусе liquidated. "
                     f"Сегмент с высоким риском входа.",
        })

    # Revenue skew (top 1 dominates)
    if industries:
        top_rev = max((i["revenue_usd"] for i in industries), default=0)
        total_rev = sum(i["revenue_usd"] for i in industries)
        if total_rev > 0 and top_rev / total_rev > 0.6:
            top_i = max(industries, key=lambda i: i["revenue_usd"])
            insights.append({
                "severity": "warn",
                "title": "Монополизированный денежный поток",
                "body": f"Отрасль {top_i['industry_label']} концентрирует "
                         f"{top_rev/total_rev*100:.0f}% выручки. Возможна олигополия.",
            })

    # Enterprise share
    if size_dist:
        ent = next((b for b in size_dist if b["bucket"] == "enterprise"), None)
        if ent and ent["companies"] / total > 0.05:
            insights.append({
                "severity": "ok",
                "title": "Зрелый рынок",
                "body": f"В выборке {ent['companies']} enterprise-компаний "
                         f"(>1000 сотрудников). Признак развитой инфраструктуры.",
            })

    # Underserved (если мало компаний в категории — может быть ниша)
    if industries and len(industries) >= 5:
        smallest = industries[-1]
        if smallest["companies"] < 5 and smallest["revenue_usd"] > 1_000_000:
            insights.append({
                "severity": "ok",
                "title": "Возможная ниша",
                "body": f"{smallest['industry_label']}: всего {smallest['companies']} "
                         f"игроков при выручке ${smallest['revenue_usd']/1e6:.1f}M. "
                         f"Низкая конкуренция при платёжеспособном спросе.",
            })

    if not insights:
        insights.append({
            "severity": "info", "title": "Рынок стабилен",
            "body": "Не обнаружено явных аномалий концентрации, смертности или нишевых сигналов.",
        })

    return insights


# ────────────────────────────────────────────────────────────────────
# Region / city distribution (denormalized columns: region_kato, region_name, city_name)
# ────────────────────────────────────────────────────────────────────


_GEO_CACHE_PREFIX = "analytics:geo:"
_GEO_CACHE_TTL_SECONDS = 300  # 5 minutes


def _metric_expr(metric: str) -> Any:
    """Aggregate expression keyed by `metric` query param."""
    if metric == "revenue":
        return func.coalesce(func.sum(Company.revenue_usd), 0)
    if metric == "employees":
        return func.coalesce(func.sum(Company.employee_count), 0)
    return func.count(Company.id)  # default: count


def _cache_key(prefix: str, country: str, metric: str, limit: int,
               filters: dict[str, Any]) -> str:
    # Stable hash of filter dict
    fp = hashlib.sha1(
        json.dumps({"f": filters, "c": country, "m": metric, "l": limit},
                   sort_keys=True, ensure_ascii=False, default=str).encode(),
    ).hexdigest()[:16]
    return f"{_GEO_CACHE_PREFIX}{prefix}:{fp}"


async def _geo_cache_get(key: str) -> list[dict[str, Any]] | None:
    try:
        from app.ai.cache import get_redis  # noqa: PLC0415

        r = await get_redis()
        raw = await r.get(key)
        if not raw:
            return None
        return json.loads(raw)  # type: ignore[no-any-return]
    except Exception:
        return None


async def _geo_cache_put(key: str, payload: list[dict[str, Any]]) -> None:
    try:
        from app.ai.cache import get_redis  # noqa: PLC0415

        r = await get_redis()
        await r.setex(key, _GEO_CACHE_TTL_SECONDS,
                      json.dumps(payload, ensure_ascii=False, default=str))
    except Exception:
        return


async def region_distribution(
    session: AsyncSession,
    *,
    filters: dict[str, Any],
    country: str = "KZ",
    metric: str = "count",
) -> list[dict[str, Any]]:
    """Distribution of companies grouped by region (KATO + denormalized name).

    Returns rows like {region_kato, region_name, value, percent_of_total}.
    metric ∈ {count, revenue, employees}. Cached in Redis 5min.
    """
    cache_key = _cache_key("region", country, metric, 0, filters)
    cached = await _geo_cache_get(cache_key)
    if cached is not None:
        return cached

    region_kato = _col("region_kato")
    region_name = _col("region_name")
    value_expr = _metric_expr(metric).label("value")

    base = select(
        region_kato.label("region_kato"),
        region_name.label("region_name"),
        value_expr,
    ).where(
        Company.merged_into_id.is_(None),
        Company.country == country,
        region_kato.isnot(None),
    ).group_by(region_kato, region_name)

    base = _apply_filters(base, filters)
    base = base.order_by(text("value DESC NULLS LAST"))

    rows = (await session.execute(base)).all()
    total = sum(float(r.value or 0) for r in rows) or 1.0
    out = [
        {
            "region_kato": r.region_kato,
            "region_name": r.region_name,
            "value": float(r.value or 0),
            "percent_of_total": round(float(r.value or 0) / total * 100, 2),
        }
        for r in rows
    ]
    await _geo_cache_put(cache_key, out)
    return out


async def city_distribution(
    session: AsyncSession,
    *,
    filters: dict[str, Any],
    country: str = "KZ",
    metric: str = "count",
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Top-N cities grouped by city_name (+ region context).

    Returns {city_name, region_name, value, percent_of_total}. Cached 5min.
    """
    cache_key = _cache_key("city", country, metric, limit, filters)
    cached = await _geo_cache_get(cache_key)
    if cached is not None:
        return cached

    city_name = _col("city_name")
    region_name = _col("region_name")
    value_expr = _metric_expr(metric).label("value")

    base = select(
        city_name.label("city_name"),
        region_name.label("region_name"),
        value_expr,
    ).where(
        Company.merged_into_id.is_(None),
        Company.country == country,
        city_name.isnot(None),
    ).group_by(city_name, region_name)

    base = _apply_filters(base, filters)
    base = base.order_by(text("value DESC NULLS LAST")).limit(limit)

    rows = (await session.execute(base)).all()
    total = sum(float(r.value or 0) for r in rows) or 1.0
    out = [
        {
            "city_name": r.city_name,
            "region_name": r.region_name,
            "value": float(r.value or 0),
            "percent_of_total": round(float(r.value or 0) / total * 100, 2),
        }
        for r in rows
    ]
    await _geo_cache_put(cache_key, out)
    return out
