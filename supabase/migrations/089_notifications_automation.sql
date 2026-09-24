-- 089_notifications_automation.sql — автоматические касания клиента (пакет 4).
--
--   automation_sends          — журнал автоматических и одноразовых уведомлений:
--                               идемпотентность (dedupe_key) + недельный потолок
--                               касаний (counts_toward_cap) + маркер «последний
--                               дайджест» (kind = 'client_digest').
--   automation_client_state() — одна строка на клиента: где он на пути
--                               (анкета, Точка А, GRI) — для cron-напоминаний.
--
-- Всё аддитивно и идемпотентно. Доступ — только service_role (RLS без политик).
-- Применение: node scripts/apply-migration.js supabase/migrations/089_notifications_automation.sql

-- ─── 1. Журнал отправок ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.automation_sends (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL — касание не конкретному клиенту (сводка администраторам).
  user_id            UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Вид касания: survey_reminder, welcome, gri_start_reminder, gri_draft_reminder,
  -- pulse_reminder, gri_rescan, client_digest, staff_tasks, staff_digest, или имя события
  -- продукта (gri_completed, expert_comment …) для одноразовых уведомлений.
  kind               TEXT NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 64),
  -- Ключ идемпотентности: второе касание с тем же ключом не уходит.
  dedupe_key         TEXT CHECK (dedupe_key IS NULL OR char_length(dedupe_key) <= 200),
  -- Учитывается в недельном потолке auto_touch_weekly_cap.
  counts_toward_cap  BOOLEAN NOT NULL DEFAULT false,
  channels           TEXT[] NOT NULL DEFAULT '{}'::text[],
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS automation_sends_dedupe_uniq
  ON public.automation_sends (dedupe_key) WHERE dedupe_key IS NOT NULL;
-- Потолок касаний: «сколько учитываемых касаний у пользователя за 7 дней».
CREATE INDEX IF NOT EXISTS automation_sends_user_sent_idx
  ON public.automation_sends (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS automation_sends_cap_idx
  ON public.automation_sends (user_id, sent_at DESC) WHERE counts_toward_cap;
-- Маркер «последний дайджест» и отчёты по видам.
CREATE INDEX IF NOT EXISTS automation_sends_kind_idx
  ON public.automation_sends (kind, user_id, sent_at DESC);

ALTER TABLE public.automation_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_sends FROM anon, authenticated;

COMMENT ON TABLE public.automation_sends IS
  'Журнал автоматических касаний клиента: идемпотентность (dedupe_key), недельный потолок (counts_toward_cap), маркер последнего дайджеста. Только service_role.';

-- ─── 2. Состояние клиента для напоминаний ────────────────────────────────────
-- survey_last_change_at — последнее изменение анкеты: максимум из истории
-- ответов (survey_answer_history) и answered_at самих ответов.
-- survey_completed — клиент отправил анкету (маркер survey_completed в ленте,
-- см. миграцию 071) ИЛИ заполнены все 12 шагов.
CREATE OR REPLACE FUNCTION public.automation_client_state()
RETURNS TABLE (
  user_id               UUID,
  registered_at         TIMESTAMPTZ,
  approved_at           TIMESTAMPTZ,
  status                TEXT,
  survey_steps          INT,
  survey_filled_steps   INT[],
  survey_first_at       TIMESTAMPTZ,
  survey_last_change_at TIMESTAMPTZ,
  survey_completed      BOOLEAN,
  point_a_at            TIMESTAMPTZ,
  gri_started_at        TIMESTAMPTZ,
  gri_draft_updated_at  TIMESTAMPTZ,
  gri_completed_at      TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (SELECT * FROM public.admin_survey_steps()),
  h AS (
    SELECT sh.user_id, max(sh.created_at) AS last_at
    FROM public.survey_answer_history sh
    GROUP BY sh.user_id
  ),
  m AS (
    SELECT DISTINCT an.user_id
    FROM public.app_notifications an
    WHERE an.category = 'survey' AND an.metadata->>'event' = 'survey_completed'
  )
  SELECT p.id,
         p.created_at,
         CASE WHEN p.status = 'approved' THEN COALESCE(p.approved_at, p.created_at) END,
         p.status,
         COALESCE(s.steps, 0),
         COALESCE(s.filled_steps, '{}'::int[]),
         s.first_at,
         GREATEST(s.last_at, h.last_at),
         (m.user_id IS NOT NULL OR COALESCE(s.steps, 0) >= 12),
         (SELECT min(d.calculated_at) FROM public.diagnostics d WHERE d.user_id = p.id),
         LEAST(
           (SELECT min(ga.created_at) FROM public.gri_assessments ga WHERE ga.user_id = p.id),
           (SELECT dr.updated_at FROM public.gri_assessment_drafts dr WHERE dr.user_id = p.id)
         ),
         (SELECT dr.updated_at FROM public.gri_assessment_drafts dr WHERE dr.user_id = p.id),
         (SELECT max(ga.created_at) FROM public.gri_assessments ga WHERE ga.user_id = p.id)
  FROM public.profiles p
  LEFT JOIN s ON s.user_id = p.id
  LEFT JOIN h ON h.user_id = p.id
  LEFT JOIN m ON m.user_id = p.id
  WHERE p.role = 'client'
$$;

REVOKE ALL ON FUNCTION public.automation_client_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_client_state() TO service_role;

NOTIFY pgrst, 'reload schema';
