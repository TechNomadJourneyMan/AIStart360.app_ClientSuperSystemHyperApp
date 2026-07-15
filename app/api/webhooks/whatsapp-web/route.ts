export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The fast path handles at most one durable job, but that job may use two
// bounded model attempts. Give it the same execution budget as the queue
// lease; the database job remains recoverable if the invocation still ends.
export const maxDuration = 300;

import { createHash } from "crypto";
import { waitUntil } from "@vercel/functions";
import { NextResponse, type NextRequest } from "next/server";
import { inngest } from "@/lib/inngest";
import { processOmnichannelMessageDirect } from "@/lib/functions/process-omnichannel-message";
import { OMNICHANNEL_MESSAGE_RECEIVED_EVENT } from "@/lib/omnichannel/events";
import {
  claimWebhookEventForProcessing,
  ingestNormalizedMessage,
  recordWebhookEvent,
  transitionWebhookEvent,
} from "@/lib/omnichannel/repository";
import type {
  IngestNormalizedMessageResult,
  RecordedWebhookEvent,
  RecordWebhookEventInput,
} from "@/lib/omnichannel/repository";
import type {
  NormalizedOmnichannelMessage,
  OmnichannelWebhookEventStatus,
} from "@/lib/omnichannel/types";
import {
  verifySignedBridgeRequest,
  WHATSAPP_WEB_PORTAL_AUDIENCE,
} from "@/lib/omnichannel/whatsapp-web-signature";
import { parseWhatsAppWebBridgeEvent } from "@/lib/omnichannel/whatsapp-web-webhook";
import { shouldUseOmnichannelPostgres } from "@/lib/omnichannel/postgres-runtime";
import { enqueueOmnichannelProcessingJob } from "@/lib/omnichannel/processing-jobs";
import { drainOmnichannelProcessingJobs } from "@/lib/omnichannel/process-job-queue";

const WEBHOOK_PATH = "/api/webhooks/whatsapp-web";
const MAX_BODY_BYTES = 256_000;
const MAX_FAST_PATH_DELAY_MS = 30_000;

interface WebhookPersistence {
  recordWebhookEvent(
    input: RecordWebhookEventInput,
  ): Promise<RecordedWebhookEvent>;
  claimWebhookEventForProcessing(eventId: string): Promise<boolean>;
  transitionWebhookEvent(
    eventId: string,
    status: OmnichannelWebhookEventStatus,
    errorMessage?: string | null,
  ): Promise<void>;
  ingestNormalizedMessage(
    message: NormalizedOmnichannelMessage,
  ): Promise<IngestNormalizedMessageResult>;
}

function shouldUsePostgresFallback(): boolean {
  return shouldUseOmnichannelPostgres();
}

async function persistence(): Promise<WebhookPersistence> {
  if (shouldUsePostgresFallback()) {
    return import("@/lib/omnichannel/postgres-ingest");
  }
  return {
    recordWebhookEvent,
    claimWebhookEventForProcessing,
    transitionWebhookEvent,
    ingestNormalizedMessage,
  };
}

function enabled(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? "");
}

/** Inline execution is a local-development escape hatch, never a production mode. */
function shouldProcessInline(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    enabled(process.env.OMNICHANNEL_INLINE_PROCESSING)
  );
}

