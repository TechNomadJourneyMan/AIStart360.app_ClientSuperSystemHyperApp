-- 065_omnichannel_runtime_role.sql
-- Least-privilege capability role for the dedicated omnichannel PostgreSQL
-- connection. A separate LOGIN role may be granted membership operationally;
-- credentials are deliberately never created or stored in migrations.

DO $role$
DECLARE
  v_role pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO v_role
    FROM pg_catalog.pg_roles
   WHERE rolname = 'aistart360_omnichannel_runtime';

  IF NOT FOUND THEN
    EXECUTE 'CREATE ROLE aistart360_omnichannel_runtime '
      'NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE '
      'NOREPLICATION NOBYPASSRLS';
  ELSIF v_role.rolcanlogin
     OR v_role.rolinherit
     OR v_role.rolsuper
     OR v_role.rolcreatedb
     OR v_role.rolcreaterole
     OR v_role.rolreplication
     OR v_role.rolbypassrls THEN
    RAISE EXCEPTION
      'existing aistart360_omnichannel_runtime role has unsafe attributes'
      USING ERRCODE = '42501';
  END IF;
END
$role$;

REVOKE ALL PRIVILEGES ON SCHEMA public
  FROM aistart360_omnichannel_runtime;
GRANT CONNECT ON DATABASE postgres TO aistart360_omnichannel_runtime;
GRANT USAGE ON SCHEMA public TO aistart360_omnichannel_runtime;

-- Remove any explicit privileges from an earlier development revision before
-- granting only the statements issued by the direct PostgreSQL adapters.
REVOKE ALL PRIVILEGES ON TABLE public.omnichannel_settings
  FROM aistart360_omnichannel_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.omnichannel_contacts
  FROM aistart360_omnichannel_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.omnichannel_conversations
  FROM aistart360_omnichannel_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.omnichannel_messages
  FROM aistart360_omnichannel_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.omnichannel_webhook_events
  FROM aistart360_omnichannel_runtime;
REVOKE ALL PRIVILEGES ON TABLE public.omnichannel_processing_jobs
  FROM aistart360_omnichannel_runtime;

-- Runtime processing and the operator inbox need to read these four tables.
-- Writes remain column-scoped so credentials cannot alter identifiers,
-- immutable audit timestamps, or automation configuration directly.
GRANT SELECT ON TABLE public.omnichannel_settings
  TO aistart360_omnichannel_runtime;
GRANT UPDATE (
  enabled,
  mode,
  business_context,
  confidence_threshold,
  reply_delay_seconds
) ON TABLE public.omnichannel_settings
  TO aistart360_omnichannel_runtime;

GRANT SELECT ON TABLE public.omnichannel_contacts
  TO aistart360_omnichannel_runtime;
GRANT INSERT (
  channel,
  external_id,
  display_name,
  username,
  phone,
  last_seen_at
) ON TABLE public.omnichannel_contacts
  TO aistart360_omnichannel_runtime;
GRANT UPDATE (
  display_name,
  username,
  phone,
  last_seen_at
) ON TABLE public.omnichannel_contacts
  TO aistart360_omnichannel_runtime;

GRANT SELECT ON TABLE public.omnichannel_conversations
  TO aistart360_omnichannel_runtime;
GRANT INSERT (
  channel,
  account_external_id,
  external_id,
  contact_id
) ON TABLE public.omnichannel_conversations
  TO aistart360_omnichannel_runtime;
GRANT UPDATE (
  contact_id,
  status,
  auto_reply_override,
  send_suppressed,
  suppression_reason,
  suppressed_at,
  intent,
  sentiment,
  lead_score,
  summary,
  last_message_at,
  last_inbound_at,
  last_outbound_at
) ON TABLE public.omnichannel_conversations
  TO aistart360_omnichannel_runtime;

GRANT SELECT ON TABLE public.omnichannel_messages
  TO aistart360_omnichannel_runtime;
GRANT INSERT (
  conversation_id,
  channel,
  external_message_id,
  direction,
  message_type,
  text,
  status,
  reply_to_external_id,
  ai_generated,
  metadata,
  occurred_at,
  processed_at
) ON TABLE public.omnichannel_messages
  TO aistart360_omnichannel_runtime;
GRANT UPDATE (
  direction,
  message_type,
  text,
  status,
  reply_to_external_id,
  ai_draft,
  ai_confidence,
  ai_reason,
  ai_generated,
  metadata,
  processed_at
) ON TABLE public.omnichannel_messages
  TO aistart360_omnichannel_runtime;

