-- 090_analytics.sql — продуктовая аналитика (пакет 5).
--
-- Всё идемпотентно: CREATE ... IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS.
-- Данные не меняются (кроме новых таблиц-агрегатов, которые можно пересобрать).
--
--   1. «Анкета заполнена» (F-065) — единое определение вместо survey_steps >= 12:
--        admin_survey_completions()   — (user_id, completed_at) для всех
--        survey_completed_at(uuid)    — то же для одного пользователя
--        user_segment_facts(uuid)     — + поле survey_completed
--        admin_journey_stages()       — + колонка survey_completed_at (DROP + CREATE)
--   2. Ежедневный агрегат активности (F-066):
--        daily_activity, daily_activity_runs, analytics_is_staff(uuid),
--        rollup_daily_activity(date), analytics_missing_days(int),
--        admin_activity_series(int), admin_retention_cohorts(int)
--   3. Активация и Free→Pro (F-067):
--        admin_activation_rate(int, text, int), admin_free_to_pro(int)
--   4. admin_overview(int) — воронка по новому определению анкеты, активные
--      пользователи из daily_activity (фолбэк на profiles.last_seen_at).
--
-- Зависимости: 037 (app_notifications), 073 (user_events, staff_roles),
-- 082 (admin_survey_steps с filled_steps, admin_answer_filled).
-- admin_list_users НЕ меняется (сегмент survey_completed там — отдельная задача;
-- для неё готова функция admin_survey_completions()).
--
-- Дни считаются по времени Алматы (Asia/Almaty) — так же, как «активность по
-- часам» в admin_activity_stats и cron в 03:00 по Алматы.
-- Доступ ко всем функциям — только service_role.
-- Применение: node scripts/apply-migration.js supabase/migrations/090_analytics.sql

