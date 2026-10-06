-- 095_telegram_bot_state.sql
--
-- State of the Telegram bots (docs/platform/07-admin-control-center.md §7):
--
--   telegram_bot_state         per-chat conversation state of a multi-step
--                              input (add a provider, rotate a key, a reason
--                              for a rejection). Short-lived: expires_at.
--   telegram_bot_updates_seen  update_id dedupe PER BOT (update ids are
--                              counted per bot; the 087 table stays for the
--                              client bot webhook).
--   telegram_bot_links         Telegram identity of a person in a bot other
--                              than the staff link of 087 — today the expert
--                              bot (expert / admin / super_admin profiles).
--                              Only the SHA-256 of a one-time link code is
--                              stored, with a 15-minute TTL.
--   telegram_bot_deliveries    dedupe + delivery log of bot notifications that
--                              have no notification_events row (expert bot).
--
-- Bots: 'client' (TELEGRAM_BOT_TOKEN), 'admin' (TELEGRAM_ADMIN_BOT_TOKEN),
-- 'expert' (TELEGRAM_EXPERT_BOT_TOKEN). Tokens never reach the database.
--
-- Server-only tables: RLS on, no policies, REVOKE from anon/authenticated.
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/095_telegram_bot_state.sql

CREATE TABLE IF NOT EXISTS public.telegram_bot_state (
  bot         TEXT        NOT NULL CHECK (bot IN ('client', 'admin', 'expert')),
  chat_id     TEXT        NOT NULL CHECK (length(chat_id) BETWEEN 1 AND 32),
  user_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  state       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot, chat_id)
);
CREATE INDEX IF NOT EXISTS telegram_bot_state_expires_idx ON public.telegram_bot_state (expires_at);

DROP TRIGGER IF EXISTS telegram_bot_state_updated_at ON public.telegram_bot_state;
CREATE TRIGGER telegram_bot_state_updated_at
  BEFORE UPDATE ON public.telegram_bot_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.telegram_bot_updates_seen (
  bot         TEXT        NOT NULL CHECK (bot IN ('client', 'admin', 'expert')),
  update_id   BIGINT      NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot, update_id)
);
CREATE INDEX IF NOT EXISTS telegram_bot_updates_seen_received_idx ON public.telegram_bot_updates_seen (received_at);

CREATE TABLE IF NOT EXISTS public.telegram_bot_links (
  bot                   TEXT        NOT NULL CHECK (bot IN ('admin', 'expert')),
  user_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_user_id      BIGINT,
  chat_id               TEXT,
  telegram_username     TEXT,
  link_code_hash        TEXT        UNIQUE,
  link_code_expires_at  TIMESTAMPTZ,
  linked_at             TIMESTAMPTZ,
  muted_until           TIMESTAMPTZ,
  min_level             TEXT        NOT NULL DEFAULT 'INFO'
                        CHECK (min_level IN ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot, user_id),
  CONSTRAINT telegram_bot_links_linked CHECK (
    (linked_at IS NULL) OR (telegram_user_id IS NOT NULL AND chat_id IS NOT NULL)
  )
);
-- One Telegram account ↔ one person per bot.
CREATE UNIQUE INDEX IF NOT EXISTS telegram_bot_links_tg_user
  ON public.telegram_bot_links (bot, telegram_user_id) WHERE telegram_user_id IS NOT NULL;

DROP TRIGGER IF EXISTS telegram_bot_links_updated_at ON public.telegram_bot_links;
CREATE TRIGGER telegram_bot_links_updated_at
  BEFORE UPDATE ON public.telegram_bot_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.telegram_bot_deliveries (
  bot          TEXT        NOT NULL CHECK (bot IN ('client', 'admin', 'expert')),
  dedupe_key   TEXT        NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 200),
  chat_id      TEXT        NOT NULL,
  status       TEXT        NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot, dedupe_key, chat_id)
);
CREATE INDEX IF NOT EXISTS telegram_bot_deliveries_created_idx ON public.telegram_bot_deliveries (created_at);

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['telegram_bot_state', 'telegram_bot_updates_seen', 'telegram_bot_links', 'telegram_bot_deliveries'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
