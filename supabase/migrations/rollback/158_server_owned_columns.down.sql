-- 158_server_owned_columns.down.sql — ROLLBACK of migration 158 (data the client may not change).
--
-- NOT part of the migration sequence (appliers read only supabase/migrations/*.sql).
-- Restores the definitions before 158:
--   • profiles: drops the trigger profiles_guard_server_columns and its function (e-mail, id,
--     created_at, last_seen_at, vertical, widget_config, branding are self-editable again under
--     profiles_update_own) and the column telegram_link_code_expires_at (the link codes then
--     never expire — the webhook code of 158 accepts no code without an expiry: roll the code
--     back first);
--   • companies: table-level INSERT / UPDATE for anon and authenticated again (Supabase's default
--     grants, the state before 158; the REVOKE first drops the column grants). The
--     companies_updated_at trigger stays (it is 001's; 158 only created it where it was missing);
--   • admin_purge_user: the 083 definition (history deleted before the profile);
--   • profiles.approved_by: the FK without ON DELETE (NOT VALID, then VALIDATE);
--   • email_deliveries: a 'pending' claim becomes 'sent' — the meaning a claim had before 158, so a
--     letter is never sent twice (one still being sent, or never sent because its process died,
--     stays as it was in 157); claimed_at dropped; CHECK (sent, failed, skipped).
-- Data lost: the link-code expiries and the claim times. Roll the portal code back first.
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/rollback/158_server_owned_columns.down.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. profiles ─────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS profiles_guard_server_columns ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_guard_server_columns();
ALTER TABLE public.profiles DROP COLUMN IF EXISTS telegram_link_code_expires_at;

-- ── 2. companies ───────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE ON public.companies FROM anon, authenticated;
GRANT INSERT, UPDATE ON public.companies TO anon, authenticated;

-- ── 3. admin_purge_user as in 083 ──────────────────────────────────────────────
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
    'documents',       (SELECT count(*) FROM public.documents WHERE user_id = v_uid OR company_id::text = ANY (v_company_txt)),
    'survey_answers',  (SELECT count(*) FROM public.survey_answers WHERE user_id = p_user_id),
    'gri_assessments', (SELECT count(*) FROM public.gri_assessments WHERE user_id = p_user_id),
    'diagnostics',     (SELECT count(*) FROM public.diagnostics WHERE user_id = p_user_id),
    'ai_conversations',(SELECT count(*) FROM public.ai_conversations WHERE user_id = p_user_id),
    'files',           jsonb_array_length(v_storage)
  );

  IF p_dry_run THEN
    RETURN jsonb_build_object('found', true, 'dry_run', true, 'counts', v_counts, 'storage', v_storage);
  END IF;

  -- 1. Данные пользователя без внешнего ключа на него (text/uuid-колонки).
  DELETE FROM public.documents               WHERE user_id = v_uid OR company_id::text = ANY (v_company_txt);
  DELETE FROM public.document_summaries      WHERE user_id = v_uid;
  DELETE FROM public.assistant_conversations WHERE user_id = v_uid;
  DELETE FROM public.point_a_resolutions     WHERE user_id = v_uid;
  DELETE FROM public.point_a_value_events    WHERE user_id = v_uid;
  DELETE FROM public.point_a_values          WHERE user_id = v_uid;
  DELETE FROM public.point_a_sources         WHERE user_id = v_uid;
  DELETE FROM public.survey_answer_history   WHERE user_id = p_user_id;
  DELETE FROM public.shared_reports          WHERE "companyId" = ANY (v_company_txt);

  -- 2. Ссылки на пользователя из чужих записей без ON DELETE — обнуляем.
  UPDATE public.ai_conflicts SET resolved_by = NULL WHERE resolved_by = p_user_id;

  -- 3. Профиль и учётная запись; остальное — каскадом.
  DELETE FROM public.profiles WHERE id = p_user_id;
  DELETE FROM auth.users      WHERE id = p_user_id;

  RETURN jsonb_build_object('found', true, 'dry_run', false, 'counts', v_counts, 'storage', v_storage);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purge_user(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_user(UUID, BOOLEAN) TO service_role;

-- ── 4. profiles.approved_by without ON DELETE ──────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'profiles_approved_by_fkey' AND conrelid = 'public.profiles'::regclass
                AND confdeltype <> 'a') THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_approved_by_fkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'profiles_approved_by_fkey' AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_approved_by_fkey FOREIGN KEY (approved_by)
      REFERENCES public.profiles(id) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_approved_by_fkey;

-- ── 5. email_deliveries ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pending INTEGER;
  c RECORD;
BEGIN
  UPDATE public.email_deliveries SET status = 'sent' WHERE status = 'pending';
  GET DIAGNOSTICS v_pending = ROW_COUNT;
  IF v_pending > 0 THEN
    RAISE NOTICE '158 rollback: % pending e-mail claim(s) marked sent', v_pending;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'email_deliveries_status_check' AND conrelid = 'public.email_deliveries'::regclass
                AND pg_get_constraintdef(oid) NOT LIKE '%pending%') THEN
    RETURN;
  END IF;
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.email_deliveries'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%status%' LOOP
    EXECUTE format('ALTER TABLE public.email_deliveries DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.email_deliveries
    ADD CONSTRAINT email_deliveries_status_check CHECK (status IN ('sent', 'failed', 'skipped'));
END $$;
ALTER TABLE public.email_deliveries DROP COLUMN IF EXISTS claimed_at;

NOTIFY pgrst, 'reload schema';