-- Webhook audit access is narrower still: only the deduplication columns are
-- readable and only lifecycle diagnostics can be updated.
GRANT SELECT (
  id,
  channel,
  event_hash,
  status
) ON TABLE public.omnichannel_webhook_events
  TO aistart360_omnichannel_runtime;
GRANT INSERT (
  channel,
  event_hash,
  event_type,
  account_external_id,
  metadata,
  status
) ON TABLE public.omnichannel_webhook_events
  TO aistart360_omnichannel_runtime;
GRANT UPDATE (
  status,
  error,
  processed_at
) ON TABLE public.omnichannel_webhook_events
  TO aistart360_omnichannel_runtime;

-- The role is a system integration principal rather than an end-user tenant.
-- RLS still stays enabled so access must match both these policies and the
-- column privileges above. No DELETE policy exists.
ALTER TABLE public.omnichannel_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omnichannel_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omnichannel_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omnichannel_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omnichannel_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS omnichannel_runtime_select
  ON public.omnichannel_settings;
CREATE POLICY omnichannel_runtime_select
  ON public.omnichannel_settings
  FOR SELECT
  TO aistart360_omnichannel_runtime
  USING (TRUE);
DROP POLICY IF EXISTS omnichannel_runtime_update
  ON public.omnichannel_settings;
CREATE POLICY omnichannel_runtime_update
  ON public.omnichannel_settings
  FOR UPDATE
  TO aistart360_omnichannel_runtime
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS omnichannel_runtime_select
  ON public.omnichannel_contacts;
CREATE POLICY omnichannel_runtime_select
  ON public.omnichannel_contacts
  FOR SELECT
  TO aistart360_omnichannel_runtime
  USING (TRUE);
DROP POLICY IF EXISTS omnichannel_runtime_insert
  ON public.omnichannel_contacts;
CREATE POLICY omnichannel_runtime_insert
  ON public.omnichannel_contacts
  FOR INSERT
  TO aistart360_omnichannel_runtime
  WITH CHECK (TRUE);
DROP POLICY IF EXISTS omnichannel_runtime_update
  ON public.omnichannel_contacts;
CREATE POLICY omnichannel_runtime_update
  ON public.omnichannel_contacts
  FOR UPDATE
  TO aistart360_omnichannel_runtime
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS omnichannel_runtime_select
  ON public.omnichannel_conversations;
CREATE POLICY omnichannel_runtime_select
  ON public.omnichannel_conversations
  FOR SELECT
  TO aistart360_omnichannel_runtime
  USING (TRUE);
DROP POLICY IF EXISTS omnichannel_runtime_insert
  ON public.omnichannel_conversations;
CREATE POLICY omnichannel_runtime_insert
  ON public.omnichannel_conversations
  FOR INSERT
  TO aistart360_omnichannel_runtime
  WITH CHECK (TRUE);
DROP POLICY IF EXISTS omnichannel_runtime_update
  ON public.omnichannel_conversations;
CREATE POLICY omnichannel_runtime_update
  ON public.omnichannel_conversations
  FOR UPDATE
  TO aistart360_omnichannel_runtime
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS omnichannel_runtime_select
  ON public.omnichannel_messages;
CREATE POLICY omnichannel_runtime_select
  ON public.omnichannel_messages
  FOR SELECT
  TO aistart360_omnichannel_runtime
  USING (TRUE);
DROP POLICY IF EXISTS omnichannel_runtime_insert
  ON public.omnichannel_messages;
CREATE POLICY omnichannel_runtime_insert
  ON public.omnichannel_messages
  FOR INSERT
  TO aistart360_omnichannel_runtime
  WITH CHECK (TRUE);
DROP POLICY IF EXISTS omnichannel_runtime_update
  ON public.omnichannel_messages;
CREATE POLICY omnichannel_runtime_update
  ON public.omnichannel_messages
  FOR UPDATE
  TO aistart360_omnichannel_runtime
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS omnichannel_runtime_select
  ON public.omnichannel_webhook_events;
CREATE POLICY omnichannel_runtime_select
  ON public.omnichannel_webhook_events
  FOR SELECT
  TO aistart360_omnichannel_runtime
  USING (TRUE);
DROP POLICY IF EXISTS omnichannel_runtime_insert
  ON public.omnichannel_webhook_events;
