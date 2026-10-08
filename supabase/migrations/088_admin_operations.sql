-- 088_admin_operations.sql — пакет «Операции администратора» (F-013…F-017).
--
-- Всё аддитивно и идемпотентно (можно применять повторно).
--
--   1. expert_cases: ответственный (assignee_id), срок реакции (sla_due_at),
--      время первой реакции (first_response_at) + индексы очереди эскалаций.
--      Старое поле assigned_to (→ profiles) остаётся для совместимости с
--      экспертным порталом; код пишет оба поля.
--   2. Бэкфилл: assignee_id ← assigned_to; sla_due_at для открытых кейсов =
--      created_at + SLA приоритета (из system_settings.escalation_sla_hours,
--      иначе значения по умолчанию critical 2 / high 4 / medium 24 / low 72 ч).
--   3. admin_list_users(): + параметр p_assignee UUID DEFAULT NULL и колонка
--      assignee_id (кто ведёт клиента, user_assignments). Все прежние
--      параметры и колонки сохранены.
--        p_assignee = NULL                                   → все
--        p_assignee = '00000000-0000-0000-0000-000000000000' → без ответственного
--        p_assignee = <uuid сотрудника>                      → клиенты этого сотрудника
--
-- Колонку staff_roles.client_scope добавляет миграция 086 (параллельный пакет);
-- эта миграция на неё не опирается.
--
-- Применение: node scripts/apply-migration.js supabase/migrations/088_admin_operations.sql

-- ─── 1. expert_cases: ответственный и SLA ───────────────────────────────────
ALTER TABLE public.expert_cases
  ADD COLUMN IF NOT EXISTS assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.expert_cases ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ;
ALTER TABLE public.expert_cases ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS expert_cases_assignee_idx
  ON public.expert_cases (assignee_id, status);
-- Очередь: открытые кейсы по сроку реакции.
CREATE INDEX IF NOT EXISTS expert_cases_open_sla_idx
  ON public.expert_cases (sla_due_at)
  WHERE status IN ('new', 'in_progress');

COMMENT ON COLUMN public.expert_cases.assignee_id IS 'Ответственный сотрудник (auth.users). Назначается автоматически по user_assignments клиента или вручную в очереди эскалаций.';
COMMENT ON COLUMN public.expert_cases.sla_due_at IS 'Срок реакции: created_at + escalation_sla_hours[priority]. Пересчитывается при смене приоритета.';
COMMENT ON COLUMN public.expert_cases.first_response_at IS 'Когда кейс впервые взяли в работу (статус ушёл из new).';

-- ─── 2. Бэкфилл ─────────────────────────────────────────────────────────────
-- assigned_to ссылается на profiles(id) = auth.users(id); берём только тех,
-- кто есть в auth.users, чтобы не упасть на FK.
UPDATE public.expert_cases ec
   SET assignee_id = ec.assigned_to
 WHERE ec.assignee_id IS NULL
   AND ec.assigned_to IS NOT NULL
   AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ec.assigned_to);

-- SLA для открытых кейсов. Значение из настроек берём, только если это целое
-- число часов — иначе значение по умолчанию (как делает приложение).
UPDATE public.expert_cases ec
   SET sla_due_at = ec.created_at + make_interval(hours => COALESCE(
         (SELECT CASE WHEN (ss.value ->> ec.priority) ~ '^[0-9]{1,4}$'
                      THEN (ss.value ->> ec.priority)::int END
            FROM public.system_settings ss
           WHERE ss.key = 'escalation_sla_hours'),
         CASE ec.priority WHEN 'critical' THEN 2 WHEN 'high' THEN 4 WHEN 'medium' THEN 24 ELSE 72 END
       ))
 WHERE ec.sla_due_at IS NULL
   AND ec.status IN ('new', 'in_progress');

-- ─── 3. admin_list_users: ответственный ─────────────────────────────────────
-- Тело — как в 082, добавлены параметр p_assignee и колонка assignee_id.
-- Сигнатура меняется, поэтому старую версию удаляем явно.
DROP FUNCTION IF EXISTS public.admin_list_users(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT);
DROP FUNCTION IF EXISTS public.admin_list_users(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, UUID);
CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search   TEXT DEFAULT NULL,
  p_status   TEXT DEFAULT NULL,
  p_role     TEXT DEFAULT NULL,
  p_segment  TEXT DEFAULT NULL,
  p_sort     TEXT DEFAULT 'created_at',
  p_dir      TEXT DEFAULT 'desc',
  p_limit    INT  DEFAULT 25,
  p_offset   INT  DEFAULT 0,
  p_assignee UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID, email TEXT, full_name TEXT, role TEXT, status TEXT, tier TEXT, organization TEXT,
  phone TEXT, created_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ, company_name TEXT,
  survey_steps INT, survey_filled_steps INT[], survey_updated_at TIMESTAMPTZ,
  gri_index NUMERIC, gri_at TIMESTAMPTZ, gri_runs INT, gri_draft BOOLEAN,
  diag_score NUMERIC, staff_role TEXT, assignee_id UUID, total_count BIGINT
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
             sr.role AS staff_role,
             ua.assignee_id
      FROM public.profiles p
      LEFT JOIN LATERAL (SELECT co.name FROM public.companies co WHERE co.user_id = p.id LIMIT 1) c ON true
      LEFT JOIN s ON s.user_id = p.id
      LEFT JOIN g ON g.user_id = p.id
      LEFT JOIN d ON d.user_id = p.id
      LEFT JOIN public.gri_assessment_drafts dr ON dr.user_id = p.id
      LEFT JOIN public.staff_roles sr ON sr.user_id = p.id
      LEFT JOIN public.user_assignments ua ON ua.user_id = p.id
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
        AND (
          $7 IS NULL
          OR ($7 = '00000000-0000-0000-0000-000000000000'::uuid AND b.assignee_id IS NULL)
          OR b.assignee_id = $7
        )
    )
    SELECT b.id, b.email, b.full_name, b.role, b.status, b.tier, b.organization, b.phone,
           b.created_at, b.last_seen_at, b.company_name,
           b.survey_steps, b.survey_filled_steps, b.survey_updated_at,
           b.gri_index, b.gri_at, b.gri_runs, b.gri_draft, b.diag_score, b.staff_role,
           b.assignee_id,
           count(*) OVER () AS total_count
    FROM f b
    ORDER BY %s %s NULLS LAST, b.id
    LIMIT $5 OFFSET $6
  $q$, v_sort, v_dir)
  USING p_search, p_status, p_role, p_segment,
        LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200),
        GREATEST(COALESCE(p_offset, 0), 0),
        p_assignee;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
