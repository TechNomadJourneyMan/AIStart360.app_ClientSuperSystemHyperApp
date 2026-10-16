-- 120_user_communications.sql
--
-- Communication of the platform with its users
-- (docs/superpowers/specs/2026-10-16-user-communications-design.md §5):
--
--   comm_threads              ONE conversation per user (unique user_id): who
--                             answers (assignee_id), status open / waiting_staff
--                             / waiting_user / closed, mode manual / auto (the
--                             AI auto-reply of phase 5), the 30-minute reply
--                             deadline (staff_reply_due_at, escalated_at),
--                             unread counters, the WhatsApp opt-out
--                             (whatsapp_opt_out_at: «стоп» in WhatsApp or the
--                             switch in GIGA — nothing is sent to WhatsApp
--                             after it) and the last Telegram receipt
--                             (tg_receipt_at: «Сообщение получено…» at most
--                             once per 6 h per chat). Moderation: how many
--                             inbound messages had profanity (profanity_count),
--                             the last automatic warning (profanity_warned_at,
--                             at most once per 6 h) and the comm-level block
--                             (blocked_at / blocked_by / block_reason: inbound
--                             is still stored, staff are not notified, the bot
--                             does not answer, nothing is sent to the user).
--   comm_messages             every message both ways, one row per channel
--                             (app / email / telegram / whatsapp); the rows of
--                             one send share group_id, so the feed shows one
--                             bubble with a delivery status per channel.
--                             Inbound profanity (lib/moderation/profanity.ts):
--                             body keeps the original, body_masked the «б***»
--                             version staff see by default, flags e.g.
--                             {"profanity": true, "words": 2}.
--                             Inbound rows are unique per (channel, external_id)
--                             — a redelivered Telegram update or bridge event
--                             cannot create a second message.
--   comm_campaigns            broadcasts (phase 3): text, channels, audience
--                             (saved GIGA user-list filters or explicit ids),
--                             status and counters.
--   comm_campaign_recipients  user × channel of a broadcast, unique
--                             (campaign_id, user_id, channel): nobody gets the
--                             same broadcast twice on one channel.
--   kb_articles               knowledge base of the client bot (phase 5);
--                             embedding vector(1536) (pgvector, see 054).
--
--   comm_phone_key(text)      the phone number reduced to its E.164 digits
--                             (8XXXXXXXXXX → 7XXXXXXXXXX), the same rule as
--                             lib/comm/phone.ts phoneKey(). An expression index
--                             on profiles makes «which user wrote from this
--                             WhatsApp number» one indexed lookup:
--   comm_user_by_phone(text)  → profiles.id (service role only).
--
-- RLS: every table is written by the server only (service role, from the GIGA
-- routes, the webhooks and lib/comm). A signed-in client may SELECT his own
-- thread and its messages (the «Сообщения» feed of the cabinet, Realtime).
-- Campaigns, recipients and the knowledge base have no client policies.
--
-- Realtime: comm_messages and comm_threads join supabase_realtime (default
-- replica identity, like 114) so the cabinet feed refreshes itself; RLS still
-- scopes what a subscriber receives.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/120_user_communications.sql

-- ─── 1. Conversations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comm_threads (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id            TEXT        REFERENCES public.companies(id) ON DELETE SET NULL,
  assignee_id           UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  status                TEXT        NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'waiting_staff', 'waiting_user', 'closed')),
  mode                  TEXT        NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'auto')),
  last_inbound_at       TIMESTAMPTZ,
  last_outbound_at      TIMESTAMPTZ,
  last_message_at       TIMESTAMPTZ,
  last_message_preview  TEXT        CHECK (last_message_preview IS NULL OR length(last_message_preview) <= 300),
  staff_reply_due_at    TIMESTAMPTZ,
  escalated_at          TIMESTAMPTZ,
  unread_staff          INT         NOT NULL DEFAULT 0 CHECK (unread_staff >= 0),
  unread_user           INT         NOT NULL DEFAULT 0 CHECK (unread_user >= 0),
  whatsapp_opt_out_at   TIMESTAMPTZ,
  tg_receipt_at         TIMESTAMPTZ,
  profanity_count       INT         NOT NULL DEFAULT 0 CHECK (profanity_count >= 0),
  profanity_warned_at   TIMESTAMPTZ,
  blocked_at            TIMESTAMPTZ,
  blocked_by            UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  block_reason          TEXT        CHECK (block_reason IS NULL OR length(block_reason) <= 500),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- «Ждут ответа» / «Просрочены»: the 30-minute check reads only waiting threads.
