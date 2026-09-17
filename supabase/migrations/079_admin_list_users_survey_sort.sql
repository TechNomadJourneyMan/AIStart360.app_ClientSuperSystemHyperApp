-- 079_admin_list_users_survey_sort.sql
-- Раздел «Анкеты»: сортировка по дате последнего изменения анкеты
-- (p_sort = 'survey_updated'). Остальное тело функции — как в 073.
-- Применение: node scripts/apply-migration.js supabase/migrations/079_admin_list_users_survey_sort.sql

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

REVOKE ALL ON FUNCTION public.admin_list_users(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT) TO service_role;

NOTIFY pgrst, 'reload schema';