function shouldUseDatabaseQueue(): boolean {
  return (
    process.env.OMNICHANNEL_PROCESSING_BACKEND?.trim().toLowerCase() ===
    "database"
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Best-effort low-latency path for Vercel. The durable database job remains
 * the source of truth; the bridge kicker will recover it if this invocation
 * ends before the promise runs.
 */
function scheduleDatabaseQueueFastPath(runAt: string): void {
  if (process.env.VERCEL !== "1") return;
  const runAtMs = new Date(runAt).getTime();
  if (!Number.isFinite(runAtMs)) return;
  const delayMs = Math.max(0, runAtMs - Date.now());
  if (delayMs > MAX_FAST_PATH_DELAY_MS) return;

  const work = (async () => {
    if (delayMs > 0) await sleep(delayMs);
    await drainOmnichannelProcessingJobs({ limit: 1 });
  })().catch(() => {
    // The durable job remains queued and the signed bridge kicker retries it.
  });
  try {
    waitUntil(work);
  } catch {
    // Local/non-Vercel runtimes may not provide an execution context. The
    // promise has already started; database durability still covers failure.
  }
}

function isOwnedDuplicate(audit: RecordedWebhookEvent): boolean {
  return (
    audit.duplicate && ["queued", "processed", "ignored"].includes(audit.status)
  );
}

function hmacSecret(value: string | undefined): string | undefined {
  const secret = value?.trim();
  return secret && Buffer.byteLength(secret, "utf8") >= 32 ? secret : undefined;
}

function response(status = 200): NextResponse {
  return NextResponse.json(
    { ok: status >= 200 && status < 300 },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function markFailed(
  store: WebhookPersistence,
  eventId: string,
  code: string,
): Promise<void> {
  try {
    await store.transitionWebhookEvent(eventId, "failed", code);
  } catch {
    // The bridge receives 500 and retries. Never log customer content here.
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!enabled(process.env.WHATSAPP_WEB_BRIDGE_ENABLED)) return response(503);
  const databaseQueue = shouldUseDatabaseQueue();
  // Production database mode must use the dedicated, least-privilege DSN.
  // Never silently fall back to the application's broad DATABASE_URL/service
  // role when the durable queue has been selected.
  if (databaseQueue && !shouldUseOmnichannelPostgres()) return response(503);
  const secret = hmacSecret(process.env.WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET);
  const configuredSession =
    process.env.WHATSAPP_WEB_BRIDGE_SESSION_ID?.trim() || "primary";
  if (!secret) return response(503);
  if (
    !req.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return response(415);
  }

  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return response(413);
  }

  let rawBody: Buffer;
  try {
    rawBody = Buffer.from(await req.arrayBuffer());
  } catch {
    return response(400);
  }
  if (rawBody.byteLength > MAX_BODY_BYTES) return response(413);

  const verified = verifySignedBridgeRequest({
    method: "POST",
    path: WEBHOOK_PATH,
    body: rawBody,
    headers: req.headers,
    expectedAudience: WHATSAPP_WEB_PORTAL_AUDIENCE,
    secrets: {
      primary: secret,
      previous: hmacSecret(
        process.env.WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET_PREVIOUS,
      ),
    },
    maxSkewSeconds: 60,
  });
  if (!verified.ok) return response(401);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    return response(400);
  }
  const parsed = parseWhatsAppWebBridgeEvent(payload);
  if (!parsed) return response(400);
  if (parsed.sessionId !== configuredSession) return response(403);

  // The bridge keeps event_id stable across delivery attempts. Hash the
  // validated session-scoped identity (rather than transport headers or JSON
  // serialization) so the database uniqueness constraint remains the durable
  // replay guard across processes and deployments.
  const eventHash = createHash("sha256")
    .update(`whatsapp_web\0${parsed.sessionId}\0${parsed.eventId}`)
    .digest("hex");
  let auditId: string | null = null;
  let auditClaimed = false;
  const store = await persistence();
  try {
    const audit = await store.recordWebhookEvent({
      channel: "whatsapp",
      eventHash,
      eventType: "wa_web_message",
      accountExternalId: parsed.message.accountExternalId,
      metadata: {
        eventCount: 1,
        transport: "whatsapp_web",
        catchUp: !parsed.live,
        offline: !parsed.live,
      },
    });
    auditId = audit.id;

    // Durable event identity is the replay guard. Terminal or already queued
    // events can be acknowledged immediately. A `processing` duplicate must
    // still pass through the leased claim below: the previous worker may have
    // crashed after claiming but before enqueueing.
    if (isOwnedDuplicate(audit)) return response();

    // Persist before claiming so a process crash cannot strand an audit in
    // `processing` without its message. Message insertion is independently
    // idempotent on the provider message id.
    const ingested = await store.ingestNormalizedMessage(parsed.message);

    // The database claim is a short lease. It protects concurrent deliveries
    // while allowing a stale `processing` event to recover after a worker
    // crash. Both contenders may perform the idempotent message upsert, but
    // only the lease owner may enqueue/process it.
    const claimed = await store.claimWebhookEventForProcessing(audit.id);
    // Do not acknowledge an in-flight race: a retryable response keeps the
    // bridge event in its durable outbox. If the current owner succeeds, the
    // next attempt observes a terminal audit and receives 200. If it crashed,
    // the database lease becomes reclaimable.
    if (!claimed) return response(503);
    auditClaimed = true;

    if (ingested.shouldQueue) {
      const eventData = {
        message_id: ingested.messageId,
        conversation_id: ingested.conversationId,
        // Reconnected devices may emit accumulated messages as `append`.
        // Analyse them, but never let old backlog trigger an automatic send.
        force_draft: !parsed.live,
      };
      const inline = shouldProcessInline();
      try {
        if (databaseQueue) {
          const job = await enqueueOmnichannelProcessingJob({
            messageId: ingested.messageId,
            forceDraft: !parsed.live,
          });
          scheduleDatabaseQueueFastPath(job.runAt);
        } else if (inline) {
          await processOmnichannelMessageDirect(eventData);
        } else {
          await inngest.send({
            id: `omnichannel-message-${ingested.messageId}`,
            name: OMNICHANNEL_MESSAGE_RECEIVED_EVENT,
            data: eventData,
          });
        }
      } catch {
        await markFailed(
          store,
          audit.id,
          databaseQueue
            ? "database_queue_enqueue_failed"
            : inline
              ? "inline_processing_failed"
              : "inngest_enqueue_failed",
        );
        return response(500);
      }
    }

    await store.transitionWebhookEvent(audit.id, "processed");
    return response();
  } catch {
    // Before the compare-and-set this request does not own the audit row. Do
    // not overwrite a concurrent worker's `processing` state on an ingest or
    // claim error; leaving received/failed makes the delivery safely retryable.
    if (auditId && auditClaimed) {
      await markFailed(store, auditId, "webhook_processing_failed");
    }
    return response(500);
  }
}
