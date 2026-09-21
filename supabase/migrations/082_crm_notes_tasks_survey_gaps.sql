-- 082_crm_notes_tasks_survey_gaps.sql — CRM: заметки, ответственный, задачи,
-- «где застрял» в списке пользователей.
--
-- Всё аддитивно и идемпотентно. Существующие данные не меняются.
--
--   user_notes            — заметки сотрудников о клиенте
--   user_assignments      — кто ведёт клиента
--   staff_tasks           — задачи с датой и ответственным
--   admin_survey_steps()  — теперь отдаёт ещё и НОМЕРА заполненных шагов
--   admin_list_users()    — отдаёт survey_filled_steps, чтобы в списке было
--                           видно, на чём человек застрял, без открытия карточки
--
-- Доступ к новым таблицам — только service_role (RLS без политик).
-- Применение: node scripts/apply-migration.js supabase/migrations/082_crm_notes_tasks_survey_gaps.sql

-- ─── 1. Заметки о клиенте ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id    TEXT NOT NULL,
  author_email TEXT,
  author_role  TEXT,
  body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  pinned       BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_notes_user_idx ON public.user_notes (user_id, pinned DESC, created_at DESC);
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_notes FROM anon, authenticated;

-- ─── 2. Ответственный за клиента ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_assignments (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  assignee_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_by  TEXT,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_assignments_assignee_idx ON public.user_assignments (assignee_id);
ALTER TABLE public.user_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_assignments FROM anon, authenticated;

-- ─── 3. Задачи персонала ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  assignee_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title        TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  due_at       TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at      TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_tasks_user_idx ON public.staff_tasks (user_id, status, due_at);
CREATE INDEX IF NOT EXISTS staff_tasks_assignee_idx ON public.staff_tasks (assignee_id, status, due_at);
ALTER TABLE public.staff_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_tasks FROM anon, authenticated;

-- ─── 4. Какие шаги анкеты заполнены ──────────────────────────────────────────
-- Раньше функция отдавала только КОЛИЧЕСТВО шагов, поэтому «17 начали, 2
-- закончили» было видно, а «на каком шаге бросили» — нет. Теперь отдаёт и
-- сами номера: список пользователей показывает пропуски без открытия карточки.
-- Общий предикат «ответ непустой» — чтобы условие не расходилось между
-- подсчётом шагов и списком заполненных шагов.
CREATE OR REPLACE FUNCTION public.admin_answer_filled(p_answer JSONB)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_answer ? 'value'
     AND jsonb_typeof(p_answer -> 'value') <> 'null'
     AND (p_answer -> 'value') NOT IN ('""'::jsonb, '[]'::jsonb, '{}'::jsonb)
$$;

DROP FUNCTION IF EXISTS public.admin_survey_steps();
CREATE OR REPLACE FUNCTION public.admin_survey_steps()
RETURNS TABLE (user_id UUID, steps INT, filled_steps INT[], first_at TIMESTAMPTZ, last_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sa.user_id,
         count(DISTINCT sa.step) FILTER (WHERE sa.step BETWEEN 1 AND 12 AND public.admin_answer_filled(sa.answer))::int,
         COALESCE(
           array_agg(DISTINCT sa.step ORDER BY sa.step)
             FILTER (WHERE sa.step BETWEEN 1 AND 12 AND public.admin_answer_filled(sa.answer)),
           '{}'::int[]
         ),
         min(sa.answered_at),
         max(sa.answered_at)
  FROM public.survey_answers sa
  WHERE sa.question_key ~ '^s[0-9]+[a-z]?_'
  GROUP BY sa.user_id
$$;

REVOKE ALL ON FUNCTION public.admin_survey_steps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_survey_steps() TO service_role;

NOTIFY pgrst, 'reload schema';

-- ─── 5. Список пользователей отдаёт заполненные шаги анкеты ──────────────────
-- Тело — как в 079, добавлена одна колонка survey_filled_steps.
-- Набор выходных колонок меняется, поэтому нужен DROP: CREATE OR REPLACE
-- не умеет менять сигнатуру возвращаемой таблицы.
DROP FUNCTION IF EXISTS public.admin_list_users(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT);
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
  survey_steps INT, survey_filled_steps INT[], survey_updated_at TIMESTAMPTZ,
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
    WHEN 'survey_updated' THEN 'b.survey_updated_at'
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
             COALESCE(s.steps, 0) AS survey_steps,
             COALESCE(s.filled_steps, '{}'::int[]) AS survey_filled_steps,
             s.last_at AS survey_updated_at,
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
           b.created_at, b.last_seen_at, b.company_name,
           b.survey_steps, b.survey_filled_steps, b.survey_updated_at,
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

REVOKE ALL ON FUNCTION public.admin_list_users(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT) TO service_role;

NOTIFY pgrst, 'reload schema';
