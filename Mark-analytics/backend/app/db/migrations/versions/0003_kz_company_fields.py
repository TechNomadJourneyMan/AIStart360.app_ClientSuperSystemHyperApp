"""Add KZ-specific company fields + ingest jobs table.

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-26
"""
from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # KZ-specific fields on companies — all nullable so we can fill incrementally.
    op.add_column("companies",
        sa.Column("kato_code", sa.String(16), nullable=True),
    )
    op.add_column("companies",
        sa.Column("oked_secondary", postgresql.ARRAY(sa.String(16)), nullable=True),
    )
    op.add_column("companies",
        sa.Column("founders", postgresql.JSONB(), nullable=True),
    )
    op.add_column("companies",
        sa.Column("directors", postgresql.JSONB(), nullable=True),
    )
    op.add_column("companies",
        sa.Column("share_capital_kzt", sa.Numeric(18, 2), nullable=True),
    )
    op.add_column("companies",
        sa.Column("government_share_pct", sa.Numeric(5, 2), nullable=True),
    )
    op.add_column("companies",
        sa.Column("size_category", sa.String(16), nullable=True),
    )
    op.add_column("companies",
        sa.Column("krp_code", sa.String(8), nullable=True),
    )
    op.add_column("companies",
        sa.Column("ownership_type_detail", sa.String(64), nullable=True),
    )
    op.add_column("companies",
        sa.Column("data_source", sa.String(64), nullable=True),
    )
    op.add_column("companies",
        sa.Column("source_confidence", sa.Numeric(3, 2), nullable=True),
    )

    op.create_index("ix_companies_kato_code", "companies", ["kato_code"])
    op.create_index("ix_companies_size_category", "companies", ["size_category"])
    op.create_index("ix_companies_krp_code", "companies", ["krp_code"])

    # Ingest jobs table — tracks crawl/enrichment runs for the admin dashboard
    op.create_table(
        "ingest_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),     # 'discovery' | 'crawl' | 'enrich'
        sa.Column("status", sa.String(16), nullable=False, server_default="running"),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("items_processed", sa.Integer(), server_default="0"),
        sa.Column("items_added", sa.Integer(), server_default="0"),
        sa.Column("items_updated", sa.Integer(), server_default="0"),
        sa.Column("items_failed", sa.Integer(), server_default="0"),
        sa.Column("error", sa.Text()),
        sa.Column("payload", postgresql.JSONB()),
    )
    op.create_index("ix_ingest_jobs_source_started", "ingest_jobs", ["source", "started_at"])
    op.create_index("ix_ingest_jobs_status", "ingest_jobs", ["status"])


def downgrade() -> None:
    op.drop_table("ingest_jobs")
    for c in ["data_source", "source_confidence", "ownership_type_detail", "krp_code",
              "size_category", "government_share_pct", "share_capital_kzt",
              "directors", "founders", "oked_secondary", "kato_code"]:
        op.drop_column("companies", c)