CREATE INDEX IF NOT EXISTS comm_threads_waiting_idx
  ON public.comm_threads (staff_reply_due_at)
  WHERE status = 'waiting_staff';
CREATE INDEX IF NOT EXISTS comm_threads_status_idx
  ON public.comm_threads (status, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS comm_threads_assignee_idx
  ON public.comm_threads (assignee_id, last_message_at DESC NULLS LAST)
  WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS comm_threads_recent_idx
  ON public.comm_threads (last_message_at DESC NULLS LAST);
-- «С нарушениями»: threads with profanity or a block.
CREATE INDEX IF NOT EXISTS comm_threads_violations_idx
  ON public.comm_threads (last_message_at DESC NULLS LAST)
  WHERE profanity_count > 0 OR blocked_at IS NOT NULL;

DROP TRIGGER IF EXISTS comm_threads_updated_at ON public.comm_threads;
CREATE TRIGGER comm_threads_updated_at
  BEFORE UPDATE ON public.comm_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 2. Broadcasts (phase 3; the table exists now for comm_messages.campaign_id) ─
CREATE TABLE IF NOT EXISTS public.comm_campaigns (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT        NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  body          TEXT        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  subject       TEXT        CHECK (subject IS NULL OR length(subject) <= 200),
  channels      TEXT[]      NOT NULL DEFAULT '{}'
                CHECK (channels <@ ARRAY['app', 'email', 'telegram', 'whatsapp']::text[]),
  audience      JSONB       NOT NULL DEFAULT '{}'::jsonb
                CHECK (jsonb_typeof(audience) = 'object' AND pg_column_size(audience) <= 262144),
  status        TEXT        NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'done', 'cancelled')),
  created_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  starts_at     TIMESTAMPTZ,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  total_count   INT         NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  sent_count    INT         NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  failed_count  INT         NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  skipped_count INT         NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comm_campaigns_status_idx
  ON public.comm_campaigns (status, created_at DESC);

DROP TRIGGER IF EXISTS comm_campaigns_updated_at ON public.comm_campaigns;
CREATE TRIGGER comm_campaigns_updated_at
  BEFORE UPDATE ON public.comm_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 3. Messages ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comm_messages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id    UUID        NOT NULL REFERENCES public.comm_threads(id) ON DELETE CASCADE,
  group_id     UUID        NOT NULL DEFAULT gen_random_uuid(),
  direction    TEXT        NOT NULL CHECK (direction IN ('out', 'in')),
  channel      TEXT        NOT NULL CHECK (channel IN ('app', 'email', 'telegram', 'whatsapp')),
  author_kind  TEXT        NOT NULL CHECK (author_kind IN ('staff', 'bot', 'user', 'system')),
  author_id    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name  TEXT        CHECK (author_name IS NULL OR length(author_name) <= 200),
  body         TEXT        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 8000),
  body_masked  TEXT        CHECK (body_masked IS NULL OR length(body_masked) <= 8000),
  flags        JSONB       NOT NULL DEFAULT '{}'::jsonb
               CHECK (jsonb_typeof(flags) = 'object' AND pg_column_size(flags) <= 2048),
  subject      TEXT        CHECK (subject IS NULL OR length(subject) <= 200),
  campaign_id  UUID        REFERENCES public.comm_campaigns(id) ON DELETE SET NULL,
  status       TEXT        NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'failed', 'skipped')),
  error        TEXT        CHECK (error IS NULL OR length(error) <= 500),
  external_id  TEXT        CHECK (external_id IS NULL OR length(external_id) <= 500),
  reply_to_id  UUID        REFERENCES public.comm_messages(id) ON DELETE SET NULL,
  metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb
               CHECK (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 16384),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at      TIMESTAMPTZ,
  -- Direction and author agree: users only write in, staff / bot / system only out.
  CONSTRAINT comm_messages_direction_author CHECK ((direction = 'in') = (author_kind = 'user'))
);

