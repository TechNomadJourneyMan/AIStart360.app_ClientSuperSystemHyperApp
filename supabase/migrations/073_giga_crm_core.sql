-- 073_giga_crm_core.sql — фундамент GIGA-CRM (Platform Control Center).
--
-- Всё аддитивно: новые таблицы, колонка profiles.last_seen_at, триггеры,
-- SQL-функции для CRM. Существующие данные не меняются (кроме бэкфила
-- событий/аудита, помеченного metadata.backfilled = true).
--
--   staff_roles              — роли персонала (RBAC), отдельно от profiles.role,
--                              чтобы не трогать маршрутизацию кабинетов
--   user_events              — поток продуктовых событий (event-based analytics)
--   admin_audit_log          — append-only журнал действий персонала (old → new)
--   impersonation_sessions   — сессии «кабинет от имени пользователя»
--   survey_answer_history    — история изменений ответов анкеты (кто/когда/было/стало)
--
-- Доступ ко всем таблицам — только service_role (RLS без политик), кроме
-- staff_roles: сотрудник читает свою строку (нужно middleware).
-- Применение: node scripts/apply-migration.js supabase/migrations/073_giga_crm_core.sql

-- ─── 1. Роли персонала ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_roles (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('super_admin','admin','crm_manager','content_manager','analyst','support')),
  granted_by TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_roles_sel_own ON public.staff_roles;
CREATE POLICY staff_roles_sel_own ON public.staff_roles FOR SELECT USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.staff_roles FROM anon, authenticated;

-- Существующие super_admin профили получают явную запись (идемпотентно).
INSERT INTO public.staff_roles (user_id, role, granted_by)
SELECT p.id, 'super_admin', 'migration:073'
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.role = 'super_admin'
ON CONFLICT (user_id) DO NOTHING;

