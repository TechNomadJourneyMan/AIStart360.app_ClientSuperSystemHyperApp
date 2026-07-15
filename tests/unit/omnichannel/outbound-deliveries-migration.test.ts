import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/066_omnichannel_outbound_deliveries.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("066 durable WhatsApp Web outbound pull migration", () => {
  it("keeps customer text out of the lease queue", () => {
    const queueDefinition = migration.slice(
      migration.indexOf("CREATE TABLE IF NOT EXISTS public.omnichannel_outbound_deliveries"),
      migration.indexOf("CREATE INDEX IF NOT EXISTS idx_omnichannel_outbound_deliveries_ready"),
    );
    expect(queueDefinition).not.toMatch(/\btext\s+TEXT\b/i);
    expect(queueDefinition).toContain("payload_id UUID NOT NULL UNIQUE");
    expect(queueDefinition).toContain("payload_hash TEXT NOT NULL");
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.omnichannel_outbound_payloads[\s\S]*?text TEXT/,
    );
  });

  it("keeps both tables RPC-only and grants four exact transitions", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.omnichannel_outbound_payloads\s+FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.omnichannel_outbound_deliveries\s+FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).not.toMatch(
      /CREATE POLICY[^;]+ON public\.omnichannel_outbound_(?:payloads|deliveries)/,
    );
    for (const name of ["enqueue", "claim", "authorize", "report"]) {
      expect(migration).toContain(`${name}_omnichannel_outbound_delivery`);
    }
    expect(
      migration.match(
        /GRANT EXECUTE ON FUNCTION public\.(?:enqueue|claim|authorize|report)_omnichannel_outbound_delivery/g,
      ),
    ).toHaveLength(4);
  });

  it("never recovers an expired authorized lease as sendable", () => {
    expect(migration).toMatch(
      /v_expired\.status = 'authorized'[\s\S]*?status = 'delivery_unknown'/,
    );
    expect(migration).toMatch(
      /status = 'needs_human'[\s\S]*?auto_reply_override = FALSE/,
    );
    expect(migration).not.toMatch(
      /v_expired\.status = 'authorized'[\s\S]{0,500}?status = 'queued'/,
    );
  });

  it("exposes an independent service-only fence reaper", () => {
    expect(migration).toContain("reap_omnichannel_outbound_deliveries");
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.reap_omnichannel_outbound_deliveries\(TEXT, INTEGER\)\s+TO service_role;/,
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.reap_omnichannel_outbound_deliveries[^;]+aistart360_omnichannel_runtime/,
    );
  });

  it("prevents a later reply from overtaking an older delivery", () => {
    expect(migration).toMatch(
      /earlier\.conversation_id = d\.conversation_id[\s\S]*?earlier\.status IN \('queued', 'leased', 'authorized'\)[\s\S]*?earlier\.created_at < d\.created_at/,
    );
  });

  it("marks an automated inbound row as owned by its durable delivery", () => {
    expect(migration).toMatch(
      /p_actor = 'automated'[\s\S]*?outboundDeliveryId[\s\S]*?p_source_inbound_message_id/,
    );
  });

  it("rechecks the WhatsApp policy window before exposing a manual payload", () => {
    expect(migration).toMatch(
      /v_payload\.actor = 'manual'[\s\S]*?providerTimestampTrusted[\s\S]*?INTERVAL '24 hours'[\s\S]*?manual_send_window_expired/,
    );
    expect(migration).toContain("manual_reply_superseded_by_newer_message");
  });

  it("allowlists only pre-provider failures for retry", () => {
    expect(migration).toContain("v_safe_retry_codes CONSTANT TEXT[]");
    expect(migration).toContain("'session_disconnected'");
    expect(migration).toContain("'idempotency_cache_persist_failed'");
    expect(migration).not.toMatch(
      /v_safe_retry_codes CONSTANT TEXT\[\][\s\S]{0,500}?'provider_send_ambiguous'/,
    );
    expect(migration).toMatch(
      /ELSE 'delivery_unknown'[\s\S]*?status = 'needs_human'/,
    );
  });

  it("stores only confirmed sends in omnichannel message history", () => {
    expect(migration).toMatch(
      /IF p_outcome = 'sent' THEN[\s\S]*?INSERT INTO public\.omnichannel_messages/,
    );
    const unknownBranch = migration.slice(
      migration.indexOf("v_next_status := CASE"),
      migration.indexOf("RETURN QUERY SELECT TRUE, v_next_status"),
    );
    expect(unknownBranch).not.toContain("INSERT INTO public.omnichannel_messages");
  });
});
