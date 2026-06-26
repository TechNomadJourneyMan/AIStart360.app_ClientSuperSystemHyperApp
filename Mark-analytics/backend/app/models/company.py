"""Company entity + change history + field provenance."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ARRAY, Date, DateTime, Float, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

try:
    from pgvector.sqlalchemy import Vector  # type: ignore[import-untyped]
except ImportError:  # pgvector optional at import time; required at DB time
    Vector = None  # type: ignore[assignment, misc]

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.address import Address


class Company(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "companies"

    # Identity
    bin: Mapped[str | None] = mapped_column(String(12), unique=True, index=True)
    inn: Mapped[str | None] = mapped_column(String(12), index=True)
    ogrn: Mapped[str | None] = mapped_column(String(15), index=True)
    country: Mapped[str] = mapped_column(String(2), nullable=False, index=True)

    # Names
    name: Mapped[str] = mapped_column(Text, nullable=False)
    name_normalized: Mapped[str] = mapped_column(Text, nullable=False, index=True)

    # Legal / status
    legal_form: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str | None] = mapped_column(String(32), index=True)
    registered_at: Mapped[date | None] = mapped_column(Date)

    # Industry
    industry_code: Mapped[str | None] = mapped_column(String(16), index=True)
    industry_label: Mapped[str | None] = mapped_column(Text)

    # Scale
    employee_count: Mapped[int | None] = mapped_column()
    revenue_usd: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    capitalization_usd: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))

    # Contact
    website: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)

    # Address relation (string FK to break the cycle; addresses live in separate table)
    address_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("addresses.id", ondelete="SET NULL")
    )
    # PERF (Sprint 5.2): default lazy strategy avoids an outer JOIN on every
    # `select(Company)` — list endpoints don't read `.address`, so eager-loading
    # the addresses table per row added ~20% latency at scale. Callers that
    # need the address must opt in with `selectinload(Company.address)`.
    address: Mapped["Address | None"] = relationship(lazy="select")

    # Free text / tags / risk
    description: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String))
    confidence: Mapped[float | None] = mapped_column(Numeric(3, 2))
    risk_score: Mapped[float | None] = mapped_column(Numeric(5, 2))

    # Provenance / origin
    source_ids: Mapped[list[uuid.UUID] | None] = mapped_column(ARRAY(PG_UUID(as_uuid=True)))

    # Semantic embedding (BGE-M3 → 1024 dim)
    if Vector is not None:
        embedding: Mapped[list[float] | None] = mapped_column(Vector(1024))  # type: ignore[valid-type]

    # Flexible bucket for everything we haven't promoted to a column yet
    raw: Mapped[dict | None] = mapped_column(JSONB)

    # ─── KZ-specific (migration 0003) ───────────────────────────────
    kato_code: Mapped[str | None] = mapped_column(String(16))          # территориальный код
    oked_secondary: Mapped[list[str] | None] = mapped_column(ARRAY(String(16)))
    founders: Mapped[list[dict] | None] = mapped_column(JSONB)         # [{name, share_pct, since, country}]
    directors: Mapped[list[dict] | None] = mapped_column(JSONB)        # [{name, role, since}]
    share_capital_kzt: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    government_share_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    size_category: Mapped[str | None] = mapped_column(String(16))      # 'micro'|'small'|'medium'|'large'|'enterprise'
    krp_code: Mapped[str | None] = mapped_column(String(8))            # код размера предприятия КРП
    ownership_type_detail: Mapped[str | None] = mapped_column(String(64))  # 'state'|'private'|'foreign'|'mixed'|'samruk'
    data_source: Mapped[str | None] = mapped_column(String(64))        # 'stat.gov.kz' | 'seed' | 'kgd.gov.kz'
    source_confidence: Mapped[float | None] = mapped_column(Numeric(3, 2))

    # ─── Denormalized geo (migration 0004) ──────────────────────────
    # Mirrored from addresses for fast map rendering (no JOIN per viewport tile).
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    region_kato: Mapped[str | None] = mapped_column(String(20), nullable=True)  # region-level KATO (first 2 digits)
    region_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    city_name: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Liveness
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("companies.id", ondelete="SET NULL")
    )

    # ─── Enrichment provenance (migration 0009) ─────────────────────
    # Last successful pull-style enrichment from egov.kz. Used by the Arq
    # task to skip companies that were enriched recently (30d guard).
    enriched_at_egov: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # ─── Trust signals (migration 0012) ────────────────────────────
    # `data_freshness_at` is set by spiders / enrichers on every touch.
    # `confidence_band` is a coarse text band ('high'|'medium'|'low')
    # surfaced via the data_quality envelope; the numeric `confidence`
    # column above is kept for legacy score-driven UI.
    data_freshness_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    confidence_band: Mapped[str] = mapped_column(
        String(8), nullable=False, server_default="medium"
    )


class CompanyChange(Base, UUIDPrimaryKeyMixin):
    """CDC log of a single field change. Append-only."""

    __tablename__ = "companies_changes"

    company_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    field: Mapped[str] = mapped_column(String(64), nullable=False)
    old_value: Mapped[dict | None] = mapped_column(JSONB)
    new_value: Mapped[dict | None] = mapped_column(JSONB)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    source_page_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("pages.id", ondelete="SET NULL")
    )
    # Discriminator for how the change was detected (migration 0008).
    # Examples: 'spider', 'manual', 'enrichment', 'merge', 'unknown'.
    change_source: Mapped[str | None] = mapped_column(String(32))


class CompanyFieldProvenance(Base, UUIDPrimaryKeyMixin):
    """For every populated field, where did it come from?"""

    __tablename__ = "companies_field_provenance"

    company_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    field: Mapped[str] = mapped_column(String(64), nullable=False)
    value: Mapped[dict | None] = mapped_column(JSONB)
    source_page_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("pages.id", ondelete="SET NULL")
    )
    extracted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    extractor: Mapped[str] = mapped_column(String(64))  # 'rule:goszakup_v2', 'llm:gemini-2.5-flash', ...
    confidence: Mapped[float] = mapped_column(Numeric(3, 2))
