-- 158_server_owned_columns.sql
--
-- Round 5, wave 1 — data the client may not change (and two cleanups of the account purge).
--
-- 1. profiles (N5-2, R-139). profiles_update_own (001) pins only role / status; the guards of
--    096 / 140 (profiles_guard_privileged_columns, profiles_protect_privileged_columns) cover
--    role, status, tier, feature_flags, approved_* and the Telegram binding — not the e-mail.
--    A signed-in user could PATCH /rest/v1/profiles?id=eq.<own id> {email}: notifications go to
--    profiles.email (lib/automation/data.ts, the CRM digest), an approval by e-mail
--    (lib/users/approval.ts) matches it, and the GIGA owner login looks the owner up by it
--    (ilike email … maybeSingle: a second row with the owner's address locks the owner out).
--    New BEFORE UPDATE trigger profiles_guard_server_columns refuses, for the API roles of
--    PostgREST (auth.role() authenticated / anon) — a platform admin signed in with their own
--    session included (every staff write to profiles goes through the service role):
--      • identity: id, email, created_at;
--      • set by the server only: last_seen_at (/api/v1/events), vertical
--        (/api/v1/organizations/set-vertical), widget_config (GIGA widgets), branding;
--      • telegram_link_code_expires_at (new, below): set only by the server; clearing is allowed,
--        like the other Telegram columns of the 140 guard.
--    Still self-editable under the session (what the UI writes): full_name, position,
--    organization, phone (settings «Профиль»), preferences (settings, assistant), expert_title,
--    avatar_url (expert profile), and NULL for the Telegram columns (unlink).
--    The server keeps every column: service_role, postgres (migrations), GoTrue. auth.users →
--    profiles: only on INSERT (handle_new_user, unaffected); there is no UPDATE sync — an e-mail
--    changed in GoTrue does not reach profiles (unchanged by this migration).
--    profiles.telegram_link_code_expires_at (R-139): the client bot's /start code
--    (POST /api/v1/settings/telegram) lives 15 minutes. A code without an expiry (issued before
--    158) is not accepted by the new webhook code.
--
-- 2. companies (R-053в). companies_update_own (020) let the owner update ANY column of their
--    company (partner_id, status, domain, notes, stage, user_id, id …), companies_insert_own the
--    same on the first insert. Column grants now: authenticated may INSERT / UPDATE only what the
--    two user-scoped writers send — /api/v1/onboarding/company (OnboardingCompanyBody: name,
--    industry, employee_count, founded_at, business_model, regions, contact_name,
--    contact_position, contact_phone, contact_email; + updated_at on update, + user_id on insert)
--    and /api/v1/companies/targets (target_revenue_12m_kzt, target_revenue_3y_kzt). anon gets no
--    INSERT / UPDATE (it has no policy anyway). Every other writer uses the service role (GIGA,
--    medical onboarding, registration, goals sync) or Prisma (postgres) — unaffected. Only columns
--    that exist are granted (NOTICE for a missing one). updated_at is kept by the
--    companies_updated_at trigger (001, set_updated_at); it is created here where it is missing.
--    "updatedAt" (Prisma's column) is now stamped by every UPDATE too (companies_touch_updated_at).
--
-- 3. admin_purge_user (R-054). It deleted the answer history BEFORE the profile and the account;
--    the cascade of that delete removes survey_answers, whose history trigger
--    (track_survey_answer_history) writes a DELETE row per answer, with the old answer — the
--    «full» purge left the client's answers behind. The history is now deleted last. The
--    function is one transaction as before (any failing step undoes all of it). Also: user_id is
--    compared as text (prod has text and uuid columns among these tables), and the tables that
--    no migration creates (assistant_conversations, point_a_*, ai_conflicts — they exist on prod)
--    are skipped where absent instead of failing the purge.
--
-- 4. profiles.approved_by (R-055): the FK (001) had no ON DELETE — purging an approver failed.
--    Now ON DELETE SET NULL, added NOT VALID, then VALIDATE.
--
-- 5. email_deliveries (R-152): an idempotency claim is 'pending' until the letter is sent
--    (lib/email/send.ts), claimed_at = when it was claimed (a stale 'pending' is taken over).
--
-- Safe on prod: profiles (~60 rows) and companies keep their data; no row is rewritten.
-- Idempotent. Policies are unchanged.
-- Rollback: supabase/migrations/rollback/158_server_owned_columns.down.sql
--   node scripts/apply-migration.js supabase/migrations/158_server_owned_columns.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. profiles ─────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telegram_link_code_expires_at TIMESTAMPTZ;
COMMENT ON COLUMN public.profiles.telegram_link_code_expires_at IS
  '[158] until when telegram_link_code is accepted by /api/telegram/webhook (15 minutes); set by the server only';

CREATE OR REPLACE FUNCTION public.profiles_guard_server_columns()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Only the API roles of PostgREST are limited. The service role, migrations (postgres) and
  -- GoTrue (no request claims) are the server. A platform admin with a personal session is NOT
  -- exempt here: staff change these columns through the service role only.
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF NEW.id         IS DISTINCT FROM OLD.id
  OR NEW.email      IS DISTINCT FROM OLD.email
  OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'profiles: id, email and created_at are set by the server only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.last_seen_at  IS DISTINCT FROM OLD.last_seen_at
  OR NEW.vertical      IS DISTINCT FROM OLD.vertical
  OR NEW.widget_config IS DISTINCT FROM OLD.widget_config
  OR NEW.branding      IS DISTINCT FROM OLD.branding
  OR (NEW.telegram_link_code_expires_at IS NOT NULL
      AND NEW.telegram_link_code_expires_at IS DISTINCT FROM OLD.telegram_link_code_expires_at) THEN
    RAISE EXCEPTION 'profiles: column is set by the server only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_guard_server_columns ON public.profiles;
CREATE TRIGGER profiles_guard_server_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_server_columns();

REVOKE ALL ON FUNCTION public.profiles_guard_server_columns() FROM PUBLIC;

-- ── 2. companies: column grants ────────────────────────────────────────────────
DO $$
DECLARE
  -- /api/v1/onboarding/company (OnboardingCompanyBody) + /api/v1/companies/targets.
  v_update CONSTANT TEXT[] := ARRAY[
    'name', 'industry', 'employee_count', 'founded_at', 'business_model', 'regions',
    'contact_name', 'contact_position', 'contact_phone', 'contact_email',
    'target_revenue_12m_kzt', 'target_revenue_3y_kzt', 'updated_at'];
  -- The first save of /api/v1/onboarding/company: the same fields and the owner.
  v_insert CONSTANT TEXT[] := ARRAY[
    'user_id', 'name', 'industry', 'employee_count', 'founded_at', 'business_model', 'regions',
    'contact_name', 'contact_position', 'contact_phone', 'contact_email'];
  v_cols TEXT;
  v_missing TEXT[];
BEGIN
  -- Table-level REVOKE also drops earlier column grants: re-running gives the same result.
  REVOKE INSERT, UPDATE ON public.companies FROM anon, authenticated;

  SELECT array_agg(c) INTO v_missing
    FROM unnest(v_update || v_insert) AS c
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = c);
  SELECT string_agg(format('%I', c), ', ' ORDER BY c) INTO v_cols
    FROM unnest(v_update) AS c
   WHERE EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = c);
  IF v_missing IS NOT NULL THEN
    RAISE NOTICE '158: companies has no column(s) % — not granted', v_missing;
  END IF;
  IF v_cols IS NOT NULL THEN
    EXECUTE format('GRANT UPDATE (%s) ON public.companies TO authenticated', v_cols);
  END IF;

  SELECT string_agg(format('%I', c), ', ' ORDER BY c) INTO v_cols
    FROM unnest(v_insert) AS c
   WHERE EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = c);
  IF v_cols IS NOT NULL THEN
    EXECUTE format('GRANT INSERT (%s) ON public.companies TO authenticated', v_cols);
  END IF;

  -- updated_at is kept by a trigger (001 companies_updated_at → set_updated_at). Where it is
  -- missing, create it (only when the column exists).
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'updated_at')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger
                      WHERE tgrelid = 'public.companies'::regclass AND NOT tgisinternal
                        AND tgfoid = 'public.set_updated_at()'::regprocedure) THEN
    CREATE TRIGGER companies_updated_at
      BEFORE UPDATE ON public.companies
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    RAISE NOTICE '158: companies_updated_at trigger created';
  END IF;
