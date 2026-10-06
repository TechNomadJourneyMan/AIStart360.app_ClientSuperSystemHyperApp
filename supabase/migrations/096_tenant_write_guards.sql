-- 096_tenant_write_guards.sql
--
-- Closes the write-side gaps of the 084 tenancy model and the follow-ups of
-- the 083/089 guards (security review A1). Everything here is additive and
-- idempotent; no row is deleted or rewritten.
--
--   1. diagnostics / gri_assessments / survey_answers: an API caller
--      (authenticated / anon) may only stamp a company_id it can MANAGE
--      (can_manage_company, 084), and may never move a row to another user.
--      The old INSERT/UPDATE policies checked only user_id = auth.uid(), so any
--      client could inject rows into another tenant's Point A (084 made those
--      rows visible to the victim through *_tenant_select). Same pattern as
--      the documents guard of 089. Trusted writers are unchanged: the service
--      role, migrations and the server's direct (Prisma) connection carry no
--      authenticated/anon JWT role, and platform staff are exempt as in 089.
--   2. documents (089 guard): on INSERT an API caller may only set file_url to
--      a path inside its own storage folder ("<auth.uid()>/…", no dot
--      segments). The legacy medical routes fetch file_url with the service
--      key, so a foreign path was a cross-tenant read.
--   3. is_platform_staff(): a staff_roles row counts as platform staff only
--      for roles whose GIGA RBAC matrix (lib/admin/rbac.ts) holds
--      'users.sensitive' — super_admin, admin, super_expert, crm_manager,
--      support. content_manager (CMS only) and analyst ("aggregates, no
--      personal contacts, answers or documents") no longer read every
--      tenant's rows through RLS; they keep their GIGA screens, which read via
--      the service role after requireGiga(). Legacy profiles.role staff
--      (super_admin/admin/manager/analyst/expert) is unchanged.
--   4. agent_tasks / agent_runs / agent_events: tenants keep row access
--      (086 policies) but only to whitelisted columns — status, timing, cost,
--      error codes. Raw error text, inputs, summaries, prompts' metadata and
--      lease tokens are no longer selectable by anon/authenticated. Staff read
--      these tables through the admin API (Prisma / service role) as before.
--   5. profiles guard (083): every telegram_* identity column may only be
--      cleared (unlink) by the user; binding is done by the bot / server with
--      the service role. telegram_user_id was user-editable and the bot
--      resolves users by it.
--   6. point_b_versions_owner_read: the owner sees approved versions only.
--   7. search_path pinned on the four remaining trigger functions, and every
--      public/storage policy calling auth.uid()/auth.role()/auth.jwt() per row
--      is rewritten to the initplan form (SELECT auth.uid()) — same semantics,
--      evaluated once per statement (Supabase advisor: auth_rls_initplan).
--
-- Apply: node scripts/apply-migration.js supabase/migrations/096_tenant_write_guards.sql

-- ─── 3. is_platform_staff: staff_roles only with users.sensitive ────────────
-- Keep in sync with ROLE_PERMISSIONS[...].has('users.sensitive') in lib/admin/rbac.ts.
CREATE OR REPLACE FUNCTION public.is_platform_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.status = 'approved'
      AND (
        p.role IN ('super_admin', 'admin', 'manager', 'analyst', 'expert')
        OR EXISTS (
          SELECT 1 FROM public.staff_roles s
          WHERE s.user_id = p.id
            AND s.role IN ('super_admin', 'admin', 'super_expert', 'crm_manager', 'support')
        )
      )
  )
$$;
REVOKE EXECUTE ON FUNCTION public.is_platform_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_staff() TO anon, authenticated, service_role;

