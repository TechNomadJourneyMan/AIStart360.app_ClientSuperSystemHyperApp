"""Company service — list with filters, get by id, detail enrichment.

The enriched detail uses at most 4 additional SQL queries beyond the
single primary `SELECT companies WHERE id=...`:

  Q1: related tenders (customer_id OR awarded_to_id)
  Q2: company_changes for timeline
  Q3: peer aggregates (industry+country) — revenue / employee percentiles + rank
  Q4: similar companies (vector or trgm fallback)

Insights + scores are pure-Python over the data fetched above. Results are
cached in Redis for 1h under `company_insights:{id}` (see `get_insights_cached`).
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import and_, case, column, func, literal, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.filters.registry import FILTERS, FilterType
from app.models.company import Company, CompanyChange
from app.models.tender import Tender
from app.schemas.company import (
    CompanyInsight,
    CompanyScores,
    DataQuality,
    TimelineEvent,
)
from app.schemas.pagination import decode_cursor, encode_cursor


# ────────────────────────────────────────────────────────────────────
# List / get
# ────────────────────────────────────────────────────────────────────


async def list_companies(
    session: AsyncSession,
    *,
    filters: dict[str, Any],
    q: str | None = None,
    limit: int = 20,
    cursor: str | None = None,
) -> tuple[list[Company], str | None, int]:
    """Return (rows, next_cursor, approx_total).

    PERF (Sprint 5.2):
      * The page query is cursor-paginated (no OFFSET) and ordered by
        (updated_at DESC, id DESC) — backed by the partial composite
        `ix_companies_alive_updated`.
      * The approximate total is taken from `pg_class.reltuples` when there
        are no filters (fast — single index lookup, no full scan). With
        filters or a free-text query the total falls back to -1 (caller
        treats negative as "unknown") to keep p95 bounded — the UI doesn't
        rely on the exact count.
    """
    stmt = select(Company).where(Company.merged_into_id.is_(None))

    # Apply filters (registry-driven)
    has_real_filter = False
    for key, value in filters.items():
        negated = key.endswith("!")
        key_clean = key[:-1] if negated else key
        f = FILTERS.get(key_clean)
        if not f:
            continue
        clause = _build_clause(f, value, negated)
        if clause is not None:
            stmt = stmt.where(clause)
            has_real_filter = True

    # Free-text trigram match on name_normalized
    if q:
        q_lower = q.lower()
        stmt = stmt.where(
            or_(
                Company.name_normalized.ilike(f"%{q_lower}%"),
                Company.description.ilike(f"%{q_lower}%"),
            )
        )

    # Cursor pagination by (updated_at desc, id desc)
    if cursor:
        cur_ts, cur_id = decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                Company.updated_at < cur_ts,
                and_(Company.updated_at == cur_ts, Company.id < cur_id),
            )
        )

    stmt = stmt.order_by(Company.updated_at.desc(), Company.id.desc()).limit(limit + 1)

    result = await session.execute(stmt)
    rows = list(result.scalars().all())

    next_cursor: str | None = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = encode_cursor(last.updated_at, last.id)
        rows = rows[:limit]

    # Approximate total — see docstring.
    if has_real_filter or q:
        total = -1  # unknown; client should display "1000+"-style indicator
    else:
        total = await _approx_company_count(session)

    return rows, next_cursor, total


async def _approx_company_count(session: AsyncSession) -> int:
    """Cheap row estimate via pg_class.reltuples.

    Postgres maintains this stat after ANALYZE / autovacuum, so it's a
    single index lookup — O(1) regardless of table size. We fall back to
    a real COUNT(*) only if reltuples is < 0 (table never analysed).
    """
    try:
        est = (await session.execute(
            text("SELECT reltuples::bigint AS est FROM pg_class WHERE relname='companies'")
        )).scalar()
    except Exception:
        est = None
    if est is None or est < 0:
        # Fallback: bounded approximate count. Still cheap because of the
        # partial index on (merged_into_id IS NULL).
        count_stmt = (
            select(func.count())
            .select_from(Company)
            .where(Company.merged_into_id.is_(None))
        )
        return int((await session.execute(count_stmt)).scalar() or 0)
    return int(est)


async def get_company_by_id(session: AsyncSession, company_id: UUID) -> Company | None:
    result = await session.execute(
        select(Company).where(Company.id == company_id, Company.merged_into_id.is_(None))
    )
    return result.scalar_one_or_none()


def _build_clause(f: Any, value: Any, negated: bool) -> Any | None:
    """Translate a parsed filter value into a SQLAlchemy clause."""
    # 1) Derived filters that we resolve to real SQL expressions on companies columns
    derived = _build_derived_clause(f.key, value, negated)
    if derived is not None:
        return derived

    # 2) Plain column-backed filters (the common case)
    backed = f.backed_by
    if not backed.startswith("companies."):
        return None
    col_name = backed.split(".", 1)[1]
    col = getattr(Company, col_name, None)
    if col is None:
        # Fall back to a raw column reference. Allows filters whose backing
        # column exists in the DB (added via migration in a parallel worktree)
        # but isn't yet declared on the SQLAlchemy model.
        col = column(col_name)

    if f.type in (FilterType.MULTI_ENUM, FilterType.MULTI_TEXT):
        clause = col.in_(value)
        return ~clause if negated else clause
    if f.type == FilterType.ENUM:
        clause = col == value
        return ~clause if negated else clause
    if f.type == FilterType.BOOL:
        return col.is_(value)
    if f.type == FilterType.RANGE_NUMBER and isinstance(value, dict):
        clauses = []
        if value.get("gte") is not None:
            clauses.append(col >= value["gte"])
        if value.get("lte") is not None:
            clauses.append(col <= value["lte"])
        return and_(*clauses) if clauses else None
    return None


# ────────────────────────────────────────────────────────────────────
# Derived filters — translate semantic UI keys to real SQL on existing columns
# ────────────────────────────────────────────────────────────────────

SIZE_BUCKETS = {
    "micro":      (None, 9),          # emp ≤ 9
    "small":      (10, 49),
    "medium":     (50, 249),
    "large":      (250, 999),
    "enterprise": (1000, None),       # 1000+
}


def _build_derived_clause(key: str, value: Any, negated: bool) -> Any | None:
    """Resolve derived filters that don't map 1-1 to a column.

    Returns SQLAlchemy expression or None (let caller fall through to standard path).
    """
    # ── company_size: prefer size_category column when set, fall back to employee_count bucket
    if key == "company_size":
        vals = value if isinstance(value, list) else [value]
        clauses = []
        for v in vals:
            if v not in SIZE_BUCKETS:
                continue
            lo, hi = SIZE_BUCKETS[v]
            bucket_conds = []
            if lo is not None:
                bucket_conds.append(Company.employee_count >= lo)
            if hi is not None:
                bucket_conds.append(Company.employee_count <= hi)
            # Match either explicit size_category OR the employee bucket
            clauses.append(or_(
                Company.size_category == v,
                and_(Company.size_category.is_(None), *bucket_conds) if bucket_conds else Company.size_category == v,
            ))
        if not clauses:
            return None
        c = or_(*clauses)
        return ~c if negated else c

    # ── business_age_years: range over (NOW - registered_at)
    if key == "business_age_years" and isinstance(value, dict):
        # PostgreSQL: EXTRACT(year FROM AGE(now(), registered_at))
        age_expr = func.extract("year", func.age(func.now(), Company.registered_at))
        conds = []
        if value.get("gte") is not None:
            conds.append(age_expr >= value["gte"])
        if value.get("lte") is not None:
            conds.append(age_expr <= value["lte"])
        if not conds:
            return None
        return and_(*conds)

    # ── ownership_type → real column ownership_type_detail
    if key == "ownership_type":
        vals = value if isinstance(value, list) else [value]
        c = Company.ownership_type_detail.in_(vals)
        return ~c if negated else c

    # ── profitability: derived. revenue > 0 + employees ratio.
    if key == "profitability" and isinstance(value, str):
        # Heuristic: revenue_per_employee buckets. No real P&L data → return None.
        return None

    # ── status, country, industry — already handled by standard path
    return None


# ────────────────────────────────────────────────────────────────────
# Sub-resources used by the enriched detail
# ────────────────────────────────────────────────────────────────────


async def get_related_tenders(
    session: AsyncSession, company_id: UUID, limit: int = 10,
) -> list[dict[str, Any]]:
    """Q1 — tenders where the company is customer or awardee."""
    stmt = (
        select(
            Tender.id, Tender.title, Tender.amount_usd, Tender.currency,
            Tender.status, Tender.published_at, Tender.customer_id, Tender.awarded_to_id,
        )
        .where(or_(Tender.customer_id == company_id, Tender.awarded_to_id == company_id))
        .order_by(Tender.published_at.desc().nulls_last())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "id": str(r.id),
            "title": r.title,
            "amount_usd": float(r.amount_usd) if r.amount_usd is not None else None,
            "currency": r.currency,
            "status": r.status,
            "published_at": r.published_at.isoformat() if r.published_at else None,
            "role": "customer" if r.customer_id == company_id else "awardee",
        }
        for r in rows
    ]


async def get_timeline(session: AsyncSession, company_id: UUID) -> list[TimelineEvent]:
    """Build a timeline from `companies_changes` + recent tenders + lifecycle dates.

    Uses Q2 here. `registered_at` and `updated_at` are pulled from the company
    object the caller already has (no extra query). Related tenders are fetched
    separately by `get_related_tenders` (Q1) and merged by the orchestrator.
    """
    stmt = (
        select(
            CompanyChange.field,
            CompanyChange.old_value,
            CompanyChange.new_value,
            CompanyChange.detected_at,
        )
        .where(CompanyChange.company_id == company_id)
        .order_by(CompanyChange.detected_at.desc())
        .limit(50)
    )
    rows = (await session.execute(stmt)).all()
    events: list[TimelineEvent] = []
    for r in rows:
        events.append(
            TimelineEvent(
                at=r.detected_at,
                kind="field_change",
                label=f"Изменено поле «{r.field}»",
                payload={"field": r.field, "old": r.old_value, "new": r.new_value},
            )
        )
    return events


async def get_peer_stats(
    session: AsyncSession, company: Company,
) -> dict[str, Any]:
    """Q3 — aggregate stats for peers in same industry+country.

    Returns medians and rank info used by both scores and insights.

    PERF (Sprint 5.2): collapses 4 separate scans (count+medians, rev_rank,
    emp_pct, rev_pct) into a single aggregate using FILTER clauses. Saves 3
    round-trips per company-detail request and lets the planner share one
    index scan on (country, industry_code).
    """
    base = select(Company).where(
        Company.merged_into_id.is_(None),
        Company.country == company.country,
    )
    if company.industry_code:
        base = base.where(Company.industry_code == company.industry_code)

    subq = base.subquery()

    target_rev = company.revenue_usd
    target_emp = company.employee_count

    stmt = select(
        func.count().label("peer_count"),
        func.coalesce(
            func.percentile_cont(0.5).within_group(subq.c.employee_count), 0,
        ).label("emp_median"),
        func.coalesce(
            func.percentile_cont(0.5).within_group(subq.c.revenue_usd), 0,
        ).label("rev_median"),
        func.coalesce(
            func.sum(case((subq.c.status == "liquidated", 1), else_=0)),
            0,
        ).label("liquidated_count"),
        # Rank + percentile counters via FILTER (compiled to FILTER WHERE on PG).
        # Comparing NULL > x → NULL → excluded, which matches the previous logic.
        (
            func.count().filter(subq.c.revenue_usd > target_rev).label("rev_above")
            if target_rev is not None else literal(0).label("rev_above")
        ),
        (
            func.count().filter(subq.c.revenue_usd < target_rev).label("rev_below")
            if target_rev is not None else literal(0).label("rev_below")
        ),
        (
            func.count().filter(subq.c.employee_count < target_emp).label("emp_below")
            if target_emp is not None else literal(0).label("emp_below")
        ),
    )
    row = (await session.execute(stmt)).one()

    peer_count = int(row.peer_count or 0)
    liquidated = int(row.liquidated_count or 0)
    mortality_pct = (liquidated / peer_count * 100) if peer_count else 0.0

    rank: int | None = None
    if target_rev is not None:
        rank = int(row.rev_above or 0) + 1

    emp_pct: float = 0.0
    rev_pct: float = 0.0
    if peer_count > 1:
        if target_emp is not None:
            emp_pct = int(row.emp_below or 0) / peer_count * 100
        if target_rev is not None:
            rev_pct = int(row.rev_below or 0) / peer_count * 100

    return {
        "peer_count": peer_count,
        "emp_median": float(row.emp_median or 0),
        "rev_median": float(row.rev_median or 0),
        "mortality_pct": mortality_pct,
        "revenue_rank": rank,
        "emp_percentile": emp_pct,
        "rev_percentile": rev_pct,
    }


async def get_similar(
    session: AsyncSession, company_id: UUID, limit: int = 5,
) -> list[Company]:
    """Q4 — similar companies via pgvector cosine or trgm fallback.

    Strategy:
      1. If the target has an embedding, use `embedding <=> target.embedding`
         restricted to same country (loose prefilter), excluding self.
      2. Otherwise fall back to same industry_code + same country, ordered by
         trigram similarity on name_normalized.
    """
    target = await session.execute(
        select(Company).where(Company.id == company_id)
    )
    src = target.scalar_one_or_none()
    if src is None:
        return []

    has_embedding = getattr(src, "embedding", None) is not None
    if has_embedding:
        # pgvector cosine search; use bound param so asyncpg encodes the vector.
        stmt = (
            select(Company)
            .where(
                Company.id != company_id,
                Company.merged_into_id.is_(None),
                Company.country == src.country,
                Company.embedding.isnot(None),  # type: ignore[attr-defined]
            )
            .order_by(Company.embedding.cosine_distance(src.embedding))  # type: ignore[attr-defined]
            .limit(limit)
        )
        result = await session.execute(stmt)
        rows = list(result.scalars().all())
        if rows:
            return rows
        # else fall through to trgm

    # Trgm fallback: same industry_code + same country, order by similarity on name
    sim_expr = func.similarity(Company.name_normalized, src.name_normalized)
    stmt2 = (
        select(Company)
        .where(
            Company.id != company_id,
            Company.merged_into_id.is_(None),
            Company.country == src.country,
        )
    )
    if src.industry_code:
        # widen to industry prefix to avoid empty results
        prefix = src.industry_code[:2]
        stmt2 = stmt2.where(
            or_(
                Company.industry_code == src.industry_code,
                Company.industry_code.like(f"{prefix}%"),
            )
        )
    stmt2 = stmt2.order_by(sim_expr.desc(), Company.updated_at.desc()).limit(limit)
    result2 = await session.execute(stmt2)
    return list(result2.scalars().all())


# ────────────────────────────────────────────────────────────────────
# Scores + insights (pure formulas)
# ────────────────────────────────────────────────────────────────────


_COMPLETENESS_FIELDS = (
    "bin", "name", "country", "legal_form", "status", "industry_code",
    "registered_at", "employee_count", "revenue_usd", "website", "email",
    "phone", "address_id", "description",
)

_SOCIAL_TAG_HINTS = {
    "facebook", "instagram", "linkedin", "youtube", "tiktok", "telegram",
    "twitter", "x", "vk", "social",
}


def _digital_maturity(company: Company) -> int:
    score = 0
    if company.website:
        score += 1
    if company.email:
        score += 1
    if company.phone:
        score += 1
    tags = company.tags or []
    if any(t and t.lower() in _SOCIAL_TAG_HINTS for t in tags):
        score += 1
    if company.industry_code and company.industry_code.startswith("62"):
        score += 1
    return min(score, 5)


def _data_completeness(company: Company) -> float:
    populated = sum(1 for f in _COMPLETENESS_FIELDS if getattr(company, f, None) not in (None, ""))
    return round(populated / len(_COMPLETENESS_FIELDS) * 100, 2)


def _freshness_days(company: Company) -> int:
    if company.updated_at is None:
        return 0
    now = datetime.now(timezone.utc)
    upd = company.updated_at
    if upd.tzinfo is None:
        upd = upd.replace(tzinfo=timezone.utc)
    return max(0, (now - upd).days)


def _confidence(company: Company) -> float:
    if company.confidence is not None:
        return min(1.0, max(0.0, float(company.confidence)))
    # Proxy: data completeness scaled.
    return round(_data_completeness(company) / 100.0, 2)


def _risk_level(
    company: Company, peer: dict[str, Any], completeness: float, confidence: float,
) -> str:
    if (company.status and company.status != "active") or peer["mortality_pct"] > 20:
        return "high"
    if confidence < 0.7 or completeness < 50:
        return "medium"
    return "low"


def _ai_growth_score(peer: dict[str, Any]) -> float:
    """Heuristic: blend of employee + revenue percentiles within peer group."""
    return round((peer["emp_percentile"] + peer["rev_percentile"]) / 2, 2)


def compute_scores(company: Company, peer: dict[str, Any]) -> CompanyScores:
    completeness = _data_completeness(company)
    confidence = _confidence(company)
    return CompanyScores(
        digital_maturity=_digital_maturity(company),
        data_completeness_pct=completeness,
        freshness_days=_freshness_days(company),
        confidence_score=confidence,
        risk_level=_risk_level(company, peer, completeness, confidence),  # type: ignore[arg-type]
        ai_growth_score=_ai_growth_score(peer),
    )


def _business_age_years(company: Company) -> float | None:
    if not company.registered_at:
        return None
    today = datetime.now(timezone.utc).date()
    return (today - company.registered_at).days / 365.25


def compute_company_insights(
    company: Company,
    peer: dict[str, Any],
    scores: CompanyScores,
    related_tenders: list[dict[str, Any]],
) -> list[CompanyInsight]:
    """Up to 6 rule-based insights. Skip trivial duplicates."""
    out: list[CompanyInsight] = []

    industry = company.industry_label or company.industry_code or "—"
    country = company.country or "—"

    # 1. Лидер в нише
    rank = peer.get("revenue_rank")
    if rank is not None and rank <= 3 and peer["peer_count"] >= 5:
        out.append(CompanyInsight(
            severity="ok",
            title=f"Лидер в нише: {industry} в {country}",
            body=f"Компания #{rank} по выручке среди {peer['peer_count']} конкурентов.",
            evidence={"rank": rank, "peer_count": peer["peer_count"]},
        ))

    # 2. Высокая зависимость от госзакупок
    tags_lower = {(t or "").lower() for t in (company.tags or [])}
    has_b2g = "b2g" in tags_lower or "government" in tags_lower or "gov" in tags_lower
    awardee_count = sum(1 for t in related_tenders if t.get("role") == "awardee")
    if (has_b2g or awardee_count > 0) and awardee_count >= 3:
        tender_volume = sum(t["amount_usd"] or 0 for t in related_tenders if t.get("role") == "awardee")
        rev = float(company.revenue_usd or 0)
        ratio = (tender_volume / rev) if rev > 0 else None
        if ratio is None or ratio > 0.3:
            out.append(CompanyInsight(
                severity="warn",
                title="Высокая зависимость от госзакупок",
                body=f"Выиграно {awardee_count} тендеров на ${tender_volume:,.0f}.",
                evidence={"awarded_count": awardee_count, "awarded_usd": tender_volume,
                          "revenue_ratio": ratio},
            ))

    # 3. Признаки быстрого роста
    emp = company.employee_count or 0
    if emp > 0 and peer["emp_median"] > 0 and emp > peer["emp_median"] * 2:
        out.append(CompanyInsight(
            severity="ok",
            title="Признаки быстрого роста",
            body=f"{emp} сотрудников — более чем 2× медиана отрасли "
                 f"({int(peer['emp_median'])}).",
            evidence={"employees": emp, "industry_median": int(peer["emp_median"])},
        ))

    # 4. Низкая цифровая представленность
    if scores.digital_maturity < 2:
        out.append(CompanyInsight(
            severity="warn",
            title="Низкая цифровая представленность",
            body="Нет сайта/email/соцсетей. Сложно вести digital-продажи и B2B-аутрич.",
            evidence={"digital_maturity": scores.digital_maturity},
        ))

    # 5. Зрелый игрок
    age = _business_age_years(company)
    if age is not None and age > 10 and company.status == "active":
        out.append(CompanyInsight(
            severity="info",
            title="Зрелый игрок",
            body=f"Работает {age:.0f} лет, статус active. Низкая операционная неопределённость.",
            evidence={"age_years": round(age, 1)},
        ))

    # 6. Малый бизнес
    if emp and emp < 10:
        out.append(CompanyInsight(
            severity="info",
            title="Малый бизнес",
            body=f"Микропредприятие ({emp} сотр.) — короткий цикл принятия решений, "
                 f"но ограниченная capacity.",
            evidence={"employees": emp, "bucket": "micro"},
        ))

    # 7. Риск устаревших данных
    if scores.freshness_days > 365:
        out.append(CompanyInsight(
            severity="danger",
            title="Риск: данные устарели",
            body=f"Профиль не обновлялся {scores.freshness_days} дн. "
                 f"Перед сделкой требуется верификация.",
            evidence={"freshness_days": scores.freshness_days},
        ))

    # Cap at 6, prioritise non-info.
    out.sort(key=lambda i: {"danger": 0, "warn": 1, "ok": 2, "info": 3}[i.severity])
    return out[:6]


# ────────────────────────────────────────────────────────────────────
# Trust-signal envelope (§11 PR #5)
# ────────────────────────────────────────────────────────────────────


# The "core schema" the redesign doc pins completeness to. 8 fields exactly.
_DATA_QUALITY_CORE_FIELDS: tuple[str, ...] = (
    "name", "bin", "industry_code", "registration_status",
    "address", "director_name", "phone", "website",
)

_RECENT_CHANGES_DAYS = 30


def _core_field_present(company: Company, field: str) -> bool:
    """Map an abstract core-schema field to the concrete Company column(s)."""
    if field == "name":
        return bool(company.name)
    if field == "bin":
        return bool(company.bin)
    if field == "industry_code":
        return bool(company.industry_code)
    if field == "registration_status":
        return bool(company.status)
    if field == "address":
        return company.address_id is not None or bool(getattr(company, "city_name", None))
    if field == "director_name":
        directors = getattr(company, "directors", None) or []
        return any((d or {}).get("name") for d in directors)
    if field == "phone":
        return bool(company.phone)
    if field == "website":
        return bool(company.website)
    return False


def _completeness_pct(company: Company) -> int:
    # Half-up rounding (math.floor(x + 0.5)) per the redesign-doc spec —
    # Python's built-in round() uses banker's rounding and would map 5/8 to 62.
    populated = sum(1 for f in _DATA_QUALITY_CORE_FIELDS if _core_field_present(company, f))
    pct = populated / len(_DATA_QUALITY_CORE_FIELDS) * 100
    return int(pct + 0.5)


async def _count_recent_changes(session: AsyncSession, company_id: UUID) -> int:
    """Count CDC rows in the trailing 30d window."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=_RECENT_CHANGES_DAYS)
    stmt = (
        select(func.count())
        .select_from(CompanyChange)
        .where(
            CompanyChange.company_id == company_id,
            CompanyChange.detected_at >= cutoff,
        )
    )
    return int((await session.execute(stmt)).scalar() or 0)


