-- 097_diagnostics_fixes.sql
--
-- 1. Metric values materialised from sources that were never the metric.
--
--    Before 2026-10 the source lists in lib/metrics/descriptions.ts let the
--    resolver fill these metrics from an INPUT of their formula instead of the
--    metric itself. A company that had not answered the real question got a
--    public.metrics row such as «CAC = весь маркетинговый бюджет» with
--    source='survey', confidence ~0.9, and it stayed the latest value after the
--    sources were removed (materialisation only upserts). These rows are
--    deleted here, exactly the (metric_key, picked survey key) pairs removed
--    from the declarations (computed by diffing the registry of c0acee0 with
--    the current one):
--
--      metric_key                              provenance.picked.key
--      biz.marketing.cac                       s9n_expense_marketing
--      goal.01.stoimost_privlecheniya_cac      s9n_expense_marketing
--      goal.01.stoimost_privlecheniya_cac      s5_marketing_budget_pct
--      goal.09.cac                             s9n_expense_marketing
--      goal.09.cac                             s5_marketing_budget_pct
--      goal.09.cac                             s2_new_clients_2024
--      goal.03.sredniy_chek                    s9n_revenue_2024
--
--    A row is deleted only when provenance.picked.type = 'survey' AND its key
--    is in that list for that metric. Rows of the same metric from any other
--    source (s2_cac, the step-8 metrics table, documents, CRM, manual) and rows
--    without resolver provenance are not touched. The same points are removed
--    from metric_value_history: they are the same wrong value, and trends /
--    forecasts / anomalies are computed from that table.
--    Going forward the materialiser deletes such rows itself
--    (lib/metrics/materialize.ts, pruneStaleMetricRows).
--
-- 2. At most one current diagnostic per user.
--
--    POST /api/v1/diagnostics/recalculate retired the previous current row with
--    the session client; `diagnostics` has no UPDATE policy for API roles, so
--    the UPDATE matched 0 rows and every recalculation added another
--    is_current=true row (reads with .single()/.maybeSingle() then failed). The
--    route now writes with the service role after authorising the caller.
--    Existing duplicates are collapsed to the newest row per user
--    (calculated_at, then version, then id), and a partial unique index makes
--    a second current row fail loudly instead of corrupting reads.
--
-- 3. point_a_insights: provenance columns are not client-writable.
--
--    insert_own / update_own (with full column grants) let a client write, via
--    PostgREST, a question «from an expert / ИИ» (type), an answer «from an
--    expert» (answer_author_role / answer_author_name), moderation columns and
--    another company's id. A BEFORE INSERT/UPDATE trigger now limits
--    authenticated / anon callers that are not platform staff to their own
--    question: on INSERT type must be 'client', no author label, no answer, no
--    moderation fields, status 'pending_ai' / 'awaiting_answer', company_id
--    NULL or a company they can manage; on UPDATE user_id, company_id, type,
--    author_name, source_meta and the moderation columns are frozen, and a
--    changed answer is always attributed to the caller (role 'client', name
--    from their profile). The service role, migrations, the server's direct
--    connection and platform staff are unaffected (same rule as 089 / 096).
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/097_diagnostics_fixes.sql

-- ─── 1. Wrongly-sourced metric values ───────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.removed_metric_sources_097()
RETURNS TABLE (metric_key TEXT, source_key TEXT) LANGUAGE sql IMMUTABLE AS $$
  VALUES
    ('biz.marketing.cac',                  's9n_expense_marketing'),
    ('goal.01.stoimost_privlecheniya_cac', 's9n_expense_marketing'),
    ('goal.01.stoimost_privlecheniya_cac', 's5_marketing_budget_pct'),
    ('goal.09.cac',                        's9n_expense_marketing'),
    ('goal.09.cac',                        's5_marketing_budget_pct'),
    ('goal.09.cac',                        's2_new_clients_2024'),
    ('goal.03.sredniy_chek',               's9n_revenue_2024')
$$;

DELETE FROM public.metrics m
USING pg_temp.removed_metric_sources_097() r
WHERE m.metric_key = r.metric_key
  AND m.provenance -> 'picked' ->> 'type' = 'survey'
  AND m.provenance -> 'picked' ->> 'key' = r.source_key;

DO $$
BEGIN
  IF to_regclass('public.metric_value_history') IS NOT NULL THEN
    DELETE FROM public.metric_value_history h
    USING pg_temp.removed_metric_sources_097() r
    WHERE h.metric_key = r.metric_key
      AND h.provenance -> 'picked' ->> 'type' = 'survey'
      AND h.provenance -> 'picked' ->> 'key' = r.source_key;
  END IF;
END $$;

-- ─── 2. One current diagnostic per user ─────────────────────────────────────
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY user_id
                            ORDER BY calculated_at DESC NULLS LAST, version DESC NULLS LAST, id DESC) AS rn
  FROM public.diagnostics
  WHERE is_current
)
UPDATE public.diagnostics d
SET is_current = FALSE
FROM ranked
WHERE d.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS diagnostics_one_current_per_user_uidx
  ON public.diagnostics (user_id)
  WHERE is_current;

-- ─── 3. point_a_insights provenance guard ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.point_a_insights_guard_client_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.is_platform_staff() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.type IS DISTINCT FROM 'client'
       OR NEW.author_name IS NOT NULL
       OR NEW.answer_text IS NOT NULL OR NEW.answer_author_name IS NOT NULL
       OR NEW.answer_author_role IS NOT NULL OR NEW.answered_at IS NOT NULL
       OR NEW.source_meta IS NOT NULL
       OR NEW.published_at IS NOT NULL OR NEW.published_by IS NOT NULL
       OR NEW.status NOT IN ('pending_ai', 'awaiting_answer') THEN
      RAISE EXCEPTION 'point_a_insights: a client may only create its own open question'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- coalesce: can_manage_company() yields NULL (not false) for a company the
    -- caller has no role in, and NOT NULL would let the row through.
    IF NEW.company_id IS NOT NULL AND NOT coalesce(public.can_manage_company(NEW.company_id::text), false) THEN
      RAISE EXCEPTION 'point_a_insights: no write access to this company'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.author_name IS DISTINCT FROM OLD.author_name
     OR NEW.source_meta IS DISTINCT FROM OLD.source_meta
     OR NEW.visible_to_user IS DISTINCT FROM OLD.visible_to_user
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.published_by IS DISTINCT FROM OLD.published_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'point_a_insights: these fields are not editable by the client'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.answer_text IS DISTINCT FROM OLD.answer_text THEN
    IF NEW.answer_text IS NULL THEN
      NEW.answer_author_role := NULL;
      NEW.answer_author_name := NULL;
    ELSE
      NEW.answer_author_role := 'client';
      NEW.answer_author_name := (SELECT p.full_name FROM public.profiles p WHERE p.id = auth.uid());
    END IF;
  ELSIF NEW.answer_author_role IS DISTINCT FROM OLD.answer_author_role
        OR NEW.answer_author_name IS DISTINCT FROM OLD.answer_author_name THEN
    RAISE EXCEPTION 'point_a_insights: the answer author is set by the server'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.point_a_insights_guard_client_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS point_a_insights_guard_client_write ON public.point_a_insights;
CREATE TRIGGER point_a_insights_guard_client_write
  BEFORE INSERT OR UPDATE ON public.point_a_insights
  FOR EACH ROW EXECUTE FUNCTION public.point_a_insights_guard_client_write();

NOTIFY pgrst, 'reload schema';
