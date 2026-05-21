-- ============================================================
-- 023_metrics_update_policy.sql
-- Adds an UPDATE policy to public.metrics so that upserts coming
-- from authenticated users (via the resolver/materialize route)
-- can refresh the row on conflict. Without it, `INSERT … ON
-- CONFLICT DO UPDATE` fails with
--   "new row violates row-level security policy for table metrics"
-- because Postgres requires UPDATE privilege whenever the upsert
-- may resolve into an UPDATE branch.
--
-- Mirrors the existing `metrics_insert_own` / `metrics_select_own`
-- shape: user can write their company's rows; admins can write
-- anything.
-- Idempotent.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.metrics') IS NOT NULL THEN

    -- ── user SELECT: only their company's rows ───────────────
    DROP POLICY IF EXISTS "metrics_select_own" ON public.metrics;
    CREATE POLICY "metrics_select_own" ON public.metrics
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.companies
          WHERE id = metrics.company_id
            AND user_id = auth.uid()
        )
      );

    -- ── user INSERT: only their company's rows ───────────────
    DROP POLICY IF EXISTS "metrics_insert_own" ON public.metrics;
    CREATE POLICY "metrics_insert_own" ON public.metrics
      FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.companies
          WHERE id = metrics.company_id
            AND user_id = auth.uid()
        )
      );

    -- ── admin SELECT: any company ────────────────────────────
    DROP POLICY IF EXISTS "metrics_admin_select" ON public.metrics;
    CREATE POLICY "metrics_admin_select" ON public.metrics
      FOR SELECT
      USING (
        public.current_user_role() IN ('super_admin', 'admin', 'manager', 'analyst')
      );

    -- ── user UPDATE: only their company's rows ───────────────
    DROP POLICY IF EXISTS "metrics_update_own" ON public.metrics;
    CREATE POLICY "metrics_update_own" ON public.metrics
      FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM public.companies
          WHERE id = metrics.company_id
            AND user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.companies
          WHERE id = metrics.company_id
            AND user_id = auth.uid()
        )
      );

    -- ── admin UPDATE: any company ────────────────────────────
    DROP POLICY IF EXISTS "metrics_admin_update" ON public.metrics;
    CREATE POLICY "metrics_admin_update" ON public.metrics
      FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid()
            AND role IN ('super_admin', 'admin', 'manager', 'analyst')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid()
            AND role IN ('super_admin', 'admin', 'manager', 'analyst')
        )
      );

  END IF;
END $$;
