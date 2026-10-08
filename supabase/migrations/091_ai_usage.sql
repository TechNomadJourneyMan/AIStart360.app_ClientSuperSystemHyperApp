-- 091_ai_usage.sql — стоимость и качество AI, поиск и подсказки из документов.
--
-- Всё аддитивно и идемпотентно (можно применять повторно). Данные не меняются,
-- кроме снятия NOT NULL с document_summaries."clientId" (см. §5).
--
--   ai_usage                       — учёт каждого вызова модели: токены, стоимость, задержка
--   ai_usage_summary(p_days)       — сводка по функциям/моделям за N дней (плитка в панели)
--   ai_usage_user_today(p_user)    — сколько $ пользователь потратил сегодня (дневной бюджет)
--   ai_briefing_cache              — утренний брифинг Pulse: один текст на пользователя в день
--   diagnostics.narrative_input_hash — хэш входа Точки А: при неизменных данных LLM не зовём
--   document_survey_suggestions    — ответы анкеты, найденные в документах (ждут «Принять»)
--   document_summaries."clientId"  — nullable: индексировать документы можно без Prisma-клиента
--
-- Поиск по документам использует уже существующую RPC match_user_document_chunks (054).
--
-- Доступ к новым таблицам — только service_role (RLS включён, политик нет).
-- Применение: node scripts/apply-migration.js supabase/migrations/091_ai_usage.sql

-- ─── 1. Учёт вызовов AI ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id                BIGSERIAL PRIMARY KEY,
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_id          TEXT,
  feature           TEXT NOT NULL,
  model             TEXT NOT NULL,
  prompt_tokens     INT  NOT NULL DEFAULT 0,
  completion_tokens INT  NOT NULL DEFAULT 0,
  cost_usd          NUMERIC(10, 6),
  latency_ms        INT,
  ok                BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_user_created_idx    ON public.ai_usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_feature_created_idx ON public.ai_usage (feature, created_at DESC);
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage FROM anon, authenticated;

-- Сводка: вызовы, токены и стоимость по функции и модели за последние p_days дней.
CREATE OR REPLACE FUNCTION public.ai_usage_summary(p_days INT DEFAULT 30)
RETURNS TABLE (
  feature           TEXT,
  model             TEXT,
  calls             BIGINT,
  failed_calls      BIGINT,
  prompt_tokens     BIGINT,
  completion_tokens BIGINT,
  cost_usd          NUMERIC,
  avg_latency_ms    INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.feature,
         u.model,
         count(*)                                   AS calls,
         count(*) FILTER (WHERE NOT u.ok)           AS failed_calls,
         coalesce(sum(u.prompt_tokens), 0)          AS prompt_tokens,
         coalesce(sum(u.completion_tokens), 0)      AS completion_tokens,
         coalesce(sum(u.cost_usd), 0)               AS cost_usd,
         avg(u.latency_ms)::int                     AS avg_latency_ms
    FROM public.ai_usage u
   WHERE u.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
   GROUP BY u.feature, u.model
   ORDER BY coalesce(sum(u.cost_usd), 0) DESC, count(*) DESC;
$$;
REVOKE ALL ON FUNCTION public.ai_usage_summary(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_usage_summary(INT) TO service_role;

-- Потрачено пользователем «сегодня» (сутки по Алматы — рабочий часовой пояс платформы).
CREATE OR REPLACE FUNCTION public.ai_usage_user_today(p_user UUID)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(u.cost_usd), 0)
    FROM public.ai_usage u
   WHERE u.user_id = p_user
     AND u.created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Almaty') AT TIME ZONE 'Asia/Almaty');
$$;
REVOKE ALL ON FUNCTION public.ai_usage_user_today(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_usage_user_today(UUID) TO service_role;

-- ─── 2. Кэш утреннего брифинга (Pulse) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_briefing_cache (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
ALTER TABLE public.ai_briefing_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_briefing_cache FROM anon, authenticated;

-- ─── 3. Кэш AI-анализа Точки А ───────────────────────────────────────────────
ALTER TABLE public.diagnostics ADD COLUMN IF NOT EXISTS narrative_input_hash TEXT;
CREATE INDEX IF NOT EXISTS diagnostics_user_narrative_hash_idx
  ON public.diagnostics (user_id, narrative_input_hash)
  WHERE narrative_input_hash IS NOT NULL;

-- ─── 4. Подсказки ответов анкеты из документов ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_survey_suggestions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_key       TEXT NOT NULL,
  value              JSONB NOT NULL,
  label              TEXT,
  source_document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  confidence         NUMERIC(4, 3),
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS document_survey_suggestions_uniq
  ON public.document_survey_suggestions (user_id, question_key, source_document_id);
CREATE INDEX IF NOT EXISTS document_survey_suggestions_pending_idx
  ON public.document_survey_suggestions (user_id, status);
ALTER TABLE public.document_survey_suggestions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_survey_suggestions FROM anon, authenticated;

-- ─── 5. Индексация документов без Prisma-клиента ─────────────────────────────
-- Раньше эмбеддинги строились только если у владельца есть строка в Prisma
-- `clients` (managerId = user_id) — у обычных клиентов её нет, поэтому поиск по
-- документам молча оставался пустым. Владелец теперь хранится в user_id (054).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'document_summaries'
       AND column_name = 'clientId' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.document_summaries ALTER COLUMN "clientId" DROP NOT NULL;
  END IF;
END $$;