CREATE POLICY omnichannel_runtime_insert
  ON public.omnichannel_webhook_events
  FOR INSERT
  TO aistart360_omnichannel_runtime
  WITH CHECK (TRUE);
DROP POLICY IF EXISTS omnichannel_runtime_update
  ON public.omnichannel_webhook_events;
CREATE POLICY omnichannel_runtime_update
  ON public.omnichannel_webhook_events
  FOR UPDATE
  TO aistart360_omnichannel_runtime
  USING (TRUE)
  WITH CHECK (TRUE);

-- Queue rows remain RPC-only: the role has no table policy or table grant.
-- Every mutation is fenced by the SECURITY DEFINER functions from migration
-- 064, and every other privileged transition is granted by exact signature.
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public
  FROM aistart360_omnichannel_runtime;

GRANT EXECUTE ON FUNCTION public.claim_omnichannel_auto_send(UUID)
  TO aistart360_omnichannel_runtime;
GRANT EXECUTE ON FUNCTION public.reserve_omnichannel_manual_reply(UUID)
  TO aistart360_omnichannel_runtime;
GRANT EXECUTE ON FUNCTION public.list_omnichannel_inbox(TEXT, INTEGER)
  TO aistart360_omnichannel_runtime;
GRANT EXECUTE ON FUNCTION public.claim_omnichannel_equipment_flow_send(
  UUID, TIMESTAMPTZ
) TO aistart360_omnichannel_runtime;
GRANT EXECUTE ON FUNCTION public.set_omnichannel_equipment_flow_enabled(
  TEXT, BOOLEAN
) TO aistart360_omnichannel_runtime;
GRANT EXECUTE ON FUNCTION public.finalize_omnichannel_equipment_flow_reply(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) TO aistart360_omnichannel_runtime;
GRANT EXECUTE ON FUNCTION public.claim_omnichannel_webhook_event(UUID)
  TO aistart360_omnichannel_runtime;

GRANT EXECUTE ON FUNCTION public.enqueue_omnichannel_processing_job(
  UUID, BOOLEAN, TIMESTAMPTZ, INTEGER
) TO aistart360_omnichannel_runtime;
GRANT EXECUTE ON FUNCTION public.claim_omnichannel_processing_job(INTEGER)
  TO aistart360_omnichannel_runtime;
GRANT EXECUTE ON FUNCTION public.complete_omnichannel_processing_job(UUID, UUID)
  TO aistart360_omnichannel_runtime;
GRANT EXECUTE ON FUNCTION public.retry_omnichannel_processing_job(
  UUID, UUID, TEXT, BOOLEAN, INTEGER
) TO aistart360_omnichannel_runtime;

-- Migration 065 normally runs before the pull-delivery functions from 066.
-- On a convergent rerun, restore those exact RPC grants after the blanket
-- function revoke above without making their absence an installation error.
DO $outbound_runtime_grants$
BEGIN
  IF to_regprocedure(
    'public.enqueue_omnichannel_outbound_delivery(uuid,uuid,text,text,text,text,text,boolean,text,jsonb,jsonb,integer,integer)'
  ) IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.enqueue_omnichannel_outbound_delivery(
      UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT,
      JSONB, JSONB, INTEGER, INTEGER
    ) TO aistart360_omnichannel_runtime;
    GRANT EXECUTE ON FUNCTION public.claim_omnichannel_outbound_delivery(
      TEXT, INTEGER
    ) TO aistart360_omnichannel_runtime;
    GRANT EXECUTE ON FUNCTION public.authorize_omnichannel_outbound_delivery(
      UUID, UUID, TEXT, INTEGER
    ) TO aistart360_omnichannel_runtime;
    GRANT EXECUTE ON FUNCTION public.report_omnichannel_outbound_delivery(
      UUID, UUID, TEXT, TEXT, TEXT, TEXT
    ) TO aistart360_omnichannel_runtime;
  END IF;
END
$outbound_runtime_grants$;

-- PUBLIC privileges cannot be denied to one role. Close the only unrelated
-- SECURITY DEFINER entry points found by the pre-migration privilege audit,
-- then restore their intended application/auth callers explicitly. This keeps
-- the dedicated integration login from inheriting an unintended escalator.
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role()
  TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user()
  TO supabase_auth_admin;

COMMENT ON ROLE aistart360_omnichannel_runtime IS
  'NOLOGIN capability role for the dedicated omnichannel application connection; must not own objects and does not bypass RLS.';

NOTIFY pgrst, 'reload schema';