-- ─── 1. Company-scoped client writes ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_tenant_company_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- The service role, migrations and the server's direct connection (Prisma,
  -- no JWT) are trusted; so is platform staff (same rule as 089).
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.is_platform_staff() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION '%: user_id is not editable', TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Bookkeeping on the caller's own older rows stays possible whatever their
    -- company: set_gri_assessment_current() retires previous assessments as
    -- the invoker when a new one is inserted, also for an ex-owner whose old
    -- rows still carry the former company.
    IF NEW.company_id IS NOT DISTINCT FROM OLD.company_id
       AND (to_jsonb(NEW) - ARRAY['is_current', 'updated_at']) = (to_jsonb(OLD) - ARRAY['is_current', 'updated_at']) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- NULL (no company) is always allowed: the row then stays private to its
  -- user. A company is accepted only when the caller may manage it right now,
  -- so a removed member or a read-only viewer/partner expert cannot keep or
  -- start writing into it. can_manage_company() yields NULL (not FALSE) for a
  -- stranger — NULL OR FALSE — hence IS NOT TRUE.
  IF NEW.company_id IS NOT NULL AND public.can_manage_company(NEW.company_id::text) IS NOT TRUE THEN
    RAISE EXCEPTION '%: no write access to this company', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_tenant_company_write() FROM PUBLIC, anon, authenticated;

-- Trigger names sort before the existing BEFORE triggers of these tables
-- (diagnostics_versioning, …) only for readability; a RAISE aborts the whole
-- statement either way.
DROP TRIGGER IF EXISTS diagnostics_guard_tenant_write ON public.diagnostics;
CREATE TRIGGER diagnostics_guard_tenant_write
  BEFORE INSERT OR UPDATE ON public.diagnostics
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_company_write();

DROP TRIGGER IF EXISTS gri_assessments_guard_tenant_write ON public.gri_assessments;
CREATE TRIGGER gri_assessments_guard_tenant_write
  BEFORE INSERT OR UPDATE ON public.gri_assessments
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_company_write();

DROP TRIGGER IF EXISTS survey_answers_guard_tenant_write ON public.survey_answers;
CREATE TRIGGER survey_answers_guard_tenant_write
  BEFORE INSERT OR UPDATE ON public.survey_answers
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_company_write();

-- ─── 2. documents guard: file_url on INSERT ─────────────────────────────────
-- Body of 089 unchanged except the file_url rule in the INSERT branch.
CREATE OR REPLACE FUNCTION public.documents_guard_pipeline_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- The service role, migrations and the server's direct connection (Prisma,
  -- no JWT) are trusted; so is platform staff.
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.is_platform_staff() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.parsed_data IS NOT NULL
    OR NEW.parse_status IS DISTINCT FROM 'queued'
    OR NEW.parse_error IS NOT NULL
    OR NEW.security_status IS DISTINCT FROM 'pending'
    OR NEW.security_reason IS NOT NULL
    OR NEW.sha256 IS NOT NULL
    OR NEW.sniffed_mime IS NOT NULL
    OR coalesce(NEW.processing_stage, 'uploaded') <> 'uploaded'
    OR NEW.attempts <> 0
    OR NEW.processed_at IS NOT NULL
    OR NEW.extraction_version IS NOT NULL
    OR NEW.last_error_code IS NOT NULL
    OR NEW.processing_task_id IS NOT NULL
    OR NEW.storage_bucket IS NOT NULL
    OR NEW.storage_path IS NOT NULL
    OR NEW.size_bytes IS NOT NULL THEN
      RAISE EXCEPTION 'documents: pipeline columns are set by the server only'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- file_url is read by legacy routes with the service key: it must point
    -- into the caller's own folder, without dot segments (also %2e-encoded),
    -- backslashes, query or fragment that could escape it.
    IF NEW.file_url IS NOT NULL AND (
         auth.uid() IS NULL
      OR left(NEW.file_url, length(auth.uid()::text) + 1) <> auth.uid()::text || '/'
      OR NEW.file_url ~* '(\.\.|%2e|\\|\?|#|//)'
    ) THEN
      RAISE EXCEPTION 'documents: file_url must be inside the caller''s own folder'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.company_id IS NOT NULL AND public.can_read_company(NEW.company_id::text) IS NOT TRUE THEN
      RAISE EXCEPTION 'documents: no access to this company'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.parsed_data        IS DISTINCT FROM OLD.parsed_data
  OR NEW.parse_status       IS DISTINCT FROM OLD.parse_status
  OR NEW.parse_error        IS DISTINCT FROM OLD.parse_error
  OR NEW.security_status    IS DISTINCT FROM OLD.security_status
  OR NEW.security_reason    IS DISTINCT FROM OLD.security_reason
  OR NEW.sha256             IS DISTINCT FROM OLD.sha256
  OR NEW.sniffed_mime       IS DISTINCT FROM OLD.sniffed_mime
  OR NEW.processing_stage   IS DISTINCT FROM OLD.processing_stage
  OR NEW.attempts           IS DISTINCT FROM OLD.attempts
  OR NEW.processed_at       IS DISTINCT FROM OLD.processed_at
  OR NEW.extraction_version IS DISTINCT FROM OLD.extraction_version
  OR NEW.last_error_code    IS DISTINCT FROM OLD.last_error_code
  OR NEW.processing_task_id IS DISTINCT FROM OLD.processing_task_id
  OR NEW.storage_bucket     IS DISTINCT FROM OLD.storage_bucket
  OR NEW.storage_path       IS DISTINCT FROM OLD.storage_path
  OR NEW.size_bytes         IS DISTINCT FROM OLD.size_bytes
  OR NEW.file_url           IS DISTINCT FROM OLD.file_url
  OR NEW.company_id         IS DISTINCT FROM OLD.company_id
  OR NEW.user_id            IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'documents: column is not editable by the owner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 4. agent_*: tenants see status / timing / cost, never raw text ────────