-- ─── 2. Последняя активность ─────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS profiles_last_seen_idx ON public.profiles (last_seen_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS profiles_created_idx ON public.profiles (created_at DESC);

-- ─── 3. Поток событий ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_events (
  id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id                   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name                TEXT NOT NULL CHECK (event_name ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  event_type                TEXT NOT NULL DEFAULT 'system'
                            CHECK (event_type IN ('auth','navigation','interaction','questionnaire','gri','content','document','diagnostics','system','admin')),
  page                      TEXT CHECK (page IS NULL OR char_length(page) <= 300),
  entity_type               TEXT,
  entity_id                 TEXT,
  metadata                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  source                    TEXT NOT NULL DEFAULT 'server' CHECK (source IN ('web','server','admin','impersonation','backfill')),
  session_id                TEXT CHECK (session_id IS NULL OR char_length(session_id) <= 64),
  impersonation_session_id  UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_events_user_created_idx ON public.user_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_events_name_created_idx ON public.user_events (event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS user_events_created_idx ON public.user_events (created_at DESC);
CREATE INDEX IF NOT EXISTS user_events_pageviews_idx ON public.user_events (page, created_at DESC) WHERE event_name = 'PAGE_VIEWED';
ALTER TABLE public.user_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_events FROM anon, authenticated;

-- ─── 4. Журнал действий персонала (append-only) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id                  TEXT NOT NULL,
  actor_kind                TEXT NOT NULL DEFAULT 'session',
  actor_role                TEXT,
  actor_email               TEXT,
  target_user_id            UUID,
  impersonation_session_id  UUID,
  action                    TEXT NOT NULL,
  entity_type               TEXT NOT NULL DEFAULT 'system',
  entity_id                 TEXT,
  old_value                 JSONB,
  new_value                 JSONB,
  metadata                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address                TEXT,
  user_agent                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target_idx ON public.admin_audit_log (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_actor_idx ON public.admin_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_action_idx ON public.admin_audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_imp_idx ON public.admin_audit_log (impersonation_session_id) WHERE impersonation_session_id IS NOT NULL;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_audit_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_audit_log_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only (% blocked)', TG_OP;
END;
$$;
DROP TRIGGER IF EXISTS admin_audit_log_no_update ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_no_update
  BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_log_immutable();
DROP TRIGGER IF EXISTS admin_audit_log_no_truncate ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_no_truncate
  BEFORE TRUNCATE ON public.admin_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.admin_audit_log_immutable();

-- Перенос прежнего журнала (Prisma audit_logs), без дублей при повторном запуске.
DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO public.admin_audit_log
      (actor_id, actor_kind, action, entity_type, entity_id, target_user_id, old_value, new_value, metadata, ip_address, created_at)
    SELECT
      a."performedBy",
      CASE WHEN a."performedBy" LIKE 'giga:%' THEN 'break_glass' ELSE 'session' END,
      a.action,
      a."entityType",
      a."entityId",
      CASE WHEN a."entityType" = 'user' AND a."entityId" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN a."entityId"::uuid END,
      a.diff -> 'before',
      a.diff -> 'after',
      jsonb_build_object('legacy_id', a.id, 'legacy_diff', a.diff, 'backfilled', true),
      a."ipAddress",
      a."timestamp" AT TIME ZONE 'UTC'
    FROM public.audit_logs a
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log l WHERE l.metadata ->> 'legacy_id' = a.id
    );
  END IF;
END $$;

-- ─── 5. Impersonation ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        TEXT NOT NULL,
  admin_kind      TEXT NOT NULL,
  admin_role      TEXT NOT NULL,
  admin_email     TEXT,
  target_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode            TEXT NOT NULL CHECK (mode IN ('view','edit')),
  reason          TEXT NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 500),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  end_reason      TEXT,
  ip_address      TEXT,
  user_agent      TEXT
);
CREATE INDEX IF NOT EXISTS impersonation_target_idx ON public.impersonation_sessions (target_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS impersonation_admin_idx ON public.impersonation_sessions (admin_id, started_at DESC);
CREATE INDEX IF NOT EXISTS impersonation_active_idx ON public.impersonation_sessions (expires_at) WHERE ended_at IS NULL;
ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.impersonation_sessions FROM anon, authenticated;

-- ─── 6. История ответов анкеты ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_answer_history (
  id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id                   UUID NOT NULL,
  question_key              TEXT NOT NULL,
  operation                 TEXT NOT NULL,
  old_value                 JSONB,
  new_value                 JSONB,
  changed_by                TEXT,
  source                    TEXT NOT NULL,
  impersonation_session_id  UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_history_user_idx ON public.survey_answer_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS survey_history_key_idx ON public.survey_answer_history (user_id, question_key, updated_at DESC);
ALTER TABLE public.survey_answer_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.survey_answer_history FROM anon, authenticated;

-- Автор изменения:
--   * сессия пользователя            → changed_by = auth.uid(), source = 'user'
--   * service_role с заголовками      → x-actor-id / x-actor-source / x-impersonation-id
--     (заголовки доверяются ТОЛЬКО service_role — клиент не может их подделать)
--   * service_role без заголовков     → source = 'service'
-- Правки одним автором одного поля в течение 10 минут склеиваются в одну запись
-- (иначе автосохранение порождало бы строку на каждую паузу в наборе).
CREATE OR REPLACE FUNCTION public.track_survey_answer_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims   JSONB;
  v_headers  JSONB;
  v_role     TEXT;
  v_actor    TEXT;
  v_source   TEXT;
  v_imp      UUID;
  v_user     UUID := COALESCE(NEW.user_id, OLD.user_id);
  v_key      TEXT := COALESCE(NEW.question_key, OLD.question_key);
  v_old      JSONB := CASE WHEN TG_OP <> 'INSERT' THEN OLD.answer END;
  v_new      JSONB := CASE WHEN TG_OP <> 'DELETE' THEN NEW.answer END;
  v_existing BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.answer IS NOT DISTINCT FROM NEW.answer THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN others THEN v_claims := NULL;
  END;
  BEGIN
    v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN v_headers := NULL;
  END;
  v_role := COALESCE(v_claims ->> 'role', '');

  IF v_role = 'service_role' THEN
    v_actor := NULLIF(v_headers ->> 'x-actor-id', '');
    v_source := COALESCE(NULLIF(v_headers ->> 'x-actor-source', ''), 'service');
    IF v_source NOT IN ('admin', 'impersonation', 'service', 'user') THEN v_source := 'service'; END IF;
    BEGIN
      v_imp := NULLIF(v_headers ->> 'x-impersonation-id', '')::uuid;
    EXCEPTION WHEN others THEN v_imp := NULL;
    END;
  ELSIF v_claims ->> 'sub' IS NOT NULL THEN
    v_actor := v_claims ->> 'sub';
    v_source := 'user';
  ELSE
    v_source := 'service';
  END IF;

  SELECT h.id INTO v_existing
  FROM public.survey_answer_history h
  WHERE h.user_id = v_user
    AND h.question_key = v_key
    AND h.changed_by IS NOT DISTINCT FROM v_actor
    AND h.source = v_source
    AND h.impersonation_session_id IS NOT DISTINCT FROM v_imp
    AND h.operation <> 'DELETE'
    AND h.updated_at > now() - interval '10 minutes'
  ORDER BY h.id DESC
  LIMIT 1;

  IF v_existing IS NOT NULL AND TG_OP <> 'DELETE' THEN
    UPDATE public.survey_answer_history
    SET new_value = v_new, updated_at = now()
    WHERE id = v_existing;
  ELSE
    INSERT INTO public.survey_answer_history
      (user_id, question_key, operation, old_value, new_value, changed_by, source, impersonation_session_id)
    VALUES (v_user, v_key, TG_OP, v_old, v_new, v_actor, v_source, v_imp);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS survey_answers_history ON public.survey_answers;
CREATE TRIGGER survey_answers_history
  AFTER INSERT OR UPDATE OR DELETE ON public.survey_answers
  FOR EACH ROW EXECUTE FUNCTION public.track_survey_answer_history();

-- ─── 7. Событие регистрации (надёжнее клиента: пишется при создании профиля) ──
CREATE OR REPLACE FUNCTION public.emit_user_registered_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.id) THEN
    INSERT INTO public.user_events (user_id, event_name, event_type, metadata, source, created_at)
    VALUES (NEW.id, 'USER_REGISTERED', 'auth', jsonb_build_object('role', NEW.role), 'server', COALESCE(NEW.created_at, now()));
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  -- Аналитика никогда не должна ломать регистрацию.
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_emit_registered ON public.profiles;
CREATE TRIGGER profiles_emit_registered
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.emit_user_registered_event();

-- ─── 8. Бэкфил событий из уже существующих данных ────────────────────────────
INSERT INTO public.user_events (user_id, event_name, event_type, metadata, source, created_at)
SELECT p.id, 'USER_REGISTERED', 'auth', jsonb_build_object('role', p.role, 'backfilled', true), 'backfill', p.created_at
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.created_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.user_events e WHERE e.user_id = p.id AND e.event_name = 'USER_REGISTERED');

INSERT INTO public.user_events (user_id, event_name, event_type, entity_type, entity_id, metadata, source, created_at)
SELECT s.user_id, 'QUESTIONNAIRE_STARTED', 'questionnaire', 'survey', s.user_id::text,
       jsonb_build_object('backfilled', true), 'backfill', s.first_at
FROM (
  SELECT sa.user_id, min(sa.answered_at) AS first_at
  FROM public.survey_answers sa
  WHERE sa.question_key ~ '^s[0-9]+[a-z]?_'
  GROUP BY sa.user_id
) s
JOIN auth.users u ON u.id = s.user_id
WHERE NOT EXISTS (SELECT 1 FROM public.user_events e WHERE e.user_id = s.user_id AND e.event_name = 'QUESTIONNAIRE_STARTED');

INSERT INTO public.user_events (user_id, event_name, event_type, entity_type, entity_id, metadata, source, created_at)
SELECT g.user_id, 'GRI_COMPLETED', 'gri', 'gri_assessment', g.id::text,
       jsonb_build_object('gri_index', g.gri_index, 'backfilled', true), 'backfill', g.created_at
FROM public.gri_assessments g
JOIN auth.users u ON u.id = g.user_id
WHERE NOT EXISTS (SELECT 1 FROM public.user_events e WHERE e.event_name = 'GRI_COMPLETED' AND e.entity_id = g.id::text);

INSERT INTO public.user_events (user_id, event_name, event_type, entity_type, entity_id, metadata, source, created_at)
SELECT d.user_id, 'POINT_A_CALCULATED', 'diagnostics', 'diagnostic', d.id::text,
       jsonb_build_object('overall_score', d.overall_score, 'backfilled', true), 'backfill', d.calculated_at
FROM public.diagnostics d
JOIN auth.users u ON u.id = d.user_id
WHERE d.calculated_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.user_events e WHERE e.event_name = 'POINT_A_CALCULATED' AND e.entity_id = d.id::text);

-- ─── 9. CRM: заполненность анкеты одним SQL-выражением ───────────────────────
-- Шаг считается начатым, если в нём есть хотя бы один непустой ответ
-- (та же логика, что lib/survey/steps.ts → completedStepsFromRows).
CREATE OR REPLACE FUNCTION public.admin_survey_steps()
RETURNS TABLE (user_id UUID, steps INT, first_at TIMESTAMPTZ, last_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sa.user_id,
         count(DISTINCT sa.step) FILTER (
           WHERE sa.step BETWEEN 1 AND 12
             AND sa.answer ? 'value'
             AND jsonb_typeof(sa.answer -> 'value') <> 'null'
             AND (sa.answer -> 'value') NOT IN ('""'::jsonb, '[]'::jsonb, '{}'::jsonb)
         )::int,
         min(sa.answered_at),
         max(sa.answered_at)
  FROM public.survey_answers sa
  WHERE sa.question_key ~ '^s[0-9]+[a-z]?_'
  GROUP BY sa.user_id
$$;

-- ─── 10. CRM: список пользователей (поиск/фильтры/сегменты/сортировка/пагинация)
CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search  TEXT DEFAULT NULL,
  p_status  TEXT DEFAULT NULL,
  p_role    TEXT DEFAULT NULL,
  p_segment TEXT DEFAULT NULL,
  p_sort    TEXT DEFAULT 'created_at',
  p_dir     TEXT DEFAULT 'desc',
  p_limit   INT  DEFAULT 25,
  p_offset  INT  DEFAULT 0
)
RETURNS TABLE (
  id UUID, email TEXT, full_name TEXT, role TEXT, status TEXT, tier TEXT, organization TEXT,
  phone TEXT, created_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ, company_name TEXT,
  survey_steps INT, survey_updated_at TIMESTAMPTZ,
  gri_index NUMERIC, gri_at TIMESTAMPTZ, gri_runs INT, gri_draft BOOLEAN,
  diag_score NUMERIC, staff_role TEXT, total_count BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sort TEXT := CASE p_sort
    WHEN 'created_at' THEN 'b.created_at'
    WHEN 'last_seen_at' THEN 'b.last_seen_at'
    WHEN 'name' THEN 'lower(coalesce(b.company_name, b.full_name, b.email))'
    WHEN 'survey' THEN 'b.survey_steps'
    WHEN 'gri' THEN 'b.gri_index'
    ELSE 'b.created_at' END;
  v_dir TEXT := CASE WHEN lower(p_dir) = 'asc' THEN 'ASC' ELSE 'DESC' END;
BEGIN
  RETURN QUERY EXECUTE format($q$
    WITH s AS (SELECT * FROM public.admin_survey_steps()),
    g AS (
      SELECT ga.user_id,
             (array_agg(ga.gri_index ORDER BY ga.is_current DESC, ga.created_at DESC))[1] AS gri_index,
             max(ga.created_at) AS gri_at,
             count(*)::int AS gri_runs
      FROM public.gri_assessments ga GROUP BY ga.user_id
    ),
    d AS (
      SELECT DISTINCT ON (dg.user_id) dg.user_id, dg.overall_score
      FROM public.diagnostics dg
      ORDER BY dg.user_id, dg.is_current DESC, dg.calculated_at DESC NULLS LAST
    ),
    base AS (
      SELECT p.id, p.email, p.full_name, p.role, p.status, p.tier, p.organization, p.phone,
             p.created_at, p.last_seen_at,
             c.name AS company_name,
             COALESCE(s.steps, 0) AS survey_steps, s.last_at AS survey_updated_at,
             g.gri_index, g.gri_at, COALESCE(g.gri_runs, 0) AS gri_runs,
             (dr.user_id IS NOT NULL) AS gri_draft,
             d.overall_score AS diag_score,
             sr.role AS staff_role
      FROM public.profiles p
      LEFT JOIN LATERAL (SELECT co.name FROM public.companies co WHERE co.user_id = p.id LIMIT 1) c ON true
      LEFT JOIN s ON s.user_id = p.id
      LEFT JOIN g ON g.user_id = p.id
      LEFT JOIN d ON d.user_id = p.id
      LEFT JOIN public.gri_assessment_drafts dr ON dr.user_id = p.id
      LEFT JOIN public.staff_roles sr ON sr.user_id = p.id
    ),
    f AS (
      SELECT * FROM base b
      WHERE ($1 IS NULL OR $1 = '' OR b.email ILIKE '%%' || $1 || '%%' OR b.full_name ILIKE '%%' || $1 || '%%'
             OR b.company_name ILIKE '%%' || $1 || '%%' OR b.organization ILIKE '%%' || $1 || '%%'
             OR b.phone ILIKE '%%' || $1 || '%%' OR b.id::text = $1)
        AND ($2 IS NULL OR $2 = '' OR b.status = $2)
        AND ($3 IS NULL OR $3 = '' OR b.role = $3)
        AND (
          $4 IS NULL OR $4 = ''
          OR ($4 = 'new_7d' AND b.created_at > now() - interval '7 days')
          OR ($4 = 'active_7d' AND b.last_seen_at > now() - interval '7 days')
          OR ($4 = 'inactive_30d' AND (b.last_seen_at IS NULL OR b.last_seen_at < now() - interval '30 days'))
          OR ($4 = 'survey_not_started' AND b.survey_steps = 0)
          OR ($4 = 'survey_in_progress' AND b.survey_steps BETWEEN 1 AND 11)
          OR ($4 = 'survey_completed' AND b.survey_steps >= 12)
          OR ($4 = 'gri_not_started' AND b.gri_runs = 0 AND NOT b.gri_draft)
          OR ($4 = 'gri_in_progress' AND b.gri_draft)
          OR ($4 = 'gri_completed' AND b.gri_runs > 0)
          OR ($4 = 'staff' AND (b.staff_role IS NOT NULL OR b.role IN ('super_admin','admin')))
        )
    )
    SELECT b.id, b.email, b.full_name, b.role, b.status, b.tier, b.organization, b.phone,
           b.created_at, b.last_seen_at, b.company_name, b.survey_steps, b.survey_updated_at,
           b.gri_index, b.gri_at, b.gri_runs, b.gri_draft, b.diag_score, b.staff_role,
           count(*) OVER () AS total_count
    FROM f b
    ORDER BY %s %s NULLS LAST, b.id
    LIMIT $5 OFFSET $6
  $q$, v_sort, v_dir)
  USING p_search, p_status, p_role, p_segment,
        LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200),
        GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

-- ─── 11. CRM: воронка пути пользователя (CJM) ────────────────────────────────
-- Этапы считаются по фактическим данным (а не по событиям), поэтому воронка
-- верна и для пользователей, пришедших до появления трекинга.
CREATE OR REPLACE FUNCTION public.admin_journey_stages()
RETURNS TABLE (
  user_id UUID, registered_at TIMESTAMPTZ, approved_at TIMESTAMPTZ,
  survey_started_at TIMESTAMPTZ, survey_steps INT, survey_updated_at TIMESTAMPTZ,
  point_a_at TIMESTAMPTZ, gri_started_at TIMESTAMPTZ, gri_completed_at TIMESTAMPTZ,
  point_b_at TIMESTAMPTZ, content_viewed_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (SELECT * FROM public.admin_survey_steps())
  SELECT p.id,
         p.created_at,
         CASE WHEN p.status = 'approved' THEN COALESCE(p.approved_at, p.created_at) END,
         s.first_at,
         COALESCE(s.steps, 0),
         s.last_at,
         (SELECT min(d.calculated_at) FROM public.diagnostics d WHERE d.user_id = p.id),
         LEAST(
           (SELECT min(ga.created_at) FROM public.gri_assessments ga WHERE ga.user_id = p.id),
           (SELECT dr.updated_at FROM public.gri_assessment_drafts dr WHERE dr.user_id = p.id),
           (SELECT min(e.created_at) FROM public.user_events e WHERE e.user_id = p.id AND e.event_name = 'GRI_STARTED')
         ),
         (SELECT min(ga.created_at) FROM public.gri_assessments ga WHERE ga.user_id = p.id),
         (SELECT min(pb.calculated_at) FROM public.point_b_analysis pb
            JOIN public.diagnostics d ON d.id = pb.diagnostic_id WHERE d.user_id = p.id),
         (SELECT min(e.created_at) FROM public.user_events e WHERE e.user_id = p.id AND e.event_name = 'CONTENT_VIEWED'),
         p.last_seen_at
  FROM public.profiles p
  LEFT JOIN s ON s.user_id = p.id
  WHERE p.role = 'client'
$$;

-- ─── 12. CRM: сводка для главного экрана ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_overview(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days INT := LEAST(GREATEST(COALESCE(p_days, 30), 7), 180);
  v JSONB;
BEGIN
  WITH j AS (SELECT * FROM public.admin_journey_stages())
  SELECT jsonb_build_object(
    'generated_at', now(),
    'days', v_days,
    'users', jsonb_build_object(
      'total', (SELECT count(*) FROM public.profiles),
      'clients', (SELECT count(*) FROM public.profiles WHERE role = 'client'),
      'staff', (SELECT count(*) FROM public.staff_roles),
      'new_7d', (SELECT count(*) FROM public.profiles WHERE created_at > now() - interval '7 days'),
      'new_period', (SELECT count(*) FROM public.profiles WHERE created_at > now() - make_interval(days => v_days)),
      'active_1d', (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '1 day'),
      'active_7d', (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '7 days'),
      'active_30d', (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '30 days'),
      'pending_approval', (SELECT count(*) FROM public.profiles WHERE status = 'pending_approval'),
      'blocked', (SELECT count(*) FROM public.profiles WHERE status IN ('blocked','archived'))
    ),
    'funnel', jsonb_build_array(
      jsonb_build_object('key','registered','count',(SELECT count(*) FROM j)),
      jsonb_build_object('key','approved','count',(SELECT count(*) FROM j WHERE approved_at IS NOT NULL)),
      jsonb_build_object('key','survey_started','count',(SELECT count(*) FROM j WHERE survey_steps > 0)),
      jsonb_build_object('key','survey_completed','count',(SELECT count(*) FROM j WHERE survey_steps >= 12)),
      jsonb_build_object('key','point_a','count',(SELECT count(*) FROM j WHERE point_a_at IS NOT NULL)),
      jsonb_build_object('key','gri_started','count',(SELECT count(*) FROM j WHERE gri_started_at IS NOT NULL)),
      jsonb_build_object('key','gri_completed','count',(SELECT count(*) FROM j WHERE gri_completed_at IS NOT NULL)),
      jsonb_build_object('key','point_b','count',(SELECT count(*) FROM j WHERE point_b_at IS NOT NULL)),
      jsonb_build_object('key','content','count',(SELECT count(*) FROM j WHERE content_viewed_at IS NOT NULL))
    ),
    'signups_by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', d::date, 'count', COALESCE(x.n, 0)) ORDER BY d)
      FROM generate_series((now() - make_interval(days => v_days - 1))::date, now()::date, interval '1 day') d
      LEFT JOIN (SELECT created_at::date AS day, count(*) AS n FROM public.profiles
                 WHERE created_at > now() - make_interval(days => v_days) GROUP BY 1) x ON x.day = d::date
    ), '[]'::jsonb),
    'events_by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', d::date, 'count', COALESCE(x.n, 0), 'users', COALESCE(x.u, 0)) ORDER BY d)
      FROM generate_series((now() - make_interval(days => v_days - 1))::date, now()::date, interval '1 day') d
      LEFT JOIN (SELECT created_at::date AS day, count(*) AS n, count(DISTINCT user_id) AS u FROM public.user_events
                 WHERE created_at > now() - make_interval(days => v_days) AND source IN ('web','server') GROUP BY 1) x ON x.day = d::date
    ), '[]'::jsonb),
    'top_pages', COALESCE((
      SELECT jsonb_agg(t ORDER BY t.views DESC) FROM (
        SELECT page, count(*) AS views, count(DISTINCT user_id) AS users
        FROM public.user_events
        WHERE event_name = 'PAGE_VIEWED' AND source = 'web' AND created_at > now() - make_interval(days => v_days) AND page IS NOT NULL
        GROUP BY page ORDER BY count(*) DESC LIMIT 10
      ) t
    ), '[]'::jsonb),
    'recent_events', COALESCE((
      SELECT jsonb_agg(t ORDER BY t.created_at DESC) FROM (
        SELECT e.id, e.user_id, e.event_name, e.event_type, e.page, e.source, e.created_at, p.email, p.full_name
        FROM public.user_events e LEFT JOIN public.profiles p ON p.id = e.user_id
        WHERE e.event_name <> 'PAGE_VIEWED' AND e.source <> 'backfill'
        ORDER BY e.created_at DESC LIMIT 12
      ) t
    ), '[]'::jsonb),
    'recent_admin_actions', COALESCE((
      SELECT jsonb_agg(t ORDER BY t.created_at DESC) FROM (
        SELECT a.id, a.actor_id, a.actor_kind, a.actor_role, a.actor_email, a.action, a.entity_type, a.entity_id,
               a.target_user_id, a.created_at, p.email AS target_email
        FROM public.admin_audit_log a LEFT JOIN public.profiles p ON p.id = a.target_user_id
        ORDER BY a.created_at DESC LIMIT 10
      ) t
    ), '[]'::jsonb),
    'gri', jsonb_build_object(
      'assessments', (SELECT count(*) FROM public.gri_assessments),
      'avg_index', (SELECT round(avg(gri_index)::numeric, 2) FROM public.gri_assessments WHERE is_current),
      'drafts', (SELECT count(*) FROM public.gri_assessment_drafts)
    ),
    'impersonation_active', (SELECT count(*) FROM public.impersonation_sessions WHERE ended_at IS NULL AND expires_at > now())
  ) INTO v
  FROM (SELECT 1) one;
  RETURN v;
