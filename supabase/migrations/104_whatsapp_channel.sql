-- 104_whatsapp_channel.sql
--
-- WhatsApp as a notification channel (plan W6): Cloud API template messages
-- with a durable outbox, plus the existing WhatsApp Web bridge as a staff-only
-- fallback (lib/whatsapp/**).
--
--   notification_deliveries.channel  += 'whatsapp' (087 allowed telegram/email/in_app)
--   whatsapp_links    a person's WhatsApp number per audience (staff / expert /
--                     client): verification by a 6-digit code (only an HMAC of
--                     it is stored, 10 min TTL, bounded attempts), explicit
--                     opt-in / opt-out, personal level and mute.
--   whatsapp_outbox   durable send queue. Two-phase fence like 073 (MyHonor):
--                       queued → sending (lease) → send_started_at (fence just
--                       before the provider request) → sent / retry / failed.
--                     A lease that expires AFTER the fence becomes
--                     'delivery_unknown' and is never resent automatically;
--                     one that expires before it returns to 'queued'.
--                     Status webhooks move sent → delivered → read / failed by
--                     provider_message_id.
--
-- Phone numbers: stored as E.164 in server-only tables, the same rule as
-- profiles.phone and 073 recipient_phone_e164. They never reach logs
-- (lib/whatsapp/config.ts maskPhone) or notification_deliveries.target
-- (that uses 'wa:<user_id>').
--
-- RLS: whatsapp_outbox is server-only (no policies). whatsapp_links: the owner
-- and platform admins may SELECT the non-secret columns; all writes go through
-- the server (service role / direct connection).
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/104_whatsapp_channel.sql

-- ─── 1. notification_deliveries accepts the WhatsApp channel ────────────────
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'notification_deliveries'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%channel%'
  LOOP
    EXECUTE format('ALTER TABLE public.notification_deliveries DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.notification_deliveries
  ADD CONSTRAINT notification_deliveries_channel_check
  CHECK (channel IN ('telegram', 'email', 'in_app', 'whatsapp'));

-- ─── 2. whatsapp_links ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_links (
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_kind      TEXT        NOT NULL CHECK (recipient_kind IN ('staff', 'expert', 'client')),
  phone_e164          TEXT        CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  verified_at         TIMESTAMPTZ,
  pending_phone_e164  TEXT        CHECK (pending_phone_e164 IS NULL OR pending_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  verify_code_hash    TEXT        CHECK (verify_code_hash IS NULL OR verify_code_hash ~ '^[a-f0-9]{64}$'),
  verify_expires_at   TIMESTAMPTZ,
  verify_attempts     SMALLINT    NOT NULL DEFAULT 0 CHECK (verify_attempts BETWEEN 0 AND 100),
  verify_sent_at      TIMESTAMPTZ,
  opt_in_at           TIMESTAMPTZ,
  opt_out_at          TIMESTAMPTZ,
  min_level           TEXT        NOT NULL DEFAULT 'WARNING'
                      CHECK (min_level IN ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL')),
  muted_until         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recipient_kind),
  -- Verified means: a number confirmed by the code. Opt-in needs a verified number.
  CONSTRAINT whatsapp_links_verified_shape CHECK (verified_at IS NULL OR phone_e164 IS NOT NULL),
  CONSTRAINT whatsapp_links_opt_in_shape CHECK (opt_in_at IS NULL OR verified_at IS NOT NULL),
  CONSTRAINT whatsapp_links_code_shape CHECK (
    (verify_code_hash IS NULL AND verify_expires_at IS NULL)
    OR (verify_code_hash IS NOT NULL AND verify_expires_at IS NOT NULL AND pending_phone_e164 IS NOT NULL)
  )
);

-- Recipients of a fan-out: opted-in, verified links of one audience.
CREATE INDEX IF NOT EXISTS whatsapp_links_recipients_idx
  ON public.whatsapp_links (recipient_kind)
  WHERE opt_in_at IS NOT NULL AND verified_at IS NOT NULL;

DROP TRIGGER IF EXISTS whatsapp_links_updated_at ON public.whatsapp_links;
CREATE TRIGGER whatsapp_links_updated_at
  BEFORE UPDATE ON public.whatsapp_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whatsapp_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_links FROM PUBLIC, anon, authenticated;
-- Column-level: the code hash and its bookkeeping are never readable by a client.
GRANT SELECT (user_id, recipient_kind, phone_e164, verified_at, opt_in_at, opt_out_at,
              min_level, muted_until, created_at, updated_at)
  ON public.whatsapp_links TO authenticated;
GRANT ALL ON public.whatsapp_links TO service_role;

DROP POLICY IF EXISTS whatsapp_links_owner_select ON public.whatsapp_links;
CREATE POLICY whatsapp_links_owner_select ON public.whatsapp_links
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS whatsapp_links_admin_select ON public.whatsapp_links;
CREATE POLICY whatsapp_links_admin_select ON public.whatsapp_links
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- ─── 3. whatsapp_outbox ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_outbox (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key      TEXT        NOT NULL UNIQUE CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
  recipient_kind       TEXT        NOT NULL CHECK (recipient_kind IN ('staff', 'expert', 'client')),
  user_id              UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_e164           TEXT        NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  template_name        TEXT        NOT NULL CHECK (template_name ~ '^[a-z0-9_]{1,255}$'),
  template_lang        TEXT        NOT NULL DEFAULT 'ru' CHECK (template_lang ~ '^[a-z]{2,3}(?:_[A-Z]{2})?$'),
  params               JSONB       NOT NULL DEFAULT '{}'::jsonb
                       CHECK (jsonb_typeof(params) = 'object' AND pg_column_size(params) <= 16384),
  -- Plain-text rendering for the WhatsApp Web bridge fallback (staff only).
  fallback_text        TEXT        CHECK (fallback_text IS NULL OR length(fallback_text) BETWEEN 1 AND 4096),
  level                TEXT        CHECK (level IS NULL OR level IN ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL', 'APPROVAL_REQUIRED')),
  delivery_id          UUID        REFERENCES public.notification_deliveries(id) ON DELETE SET NULL,
  status               TEXT        NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'delivery_unknown', 'skipped')),
  transport            TEXT        CHECK (transport IS NULL OR transport IN ('cloud_api', 'web_bridge')),
  attempts             SMALLINT    NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  max_attempts         SMALLINT    NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner          TEXT        CHECK (lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 200),
  lease_token          UUID,
  lease_until          TIMESTAMPTZ,
  send_started_at      TIMESTAMPTZ,
  provider_message_id  TEXT        CHECK (provider_message_id IS NULL OR length(provider_message_id) BETWEEN 1 AND 500),
  last_error           TEXT        CHECK (last_error IS NULL OR length(last_error) <= 500),
  sent_at              TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  read_at              TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A row without a person is only an operator-configured team number (env).
  CONSTRAINT whatsapp_outbox_user_shape CHECK (user_id IS NOT NULL OR recipient_kind IN ('staff', 'expert')),
  CONSTRAINT whatsapp_outbox_attempts_max CHECK (attempts <= max_attempts),
  CONSTRAINT whatsapp_outbox_lease_shape CHECK (
    (status = 'sending' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status <> 'sending' AND lease_owner IS NULL AND lease_token IS NULL AND lease_until IS NULL AND send_started_at IS NULL)
  ),
  CONSTRAINT whatsapp_outbox_provider_shape CHECK (
    status NOT IN ('sent', 'delivered', 'read') OR provider_message_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_outbox_provider_id_idx
  ON public.whatsapp_outbox (provider_message_id) WHERE provider_message_id IS NOT NULL;
-- The claim query: due queued rows, oldest first.
CREATE INDEX IF NOT EXISTS whatsapp_outbox_ready_idx
  ON public.whatsapp_outbox (next_attempt_at, created_at) WHERE status = 'queued';
-- The reaper: expired leases.
CREATE INDEX IF NOT EXISTS whatsapp_outbox_lease_idx
  ON public.whatsapp_outbox (lease_until) WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS whatsapp_outbox_user_idx
  ON public.whatsapp_outbox (user_id, created_at DESC) WHERE user_id IS NOT NULL;

DROP TRIGGER IF EXISTS whatsapp_outbox_updated_at ON public.whatsapp_outbox;
CREATE TRIGGER whatsapp_outbox_updated_at
  BEFORE UPDATE ON public.whatsapp_outbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whatsapp_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_outbox TO service_role;

-- ─── 4. Outbox functions (SECURITY DEFINER, service role only) ──────────────

-- Enqueue once per idempotency key; a repeat returns the existing row.
CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_outbox(
  p_idempotency_key TEXT,
  p_recipient_kind  TEXT,
  p_user_id         UUID,
  p_phone_e164      TEXT,
  p_template_name   TEXT,
  p_template_lang   TEXT,
  p_params          JSONB,
  p_fallback_text   TEXT DEFAULT NULL,
  p_level           TEXT DEFAULT NULL,
  p_delivery_id     UUID DEFAULT NULL,
  p_max_attempts    INTEGER DEFAULT 5
)
RETURNS TABLE (outbox_id UUID, outbox_status TEXT, created BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.whatsapp_outbox (
    idempotency_key, recipient_kind, user_id, phone_e164, template_name, template_lang,
    params, fallback_text, level, delivery_id, max_attempts
  ) VALUES (
    p_idempotency_key, p_recipient_kind, p_user_id, p_phone_e164, p_template_name,
    COALESCE(p_template_lang, 'ru'), COALESCE(p_params, '{}'::jsonb), p_fallback_text,
    p_level, p_delivery_id, LEAST(GREATEST(COALESCE(p_max_attempts, 5), 1), 20)::SMALLINT
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, 'queued'::TEXT, TRUE;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT o.id, o.status, FALSE FROM public.whatsapp_outbox o WHERE o.idempotency_key = p_idempotency_key;
END;
$$;

-- Claim up to p_limit due rows for one worker. Concurrent workers never get
-- the same row (FOR UPDATE SKIP LOCKED). Expired leases are reaped first:
-- before the send fence → queued again; after it → delivery_unknown.
CREATE OR REPLACE FUNCTION public.claim_whatsapp_outbox(
  p_owner         TEXT,
  p_limit         INTEGER DEFAULT 20,
  p_lease_seconds INTEGER DEFAULT 120,
  p_ids           UUID[] DEFAULT NULL
)
RETURNS SETOF public.whatsapp_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_owner IS NULL OR length(btrim(p_owner)) NOT BETWEEN 1 AND 200
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200
     OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 600 THEN
    RAISE EXCEPTION 'invalid whatsapp outbox claim' USING ERRCODE = '22023';
  END IF;

  -- Reap abandoned leases (a worker died mid-run).
  WITH expired AS (
    SELECT id FROM public.whatsapp_outbox
    WHERE status = 'sending' AND lease_until <= v_now
    FOR UPDATE SKIP LOCKED
  ), reaped AS (
    UPDATE public.whatsapp_outbox o
       SET status = CASE WHEN o.send_started_at IS NULL THEN 'queued' ELSE 'delivery_unknown' END,
           last_error = CASE WHEN o.send_started_at IS NULL THEN 'lease_expired_before_send' ELSE 'lease_expired_after_send' END,
           completed_at = CASE WHEN o.send_started_at IS NULL THEN NULL ELSE v_now END,
           next_attempt_at = CASE WHEN o.send_started_at IS NULL THEN v_now ELSE o.next_attempt_at END,
           lease_owner = NULL, lease_token = NULL, lease_until = NULL, send_started_at = NULL
      FROM expired
     WHERE o.id = expired.id
    RETURNING o.delivery_id, o.status
  )
  UPDATE public.notification_deliveries d
     SET status = 'failed', error = 'delivery_unknown'
    FROM reaped
   WHERE d.id = reaped.delivery_id AND reaped.status = 'delivery_unknown';

  RETURN QUERY
  WITH picked AS (
    SELECT id FROM public.whatsapp_outbox
    WHERE status = 'queued'
      AND next_attempt_at <= v_now
      AND attempts < max_attempts
      AND (p_ids IS NULL OR id = ANY (p_ids))
    ORDER BY next_attempt_at, created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.whatsapp_outbox o
     SET status = 'sending',
         attempts = o.attempts + 1,
         lease_owner = btrim(p_owner),
         lease_token = gen_random_uuid(),
         lease_until = v_now + make_interval(secs => p_lease_seconds),
         send_started_at = NULL
    FROM picked
   WHERE o.id = picked.id
  RETURNING o.*;
END;
$$;

-- The provider boundary: true only for the current lease holder, once. After
-- this, an interrupted send is 'delivery_unknown' and never resent blindly.
CREATE OR REPLACE FUNCTION public.start_whatsapp_outbox_send(
  p_id          UUID,
  p_lease_token UUID,
  p_transport   TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_transport NOT IN ('cloud_api', 'web_bridge') THEN
    RAISE EXCEPTION 'invalid transport' USING ERRCODE = '22023';
  END IF;
  UPDATE public.whatsapp_outbox
     SET send_started_at = clock_timestamp(), transport = p_transport
   WHERE id = p_id
     AND status = 'sending'
     AND lease_token = p_lease_token
     AND lease_until > clock_timestamp()
     AND send_started_at IS NULL;
  RETURN FOUND;
END;
$$;

DROP FUNCTION IF EXISTS public.finish_whatsapp_outbox(UUID, UUID, TEXT, TEXT, TEXT, INTEGER);

-- Resolve a claimed row.
--   sent              provider accepted (message id required; fence required)
--   retry             provider answered with an error, nothing was created:
--                     queued again with backoff, or failed after max_attempts
--   defer             not now (quiet hours): queued at p_retry_after_seconds,
--                     the attempt is not counted (only before the fence)
--   failed            permanent error
--   delivery_unknown  the request may have reached the provider (timeout after
--                     the fence): terminal, never resent automatically
--   skipped           not allowed to send (no opt-in, muted, number changed)
-- The linked notification_deliveries row (if any) mirrors the outcome.
CREATE OR REPLACE FUNCTION public.finish_whatsapp_outbox(
  p_id                  UUID,
  p_lease_token         UUID,
  p_outcome             TEXT,
  p_provider_message_id TEXT DEFAULT NULL,
  p_error               TEXT DEFAULT NULL,
  p_retry_after_seconds INTEGER DEFAULT 60,
  p_transport           TEXT DEFAULT NULL
)
RETURNS TABLE (accepted BOOLEAN, outbox_status TEXT, next_attempt TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_row public.whatsapp_outbox%ROWTYPE;
  v_status TEXT;
  v_next TIMESTAMPTZ;
  v_error TEXT := left(p_error, 500);
BEGIN
  IF p_outcome NOT IN ('sent', 'retry', 'defer', 'failed', 'delivery_unknown', 'skipped')
     OR p_retry_after_seconds IS NULL OR p_retry_after_seconds NOT BETWEEN 1 AND 86400
     OR (p_transport IS NOT NULL AND p_transport NOT IN ('cloud_api', 'web_bridge')) THEN
    RAISE EXCEPTION 'invalid whatsapp outbox outcome' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.whatsapp_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'sending' OR v_row.lease_token IS DISTINCT FROM p_lease_token THEN
    RETURN QUERY SELECT FALSE, v_row.status, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF p_outcome IN ('sent', 'delivery_unknown') AND v_row.send_started_at IS NULL THEN
    RETURN QUERY SELECT FALSE, v_row.status, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  IF p_outcome = 'defer' AND v_row.send_started_at IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, v_row.status, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  IF p_outcome = 'sent' AND (p_provider_message_id IS NULL OR length(btrim(p_provider_message_id)) NOT BETWEEN 1 AND 500) THEN
    RAISE EXCEPTION 'sent outcome requires a provider message id' USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'retry' AND v_row.attempts < v_row.max_attempts THEN
    v_status := 'queued';
    v_next := v_now + make_interval(secs => p_retry_after_seconds);
  ELSIF p_outcome = 'retry' THEN
    v_status := 'failed';
    v_error := left(COALESCE(v_error, 'provider_error') || ' (max_attempts)', 500);
  ELSIF p_outcome = 'defer' THEN
    v_status := 'queued';
    v_next := v_now + make_interval(secs => p_retry_after_seconds);
  ELSE
    v_status := p_outcome;
  END IF;

  UPDATE public.whatsapp_outbox
     SET status = v_status,
         attempts = CASE WHEN p_outcome = 'defer' THEN GREATEST(attempts - 1, 0) ELSE attempts END,
         next_attempt_at = COALESCE(v_next, next_attempt_at),
         transport = COALESCE(p_transport, transport),
         lease_owner = NULL, lease_token = NULL, lease_until = NULL, send_started_at = NULL,
         provider_message_id = CASE WHEN p_outcome = 'sent' THEN btrim(p_provider_message_id) ELSE provider_message_id END,
         sent_at = CASE WHEN p_outcome = 'sent' THEN v_now ELSE sent_at END,
         last_error = CASE WHEN p_outcome = 'sent' THEN NULL ELSE COALESCE(v_error, p_outcome) END,
         completed_at = CASE WHEN v_status = 'queued' THEN NULL ELSE v_now END
   WHERE id = v_row.id;

  IF v_row.delivery_id IS NOT NULL AND v_status <> 'queued' THEN
    UPDATE public.notification_deliveries
       SET status = CASE v_status WHEN 'sent' THEN 'sent' WHEN 'skipped' THEN 'skipped' ELSE 'failed' END,
           provider_message_id = CASE WHEN v_status = 'sent' THEN btrim(p_provider_message_id) ELSE provider_message_id END,
           sent_at = CASE WHEN v_status = 'sent' THEN v_now ELSE sent_at END,
           skip_reason = CASE WHEN v_status = 'skipped' THEN left(v_error, 200) ELSE skip_reason END,
           error = CASE WHEN v_status IN ('failed', 'delivery_unknown') THEN left(COALESCE(v_error, v_status), 300) ELSE NULL END,
           attempts = v_row.attempts
     WHERE id = v_row.delivery_id;
  END IF;

  RETURN QUERY SELECT TRUE, v_status, v_next;
END;
$$;

-- Meta status webhook (sent / delivered / read / failed) by provider message id.
-- Monotonic: sent < delivered < read; 'failed' replaces sent/delivered.
CREATE OR REPLACE FUNCTION public.apply_whatsapp_outbox_status(
  p_provider_message_id TEXT,
  p_status              TEXT,
  p_occurred_at         TIMESTAMPTZ DEFAULT NULL,
  p_error               TEXT DEFAULT NULL
)
RETURNS TABLE (matched BOOLEAN, outbox_id UUID, outbox_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.whatsapp_outbox%ROWTYPE;
  v_rank JSONB := '{"sent":1,"delivered":2,"read":3}'::jsonb;
  v_when TIMESTAMPTZ := COALESCE(p_occurred_at, clock_timestamp());
  v_next TEXT;
BEGIN
  IF p_provider_message_id IS NULL OR length(btrim(p_provider_message_id)) NOT BETWEEN 1 AND 500
     OR p_status NOT IN ('sent', 'delivered', 'read', 'failed') THEN
    RAISE EXCEPTION 'invalid whatsapp delivery status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.whatsapp_outbox
   WHERE provider_message_id = btrim(p_provider_message_id) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  IF v_row.status NOT IN ('sent', 'delivered', 'read') THEN
    v_next := v_row.status;
  ELSIF p_status = 'failed' THEN
    v_next := CASE WHEN v_row.status = 'read' THEN 'read' ELSE 'failed' END;
  ELSIF (v_rank ->> p_status)::INT > (v_rank ->> v_row.status)::INT THEN
    v_next := p_status;
  ELSE
    v_next := v_row.status;
  END IF;

  UPDATE public.whatsapp_outbox
     SET status = v_next,
         delivered_at = CASE WHEN v_next IN ('delivered', 'read') THEN COALESCE(delivered_at, v_when) ELSE delivered_at END,
         read_at = CASE WHEN v_next = 'read' THEN COALESCE(read_at, v_when) ELSE read_at END,
         last_error = CASE WHEN v_next = 'failed' AND v_row.status <> 'failed' THEN left(COALESCE(p_error, 'meta.delivery_failed'), 500) ELSE last_error END
   WHERE id = v_row.id;

  IF v_next = 'failed' AND v_row.status <> 'failed' AND v_row.delivery_id IS NOT NULL THEN
    UPDATE public.notification_deliveries
       SET status = 'failed', error = left(COALESCE(p_error, 'meta.delivery_failed'), 300)
     WHERE id = v_row.delivery_id;
  END IF;

  RETURN QUERY SELECT TRUE, v_row.id, v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_whatsapp_outbox(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_whatsapp_outbox(TEXT, INTEGER, INTEGER, UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_whatsapp_outbox_send(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_whatsapp_outbox(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_whatsapp_outbox_status(TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_whatsapp_outbox(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_outbox(TEXT, INTEGER, INTEGER, UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_whatsapp_outbox_send(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_whatsapp_outbox(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_whatsapp_outbox_status(TEXT, TEXT, TIMESTAMPTZ, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
