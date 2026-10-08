-- 109_bot_ai_memory.sql
--
-- Short memory of the Telegram bots' assistant (lib/telegram/brain,
-- docs/superpowers/specs/2026-10-08-ai-providers-automation-bot-brain-design.md,
-- «Часть B»):
--
--   bot_ai_messages  the last turns of a chat with the assistant of the admin
--                    or the expert bot: what the person asked ('user'), what
--                    the assistant answered ('assistant'), and the last files
--                    the person sent ('file': Telegram file_id + name, never
--                    the bytes) for a possible «прикрепить к клиенту».
--
-- Kept small and short-lived: ~10 turns per chat, 24 hours. The app prunes on
-- every write (lib/telegram/brain/memory.ts) and the bots' housekeeping
-- (lib/telegram/bots/store.ts purgeBotHousekeeping, run by the agents queue
-- tick) drops everything older than 24 hours. `/new` in the bot clears a chat.
-- Tool results (client data) are NOT stored — they are re-read on demand.
--
-- Server-only table: RLS on, no policies, REVOKE from anon/authenticated (as 095).
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/109_bot_ai_memory.sql

CREATE TABLE IF NOT EXISTS public.bot_ai_messages (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot         TEXT        NOT NULL CHECK (bot IN ('admin', 'expert')),
  chat_id     TEXT        NOT NULL CHECK (length(chat_id) BETWEEN 1 AND 32),
  user_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'file')),
  content     TEXT        NOT NULL DEFAULT '' CHECK (length(content) <= 16000),
  tool_name   TEXT        CHECK (tool_name IS NULL OR length(tool_name) <= 80),
  meta        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bot_ai_messages_chat_idx ON public.bot_ai_messages (bot, chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bot_ai_messages_created_idx ON public.bot_ai_messages (created_at);

ALTER TABLE public.bot_ai_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bot_ai_messages FROM anon, authenticated;

COMMENT ON TABLE public.bot_ai_messages IS
  'Telegram bot assistant memory: last ~10 turns per chat for 24 h, last files (file_id only). Service role only (109).';

NOTIFY pgrst, 'reload schema';
