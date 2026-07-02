-- =============================================================================
-- AIStart360 — Migration 038: Mascot assistant events (audit / product analytics)
--
--   * public.assistant_events — minimal interaction log for the mascot
--     assistant «Гри» (docs/TZ-mascot-assistant.md §16.4). One row per event
--     (hint_shown / hint_clicked / chat_opened / mascot_hidden / feedback /…).
--     NO message texts and NO personal data are ever stored here — only event
--     type, screen, a reference id and a small numeric/flag meta bag. Texts of
--     LLM exchanges live in Langfuse traces with their own retention.
--
--   Mascot SETTINGS deliberately do NOT get a table: they live in
--   profiles.preferences.assistant (the migration-035 "single JSONB bag"
--   convention), managed by /api/v1/assistant/settings.
--
-- Idempotent — safe to re-run. RLS mirrors migration 032 (expert_cases):
-- owners insert/select their own rows; staff read all; deletes are service-role
-- only (the 90-day retention cleanup job).
-- =============================================================================

-- 1. Table ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assistant_events (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Event type is free-form but short; the app writes a known vocabulary
  -- (mascot_shown, hint_shown, hint_clicked, hint_dismissed, chat_opened,
  --  message_sent, answer_received, mascot_minimized, mascot_hidden, feedback).
  type        TEXT        NOT NULL CHECK (char_length(type) <= 64),
  screen      TEXT        CHECK (char_length(screen) <= 64),
  -- hint_id / script_id / message correlation id — never free user text.
  ref_id      TEXT        CHECK (char_length(ref_id) <= 64),
  -- Small structured bag: {latency_ms, model, insufficient, escalated, rating,
  -- period, mode}. The API layer enforces the whitelist; texts are rejected.
  meta        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes -------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_assistant_events_user_created
  ON public.assistant_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_events_type_created
  ON public.assistant_events (type, created_at DESC);

-- 3. RLS -----------------------------------------------------------------------
ALTER TABLE public.assistant_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'assistant_events'
      AND policyname = 'assistant_events_select_own'
  ) THEN
    CREATE POLICY assistant_events_select_own ON public.assistant_events
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'assistant_events'
      AND policyname = 'assistant_events_select_admin'
  ) THEN
    CREATE POLICY assistant_events_select_admin ON public.assistant_events
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid()
            AND role IN ('super_admin', 'admin', 'manager', 'analyst', 'expert')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'assistant_events'
      AND policyname = 'assistant_events_insert_own'
  ) THEN
    CREATE POLICY assistant_events_insert_own ON public.assistant_events
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  -- No UPDATE policy (events are immutable) and no DELETE policy (retention
  -- cleanup runs via the service role, which bypasses RLS).
END $$;
