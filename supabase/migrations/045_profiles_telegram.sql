-- AIStart360 — Migration 045: Telegram binding on profiles (Фаза 4A)
--
-- Дайджест умеет уходить в Telegram (lib/notifications.ts уже читает
-- profiles.telegram_chat_id), но КОЛОНКИ не было — select падал в catch и
-- Telegram-канал молча не работал. Добавляем привязку:
--   telegram_chat_id  — чат, куда слать (записывает webhook по /start).
--   telegram_link_code — одноразовый код в deep-link t.me/<bot>?start=<code>;
--                        очищается, как только чат привязан.
-- Идемпотентно; ничего не бэкфилит (у существующих profiles обе колонки NULL).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telegram_link_code TEXT;

-- Код привязки уникален, пока не NULL (несколько NULL допустимы).
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_tg_link_code
  ON public.profiles (telegram_link_code)
  WHERE telegram_link_code IS NOT NULL;

COMMENT ON COLUMN public.profiles.telegram_chat_id IS
  'Telegram chat id для доставки дайджеста; записывается webhook-ом при /start <code>.';
COMMENT ON COLUMN public.profiles.telegram_link_code IS
  'Одноразовый код в t.me deep-link; очищается, как только чат привязан.';

-- PostgREST: перечитать схему, чтобы новые колонки стали видны через API.
NOTIFY pgrst, 'reload schema';
