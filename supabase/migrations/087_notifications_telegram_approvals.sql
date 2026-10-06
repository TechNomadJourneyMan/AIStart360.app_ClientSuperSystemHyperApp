-- 087_notifications_telegram_approvals.sql
--
-- Staff notifications with levels, a delivery log and Telegram identities for
-- approvals (docs/platform/07-admin-control-center.md, D4).
--
--   notification_events      one fact worth telling a human (level, dedupe, links)
--   notification_deliveries  one attempt per channel/recipient; keeps the
--                            Telegram message id so an approval card can be
--                            edited after the decision
--   staff_telegram_links     binds a Telegram account to a staff user. Approval
--                            buttons work only for linked staff whose role has
--                            `approvals.decide`; the chat id alone proves nothing.
--   telegram_updates_seen    update_id dedupe for the bot webhook (replays)
--
-- Levels: INFO < SUCCESS < WARNING < CRITICAL; APPROVAL_REQUIRED is routed
-- separately (always delivered to approvers, never muted by quiet hours).
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/087_notifications_telegram_approvals.sql

CREATE TABLE IF NOT EXISTS public.notification_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  level        TEXT        NOT NULL CHECK (level IN ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL', 'APPROVAL_REQUIRED')),
  type         TEXT        NOT NULL CHECK (type ~ '^[a-z][a-z0-9_.]{2,63}$'),
  title        TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body         TEXT        NOT NULL DEFAULT '',
  company_id   TEXT        REFERENCES public.companies(id) ON DELETE SET NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  approval_id  UUID        REFERENCES public.agent_approvals(id) ON DELETE SET NULL,
  agent_key    TEXT,
  data         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key   TEXT        UNIQUE,
  audience     TEXT        NOT NULL DEFAULT 'staff' CHECK (audience IN ('staff', 'client')),
  read_by      TEXT[]      NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_events_feed_idx
  ON public.notification_events (audience, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_events_level_idx
  ON public.notification_events (level, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_events_company_idx
  ON public.notification_events (company_id, created_at DESC) WHERE company_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             UUID        NOT NULL REFERENCES public.notification_events(id) ON DELETE CASCADE,
  channel              TEXT        NOT NULL CHECK (channel IN ('telegram', 'email', 'in_app')),
  target               TEXT        NOT NULL,       -- chat id / email / user id
  status               TEXT        NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  skip_reason          TEXT,
  attempts             SMALLINT    NOT NULL DEFAULT 0,
  provider_message_id  TEXT,
  error                TEXT,
  sent_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, channel, target)
);
CREATE INDEX IF NOT EXISTS notification_deliveries_retry_idx
  ON public.notification_deliveries (created_at) WHERE status IN ('queued', 'failed');

DROP TRIGGER IF EXISTS notification_deliveries_updated_at ON public.notification_deliveries;
CREATE TRIGGER notification_deliveries_updated_at
  BEFORE UPDATE ON public.notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.staff_telegram_links (
  user_id               UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_user_id      BIGINT      UNIQUE,
  chat_id               TEXT,
  telegram_username     TEXT,
  link_code_hash        TEXT        UNIQUE,
  link_code_expires_at  TIMESTAMPTZ,
  linked_at             TIMESTAMPTZ,
  muted_until           TIMESTAMPTZ,
  min_level             TEXT        NOT NULL DEFAULT 'WARNING'
                        CHECK (min_level IN ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_telegram_links_linked CHECK (
    (linked_at IS NULL) OR (telegram_user_id IS NOT NULL AND chat_id IS NOT NULL)
  )
);

DROP TRIGGER IF EXISTS staff_telegram_links_updated_at ON public.staff_telegram_links;
CREATE TRIGGER staff_telegram_links_updated_at
  BEFORE UPDATE ON public.staff_telegram_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.telegram_updates_seen (
  update_id   BIGINT      PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_updates_seen_received_idx ON public.telegram_updates_seen (received_at);

-- Server-only tables: staff read them through the admin API (service role).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_events', 'notification_deliveries', 'staff_telegram_links', 'telegram_updates_seen'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
