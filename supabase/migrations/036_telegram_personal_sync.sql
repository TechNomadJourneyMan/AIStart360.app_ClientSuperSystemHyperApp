-- State + audit log for MTProto personal-account Telegram sync.

CREATE TABLE IF NOT EXISTS public.telegram_personal_chats (
  telegram_user_id          TEXT PRIMARY KEY,
  username                  TEXT,
  first_name                TEXT,
  last_name                 TEXT,
  linked_profile_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_processed_message_id BIGINT NOT NULL DEFAULT 0,
  last_incoming_at          TIMESTAMPTZ,
  last_outgoing_at          TIMESTAMPTZ,
  muted                     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS telegram_personal_chats_updated_at ON public.telegram_personal_chats;
CREATE TRIGGER telegram_personal_chats_updated_at
  BEFORE UPDATE ON public.telegram_personal_chats
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS telegram_personal_chats_profile_idx
  ON public.telegram_personal_chats (linked_profile_id)
  WHERE linked_profile_id IS NOT NULL;

ALTER TABLE public.telegram_personal_chats ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.telegram_personal_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id    TEXT NOT NULL REFERENCES public.telegram_personal_chats(telegram_user_id) ON DELETE CASCADE,
  telegram_message_id BIGINT NOT NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  status              TEXT NOT NULL CHECK (status IN ('processing', 'linked', 'replied', 'ignored', 'failed')),
  text                TEXT,
  reply_text          TEXT,
  reply_message_id    BIGINT,
  linked_profile_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  error               TEXT,
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (telegram_user_id, telegram_message_id, direction)
);

CREATE INDEX IF NOT EXISTS telegram_personal_messages_user_created_idx
  ON public.telegram_personal_messages (telegram_user_id, created_at DESC);

ALTER TABLE public.telegram_personal_messages ENABLE ROW LEVEL SECURITY;