CREATE INDEX IF NOT EXISTS comm_messages_thread_idx
  ON public.comm_messages (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS comm_messages_campaign_idx
  ON public.comm_messages (campaign_id)
  WHERE campaign_id IS NOT NULL;
-- A redelivered webhook (Telegram update, bridge event) cannot duplicate an inbound message.
CREATE UNIQUE INDEX IF NOT EXISTS comm_messages_inbound_external_uidx
  ON public.comm_messages (channel, external_id)
  WHERE direction = 'in' AND external_id IS NOT NULL;

-- ─── 4. Broadcast recipients (phase 3) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comm_campaign_recipients (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID        NOT NULL REFERENCES public.comm_campaigns(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel        TEXT        NOT NULL CHECK (channel IN ('app', 'email', 'telegram', 'whatsapp')),
  status         TEXT        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped', 'cancelled')),
  message_id     UUID        REFERENCES public.comm_messages(id) ON DELETE SET NULL,
  scheduled_for  TIMESTAMPTZ,
  attempts       SMALLINT    NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  error          TEXT        CHECK (error IS NULL OR length(error) <= 500),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT comm_campaign_recipients_once UNIQUE (campaign_id, user_id, channel)
);
-- The sender takes the next due recipient of a running campaign.
CREATE INDEX IF NOT EXISTS comm_campaign_recipients_queue_idx
  ON public.comm_campaign_recipients (campaign_id, status, scheduled_for);

DROP TRIGGER IF EXISTS comm_campaign_recipients_updated_at ON public.comm_campaign_recipients;
CREATE TRIGGER comm_campaign_recipients_updated_at
  BEFORE UPDATE ON public.comm_campaign_recipients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 5. Knowledge base of the client bot (phase 5) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.kb_articles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  body        TEXT        NOT NULL CHECK (length(body) <= 200000),
  tags        TEXT[]      NOT NULL DEFAULT '{}',
  source      TEXT        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'file')),
  status      TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  embedding   vector(1536),
  updated_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_articles_status_idx
  ON public.kb_articles (status, updated_at DESC);

DROP TRIGGER IF EXISTS kb_articles_updated_at ON public.kb_articles;
CREATE TRIGGER kb_articles_updated_at
  BEFORE UPDATE ON public.kb_articles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 6. Phone → user (WhatsApp inbound) ─────────────────────────────────────
-- Same rule as lib/comm/phone.ts phoneKey(): digits only; 8XXXXXXXXXX (KZ/RU)
-- → 7XXXXXXXXXX; a 10-digit 7… / 9… number gets the 7 country code; 11–15
-- digits are kept; anything else is NULL.
CREATE OR REPLACE FUNCTION public.comm_phone_key(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN d IS NULL OR d = '' THEN NULL
    WHEN length(d) = 11 AND left(d, 1) = '8' THEN '7' || substr(d, 2)
    WHEN length(d) = 10 AND left(d, 1) IN ('7', '9') THEN '7' || d
    WHEN length(d) BETWEEN 11 AND 15 AND left(d, 1) <> '0' THEN d
    ELSE NULL
  END
  FROM (SELECT regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') AS d) s
$$;

CREATE INDEX IF NOT EXISTS profiles_comm_phone_key_idx
  ON public.profiles (public.comm_phone_key(phone))
  WHERE phone IS NOT NULL;

CREATE OR REPLACE FUNCTION public.comm_user_by_phone(p_key TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id
  FROM public.profiles p
  WHERE p_key ~ '^[1-9][0-9]{10,14}$'
    AND p.phone IS NOT NULL
    AND public.comm_phone_key(p.phone) = p_key
  ORDER BY p.created_at ASC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.comm_user_by_phone(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comm_user_by_phone(TEXT) TO service_role;

-- ─── 7. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.comm_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comm_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comm_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_articles ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.comm_threads FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.comm_messages FROM anon, authenticated;
REVOKE ALL ON public.comm_threads, public.comm_messages FROM anon;
REVOKE ALL ON public.comm_campaigns, public.comm_campaign_recipients, public.kb_articles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.comm_threads, public.comm_messages TO authenticated;
GRANT ALL ON public.comm_threads, public.comm_messages, public.comm_campaigns,
             public.comm_campaign_recipients, public.kb_articles TO service_role;

DROP POLICY IF EXISTS comm_threads_owner_read ON public.comm_threads;
CREATE POLICY comm_threads_owner_read ON public.comm_threads FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS comm_messages_owner_read ON public.comm_messages;
CREATE POLICY comm_messages_owner_read ON public.comm_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.comm_threads t
    WHERE t.id = comm_messages.thread_id AND t.user_id = (SELECT auth.uid())
  ));

-- ─── 8. Realtime (cabinet feed) ─────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['comm_messages', 'comm_threads'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
