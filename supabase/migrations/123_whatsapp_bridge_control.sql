-- 123_whatsapp_bridge_control.sql
--
-- WhatsApp Web bridge «pull control» (WHATSAPP_WEB_BRIDGE_CONTROL=pull).
-- The bridge runs behind NAT without a public URL, so session control goes
-- through the portal (lib/omnichannel/whatsapp-bridge-control.ts):
--
--   whatsapp_bridge_status    ONE row per bridge session: the latest status the
--                             bridge pushed (POST /api/webhooks/whatsapp-web/session).
--                             The pairing QR is stored only while state = 'qr'
--                             with a short qr_expires_at (~60 s) and is cleared
--                             once connected or expired. last_seen_at drives the
--                             «bridge не на связи» check (stale > 90 s).
--   whatsapp_bridge_commands  connect / logout requested from GIGA, claimed and
--                             acked by the bridge (…/commands/claim, …/commands/ack).
--                             At most ONE in-flight (pending | claimed) command per
--                             session; commands expire after ~2 minutes.
--
-- DB-load discipline: status pushes are single-row upserts by primary key
-- (identical heartbeats ≥ 15 s apart), an idle claim is one select on a tiny
-- partial index, no cron. Service role only: RLS on, no anon/authenticated grants.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/123_whatsapp_bridge_control.sql

-- ─── 1. Latest pushed status ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_bridge_status (
  session_id        TEXT PRIMARY KEY
                      CHECK (session_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  state             TEXT NOT NULL
                      CHECK (state IN ('disconnected', 'connecting', 'qr', 'connected', 'error')),
  connected         BOOLEAN NOT NULL DEFAULT false,
  qr                TEXT CHECK (qr IS NULL OR char_length(qr) <= 8192),
  qr_expires_at     TIMESTAMPTZ,
  error_code        TEXT CHECK (error_code IS NULL OR error_code ~ '^[A-Za-z0-9._:-]{1,80}$'),
  bridge_updated_at TIMESTAMPTZ,
  bridge_version    TEXT CHECK (bridge_version IS NULL OR char_length(bridge_version) <= 32),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_bridge_status_qr_only_while_pairing
    CHECK (qr IS NULL OR (state = 'qr' AND qr_expires_at IS NOT NULL))
);

COMMENT ON TABLE public.whatsapp_bridge_status IS
  'WhatsApp Web bridge (pull control): последний статус сессии, присланный bridge. QR хранится только на время привязки.';
COMMENT ON COLUMN public.whatsapp_bridge_status.qr IS
  'Сырой QR привязки (~60 с, эквивалент доступа к аккаунту). Только при state = qr; очищается по истечении/после подключения. Не логировать.';

-- ─── 2. Commands GIGA → bridge ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_bridge_commands (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       TEXT NOT NULL CHECK (session_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  action           TEXT NOT NULL CHECK (action IN ('connect', 'logout')),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'claimed', 'succeeded', 'failed', 'expired', 'cancelled')),
  idempotency_key  TEXT NOT NULL UNIQUE CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
  requested_by     TEXT,
  lease_token      UUID,
  lease_until      TIMESTAMPTZ,
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  result_code      TEXT CHECK (result_code IS NULL OR char_length(result_code) <= 80),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  claimed_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ
);

-- One in-flight command per session; also the index the claim select uses.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_bridge_commands_one_in_flight
  ON public.whatsapp_bridge_commands (session_id)
  WHERE status IN ('pending', 'claimed');

-- Retention prune (finished commands older than 30 days, run on issue).
CREATE INDEX IF NOT EXISTS whatsapp_bridge_commands_created_idx
  ON public.whatsapp_bridge_commands (created_at);

COMMENT ON TABLE public.whatsapp_bridge_commands IS
  'WhatsApp Web bridge (pull control): команды connect/logout из GIGA; bridge забирает их подписанным запросом. Не более одной активной на сессию, срок ~2 мин.';

-- ─── 3. Service role only ───────────────────────────────────────────────────
ALTER TABLE public.whatsapp_bridge_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_bridge_commands ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.whatsapp_bridge_status FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.whatsapp_bridge_commands FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_bridge_status TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_bridge_commands TO service_role;

NOTIFY pgrst, 'reload schema';