-- REVOKE of a table privilege also drops its column grants, so re-running
-- this block converges to exactly the lists below.
REVOKE SELECT ON public.agent_tasks, public.agent_runs, public.agent_events FROM anon, authenticated;

GRANT SELECT (
  id, agent_key, company_id, session_id, parent_task_id, trigger, status, priority,
  attempts, max_attempts, run_after, last_error_code, started_at, finished_at, created_at, updated_at
) ON public.agent_tasks TO authenticated;

GRANT SELECT (
  id, task_id, agent_key, agent_version, company_id, attempt, status, tier,
  llm_calls, tokens_in, tokens_out, cost_usd, error_code, started_at, finished_at, duration_ms
) ON public.agent_runs TO authenticated;

GRANT SELECT (
  id, task_id, run_id, agent_key, company_id, level, type, created_at
) ON public.agent_events TO authenticated;

-- ─── 5. profiles guard: Telegram identity is bound by the server only ──────
CREATE OR REPLACE FUNCTION public.profiles_guard_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- The service role, migrations (postgres) and platform admins are trusted.
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.current_user_role() IN ('super_admin', 'admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.role          IS DISTINCT FROM OLD.role
  OR NEW.status        IS DISTINCT FROM OLD.status
  OR NEW.tier          IS DISTINCT FROM OLD.tier
  OR NEW.feature_flags IS DISTINCT FROM OLD.feature_flags
  OR NEW.approved_at   IS DISTINCT FROM OLD.approved_at
  OR NEW.approved_by   IS DISTINCT FROM OLD.approved_by THEN
    RAISE EXCEPTION 'profiles: column is not self-editable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A user may unlink Telegram (set any of these to NULL), but only the bot
  -- webhook / link flow (service role) binds.
  IF (NEW.telegram_chat_id               IS NOT NULL AND NEW.telegram_chat_id               IS DISTINCT FROM OLD.telegram_chat_id)
  OR (NEW.telegram_user_id               IS NOT NULL AND NEW.telegram_user_id               IS DISTINCT FROM OLD.telegram_user_id)
  OR (NEW.telegram_username              IS NOT NULL AND NEW.telegram_username              IS DISTINCT FROM OLD.telegram_username)
  OR (NEW.telegram_linked_at             IS NOT NULL AND NEW.telegram_linked_at             IS DISTINCT FROM OLD.telegram_linked_at)
  OR (NEW.telegram_link_token_hash       IS NOT NULL AND NEW.telegram_link_token_hash       IS DISTINCT FROM OLD.telegram_link_token_hash)
  OR (NEW.telegram_link_token_expires_at IS NOT NULL AND NEW.telegram_link_token_expires_at IS DISTINCT FROM OLD.telegram_link_token_expires_at)
  OR (NEW.telegram_link_code             IS NOT NULL AND NEW.telegram_link_code             IS DISTINCT FROM OLD.telegram_link_code) THEN
    RAISE EXCEPTION 'profiles: telegram binding is set by the bot only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

-- ─── 6. point_b_versions: owners read approved versions only ────────────────
DROP POLICY IF EXISTS point_b_versions_owner_read ON public.point_b_versions;
CREATE POLICY point_b_versions_owner_read ON public.point_b_versions
  FOR SELECT TO authenticated
  USING (
    is_approved
    AND EXISTS (
      SELECT 1 FROM public.diagnostics d
      WHERE d.id = point_b_versions.diagnostic_id AND d.user_id = (SELECT auth.uid())
    )
  );

-- ─── 7a. search_path of the remaining trigger functions ─────────────────────
DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.admin_audit_log_immutable()', 'public.set_diagnostic_version()',
    'public.set_gri_assessment_current()', 'public.touch_expert_comment_updated_at()'
  ] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f);
    END IF;
  END LOOP;
