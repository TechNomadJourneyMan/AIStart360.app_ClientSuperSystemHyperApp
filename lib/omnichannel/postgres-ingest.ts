import type { Pool, PoolClient } from "pg";
import {
  omnichannelPostgresPool,
  shouldUseOmnichannelPostgres,
} from "./postgres-runtime";
import type {
  IngestNormalizedMessageResult,
  RecordedWebhookEvent,
  RecordWebhookEventInput,
} from "./repository";
import { shouldQueueDuplicateOmnichannelMessage } from "./retry-policy";
import type {
  JsonObject,
  NormalizedOmnichannelMessage,
  OmnichannelWebhookEventStatus,
} from "./types";

type TransactionPool = Pick<Pool, "connect">;

function assertDirectPostgresEnabled(): void {
  // Unit-testable injected pools and the legacy local adapter remain usable in
  // development. Route selection still prefers a configured service client.
  if (process.env.NODE_ENV === "development") return;
  if (shouldUseOmnichannelPostgres()) return;
  throw new Error("Direct PostgreSQL omnichannel ingestion is disabled");
}

function defaultPool(): Pool {
  assertDirectPostgresEnabled();
  return omnichannelPostgresPool();
}

async function inTransaction<T>(
  operation: string,
  run: (client: PoolClient) => Promise<T>,
  pool: TransactionPool,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    const message =
      error instanceof Error ? error.message.slice(0, 300) : "database error";
    throw new Error(`${operation}: ${message}`);
  } finally {
    client.release();
  }
}

function normalizedProviderTime(value: string | null | undefined): {
  occurredAt: string;
  trusted: boolean;
} {
  if (value) {
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) {
      return { occurredAt: new Date(time).toISOString(), trusted: true };
    }
  }
  return { occurredAt: new Date().toISOString(), trusted: false };
}

function isCatchUp(message: NormalizedOmnichannelMessage): boolean {
  return (
    message.channel === "whatsapp" &&
    message.metadata.transport === "whatsapp_web" &&
    (message.metadata.live === false ||
      message.metadata.catchUp === true ||
      message.metadata.offline === true)
  );
}

function json(value: JsonObject): string {
  return JSON.stringify(value);
}

export async function recordWebhookEvent(
  input: RecordWebhookEventInput,
  pool: TransactionPool = defaultPool(),
): Promise<RecordedWebhookEvent> {
  assertDirectPostgresEnabled();
  return inTransaction(
    "record webhook event",
    async (client) => {
      const inserted = await client.query<{
        id: string;
        status: OmnichannelWebhookEventStatus;
      }>(
        `INSERT INTO public.omnichannel_webhook_events
        (channel, event_hash, event_type, account_external_id, metadata, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'received')
       ON CONFLICT (channel, event_hash) DO NOTHING
       RETURNING id, status`,
        [
          input.channel,
          input.eventHash,
          input.eventType ?? null,
          input.accountExternalId ?? null,
          json(input.metadata ?? {}),
        ],
      );
      if (inserted.rows[0]) {
        return { ...inserted.rows[0], duplicate: false };
      }

      const existing = await client.query<{
        id: string;
        status: OmnichannelWebhookEventStatus;
      }>(
        `SELECT id, status
         FROM public.omnichannel_webhook_events
        WHERE channel = $1 AND event_hash = $2`,
        [input.channel, input.eventHash],
      );
      if (!existing.rows[0])
        throw new Error("duplicate webhook event was not found");
      return { ...existing.rows[0], duplicate: true };
    },
    pool,
  );
}

/** Direct Postgres call to the same leased claim used by the Supabase path. */
export async function claimWebhookEventForProcessing(
  eventId: string,
  pool: TransactionPool = defaultPool(),
): Promise<boolean> {
  assertDirectPostgresEnabled();
  return inTransaction(
    "claim webhook event for processing",
    async (client) => {
      const claimed = await client.query<{ claimed: boolean }>(
        `SELECT claimed
         FROM public.claim_omnichannel_webhook_event($1::uuid)`,
        [eventId],
      );
      return claimed.rows[0]?.claimed === true;
    },
    pool,
  );
}

export async function transitionWebhookEvent(
  eventId: string,
  status: OmnichannelWebhookEventStatus,
  errorMessage: string | null = null,
  pool: TransactionPool = defaultPool(),
): Promise<void> {
  assertDirectPostgresEnabled();
  await inTransaction(
    "transition webhook event",
    async (client) => {
      const terminal = ["processed", "failed", "ignored"].includes(status);
      await client.query(
        `UPDATE public.omnichannel_webhook_events
          SET status = $2,
              error = $3,
              processed_at = CASE WHEN $4::boolean THEN now() ELSE NULL END
        WHERE id = $1`,
        [eventId, status, errorMessage?.slice(0, 500) ?? null, terminal],
      );
    },
    pool,
  );
}

