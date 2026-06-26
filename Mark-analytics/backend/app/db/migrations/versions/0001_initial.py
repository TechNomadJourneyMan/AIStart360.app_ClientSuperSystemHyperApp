"""initial schema — extensions, all tables, indexes.

Revision ID: 0001
Revises:
Create Date: 2026-05-24
"""
from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # ── Extensions ────────────────────────────────────────────
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("""
        DO $$
        BEGIN
            CREATE EXTENSION IF NOT EXISTS postgis;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'postgis extension unavailable — geo features degraded to text';
        END $$;
    """)

    # ── addresses ─────────────────────────────────────────────
    op.create_table(
        "addresses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.Column("normalized", sa.Text()),
        sa.Column("country", sa.String(2)),
        sa.Column("region", sa.Text()),
        sa.Column("city", sa.Text()),
        sa.Column("street", sa.Text()),
        sa.Column("house", sa.Text()),
        sa.Column("postal_code", sa.String(16)),
        sa.UniqueConstraint("country", "normalized", name="uq_addresses_country_normalized"),
    )
    op.create_index("ix_addresses_country", "addresses", ["country"])
    op.create_index("ix_addresses_region", "addresses", ["region"])
    op.create_index("ix_addresses_city", "addresses", ["city"])
    op.create_index("ix_addresses_normalized", "addresses", ["normalized"])

    # Add geo column via raw SQL (PostGIS optional)
    op.execute("""
        DO $$
        BEGIN
            ALTER TABLE addresses ADD COLUMN IF NOT EXISTS geo geography(POINT, 4326);
            CREATE INDEX IF NOT EXISTS ix_addresses_geo ON addresses USING gist (geo);
        EXCEPTION WHEN undefined_object THEN
            ALTER TABLE addresses ADD COLUMN IF NOT EXISTS geo TEXT;
        END $$;
    """)

    # ── sources ───────────────────────────────────────────────
    op.create_table(
        "sources",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("base_url", sa.Text(), nullable=False),
        sa.Column("rate_limit_rpm", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("refresh_min_hours", sa.Integer(), nullable=False, server_default="168"),
        sa.Column("refresh_max_hours", sa.Integer(), nullable=False, server_default="720"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )

    # ── pages ─────────────────────────────────────────────────
    op.create_table(
        "pages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("url_hash", sa.String(64), nullable=False),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("http_status", sa.Integer()),
        sa.Column("content_type", sa.Text()),
        sa.Column("fetched_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.Column("html_r2_key", sa.Text()),
        sa.Column("screenshot_r2_key", sa.Text()),
        sa.Column("extraction_status", sa.String(16), server_default="pending"),
        sa.Column("extracted_entities", postgresql.ARRAY(postgresql.UUID(as_uuid=True))),
        sa.UniqueConstraint("url_hash", "fetched_at", name="uq_pages_urlhash_fetched"),
    )
    op.create_index("ix_pages_url_hash", "pages", ["url_hash"])
    op.create_index("ix_pages_source", "pages", ["source"])
    op.create_index("ix_pages_source_fetched", "pages", ["source", "fetched_at"])
    op.create_index("ix_pages_extraction_status", "pages", ["extraction_status"])

    # ── companies ─────────────────────────────────────────────
    op.create_table(
        "companies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("bin", sa.String(12), unique=True),
        sa.Column("inn", sa.String(12)),
        sa.Column("ogrn", sa.String(15)),
        sa.Column("country", sa.String(2), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("name_normalized", sa.Text(), nullable=False),
        sa.Column("legal_form", sa.String(32)),
        sa.Column("status", sa.String(32)),
        sa.Column("registered_at", sa.Date()),
        sa.Column("industry_code", sa.String(16)),
        sa.Column("industry_label", sa.Text()),
        sa.Column("employee_count", sa.Integer()),
        sa.Column("revenue_usd", sa.Numeric(18, 2)),
        sa.Column("capitalization_usd", sa.Numeric(18, 2)),
        sa.Column("website", sa.Text()),
        sa.Column("email", sa.Text()),
        sa.Column("phone", sa.Text()),
        sa.Column("address_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("addresses.id", ondelete="SET NULL")),
        sa.Column("description", sa.Text()),
        sa.Column("tags", postgresql.ARRAY(sa.String())),
        sa.Column("confidence", sa.Numeric(3, 2)),
        sa.Column("risk_score", sa.Numeric(5, 2)),
        sa.Column("source_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=True))),
        sa.Column("raw", postgresql.JSONB()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.Column("merged_into_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("companies.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
    )
    op.execute("ALTER TABLE companies ADD COLUMN embedding vector(1024)")
    op.create_index("ix_companies_country", "companies", ["country"])
    op.create_index("ix_companies_status", "companies", ["status"])
    op.create_index("ix_companies_industry_code", "companies", ["industry_code"])
    op.create_index("ix_companies_name_normalized", "companies", ["name_normalized"])
    op.create_index("ix_companies_inn", "companies", ["inn"])
    op.create_index("ix_companies_ogrn", "companies", ["ogrn"])
    op.execute("CREATE INDEX ix_companies_name_trgm ON companies USING gin (name_normalized gin_trgm_ops)")
    op.execute("CREATE INDEX ix_companies_tags ON companies USING gin (tags)")
    op.execute("CREATE INDEX ix_companies_raw_jsonb ON companies USING gin (raw jsonb_path_ops)")
    op.execute("CREATE INDEX ix_companies_embedding_hnsw ON companies USING hnsw (embedding vector_cosine_ops)")

    # ── companies_changes ─────────────────────────────────────
    op.create_table(
        "companies_changes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("field", sa.String(64), nullable=False),
        sa.Column("old_value", postgresql.JSONB()),
        sa.Column("new_value", postgresql.JSONB()),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("source_page_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("pages.id", ondelete="SET NULL")),
    )
    op.create_index("ix_companies_changes_company", "companies_changes",
                     ["company_id", "detected_at"])

    # ── companies_field_provenance ────────────────────────────
    op.create_table(
        "companies_field_provenance",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("field", sa.String(64), nullable=False),
        sa.Column("value", postgresql.JSONB()),
        sa.Column("source_page_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("pages.id", ondelete="SET NULL")),
        sa.Column("extracted_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("extractor", sa.String(64), nullable=False),
        sa.Column("confidence", sa.Numeric(3, 2)),
    )
    op.create_index("ix_companies_provenance_company", "companies_field_provenance",
                     ["company_id", "field"])

    # ── persons ───────────────────────────────────────────────
    op.create_table(
        "persons",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("iin", sa.String(12)),
        sa.Column("full_name", sa.Text(), nullable=False),
        sa.Column("name_normalized", sa.Text(), nullable=False),
        sa.Column("country", sa.String(2)),
        sa.Column("role_history", postgresql.JSONB()),
        sa.Column("contacts", postgresql.JSONB()),
        sa.Column("sanctions", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("raw", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
    )
    op.execute("ALTER TABLE persons ADD COLUMN embedding vector(1024)")
    op.create_index("ix_persons_iin", "persons", ["iin"])
    op.create_index("ix_persons_name_normalized", "persons", ["name_normalized"])
    op.create_index("ix_persons_country", "persons", ["country"])
    op.create_index("ix_persons_sanctions", "persons", ["sanctions"])
    op.execute("CREATE INDEX ix_persons_name_trgm ON persons USING gin (name_normalized gin_trgm_ops)")

    # ── tenders ───────────────────────────────────────────────
    op.create_table(
        "tenders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("external_id", sa.Text(), nullable=False),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("companies.id", ondelete="SET NULL")),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("amount_usd", sa.Numeric(18, 2)),
        sa.Column("currency", sa.String(3)),
        sa.Column("status", sa.String(32)),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("deadline_at", sa.DateTime(timezone=True)),
        sa.Column("awarded_to_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("companies.id", ondelete="SET NULL")),
        sa.Column("raw", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.UniqueConstraint("source", "external_id", name="uq_tenders_source_external_id"),
    )
    op.execute("ALTER TABLE tenders ADD COLUMN embedding vector(1024)")
    op.create_index("ix_tenders_source", "tenders", ["source"])
    op.create_index("ix_tenders_status", "tenders", ["status"])
    op.create_index("ix_tenders_published", "tenders", ["published_at"])
    op.create_index("ix_tenders_customer", "tenders", ["customer_id"])
    op.create_index("ix_tenders_awarded", "tenders", ["awarded_to_id"])

    # ── users (Supabase extension) ────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),  # = supabase auth.users.id
        sa.Column("email", postgresql.CITEXT(), nullable=False, unique=True),
        sa.Column("plan", sa.String(16), server_default="free"),
        sa.Column("org_id", postgresql.UUID(as_uuid=True)),
        sa.Column("role", sa.String(16), server_default="user"),
        sa.Column("requests_used", sa.Integer(), server_default="0"),
        sa.Column("requests_limit", sa.Integer(), server_default="1000"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
    )
    op.create_index("ix_users_plan", "users", ["plan"])
    op.create_index("ix_users_org_id", "users", ["org_id"])

    # ── alert_rules + alert_events ────────────────────────────
    op.create_table(
        "alert_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("filter", postgresql.JSONB(), nullable=False),
        sa.Column("channels", postgresql.JSONB(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
    )
    op.create_index("ix_alert_rules_user_id", "alert_rules", ["user_id"])

    op.create_table(
        "alert_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("rule_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("aggregate_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("fired_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("delivered_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_alert_events_rule", "alert_events", ["rule_id", "fired_at"])

    # ── ai_call_log ───────────────────────────────────────────
    op.create_table(
        "ai_call_log",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("request_id", postgresql.UUID(as_uuid=True)),
        sa.Column("agent", sa.String(64)),
        sa.Column("task", sa.String(64), nullable=False),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("tokens_in", sa.Integer(), server_default="0"),
        sa.Column("tokens_out", sa.Integer(), server_default="0"),
        sa.Column("cost_usd", sa.Numeric(10, 6), server_default="0"),
        sa.Column("latency_ms", sa.Integer(), server_default="0"),
        sa.Column("cache_hit", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("cache_type", sa.String(16)),
        sa.Column("error", sa.String(512)),
        sa.Column("prompt_version", sa.String(32)),
        sa.Column("request_fingerprint", sa.String(64)),
    )
    op.create_index("ix_ai_call_log_created", "ai_call_log", ["created_at"])
    op.create_index("ix_ai_call_log_task_time", "ai_call_log", ["task", "created_at"])
    op.create_index("ix_ai_call_log_agent_time", "ai_call_log", ["agent", "created_at"])

    # ── domain_events (outbox) ────────────────────────────────
    op.create_table(
        "domain_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("aggregate_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("published_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_domain_events_aggregate", "domain_events", ["aggregate_id"])
    op.create_index("ix_domain_events_type", "domain_events", ["event_type"])
    op.execute("CREATE INDEX ix_domain_events_unpublished ON domain_events(occurred_at) WHERE published_at IS NULL")

    # ── processed_events ──────────────────────────────────────
    op.create_table(
        "processed_events",
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agent_name", sa.String(64), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("event_id", "agent_name", name="pk_processed_events"),
    )

    # ── sanctions_list ────────────────────────────────────────
    op.create_table(
        "sanctions_list",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("list_name", sa.String(64), nullable=False),
        sa.Column("full_name", sa.Text(), nullable=False),
        sa.Column("aliases", postgresql.ARRAY(sa.String())),
        sa.Column("dob", sa.Date()),
        sa.Column("country", sa.String(2)),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("raw", postgresql.JSONB()),
    )
    op.create_index("ix_sanctions_list_name", "sanctions_list", ["list_name"])
    op.create_index("ix_sanctions_full_name", "sanctions_list", ["full_name"])

    # ── audit_log ─────────────────────────────────────────────
    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("user_id", postgresql.UUID(as_uuid=True)),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("target_type", sa.String(32)),
        sa.Column("target_id", postgresql.UUID(as_uuid=True)),
        sa.Column("ip", sa.String(64)),
        sa.Column("user_agent", sa.Text()),
        sa.Column("payload", postgresql.JSONB()),
    )
    op.create_index("ix_audit_log_created", "audit_log", ["created_at"])
    op.create_index("ix_audit_log_user", "audit_log", ["user_id"])
    op.create_index("ix_audit_log_action", "audit_log", ["action"])

    # ── forecasts (user-saved) ────────────────────────────────
    op.create_table(
        "forecasts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(64), nullable=False),
        sa.Column("title", sa.Text()),
        sa.Column("inputs", postgresql.JSONB(), nullable=False),
        sa.Column("output", postgresql.JSONB(), nullable=False),
        sa.Column("assumptions", postgresql.JSONB()),
        sa.Column("ai_explanation", sa.Text()),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("forecasts.id", ondelete="SET NULL")),
        sa.Column("is_public", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("share_token", sa.String(64), unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_forecasts_user_type", "forecasts", ["user_id", "type", "created_at"])

    # ── user_uploads ──────────────────────────────────────────
    op.create_table(
        "user_uploads",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("content_type", sa.String(128)),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("sha256", sa.String(64)),
        sa.Column("status", sa.String(32), server_default="analyzing"),
        sa.Column("visibility", sa.String(16), server_default="private"),
        sa.Column("mapping_proposal", postgresql.JSONB()),
        sa.Column("extracted_rows", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_user_uploads_user", "user_uploads", ["user_id"])
    op.create_index("ix_user_uploads_status", "user_uploads", ["status"])


def downgrade() -> None:
    # Drop in reverse order for FK safety
    for tbl in [
        "user_uploads", "forecasts", "audit_log", "sanctions_list",
        "processed_events", "domain_events", "ai_call_log",
        "alert_events", "alert_rules", "users",
        "tenders", "persons",
        "companies_field_provenance", "companies_changes", "companies",
        "pages", "sources", "addresses",
    ]:
        op.execute(f"DROP TABLE IF EXISTS {tbl} CASCADE")