END $$;

-- ─── 7b. auth.*() in policies → initplan form ───────────────────────────────
-- pg_policies deparses an already wrapped call as "( SELECT auth.uid() AS uid)",
-- so the negative look-behind skips it and a re-run finds nothing to do. The
-- expression is re-parsed in the same session (same search_path) it was
-- deparsed in. Policies we may not alter (storage.* owned by the storage admin
-- on hosted Supabase) are reported and left as they are.
--
-- Exception — tables on a policy reference cycle (today only profiles:
-- profiles_update_own reads profiles in a sub-select). Postgres raises
-- "infinite recursion detected in policy" as soon as the SELECT policies of a
-- table already being expanded contain any sub-select, and the initplan form
-- IS a sub-select. Their SELECT/ALL policies therefore keep the plain call.
DO $$
DECLARE
  r       RECORD;
  pat     CONSTANT TEXT := '(?<!SELECT )auth\.(uid|role|jwt)\(\)';
  rep     CONSTANT TEXT := '(SELECT auth.\1())';
  cyclic  TEXT[];
  stmt    TEXT;
  n_done  INT := 0;
  n_left  INT;
BEGIN
  WITH RECURSIVE refs AS (
    SELECT DISTINCT p.schemaname || '.' || p.tablename AS src,
           CASE WHEN m[1] LIKE '%.%' THEN m[1] ELSE 'public.' || m[1] END AS dst
    FROM pg_policies p,
         regexp_matches(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
                        '(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_.]*)', 'g') AS m
    WHERE p.schemaname IN ('public', 'storage')
  ), reach(src, dst) AS (
    SELECT src, dst FROM refs
    UNION
    SELECT h.src, f.dst FROM reach h JOIN refs f ON f.src = h.dst
  )
  SELECT coalesce(array_agg(DISTINCT src), '{}') INTO cyclic FROM reach WHERE src = dst;

  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname IN ('public', 'storage')
      AND (coalesce(qual, '') ~ pat OR coalesce(with_check, '') ~ pat)
      AND NOT (schemaname || '.' || tablename = ANY (cyclic) AND cmd IN ('SELECT', 'ALL'))
  LOOP
    stmt := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF r.qual IS NOT NULL THEN
      stmt := stmt || ' USING (' || regexp_replace(r.qual, pat, rep, 'g') || ')';
    END IF;
    IF r.with_check IS NOT NULL THEN
      stmt := stmt || ' WITH CHECK (' || regexp_replace(r.with_check, pat, rep, 'g') || ')';
    END IF;
    BEGIN
      EXECUTE stmt;
      n_done := n_done + 1;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE '096: skipped %.%.% (not owner)', r.schemaname, r.tablename, r.policyname;
    END;
  END LOOP;

  SELECT count(*) INTO n_left
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (coalesce(qual, '') ~ pat OR coalesce(with_check, '') ~ pat)
    AND NOT ('public.' || tablename = ANY (cyclic) AND cmd IN ('SELECT', 'ALL'));
  IF n_left > 0 THEN
    RAISE EXCEPTION '096: % public policies still call auth.*() per row', n_left;
  END IF;
  RAISE NOTICE '096: % policies rewritten to (SELECT auth.*()); kept plain on %', n_done, cyclic;
END $$;

NOTIFY pgrst, 'reload schema';