async def compute_data_quality(
    session: AsyncSession, company: Company,
) -> DataQuality:
    """Build the `data_quality` envelope for `/companies/{id}` and friends.

    Per §8 of `07-product-redesign.md`:
      - `confidence`: text band from `companies.confidence_band`.
      - `freshness_at`: `companies.data_freshness_at` (set by spiders/enrichers).
      - `completeness_pct`: non-null core fields / 8, rounded.
      - `recent_changes`: count of CDC rows in last 30d. **NULL** (not 0) when
        the CDC table has zero rows for this company AND no freshness has been
        recorded — front-end uses NULL as "hide the badge entirely".
    """
    confidence = getattr(company, "confidence_band", None) or "medium"
    freshness_at: datetime | None = getattr(company, "data_freshness_at", None)
    recent = await _count_recent_changes(session, company.id)

    # Hide the badge when we have zero evidence either way.
    recent_changes: int | None = recent
    if recent == 0 and freshness_at is None:
        recent_changes = None

    return DataQuality(
        confidence=confidence,  # type: ignore[arg-type]
        freshness_at=freshness_at,
        completeness_pct=_completeness_pct(company),
        recent_changes=recent_changes,
    )


# ────────────────────────────────────────────────────────────────────
# Orchestrator + cache
# ────────────────────────────────────────────────────────────────────


