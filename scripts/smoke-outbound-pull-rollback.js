#!/usr/bin/env node

/**
 * Transactional acceptance test for migration 066. It creates synthetic rows,
 * exercises confirmed + ambiguous delivery outcomes, and always rolls back.
 * No customer rows, credentials, or secrets are printed.
 *
 * Usage:
 *   node --env-file=.env.production.local \
 *     scripts/smoke-outbound-pull-rollback.js --rollback
 */

const fs = require("node:fs");
const crypto = require("node:crypto");
const { Client } = require("pg");

function fail(message) {
  throw new Error(message);
}

async function main() {
  if (!process.argv.includes("--rollback")) {
    fail("refusing to run without --rollback");
  }
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) fail("DIRECT_URL or DATABASE_URL is required");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query(
      fs.readFileSync(
        "supabase/migrations/066_omnichannel_outbound_deliveries.sql",
        "utf8",
      ),
    );
    await client.query(
      "UPDATE public.omnichannel_settings SET enabled=TRUE, mode='auto', confidence_threshold=0.5 WHERE channel='whatsapp'",
    );

    async function seed() {
      const suffix = crypto.randomUUID();
      const contact = await client.query(
        `INSERT INTO public.omnichannel_contacts(channel, external_id, display_name)
         VALUES ('whatsapp', $1, 'Outbound rollback smoke') RETURNING id`,
        [`waweb:primary:smoke-${suffix}@s.whatsapp.net`],
      );
      const conversation = await client.query(
        `INSERT INTO public.omnichannel_conversations(
           channel, account_external_id, external_id, contact_id
         ) VALUES ('whatsapp', 'waweb:primary', $1, $2) RETURNING id`,
        [
          `7700999${suffix.replace(/-/g, "").slice(0, 6)}@s.whatsapp.net`,
          contact.rows[0].id,
        ],
      );
      const message = await client.query(
        `INSERT INTO public.omnichannel_messages(
           conversation_id, channel, external_message_id, direction,
           message_type, text, status, ai_draft, ai_confidence, metadata,
           occurred_at
         ) VALUES (
           $1, 'whatsapp', $2, 'in', 'text', 'smoke inbound', 'processing',
           'smoke outbound', 1,
           '{"providerTimestampTrusted":true,"transport":"whatsapp_web","bridgeSessionId":"primary"}',
           now()
         ) RETURNING id`,
        [conversation.rows[0].id, `waweb:primary:smoke-in-${suffix}`],
      );
      return {
        conversationId: conversation.rows[0].id,
        messageId: message.rows[0].id,
      };
    }

    async function queue(seed) {
      const idempotencyKey = `omnichannel:auto:${crypto.randomUUID()}`;
      const enqueued = await client.query(
        `SELECT * FROM public.enqueue_omnichannel_outbound_delivery(
           $1::uuid, $2::uuid, 'primary', $3, 'smoke outbound',
           'smoke-raw-in', 'automated', TRUE, 'text',
           '{"transport":"whatsapp_web"}'::jsonb,
           '{"kind":"auto","reason":"rollback_smoke"}'::jsonb,
           0, 3
         )`,
        [
          seed.conversationId,
          seed.messageId,
          idempotencyKey,
        ],
      );
      const claimed = await client.query(
        "SELECT * FROM public.claim_omnichannel_outbound_delivery('primary', 180)",
      );
      if (
        !claimed.rows[0] ||
        claimed.rows[0].delivery_id !== enqueued.rows[0].delivery_id
      ) {
        fail("claim mismatch");
      }
      const authorized = await client.query(
        `SELECT * FROM public.authorize_omnichannel_outbound_delivery(
           $1, $2, 'primary', 180
         )`,
        [claimed.rows[0].delivery_id, claimed.rows[0].lease_token],
      );
      if (authorized.rows[0]?.authorized !== true) {
        fail("authorization denied");
      }
      return { ...claimed.rows[0], idempotencyKey };
    }

    const successSeed = await seed();
    const successLease = await queue(successSeed);
    const success = await client.query(
      `SELECT * FROM public.report_omnichannel_outbound_delivery(
         $1, $2, 'primary', 'sent', $3, NULL
       )`,
      [
        successLease.delivery_id,
        successLease.lease_token,
        `provider-${crypto.randomUUID()}`,
      ],
    );
    if (success.rows[0]?.delivery_status !== "sent") {
      fail("success result not persisted");
    }
    const successState = await client.query(
      `SELECT d.status, p.text, i.status AS inbound_status,
              EXISTS(
                SELECT 1 FROM public.omnichannel_messages AS o
                 WHERE o.conversation_id = $1
                   AND o.direction = 'out' AND o.status = 'sent'
              ) AS has_sent
         FROM public.omnichannel_outbound_deliveries AS d
         JOIN public.omnichannel_outbound_payloads AS p ON p.id = d.payload_id
         JOIN public.omnichannel_messages AS i ON i.id = $2
        WHERE d.id = $3`,
      [successSeed.conversationId, successSeed.messageId, successLease.delivery_id],
    );
    const confirmed = successState.rows[0];
    if (
      confirmed.status !== "sent" ||
      confirmed.text !== null ||
      confirmed.inbound_status !== "replied" ||
      confirmed.has_sent !== true
    ) {
      fail("success invariants failed");
    }
    const duplicate = await client.query(
      `SELECT * FROM public.enqueue_omnichannel_outbound_delivery(
         $1::uuid, $2::uuid, 'primary', $3, 'smoke outbound',
         'smoke-raw-in', 'automated', TRUE, 'text',
         '{"transport":"whatsapp_web"}'::jsonb,
         '{"kind":"auto","reason":"rollback_smoke"}'::jsonb,
         0, 3
       )`,
      [
        successSeed.conversationId,
        successSeed.messageId,
        successLease.idempotencyKey,
      ],
    );
    if (
      duplicate.rows[0]?.delivery_id !== successLease.delivery_id ||
      duplicate.rows[0]?.delivery_status !== "sent" ||
      duplicate.rows[0]?.created !== false
    ) {
      fail("idempotent terminal replay failed");
    }
    await client.query("SAVEPOINT outbound_conflict_test");
    let conflictRejected = false;
    try {
      await client.query(
        `SELECT * FROM public.enqueue_omnichannel_outbound_delivery(
           $1::uuid, $2::uuid, 'primary', $3, 'different outbound',
           'smoke-raw-in', 'automated', TRUE, 'text',
           '{"transport":"whatsapp_web"}'::jsonb,
           '{"kind":"auto","reason":"rollback_smoke"}'::jsonb,
           0, 3
         )`,
        [
          successSeed.conversationId,
          successSeed.messageId,
          successLease.idempotencyKey,
        ],
      );
    } catch (error) {
      conflictRejected = error?.code === "23505";
      await client.query("ROLLBACK TO SAVEPOINT outbound_conflict_test");
    }
    await client.query("RELEASE SAVEPOINT outbound_conflict_test");
    if (!conflictRejected) fail("idempotency payload conflict was not rejected");

    const unknownSeed = await seed();
    const unknownLease = await queue(unknownSeed);
    const unknown = await client.query(
      `SELECT * FROM public.report_omnichannel_outbound_delivery(
         $1, $2, 'primary', 'delivery_unknown', NULL,
         'provider_send_ambiguous'
       )`,
      [unknownLease.delivery_id, unknownLease.lease_token],
    );
    if (unknown.rows[0]?.delivery_status !== "delivery_unknown") {
      fail("unknown result not persisted");
    }
    const unknownState = await client.query(
      `SELECT d.status, i.status AS inbound_status,
              c.status AS conversation_status,
              EXISTS(
                SELECT 1 FROM public.omnichannel_messages AS o
                 WHERE o.conversation_id = $1 AND o.direction = 'out'
              ) AS has_outbound
         FROM public.omnichannel_outbound_deliveries AS d
         JOIN public.omnichannel_messages AS i ON i.id = $2
         JOIN public.omnichannel_conversations AS c ON c.id = $1
        WHERE d.id = $3`,
      [unknownSeed.conversationId, unknownSeed.messageId, unknownLease.delivery_id],
    );
    const ambiguous = unknownState.rows[0];
    if (
      ambiguous.status !== "delivery_unknown" ||
      ambiguous.inbound_status !== "needs_human" ||
      ambiguous.conversation_status !== "needs_human" ||
      ambiguous.has_outbound !== false
    ) {
      fail("unknown invariants failed");
    }

    const expiredSeed = await seed();
    const expiredLease = await queue(expiredSeed);
    await client.query(
      `UPDATE public.omnichannel_outbound_deliveries
          SET lease_until = clock_timestamp() - interval '1 second'
        WHERE id = $1`,
      [expiredLease.delivery_id],
    );
    const reaped = await client.query(
      "SELECT * FROM public.reap_omnichannel_outbound_deliveries(NULL, 100)",
    );
    if (Number(reaped.rows[0]?.delivery_unknown ?? 0) < 1) {
      fail("independent reaper did not resolve an authorized lease");
    }
    const expiredState = await client.query(
      `SELECT d.status, i.status AS inbound_status,
              c.status AS conversation_status,
              EXISTS(
                SELECT 1 FROM public.omnichannel_messages AS o
                 WHERE o.conversation_id = $1 AND o.direction = 'out'
              ) AS has_outbound
         FROM public.omnichannel_outbound_deliveries AS d
         JOIN public.omnichannel_messages AS i ON i.id = $2
         JOIN public.omnichannel_conversations AS c ON c.id = $1
        WHERE d.id = $3`,
      [expiredSeed.conversationId, expiredSeed.messageId, expiredLease.delivery_id],
    );
    const expired = expiredState.rows[0];
    if (
      expired.status !== "delivery_unknown" ||
      expired.inbound_status !== "needs_human" ||
      expired.conversation_status !== "needs_human" ||
      expired.has_outbound !== false
    ) {
      fail("expired authorized lease invariants failed");
    }

    const retrySeed = await seed();
    const retryLease = await queue(retrySeed);
    const retry = await client.query(
      `SELECT * FROM public.report_omnichannel_outbound_delivery(
         $1, $2, 'primary', 'retryable_failure', NULL,
         'session_disconnected'
       )`,
      [retryLease.delivery_id, retryLease.lease_token],
    );
    if (retry.rows[0]?.delivery_status !== "queued") {
      fail("safe pre-provider failure was not requeued");
    }
    const retryState = await client.query(
      `SELECT d.status, d.lease_token, d.lease_until,
              i.status AS inbound_status,
              c.status AS conversation_status,
              EXISTS(
                SELECT 1 FROM public.omnichannel_messages AS o
                 WHERE o.conversation_id = $1 AND o.direction = 'out'
              ) AS has_outbound
         FROM public.omnichannel_outbound_deliveries AS d
         JOIN public.omnichannel_messages AS i ON i.id = $2
         JOIN public.omnichannel_conversations AS c ON c.id = $1
        WHERE d.id = $3`,
      [retrySeed.conversationId, retrySeed.messageId, retryLease.delivery_id],
    );
    const safelyRequeued = retryState.rows[0];
    if (
      safelyRequeued.status !== "queued" ||
      safelyRequeued.lease_token !== null ||
      safelyRequeued.lease_until !== null ||
      safelyRequeued.inbound_status !== "sending" ||
      safelyRequeued.conversation_status !== "open" ||
      safelyRequeued.has_outbound !== false
    ) {
      fail("safe retry invariants failed");
    }

    const manualSeed = await seed();
    const manualKey = `omnichannel:manual:${crypto.randomUUID()}`;
    const manualDelivery = await client.query(
      `SELECT * FROM public.enqueue_omnichannel_outbound_delivery(
         $1::uuid, $2::uuid, 'primary', $3, 'manual smoke outbound',
         'smoke-raw-in', 'manual', FALSE, 'text',
         '{"transport":"whatsapp_web"}'::jsonb,
         '{"kind":"manual","reason":"manual_operator_reply"}'::jsonb,
         0, 3
       )`,
      [manualSeed.conversationId, manualSeed.messageId, manualKey],
    );
    const manualClaim = await client.query(
      "SELECT * FROM public.claim_omnichannel_outbound_delivery('primary', 180)",
    );
    if (
      manualClaim.rows[0]?.delivery_id !==
      manualDelivery.rows[0]?.delivery_id
    ) {
      fail("manual delivery claim mismatch");
    }
    await client.query(
      `UPDATE public.omnichannel_messages
          SET occurred_at = clock_timestamp() - interval '25 hours'
        WHERE id = $1`,
      [manualSeed.messageId],
    );
    const manualAuthorization = await client.query(
      `SELECT * FROM public.authorize_omnichannel_outbound_delivery(
         $1, $2, 'primary', 180
       )`,
      [
        manualClaim.rows[0].delivery_id,
        manualClaim.rows[0].lease_token,
      ],
    );
    if (
      manualAuthorization.rows[0]?.authorized !== false ||
      manualAuthorization.rows[0]?.reason !== "manual_send_window_expired"
    ) {
      fail("expired manual policy window was not rejected");
    }
    const manualState = await client.query(
      `SELECT d.status,
              EXISTS(
                SELECT 1 FROM public.omnichannel_messages AS o
                 WHERE o.conversation_id = $1 AND o.direction = 'out'
              ) AS has_outbound
         FROM public.omnichannel_outbound_deliveries AS d
        WHERE d.id = $2`,
      [manualSeed.conversationId, manualClaim.rows[0].delivery_id],
    );
    if (
      manualState.rows[0]?.status !== "cancelled" ||
      manualState.rows[0]?.has_outbound !== false
    ) {
      fail("expired manual delivery invariants failed");
    }

    await client.query("ROLLBACK");
    process.stdout.write("outbound pull rollback acceptance passed\n");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(
    `outbound pull rollback acceptance failed: ${error?.code || "unknown"}: ${String(error?.message || error).slice(0, 500)}\n`,
  );
  process.exitCode = 1;
});