-- ─── 1. «Анкета заполнена» ───────────────────────────────────────────────────
-- Канонический источник — lib/survey/completion.ts. Анкета заполнена, если
-- выполнено ЛЮБОЕ из трёх (берётся самое раннее время):
--   а) маркер app_notifications(category='survey', metadata.event='survey_completed')
--      — ставится один раз, когда клиент отправил финальный шаг мастера или
--      анкета впервые стала полной (lib/survey/completion-notice.ts, индекс 071);
--   б) событие QUESTIONNAIRE_COMPLETED (финальная отправка мастера);
--   в) заполнены все 12 шагов (старое правило; нужно для анкет до маркера).
-- Шаг 12 можно пройти пустым, поэтому (в) само по себе занижало конверсию.
CREATE OR REPLACE FUNCTION public.admin_survey_completions()
RETURNS TABLE (user_id UUID, completed_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT x.user_id, min(x.at)
  FROM (
    SELECT n.user_id, n.created_at AS at
    FROM public.app_notifications n
    WHERE n.category = 'survey' AND n.metadata ->> 'event' = 'survey_completed'
    UNION ALL
    SELECT e.user_id, e.created_at
    FROM public.user_events e
    WHERE e.event_name = 'QUESTIONNAIRE_COMPLETED' AND e.user_id IS NOT NULL
    UNION ALL
    SELECT s.user_id, s.last_at
    FROM public.admin_survey_steps() s
    WHERE s.steps >= 12
  ) x
  WHERE x.user_id IS NOT NULL
  GROUP BY x.user_id
$$;

CREATE OR REPLACE FUNCTION public.survey_completed_at(p_user UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT min(x.at) FROM (
    SELECT min(n.created_at) AS at
    FROM public.app_notifications n
    WHERE n.user_id = p_user AND n.category = 'survey' AND n.metadata ->> 'event' = 'survey_completed'
    UNION ALL
    SELECT min(e.created_at)
    FROM public.user_events e
    WHERE e.user_id = p_user AND e.event_name = 'QUESTIONNAIRE_COMPLETED'
    UNION ALL
    SELECT CASE
             WHEN count(DISTINCT sa.step) FILTER (WHERE sa.step BETWEEN 1 AND 12 AND public.admin_answer_filled(sa.answer)) >= 12
             THEN max(sa.answered_at)
           END
    FROM public.survey_answers sa
    WHERE sa.user_id = p_user AND sa.question_key ~ '^s[0-9]+[a-z]?_'
  ) x
$$;

-- Факты для правил видимости: + survey_completed (survey_steps остаётся).
CREATE OR REPLACE FUNCTION public.user_segment_facts(p_user UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'role', p.role,
    'status', p.status,
    'tier', COALESCE(p.tier, 'free'),
    'vertical', COALESCE(p.vertical, 'generic'),
    'created_at', p.created_at,
    'survey_steps', (
      SELECT count(DISTINCT sa.step) FROM public.survey_answers sa
      WHERE sa.user_id = p.id AND sa.step BETWEEN 1 AND 12
        AND sa.question_key ~ '^s[0-9]+[a-z]?_'
        AND sa.answer ? 'value'
        AND jsonb_typeof(sa.answer -> 'value') <> 'null'
        AND (sa.answer -> 'value') NOT IN ('""'::jsonb, '[]'::jsonb, '{}'::jsonb)
    ),
    'survey_completed', (public.survey_completed_at(p.id) IS NOT NULL),
    'gri_runs', (SELECT count(*) FROM public.gri_assessments g WHERE g.user_id = p.id),
    'is_staff', (p.role IN ('super_admin','admin') OR EXISTS (SELECT 1 FROM public.staff_roles s WHERE s.user_id = p.id))
  )
  FROM public.profiles p
  WHERE p.id = p_user
$$;

-- Воронка/CJM: этап «анкета заполнена» — по единому определению.
-- Набор колонок меняется → DROP + CREATE (тело — как в 075 + survey_completed_at).
DROP FUNCTION IF EXISTS public.admin_journey_stages();
CREATE OR REPLACE FUNCTION public.admin_journey_stages()
RETURNS TABLE (
  user_id UUID, registered_at TIMESTAMPTZ, approved_at TIMESTAMPTZ,
  survey_started_at TIMESTAMPTZ, survey_steps INT, survey_updated_at TIMESTAMPTZ,
  survey_completed_at TIMESTAMPTZ,
  point_a_at TIMESTAMPTZ, gri_started_at TIMESTAMPTZ, gri_completed_at TIMESTAMPTZ,
  point_b_at TIMESTAMPTZ, content_viewed_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (SELECT * FROM public.admin_survey_steps()),
  c AS (SELECT * FROM public.admin_survey_completions())
  SELECT p.id,
         p.created_at,
         CASE WHEN p.status = 'approved' THEN COALESCE(p.approved_at, p.created_at) END,
         s.first_at,
         COALESCE(s.steps, 0),
         s.last_at,
         c.completed_at,
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
  LEFT JOIN c ON c.user_id = p.id
  WHERE p.role = 'client'
$$;

-- ─── 2. Ежедневный агрегат активности ────────────────────────────────────────
-- Одна строка = пользователь был активен в этот день (по Алматы).
-- Активность = события с source web/server (не админ, не «от имени», не бэкфил).
-- Персонал исключается. first_seen = первый активный день пользователя.
CREATE TABLE IF NOT EXISTS public.daily_activity (
  day        DATE NOT NULL,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  events     INT NOT NULL DEFAULT 0,
  first_seen BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (day, user_id)
);
CREATE INDEX IF NOT EXISTS daily_activity_user_idx ON public.daily_activity (user_id, day);
ALTER TABLE public.daily_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_activity FROM anon, authenticated;

-- Какие дни уже свёрнуты: день без активности не оставляет строк в
-- daily_activity, поэтому «пропущенные дни» определяются по этой таблице.
CREATE TABLE IF NOT EXISTS public.daily_activity_runs (
  day       DATE PRIMARY KEY,
  users     INT NOT NULL DEFAULT 0,
  rolled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.daily_activity_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_activity_runs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.analytics_is_staff(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff_roles sr WHERE sr.user_id = p_user)
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user AND p.role IN ('super_admin','admin','super_expert','expert'))
$$;

-- Идемпотентно: день пересчитывается целиком (удалить → вставить) в одной транзакции.
CREATE OR REPLACE FUNCTION public.rollup_daily_activity(p_day DATE)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from  TIMESTAMPTZ := (p_day::timestamp) AT TIME ZONE 'Asia/Almaty';
  v_to    TIMESTAMPTZ := ((p_day + 1)::timestamp) AT TIME ZONE 'Asia/Almaty';
  v_users INT;
BEGIN
  IF p_day IS NULL OR p_day > (now() AT TIME ZONE 'Asia/Almaty')::date THEN
    RETURN 0;
  END IF;

  DELETE FROM public.daily_activity WHERE day = p_day;

  INSERT INTO public.daily_activity (day, user_id, events, first_seen)
  SELECT p_day, a.user_id, a.n,
         NOT EXISTS (
           SELECT 1 FROM public.user_events e2
           WHERE e2.user_id = a.user_id AND e2.created_at < v_from AND e2.source IN ('web','server')
         )
  FROM (
    SELECT e.user_id, count(*)::int AS n
    FROM public.user_events e
    WHERE e.created_at >= v_from AND e.created_at < v_to
      AND e.user_id IS NOT NULL
      AND e.source IN ('web','server')
    GROUP BY e.user_id
  ) a
  JOIN auth.users u ON u.id = a.user_id
  WHERE NOT public.analytics_is_staff(a.user_id)
  ON CONFLICT (day, user_id) DO UPDATE SET events = EXCLUDED.events, first_seen = EXCLUDED.first_seen;

  GET DIAGNOSTICS v_users = ROW_COUNT;

  INSERT INTO public.daily_activity_runs (day, users, rolled_at)
  VALUES (p_day, v_users, now())
  ON CONFLICT (day) DO UPDATE SET users = EXCLUDED.users, rolled_at = EXCLUDED.rolled_at;

  RETURN v_users;
END;
$$;

-- Дни последних p_days (до вчера по Алматы), которые ещё ни разу не сворачивались.
CREATE OR REPLACE FUNCTION public.analytics_missing_days(p_days INT DEFAULT 90)
RETURNS TABLE (day DATE)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d::date
  FROM generate_series(
         (now() AT TIME ZONE 'Asia/Almaty')::date - LEAST(GREATEST(COALESCE(p_days, 90), 1), 366),
         (now() AT TIME ZONE 'Asia/Almaty')::date - 1,
         interval '1 day') d
  WHERE NOT EXISTS (SELECT 1 FROM public.daily_activity_runs r WHERE r.day = d::date)
  ORDER BY 1 DESC
$$;

-- DAU / скользящие WAU (7 дней) / MAU (30 дней) / stickiness = DAU/MAU, %.
-- Ряд заканчивается вчерашним днём: сегодняшний ещё не свёрнут.
CREATE OR REPLACE FUNCTION public.admin_activity_series(p_days INT DEFAULT 30)
RETURNS TABLE (day DATE, dau INT, wau INT, mau INT, stickiness NUMERIC, new_users INT, rolled BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH bounds AS (
    SELECT (now() AT TIME ZONE 'Asia/Almaty')::date - 1 AS last_day,
           LEAST(GREATEST(COALESCE(p_days, 30), 7), 180) AS n
  ),
  days AS (
    SELECT d::date AS day
    FROM bounds b, generate_series(b.last_day - (b.n - 1), b.last_day, interval '1 day') d
  )
  SELECT x.day, x.dau, x.wau, x.mau,
         CASE WHEN x.mau = 0 THEN NULL ELSE round(100.0 * x.dau / x.mau, 1) END,
         x.new_users, x.rolled
  FROM (
    SELECT d.day,
           (SELECT count(*) FROM public.daily_activity a WHERE a.day = d.day)::int AS dau,
           (SELECT count(DISTINCT a.user_id) FROM public.daily_activity a WHERE a.day > d.day - 7 AND a.day <= d.day)::int AS wau,
           (SELECT count(DISTINCT a.user_id) FROM public.daily_activity a WHERE a.day > d.day - 30 AND a.day <= d.day)::int AS mau,
           (SELECT count(*) FROM public.daily_activity a WHERE a.day = d.day AND a.first_seen)::int AS new_users,
           EXISTS (SELECT 1 FROM public.daily_activity_runs r WHERE r.day = d.day) AS rolled
    FROM days d
  ) x
  ORDER BY x.day
$$;

-- Недельные когорты регистрации (клиенты, без персонала) × удержание.
--   d1/d7/d30 — доля когорты, вернувшейся в день N или позже (rolling retention);
--   weeks[k]  — доля когорты, активной на неделе k после регистрации (дни 7k..7k+6), k = 1..8.
-- В знаменателе только те, для кого день/неделя уже наступили; если таких нет — NULL.
CREATE OR REPLACE FUNCTION public.admin_retention_cohorts(p_weeks INT DEFAULT 8)
RETURNS TABLE (cohort_start DATE, cohort_size INT, d1 NUMERIC, d7 NUMERIC, d30 NUMERIC, weeks NUMERIC[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH bounds AS (
    SELECT (now() AT TIME ZONE 'Asia/Almaty')::date - 1 AS last_day,
           LEAST(GREATEST(COALESCE(p_weeks, 8), 1), 26) AS n
  ),
  reg AS (
    SELECT p.id AS user_id,
           (p.created_at AT TIME ZONE 'Asia/Almaty')::date AS reg_day,
           date_trunc('week', (p.created_at AT TIME ZONE 'Asia/Almaty'))::date AS cohort_start
    FROM public.profiles p, bounds b
    WHERE p.created_at IS NOT NULL
      AND p.role = 'client'
      AND NOT public.analytics_is_staff(p.id)
      AND (p.created_at AT TIME ZONE 'Asia/Almaty')::date >= date_trunc('week', b.last_day::timestamp)::date - (b.n - 1) * 7
  ),
  per_user AS (
    SELECT r.user_id, r.reg_day, r.cohort_start,
           (SELECT max(a.day) FROM public.daily_activity a WHERE a.user_id = r.user_id AND a.day > r.reg_day) AS last_return,
           ARRAY(
             SELECT DISTINCT ((a.day - r.reg_day) / 7)::int
             FROM public.daily_activity a
             WHERE a.user_id = r.user_id AND a.day >= r.reg_day + 7 AND a.day < r.reg_day + 63
           ) AS active_weeks
    FROM reg r
  ),
  pct AS (
    SELECT u.cohort_start,
           count(*)::int AS size,
           count(*) FILTER (WHERE u.reg_day + 1 <= b.last_day) AS e1,
           count(*) FILTER (WHERE u.reg_day + 1 <= b.last_day AND u.last_return >= u.reg_day + 1) AS h1,
           count(*) FILTER (WHERE u.reg_day + 7 <= b.last_day) AS e7,
           count(*) FILTER (WHERE u.reg_day + 7 <= b.last_day AND u.last_return >= u.reg_day + 7) AS h7,
           count(*) FILTER (WHERE u.reg_day + 30 <= b.last_day) AS e30,
           count(*) FILTER (WHERE u.reg_day + 30 <= b.last_day AND u.last_return >= u.reg_day + 30) AS h30,
           ARRAY(
             SELECT CASE WHEN count(*) FILTER (WHERE u2.reg_day + k * 7 + 6 <= b.last_day) = 0 THEN NULL
                         ELSE round(100.0 * count(*) FILTER (WHERE u2.reg_day + k * 7 + 6 <= b.last_day AND k = ANY (u2.active_weeks))
                                    / count(*) FILTER (WHERE u2.reg_day + k * 7 + 6 <= b.last_day), 1) END
             FROM generate_series(1, 8) k
             CROSS JOIN per_user u2
             WHERE u2.cohort_start = u.cohort_start
             GROUP BY k ORDER BY k
           ) AS weeks
    FROM per_user u, bounds b
    GROUP BY u.cohort_start, b.last_day
  )
  SELECT p.cohort_start, p.size,
         CASE WHEN p.e1 = 0 THEN NULL ELSE round(100.0 * p.h1 / p.e1, 1) END,
         CASE WHEN p.e7 = 0 THEN NULL ELSE round(100.0 * p.h7 / p.e7, 1) END,
         CASE WHEN p.e30 = 0 THEN NULL ELSE round(100.0 * p.h30 / p.e30, 1) END,
         p.weeks
  FROM pct p
  ORDER BY p.cohort_start DESC
$$;

-- ─── 3. Активация и Free→Pro ─────────────────────────────────────────────────
-- Активация: доля клиентов, зарегистрированных за p_days, которые совершили
-- ключевое событие не позже чем через p_window дней после регистрации.
-- Событие задаётся настройкой activation_event (GRI_COMPLETED по умолчанию);
-- QUESTIONNAIRE_COMPLETED считается по единому определению анкеты.
CREATE OR REPLACE FUNCTION public.admin_activation_rate(
  p_days INT DEFAULT 30,
  p_event TEXT DEFAULT 'GRI_COMPLETED',
  p_window INT DEFAULT 7
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days   INT := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
  v_window INT := LEAST(GREATEST(COALESCE(p_window, 7), 1), 90);
  v_event  TEXT := CASE WHEN p_event IN ('GRI_COMPLETED','QUESTIONNAIRE_COMPLETED','POINT_A_CALCULATED') THEN p_event ELSE 'GRI_COMPLETED' END;
  v JSONB;
BEGIN
  WITH reg AS (
    SELECT p.id, p.created_at
    FROM public.profiles p
    WHERE p.role = 'client'
      AND p.created_at > now() - make_interval(days => v_days)
      AND NOT public.analytics_is_staff(p.id)
  ),
  hit AS (
    SELECT r.id, r.created_at,
           CASE WHEN v_event = 'QUESTIONNAIRE_COMPLETED' THEN public.survey_completed_at(r.id)
                ELSE (SELECT min(e.created_at) FROM public.user_events e
                      WHERE e.user_id = r.id AND e.event_name = v_event AND e.source IN ('web','server','backfill'))
           END AS at
    FROM reg r
  )
  SELECT jsonb_build_object(
    'event', v_event,
    'window_days', v_window,
    'days', v_days,
    'registered', count(*),
    'activated', count(*) FILTER (WHERE h.at IS NOT NULL AND h.at <= h.created_at + make_interval(days => v_window)),
    'pending', count(*) FILTER (WHERE h.at IS NULL AND h.created_at > now() - make_interval(days => v_window)),
    'rate', CASE WHEN count(*) = 0 THEN NULL
                 ELSE round(100.0 * count(*) FILTER (WHERE h.at IS NOT NULL AND h.at <= h.created_at + make_interval(days => v_window)) / count(*), 1) END
  ) INTO v
  FROM hit h;
  RETURN v;
END;
$$;

-- Free→Pro: пользователи, переведённые на Pro за период. Источники:
--   события TIER_CHANGED (metadata.to = 'pro', from ≠ 'pro') — с пакета 5;
--   журнал admin_audit_log: user.access_changed (new_value.tier = 'pro') и
--   payment.succeeded (Kaspi-вебхук ставит tier = 'pro') — история до пакета 5.
-- rate = перешедшие / (перешедшие + клиенты, которые сейчас на Free).
CREATE OR REPLACE FUNCTION public.admin_free_to_pro(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days INT := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
  v JSONB;
BEGIN
  WITH conv AS (
    SELECT e.user_id
    FROM public.user_events e
    WHERE e.event_name = 'TIER_CHANGED'
      AND e.created_at > now() - make_interval(days => v_days)
      AND e.metadata ->> 'to' = 'pro'
      AND COALESCE(e.metadata ->> 'from', 'free') <> 'pro'
      AND e.user_id IS NOT NULL
    UNION
    SELECT a.target_user_id
    FROM public.admin_audit_log a
    WHERE a.created_at > now() - make_interval(days => v_days)
      AND a.target_user_id IS NOT NULL
      AND (
        (a.action = 'user.access_changed' AND a.new_value ->> 'tier' = 'pro' AND COALESCE(a.old_value ->> 'tier', 'free') <> 'pro')
        OR a.action = 'payment.succeeded'
      )
  ),
  conv_clients AS (
    SELECT c.user_id FROM conv c
    JOIN public.profiles p ON p.id = c.user_id
    WHERE NOT public.analytics_is_staff(c.user_id)
  ),
  free_now AS (
    SELECT count(*) AS n FROM public.profiles p
    WHERE p.role = 'client' AND COALESCE(p.tier, 'free') <> 'pro' AND NOT public.analytics_is_staff(p.id)
  )
  SELECT jsonb_build_object(
    'days', v_days,
    'conversions', (SELECT count(*) FROM conv_clients),
    'free_now', (SELECT n FROM free_now),
    'pro_now', (SELECT count(*) FROM public.profiles p WHERE p.role = 'client' AND p.tier = 'pro'),
    'rate', CASE WHEN (SELECT count(*) FROM conv_clients) + (SELECT n FROM free_now) = 0 THEN NULL
                 ELSE round(100.0 * (SELECT count(*) FROM conv_clients)
                            / ((SELECT count(*) FROM conv_clients) + (SELECT n FROM free_now)), 1) END
  ) INTO v;
  RETURN v;
END;
$$;

-- ─── 4. Сводка главного экрана ───────────────────────────────────────────────
-- Как в 073, но:
--   * «анкета заполнена» — по admin_journey_stages().survey_completed_at;
--   * активные за 1/7/30 дней — из daily_activity (+ сегодняшние события, ещё не
--     свёрнутые), если агрегат уже наполнен; иначе, как раньше, по last_seen_at.
CREATE OR REPLACE FUNCTION public.admin_overview(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days  INT := LEAST(GREATEST(COALESCE(p_days, 30), 7), 180);
  v_today DATE := (now() AT TIME ZONE 'Asia/Almaty')::date;
  v_rolled BOOLEAN := EXISTS (SELECT 1 FROM public.daily_activity_runs r WHERE r.day >= v_today - 30);
  v_active JSONB;
  v JSONB;
BEGIN
  IF v_rolled THEN
    WITH today AS (
      SELECT DISTINCT e.user_id
      FROM public.user_events e
      WHERE e.created_at >= (v_today::timestamp AT TIME ZONE 'Asia/Almaty')
        AND e.user_id IS NOT NULL AND e.source IN ('web','server')
        AND NOT public.analytics_is_staff(e.user_id)
    ),
    act AS (
      SELECT a.user_id, a.day FROM public.daily_activity a WHERE a.day > v_today - 30
      UNION ALL
      SELECT t.user_id, v_today FROM today t
    )
    SELECT jsonb_build_object(
      'active_1d', (SELECT count(DISTINCT user_id) FROM act WHERE day >= v_today - 0),
      'active_7d', (SELECT count(DISTINCT user_id) FROM act WHERE day > v_today - 7),
      'active_30d', (SELECT count(DISTINCT user_id) FROM act WHERE day > v_today - 30),
      'active_source', 'daily_activity'
    ) INTO v_active;
  ELSE
    v_active := jsonb_build_object(
      'active_1d', (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '1 day'),
      'active_7d', (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '7 days'),
      'active_30d', (SELECT count(*) FROM public.profiles WHERE last_seen_at > now() - interval '30 days'),
      'active_source', 'last_seen_at'
    );
  END IF;

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
      'active_1d', (v_active ->> 'active_1d')::int,
      'active_7d', (v_active ->> 'active_7d')::int,
      'active_30d', (v_active ->> 'active_30d')::int,
      'pending_approval', (SELECT count(*) FROM public.profiles WHERE status = 'pending_approval'),
      'blocked', (SELECT count(*) FROM public.profiles WHERE status IN ('blocked','archived'))
    ),
    'active_source', v_active ->> 'active_source',
    'funnel', jsonb_build_array(
      jsonb_build_object('key','registered','count',(SELECT count(*) FROM j)),
      jsonb_build_object('key','approved','count',(SELECT count(*) FROM j WHERE approved_at IS NOT NULL)),
      jsonb_build_object('key','survey_started','count',(SELECT count(*) FROM j WHERE survey_steps > 0 OR survey_completed_at IS NOT NULL)),
      jsonb_build_object('key','survey_completed','count',(SELECT count(*) FROM j WHERE survey_completed_at IS NOT NULL)),
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

-- ─── 5. Права: только service_role ───────────────────────────────────────────
REVOKE ALL ON FUNCTION public.admin_survey_completions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.survey_completed_at(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_segment_facts(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_journey_stages() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_is_staff(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rollup_daily_activity(DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_missing_days(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_activity_series(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_retention_cohorts(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_activation_rate(INT, TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_free_to_pro(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_overview(INT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_survey_completions() TO service_role;
GRANT EXECUTE ON FUNCTION public.survey_completed_at(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.user_segment_facts(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_journey_stages() TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_is_staff(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.rollup_daily_activity(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_missing_days(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_activity_series(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_retention_cohorts(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_activation_rate(INT, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_free_to_pro(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_overview(INT) TO service_role;

NOTIFY pgrst, 'reload schema';
