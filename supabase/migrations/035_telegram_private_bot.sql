-- Telegram private-message account support.
-- Stores the user's linked private Telegram identity and short-lived hashed link token.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS telegram_user_id TEXT,
  ADD COLUMN IF NOT EXISTS telegram_username TEXT,
  ADD COLUMN IF NOT EXISTS telegram_linked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS telegram_link_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS telegram_link_token_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_telegram_chat_id_uidx
  ON public.profiles (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_telegram_user_id_uidx
  ON public.profiles (telegram_user_id)
  WHERE telegram_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS profiles_telegram_link_token_hash_idx
  ON public.profiles (telegram_link_token_hash)
  WHERE telegram_link_token_hash IS NOT NULL;

COMMENT ON COLUMN public.profiles.telegram_chat_id IS
  'Private Telegram chat id linked through /start deep-link token.';
COMMENT ON COLUMN public.profiles.telegram_user_id IS
  'Telegram user id for the linked private chat.';
COMMENT ON COLUMN public.profiles.telegram_link_token_hash IS
  'SHA-256 hash of a short-lived Telegram deep-link token. Raw token is never stored.';
