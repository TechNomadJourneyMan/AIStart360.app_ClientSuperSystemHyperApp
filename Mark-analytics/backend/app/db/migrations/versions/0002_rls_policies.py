"""RLS policies for users + companies. Graceful if Supabase auth schema is absent (local dev).

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-24
"""
from __future__ import annotations

from typing import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # Detect whether Supabase `auth` schema exists. Local dev Postgres won't have it.
    op.execute("""
        DO $$
        DECLARE
            has_auth_schema BOOLEAN;
        BEGIN
            SELECT EXISTS (
                SELECT 1 FROM pg_namespace WHERE nspname = 'auth'
            ) INTO has_auth_schema;

            -- users: enable RLS unconditionally; policy depends on auth schema
            ALTER TABLE users ENABLE ROW LEVEL SECURITY;
            ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
            ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
            ALTER TABLE forecasts ENABLE ROW LEVEL SECURITY;
            ALTER TABLE user_uploads ENABLE ROW LEVEL SECURITY;
            ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

            IF has_auth_schema THEN
                -- Supabase env: user-bound policies
                EXECUTE 'CREATE POLICY users_own ON users FOR SELECT USING (auth.uid() = id)';
                EXECUTE 'CREATE POLICY users_own_update ON users FOR UPDATE USING (auth.uid() = id)';
                EXECUTE 'CREATE POLICY alert_rules_own ON alert_rules FOR ALL USING (auth.uid() = user_id)';
                EXECUTE 'CREATE POLICY alert_events_via_rule ON alert_events FOR SELECT USING (
                    rule_id IN (SELECT id FROM alert_rules WHERE user_id = auth.uid())
                )';
                EXECUTE 'CREATE POLICY forecasts_own ON forecasts FOR ALL USING (
                    auth.uid() = user_id OR is_public = true
                )';
                EXECUTE 'CREATE POLICY user_uploads_own ON user_uploads FOR ALL USING (auth.uid() = user_id)';
                -- Companies: public-read (Pro+ filtering enforced at API layer)
                EXECUTE 'CREATE POLICY companies_read_all ON companies FOR SELECT USING (true)';
            ELSE
                -- Local dev: permissive policies so app works without auth schema
                EXECUTE 'CREATE POLICY local_dev_all_users ON users FOR ALL USING (true) WITH CHECK (true)';
                EXECUTE 'CREATE POLICY local_dev_all_alert_rules ON alert_rules FOR ALL USING (true) WITH CHECK (true)';
                EXECUTE 'CREATE POLICY local_dev_all_alert_events ON alert_events FOR ALL USING (true) WITH CHECK (true)';
                EXECUTE 'CREATE POLICY local_dev_all_forecasts ON forecasts FOR ALL USING (true) WITH CHECK (true)';
                EXECUTE 'CREATE POLICY local_dev_all_uploads ON user_uploads FOR ALL USING (true) WITH CHECK (true)';
                EXECUTE 'CREATE POLICY local_dev_all_companies ON companies FOR ALL USING (true) WITH CHECK (true)';
                RAISE NOTICE 'No Supabase auth schema; using permissive RLS for local dev';
            END IF;
        END $$;
    """)


def downgrade() -> None:
    for table in [
        "users", "alert_rules", "alert_events", "forecasts",
        "user_uploads", "companies",
    ]:
        op.execute(f"DROP POLICY IF EXISTS users_own ON {table}")
        op.execute(f"DROP POLICY IF EXISTS users_own_update ON {table}")
        op.execute(f"DROP POLICY IF EXISTS local_dev_all_{table} ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
