-- 075_journey_exclude_admin_events.sql
-- CJM / воронка: события, которые администратор сгенерировал в кабинете
-- клиента (source = 'impersonation' / 'admin'), не являются действиями клиента
-- и не должны двигать его по этапам. Меняется только тело функции.
-- Применение: node scripts/apply-migration.js supabase/migrations/075_journey_exclude_admin_events.sql

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
           (SELECT min(e.created_at) FROM public.user_events e
             WHERE e.user_id = p.id AND e.event_name = 'GRI_STARTED' AND e.source IN ('web', 'server', 'backfill'))
         ),
         (SELECT min(ga.created_at) FROM public.gri_assessments ga WHERE ga.user_id = p.id),
         (SELECT min(pb.calculated_at) FROM public.point_b_analysis pb
            JOIN public.diagnostics d ON d.id = pb.diagnostic_id WHERE d.user_id = p.id),
         (SELECT min(e.created_at) FROM public.user_events e
           WHERE e.user_id = p.id AND e.event_name = 'CONTENT_VIEWED' AND e.source = 'web'),
         p.last_seen_at
  FROM public.profiles p
  LEFT JOIN s ON s.user_id = p.id
  WHERE p.role = 'client'
$$;

REVOKE ALL ON FUNCTION public.admin_journey_stages() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_journey_stages() TO service_role;

NOTIFY pgrst, 'reload schema';