END $$;

-- "updatedAt" (the Prisma column, timestamp without time zone, UTC) was kept only by Prisma's own
-- writes: a save through PostgREST left it as it was. Every UPDATE now stamps it, like updated_at.
CREATE OR REPLACE FUNCTION public.companies_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW."updatedAt" := now() AT TIME ZONE 'UTC';
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.companies_touch_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS companies_touch_updated_at ON public.companies;
CREATE TRIGGER companies_touch_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.companies_touch_updated_at();

-- ── 3. admin_purge_user: the answer history last ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_purge_user(p_user_id UUID, p_dry_run BOOLEAN DEFAULT true)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          TEXT := p_user_id::text;
  -- companies.id is TEXT and not always a UUID (e.g. 'myhonor-…', 'test-co-…'),
  -- so company ids are kept as text and compared as text everywhere.
  v_company_txt  TEXT[];
  v_storage      JSONB;
  v_counts       JSONB;
  v_tbl          TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id)
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT coalesce(array_agg(id::text), '{}') INTO v_company_txt FROM public.companies WHERE user_id = p_user_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_id, 'name', name)), '[]'::jsonb)
    INTO v_storage
    FROM storage.objects
   WHERE owner = p_user_id OR owner_id = v_uid OR name LIKE v_uid || '/%';

  v_counts := jsonb_build_object(
    'companies',       coalesce(array_length(v_company_txt, 1), 0),
    'documents',       (SELECT count(*) FROM public.documents WHERE user_id::text = v_uid OR company_id::text = ANY (v_company_txt)),
    'survey_answers',  (SELECT count(*) FROM public.survey_answers WHERE user_id = p_user_id),
    'gri_assessments', (SELECT count(*) FROM public.gri_assessments WHERE user_id = p_user_id),
    'diagnostics',     (SELECT count(*) FROM public.diagnostics WHERE user_id = p_user_id),
    'ai_conversations',(SELECT count(*) FROM public.ai_conversations WHERE user_id = p_user_id),
    'files',           jsonb_array_length(v_storage)
  );

  IF p_dry_run THEN
    RETURN jsonb_build_object('found', true, 'dry_run', true, 'counts', v_counts, 'storage', v_storage);
  END IF;

  -- 1. Data of the user without a foreign key to them (text / uuid columns). Before the cascade:
  --    it may null documents.company_id / shared_reports."companyId" of the user's company.
  DELETE FROM public.documents          WHERE user_id::text = v_uid OR company_id::text = ANY (v_company_txt);
  DELETE FROM public.document_summaries WHERE user_id::text = v_uid;
  -- Tables no migration creates (they exist on prod): skipped where absent.
  FOREACH v_tbl IN ARRAY ARRAY['assistant_conversations', 'point_a_resolutions', 'point_a_value_events',
                               'point_a_values', 'point_a_sources'] LOOP
    IF to_regclass('public.' || v_tbl) IS NOT NULL THEN
      EXECUTE format('DELETE FROM public.%I WHERE user_id::text = $1', v_tbl) USING v_uid;
    END IF;
  END LOOP;
  DELETE FROM public.shared_reports     WHERE "companyId" = ANY (v_company_txt);

  -- 2. References to the user from other rows without ON DELETE — cleared.
  IF to_regclass('public.ai_conflicts') IS NOT NULL THEN
    EXECUTE 'UPDATE public.ai_conflicts SET resolved_by = NULL WHERE resolved_by = $1' USING p_user_id;
  END IF;

  -- 3. Profile and account; the rest goes by ON DELETE CASCADE.
  DELETE FROM public.profiles WHERE id = p_user_id;
  DELETE FROM auth.users      WHERE id = p_user_id;

  -- 4. The answer history LAST: the cascade of step 3 deletes survey_answers, and its history
  --    trigger (track_survey_answer_history) writes a DELETE row with the old answer per answer.
  DELETE FROM public.survey_answer_history WHERE user_id = p_user_id;

  RETURN jsonb_build_object('found', true, 'dry_run', false, 'counts', v_counts, 'storage', v_storage);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purge_user(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_user(UUID, BOOLEAN) TO service_role;

-- ── 4. profiles.approved_by: ON DELETE SET NULL ────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'profiles_approved_by_fkey' AND conrelid = 'public.profiles'::regclass
                AND confdeltype <> 'n') THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_approved_by_fkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'profiles_approved_by_fkey' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_approved_by_fkey FOREIGN KEY (approved_by)
      REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_approved_by_fkey;

-- ── 5. email_deliveries: 'pending' claims ──────────────────────────────────────
ALTER TABLE public.email_deliveries ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NOT NULL DEFAULT now();
COMMENT ON COLUMN public.email_deliveries.claimed_at IS
  '[158] when the idempotency claim was taken (status pending); a stale pending claim is taken over (lib/email/send.ts)';

DO $$
DECLARE
  c RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'email_deliveries_status_check' AND conrelid = 'public.email_deliveries'::regclass
                AND pg_get_constraintdef(oid) LIKE '%pending%') THEN
    RETURN;
  END IF;
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.email_deliveries'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%status%' LOOP
    EXECUTE format('ALTER TABLE public.email_deliveries DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.email_deliveries
    ADD CONSTRAINT email_deliveries_status_check CHECK (status IN ('pending', 'sent', 'failed', 'skipped'));
END $$;

NOTIFY pgrst, 'reload schema';
