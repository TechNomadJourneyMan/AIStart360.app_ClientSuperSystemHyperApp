#!/usr/bin/env node

/**
 * End-to-end production smoke test for the signed bridge drain and dedicated
 * database worker. It creates one synthetic draft-only message, waits for the
 * Vercel worker to complete it, and always removes the synthetic rows.
 */

const { execFileSync } = require("node:child_process");
const {
  randomUUID,
  createHash,
  createHmac,
  randomBytes,
} = require("node:crypto");
const { Client } = require("pg");

const DRAIN_URL =
  "https://aistart360.vercel.app/api/webhooks/whatsapp-web/drain";
const WEBHOOK_URL = "https://aistart360.vercel.app/api/webhooks/whatsapp-web";

function fail(message) {
  throw new Error(message);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function bridgeEnvironment(pid) {
  const output = execFileSync("ps", ["eww", "-p", pid, "-o", "command="], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  const read = (name) =>
    output.match(new RegExp(`(?:^|\\s)${name}=([^\\s]+)`))?.[1];
  return {
    sessionId: read("BRIDGE_SESSION_ID"),
    secret: read("PORTAL_WEBHOOK_SECRET"),
    keyId: read("PORTAL_WEBHOOK_KEY_ID") || "primary",
  };
}

function signedPortalRequest(bridge, urlValue, payload) {
  const url = new URL(urlValue);
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const nonce = randomBytes(18).toString("base64url");
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = [
    "v1",
    "POST",
    "aistart360-portal",
    url.pathname,
    bodyHash,
    timestamp,
    nonce,
    bridge.keyId,
  ].join("\n");
  const signature = `sha256=${createHmac("sha256", bridge.secret)
    .update(canonical)
    .digest("hex")}`;
  return {
    url,
    body,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-wa-bridge-version": "v1",
      "x-wa-bridge-audience": "aistart360-portal",
      "x-wa-bridge-timestamp": timestamp,
      "x-wa-bridge-nonce": nonce,
      "x-wa-bridge-key-id": bridge.keyId,
      "x-wa-bridge-signature": signature,
    },
  };
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function verifySignedWebhook(client, bridge, suffix) {
  const eventId = `smoke-event-${suffix}`;
  const providerMessageId = `smoke-provider-${suffix}`;
  const remoteJid = `smoke-${suffix}@lid`;
  const contactExternalId = `waweb:${bridge.sessionId}:${remoteJid}`;
  const signed = signedPortalRequest(bridge, WEBHOOK_URL, {
    version: 1,
    event_id: eventId,
    event_type: "message",
    session_id: bridge.sessionId,
    message: {
      id: providerMessageId,
      remote_jid: remoteJid,
      push_name: "Production smoke test",
      timestamp_ms: Date.now(),
      text: "Исторический smoke test",
      message_type: "text",
      live: true,
      from_me: false,
    },
  });
  const eventHash = createHash("sha256")
    .update(`whatsapp_web\0${bridge.sessionId}\0${eventId}`)
    .digest("hex");
  let conversationId;
  let contactId;
  try {
    const contact = await client.query(
      `INSERT INTO public.omnichannel_contacts
         (channel, external_id, display_name, last_seen_at)
       VALUES ('whatsapp', $1, 'Production webhook smoke test', now())
       RETURNING id`,
      [contactExternalId],
    );
    contactId = contact.rows[0].id;
    const conversation = await client.query(
      `INSERT INTO public.omnichannel_conversations
         (channel, account_external_id, external_id, contact_id,
          auto_reply_override)
       VALUES ('whatsapp', $1, $2, $3::uuid, FALSE)
       RETURNING id`,
      [`waweb:${bridge.sessionId}`, remoteJid, contactId],
    );
    conversationId = conversation.rows[0].id;

    const response = await fetch(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    if (response.status !== 200) fail("signed production webhook was rejected");

    let persisted;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const result = await client.query(
        `SELECT m.status AS message_status, j.status AS job_status,
                EXISTS (
                  SELECT 1 FROM public.omnichannel_messages AS outbound
                   WHERE outbound.conversation_id = m.conversation_id
                     AND outbound.direction = 'out'
                ) AS has_outbound
           FROM public.omnichannel_messages AS m
           LEFT JOIN public.omnichannel_processing_jobs AS j
             ON j.message_id = m.id
          WHERE m.channel = 'whatsapp' AND m.external_message_id = $1`,
        [`waweb:${bridge.sessionId}:${providerMessageId}`],
      );
      persisted = result.rows[0];
      if (["succeeded", "dead"].includes(persisted?.job_status)) break;
      await delay(1_000);
    }
    if (
      persisted?.job_status !== "succeeded" ||
      persisted.message_status !== "ignored" ||
      persisted.has_outbound !== false
    ) {
      fail("live webhook queue did not honor manual takeover without sending");
    }
    const audit = await client.query(
      `SELECT status FROM public.omnichannel_webhook_events
        WHERE channel = 'whatsapp' AND event_hash = $1`,
      [eventHash],
    );
    if (audit.rows[0]?.status !== "processed") {
      fail("signed production webhook audit was not completed");
    }
    console.log(
      "✓ Live production webhook queued, processed, and honored manual takeover without sending",
    );
  } finally {
    if (conversationId) {
      await client.query(
        "DELETE FROM public.omnichannel_conversations WHERE id = $1::uuid",
        [conversationId],
      );
    }
    if (contactId) {
      await client.query(
        "DELETE FROM public.omnichannel_contacts WHERE id = $1::uuid",
        [contactId],
      );
    }
    await client.query(
      `DELETE FROM public.omnichannel_webhook_events
        WHERE channel = 'whatsapp' AND event_hash = $1`,
      [eventHash],
    );
  }
}

async function main() {
  if (!process.argv.includes("--apply")) fail("refusing without --apply");
  const pid = argument("--pid");
  if (!pid || !/^\d+$/.test(pid)) fail("--pid must identify the live bridge");
  const bridge = bridgeEnvironment(pid);
  if (
    !bridge.sessionId ||
    !bridge.secret ||
    Buffer.byteLength(bridge.secret, "utf8") < 32
  ) {
    fail("live bridge signing configuration is unavailable");
  }
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) fail("DIRECT_URL or DATABASE_URL is required");

  const client = new Client({ connectionString });
  const suffix = randomUUID();
  let contactId;
  let conversationId;
  let messageId;
  let jobId;
  await client.connect();
  try {
    await verifySignedWebhook(client, bridge, suffix);

    await client.query("BEGIN");
    const contact = await client.query(
      `INSERT INTO public.omnichannel_contacts
         (channel, external_id, display_name, last_seen_at)
       VALUES ('whatsapp', $1, 'Production smoke test', now())
       RETURNING id`,
      [`smoke-contact-${suffix}`],
    );
    contactId = contact.rows[0].id;
    const conversation = await client.query(
      `INSERT INTO public.omnichannel_conversations
         (channel, account_external_id, external_id, contact_id)
       VALUES ('whatsapp', 'waweb:primary', $1, $2::uuid)
       RETURNING id`,
      [`smoke-conversation-${suffix}`, contactId],
    );
    conversationId = conversation.rows[0].id;
    const message = await client.query(
      `INSERT INTO public.omnichannel_messages
         (conversation_id, channel, external_message_id, direction,
          message_type, text, status, metadata, occurred_at)
       VALUES ($1::uuid, 'whatsapp', $2, 'in', 'text', 'Хочу в Клуб',
               'received', $3::jsonb, now())
       RETURNING id`,
      [
        conversationId,
        `smoke-message-${suffix}`,
        JSON.stringify({ transport: "whatsapp_web", live: false, smoke: true }),
      ],
    );
    messageId = message.rows[0].id;
    const job = await client.query(
      `SELECT * FROM public.enqueue_omnichannel_processing_job(
         $1::uuid, TRUE, NULL::timestamptz, 3
       )`,
      [messageId],
    );
    jobId = job.rows[0].job_id;
    await client.query("COMMIT");

    const signed = signedPortalRequest(bridge, DRAIN_URL, {
      version: 1,
      session_id: bridge.sessionId,
    });
    const response = await fetch(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    if (response.status !== 202)
      fail("production drain did not accept the kick");

    let outcome;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await client.query(
        `SELECT j.status AS job_status, m.status AS message_status,
                m.ai_draft IS NOT NULL AS has_draft
           FROM public.omnichannel_processing_jobs AS j
           JOIN public.omnichannel_messages AS m ON m.id = j.message_id
          WHERE j.id = $1::uuid`,
        [jobId],
      );
      outcome = status.rows[0];
      if (["succeeded", "dead"].includes(outcome?.job_status)) break;
      await delay(1_000);
    }
    if (
      outcome?.job_status !== "succeeded" ||
      outcome.message_status !== "drafted" ||
      outcome.has_draft !== true
    ) {
      fail("production worker did not complete the synthetic draft");
    }
    console.log(
      "✓ Signed production drain used the restricted DB worker and produced a draft",
    );
  } finally {
    try {
      if (conversationId) {
        await client.query(
          "DELETE FROM public.omnichannel_conversations WHERE id = $1::uuid",
          [conversationId],
        );
      }
      if (contactId) {
        await client.query(
          "DELETE FROM public.omnichannel_contacts WHERE id = $1::uuid",
          [contactId],
        );
      }
    } finally {
      await client.end();
    }
  }
}

main().catch((error) => {
  console.error(
    `✗ ${error instanceof Error ? error.message : "smoke test failed"}`,
  );
  process.exit(1);
});