_CACHE_PREFIX = "company_insights:"
_CACHE_TTL_SECONDS = 3600


def _json_default(o: Any) -> Any:
    if isinstance(o, (datetime,)):
        return o.isoformat()
    if isinstance(o, Decimal):
        return float(o)
    raise TypeError(f"unsupported type for cache: {type(o)}")


async def get_insights_cached(
    session: AsyncSession,
    company: Company,
) -> tuple[CompanyScores, list[CompanyInsight], list[dict[str, Any]]]:
    """Return (scores, insights, related_tenders), reading-through Redis when available.

    Cache only the small derived payload (scores/insights/tenders), not the
    whole company object. Cache silently bypassed if Redis is unreachable.
    """
    cache_key = f"{_CACHE_PREFIX}{company.id}"
    try:
        from app.ai.cache import get_redis

        r = await get_redis()
        raw = await r.get(cache_key)
    except Exception:
        raw = None
        r = None

    if raw:
        try:
            payload = json.loads(raw)
            scores = CompanyScores.model_validate(payload["scores"])
            insights = [CompanyInsight.model_validate(i) for i in payload["insights"]]
            tenders = payload["related_tenders"]
            return scores, insights, tenders
        except Exception:
            pass  # Stale or malformed — recompute.

    related = await get_related_tenders(session, company.id, limit=10)
    peer = await get_peer_stats(session, company)
    scores = compute_scores(company, peer)
    insights = compute_company_insights(company, peer, scores, related)

    if r is not None:
        try:
            payload = {
                "scores": scores.model_dump(mode="json"),
                "insights": [i.model_dump(mode="json") for i in insights],
                "related_tenders": related,
            }
            await r.setex(
                cache_key,
                _CACHE_TTL_SECONDS,
                json.dumps(payload, default=_json_default, ensure_ascii=False),
            )
        except Exception:
            pass

    return scores, insights, related
