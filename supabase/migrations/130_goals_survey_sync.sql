-- 130_goals_survey_sync.sql
--
-- One-time sync of the revenue goals between the questionnaire and
-- public.metric_targets (plan docs/superpowers/plans/2026-10-22-platform-
-- fixes-wave.md, W1). From now on the code keeps them in sync both ways
-- (lib/goals/survey-sync.ts); this fixes the data written before.
--
-- Source of truth: metric_targets, metric 'biz.finansy.vyruchka_god',
-- periods '12m' / '3y'. Mirrors: the numeric answers of the company owner
-- s1_goal_<12m|3y>_revenue_year / _month (survey_answers) and
-- companies.target_revenue_12m_kzt / _3y_kzt.
--
-- The rule, per company (owner = companies.user_id) and horizon, where the
-- owner has a numeric goal answer (year, else month × 12; > 0):
--   1. no metric_targets row                → insert the survey goal;
--   2. a row written by the system           → the survey goal wins
--      (updated_by IS NULL — migration 112 backfill, old mirrors)
--   3. a row a person set (updated_by NOT NULL):
--        newer than the answer               → the goal stays and is written
--                                              back into the answers (year,
--                                              month = round(year / 12), step 1);
--        older than the answer               → the survey goal wins.
--   companies.target_revenue_* takes the resulting goal.
-- The legacy text answers goal_*_v2 are not used here (numeric answers only);
-- goals without any numeric answer are left as they are.
--
-- Data only, idempotent: a second run finds nothing to change.
-- Apply: node scripts/apply-migration.js supabase/migrations/130_goals_survey_sync.sql

DO $$
DECLARE
  r RECORD;
  v_goal NUMERIC;   -- the goal of the horizon after the sync
BEGIN
  FOR r IN
    WITH answers AS (
      SELECT c.id AS company_id,
             c.user_id,
             p.period_label,
             sy.answered_at AS year_at,
             sm.answered_at AS month_at,
             -- a number, or a numeric string («780 000 000»); anything else → NULL
             CASE WHEN jsonb_typeof(sy.answer -> 'value') = 'number' THEN (sy.answer ->> 'value')::numeric
                  WHEN jsonb_typeof(sy.answer -> 'value') = 'string'
                   AND replace(regexp_replace(sy.answer ->> 'value', '[^0-9.,]', '', 'g'), ',', '.') ~ '^[0-9]+(\.[0-9]+)?$'
                  THEN replace(regexp_replace(sy.answer ->> 'value', '[^0-9.,]', '', 'g'), ',', '.')::numeric END AS year_value,
             CASE WHEN jsonb_typeof(sm.answer -> 'value') = 'number' THEN (sm.answer ->> 'value')::numeric
                  WHEN jsonb_typeof(sm.answer -> 'value') = 'string'
                   AND replace(regexp_replace(sm.answer ->> 'value', '[^0-9.,]', '', 'g'), ',', '.') ~ '^[0-9]+(\.[0-9]+)?$'
                  THEN replace(regexp_replace(sm.answer ->> 'value', '[^0-9.,]', '', 'g'), ',', '.')::numeric END AS month_value
      FROM public.companies c
      CROSS JOIN (VALUES ('12m'), ('3y')) AS p(period_label)
      LEFT JOIN public.survey_answers sy
        ON sy.user_id = c.user_id AND sy.question_key = 's1_goal_' || p.period_label || '_revenue_year'
      LEFT JOIN public.survey_answers sm
        ON sm.user_id = c.user_id AND sm.question_key = 's1_goal_' || p.period_label || '_revenue_month'
      WHERE c.user_id IS NOT NULL
    ),
    survey AS (
      SELECT company_id, user_id, period_label,
             CASE WHEN year_value > 0 THEN round(year_value) ELSE round(month_value * 12) END AS survey_value,
             CASE WHEN year_value > 0 THEN year_at ELSE month_at END AS survey_at
      FROM answers
      WHERE year_value > 0 OR month_value > 0
    )
    SELECT s.company_id, s.user_id, s.period_label, s.survey_value, s.survey_at,
           mt.id AS target_id, mt.target_value, mt.updated_by, mt.updated_at
    FROM survey s
    LEFT JOIN public.metric_targets mt
      ON mt.company_id = s.company_id
     AND mt.metric_key = 'biz.finansy.vyruchka_god'
     AND mt.period_label = s.period_label
  LOOP
    v_goal := r.survey_value;
    IF r.target_id IS NULL THEN
      -- 1. The survey has a goal, metric_targets has none.
      INSERT INTO public.metric_targets
        (company_id, metric_key, target_value, direction, period_label, source, label, baseline_at)
      VALUES
        (r.company_id, 'biz.finansy.vyruchka_god', r.survey_value, 'higher_is_better', r.period_label, 'survey',
         CASE WHEN r.period_label = '12m' THEN 'Выручка через 12 месяцев' ELSE 'Выручка через 3 года' END, now())
      ON CONFLICT (company_id, metric_key, period_label) DO NOTHING;

    ELSIF round(r.target_value) IS DISTINCT FROM r.survey_value THEN
      IF r.updated_by IS NOT NULL AND r.updated_at > coalesce(r.survey_at, '-infinity'::timestamptz) THEN
        -- 3a. A person changed the goal after answering: the goal stays, the answers follow.
        v_goal := round(r.target_value);
        INSERT INTO public.survey_answers (user_id, company_id, step, question_key, answer, answered_at)
        VALUES
          (r.user_id, r.company_id, 1, 's1_goal_' || r.period_label || '_revenue_year', jsonb_build_object('value', v_goal), now()),
          (r.user_id, r.company_id, 1, 's1_goal_' || r.period_label || '_revenue_month', jsonb_build_object('value', round(v_goal / 12)), now())
        ON CONFLICT (user_id, question_key) DO UPDATE
          SET answer = EXCLUDED.answer, step = EXCLUDED.step, answered_at = EXCLUDED.answered_at,
              company_id = coalesce(public.survey_answers.company_id, EXCLUDED.company_id);
      ELSE
        -- 2 / 3b. The survey goal wins over a system-written (or older) goal; a new horizon starts.
        UPDATE public.metric_targets
           SET target_value = r.survey_value, source = 'survey', updated_by = NULL,
               baseline_at = now(), baseline_value = NULL, baseline_period = NULL
         WHERE id = r.target_id;
      END IF;
    ELSE
      v_goal := round(r.target_value);
    END IF;

    -- companies.target_revenue_* mirrors the resulting goal.
    IF r.period_label = '12m' THEN
      UPDATE public.companies SET target_revenue_12m_kzt = v_goal
       WHERE id = r.company_id AND target_revenue_12m_kzt IS DISTINCT FROM v_goal;
    ELSE
      UPDATE public.companies SET target_revenue_3y_kzt = v_goal
       WHERE id = r.company_id AND target_revenue_3y_kzt IS DISTINCT FROM v_goal;
    END IF;
  END LOOP;
END $$;