END;
$$;

-- ─── 13. CRM: аналитика активности ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_activity_stats(p_days INT DEFAULT 14)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days INT := LEAST(GREATEST(COALESCE(p_days, 14), 1), 180);
  v JSONB;
BEGIN
  WITH ev AS (
    SELECT * FROM public.user_events
    WHERE created_at > now() - make_interval(days => v_days) AND source IN ('web','server')
  ),
  pv AS (
    SELECT user_id, session_id, page, created_at,
           row_number() OVER (PARTITION BY user_id, session_id ORDER BY created_at DESC) AS rn_desc
    FROM ev WHERE event_name = 'PAGE_VIEWED' AND session_id IS NOT NULL
  )
  SELECT jsonb_build_object(
    'days', v_days,
    'total', (SELECT count(*) FROM ev),
    'users', (SELECT count(DISTINCT user_id) FROM ev),
    'sessions', (SELECT count(DISTINCT (user_id, session_id)) FROM ev WHERE session_id IS NOT NULL),
    'by_name', COALESCE((SELECT jsonb_agg(t ORDER BY t.count DESC) FROM (
        SELECT event_name, event_type, count(*) AS count, count(DISTINCT user_id) AS users FROM ev GROUP BY 1, 2
      ) t), '[]'::jsonb),
    'exit_pages', COALESCE((SELECT jsonb_agg(t ORDER BY t.exits DESC) FROM (
        SELECT page, count(*) AS exits FROM pv WHERE rn_desc = 1 GROUP BY page ORDER BY count(*) DESC LIMIT 10
      ) t), '[]'::jsonb),
    'returning_users', (SELECT count(*) FROM (
        SELECT user_id FROM ev WHERE session_id IS NOT NULL GROUP BY user_id HAVING count(DISTINCT created_at::date) > 1
      ) r),
    'by_hour', COALESCE((SELECT jsonb_agg(jsonb_build_object('hour', h, 'count', COALESCE(x.n, 0)) ORDER BY h)
        FROM generate_series(0, 23) h
        LEFT JOIN (SELECT extract(hour FROM created_at AT TIME ZONE 'Asia/Almaty')::int AS hr, count(*) AS n FROM ev GROUP BY 1) x ON x.hr = h
      ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$$;

-- Только сервер (service_role) может вызывать CRM-функции.
REVOKE ALL ON FUNCTION public.admin_survey_steps() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_users(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_journey_stages() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_overview(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_activity_stats(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.track_survey_answer_history() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emit_user_registered_event() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_survey_steps() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_users(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_journey_stages() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_overview(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_activity_stats(INT) TO service_role;

NOTIFY pgrst, 'reload schema';