export async function ingestNormalizedMessage(
  message: NormalizedOmnichannelMessage,
  pool: TransactionPool = defaultPool(),
): Promise<IngestNormalizedMessageResult> {
  assertDirectPostgresEnabled();
  const ingestedAt = new Date().toISOString();
  const providerTime = normalizedProviderTime(message.occurredAt);
  const catchUp = isCatchUp(message);
  const persistedStatus = catchUp ? "imported" : message.status;
  const hasContactName = Boolean(message.contactName);
  const hasPhone = message.channel === "whatsapp";
  const phone =
    message.channel === "whatsapp"
      ? message.contactPhone === undefined
        ? message.contactExternalId
        : message.contactPhone
      : null;

  return inTransaction(
    "ingest omnichannel message",
    async (client) => {
      const contact = await client.query<{ id: string }>(
        `INSERT INTO public.omnichannel_contacts
        (channel, external_id, display_name, username, phone, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (channel, external_id) DO UPDATE SET
         last_seen_at = EXCLUDED.last_seen_at,
         display_name = CASE WHEN $6::boolean THEN EXCLUDED.display_name
                             ELSE omnichannel_contacts.display_name END,
         username = CASE WHEN $7::boolean THEN EXCLUDED.username
                         ELSE omnichannel_contacts.username END,
         phone = CASE WHEN $8::boolean THEN EXCLUDED.phone
                      ELSE omnichannel_contacts.phone END
       RETURNING id`,
        [
          message.channel,
          message.contactExternalId,
          hasContactName ? message.contactName : null,
          hasContactName && message.channel === "instagram"
            ? message.contactName
            : null,
          phone,
          hasContactName,
          hasContactName && message.channel === "instagram",
          hasPhone,
        ],
      );
      const contactId = contact.rows[0]?.id;
      if (!contactId) throw new Error("contact upsert returned no row");

      const conversation = await client.query<{ id: string }>(
        `INSERT INTO public.omnichannel_conversations
        (channel, account_external_id, external_id, contact_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (channel, account_external_id, external_id) DO UPDATE SET
         contact_id = EXCLUDED.contact_id
       RETURNING id`,
        [
          message.channel,
          message.accountExternalId,
          message.conversationExternalId,
          contactId,
        ],
      );
      const conversationId = conversation.rows[0]?.id;
      if (!conversationId)
        throw new Error("conversation upsert returned no row");

      const metadata = {
        ...message.metadata,
        providerTimestampTrusted: providerTime.trusted,
        // Trusted server clock used by the Inngest quiet-window fallback.
        ingestedAt,
      };
      const inserted = await client.query<{
        id: string;
        conversation_id: string;
        direction: "in" | "out";
        status: NormalizedOmnichannelMessage["status"];
      }>(
        `INSERT INTO public.omnichannel_messages
        (conversation_id, channel, external_message_id, direction, message_type,
         text, status, reply_to_external_id, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)
       ON CONFLICT (channel, external_message_id) DO NOTHING
       RETURNING id, conversation_id, direction, status`,
        [
          conversationId,
          message.channel,
          message.externalMessageId,
          message.direction,
          message.messageType,
          message.text,
          persistedStatus,
          message.replyToExternalId,
          json(metadata),
          providerTime.occurredAt,
        ],
      );
      if (inserted.rows[0]) {
        return {
          duplicate: false,
          messageId: inserted.rows[0].id,
          conversationId: inserted.rows[0].conversation_id,
          shouldQueue:
            !catchUp &&
            inserted.rows[0].direction === "in" &&
            inserted.rows[0].status === "received",
        };
      }

      const existing = await client.query<{
        id: string;
        conversation_id: string;
        direction: "in" | "out";
        status: NormalizedOmnichannelMessage["status"];
      }>(
        `SELECT id, conversation_id, direction, status
         FROM public.omnichannel_messages
        WHERE channel = $1 AND external_message_id = $2`,
        [message.channel, message.externalMessageId],
      );
      const row = existing.rows[0];
      if (!row) throw new Error("duplicate omnichannel message was not found");
      return {
        duplicate: true,
        messageId: row.id,
        conversationId: row.conversation_id,
        // Catch-up imports are intentionally persistence-only, including retries.
        shouldQueue: !catchUp && shouldQueueDuplicateOmnichannelMessage(row),
      };
    },
    pool,
  );
}
