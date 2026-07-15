import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  omnichannelPostgresPool,
  shouldUseOmnichannelPostgres,
} from "./postgres-runtime";
import type {
  JsonObject,
  OmnichannelChannel,
  OmnichannelConversationStatus,
  OmnichannelMode,
} from "./types";

/**
 * Privileged direct SQL for the local Giga Inbox only.
 *
 * The legacy name is retained for route compatibility. Production is allowed
 * only through the explicit, dedicated Postgres configuration enforced by the
 * shared runtime adapter.
 */
export function shouldUseDevelopmentAdminPostgres(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return shouldUseOmnichannelPostgres(env);
}

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;
type TransactionPool = Pick<Pool, "connect">;

function assertDevelopmentAdminPostgres(): void {
  if (!shouldUseDevelopmentAdminPostgres()) {
    throw new Error("direct Giga Inbox PostgreSQL access is disabled");
  }
}

function developmentAdminPool(): Pool {
  assertDevelopmentAdminPostgres();
  return omnichannelPostgresPool();
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function json(value: JsonObject): string {
  return JSON.stringify(value);
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : String(value);
}

function mapTimestamps<T extends Record<string, unknown>>(row: T): T {
  const mapped = { ...row };
  for (const key of [
    "updated_at",
    "last_message_at",
    "last_inbound_at",
    "last_outbound_at",
    "suppressed_at",
    "occurred_at",
  ]) {
    if (key in mapped) mapped[key as keyof T] = iso(mapped[key]) as T[keyof T];
  }
  return mapped;
}

const settingColumns = `
  channel, enabled, mode, business_context, automation_config,
  confidence_threshold, reply_delay_seconds, updated_at
`;

const conversationColumns = `
  id, channel, account_external_id, external_id, contact_id, status,
  auto_reply_override, send_suppressed, suppression_reason, suppressed_at,
  intent, sentiment, lead_score, summary, last_message_at, last_inbound_at,
  last_outbound_at
`;

const detailMessageColumns = `
  id, direction, text, status, message_type, ai_draft, ai_confidence,
  ai_reason, ai_generated, occurred_at
`;

export interface DevelopmentAdminInboxResult {
  conversations: Record<string, unknown>[];
  settings: Record<string, unknown>[];
}

export async function listDevelopmentAdminInbox(
  channel: OmnichannelChannel | null,
  limit = 200,
  db: Queryable = developmentAdminPool(),
): Promise<DevelopmentAdminInboxResult> {
  assertDevelopmentAdminPostgres();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
  const [inboxResult, settingsResult] = await Promise.all([
    db.query(
      `SELECT conversation, contact, last_message
         FROM public.list_omnichannel_inbox($1::text, $2::integer)`,
      [channel, safeLimit],
    ),
    db.query(
      `SELECT ${settingColumns}
         FROM public.omnichannel_settings
        ORDER BY channel`,
    ),
  ]);

  return {
    conversations: inboxResult.rows.map((row: QueryResultRow) => ({
      ...record(row.conversation),
      contact:
        Object.keys(record(row.contact)).length > 0
          ? record(row.contact)
          : null,
      last_message:
        Object.keys(record(row.last_message)).length > 0
          ? record(row.last_message)
          : null,
    })),
    settings: settingsResult.rows.map((row: QueryResultRow) =>
      mapTimestamps(record(row)),
    ),
  };
}

export interface DevelopmentAdminConversationDetail {
  conversation: Record<string, unknown> & { contact: Record<string, unknown> };
  messages: Record<string, unknown>[];
}

export async function getDevelopmentAdminConversation(
  conversationId: string,
  db: Queryable = developmentAdminPool(),
): Promise<DevelopmentAdminConversationDetail | null> {
  assertDevelopmentAdminPostgres();
  const conversationResult = await db.query(
    `SELECT ${conversationColumns}
       FROM public.omnichannel_conversations
      WHERE id = $1::uuid
      LIMIT 1`,
    [conversationId],
  );
  const conversation = conversationResult.rows[0]
    ? mapTimestamps(record(conversationResult.rows[0]))
    : null;
  if (!conversation) return null;

  const [contactResult, messagesResult] = await Promise.all([
    db.query(
      `SELECT id, external_id, display_name, username, phone
         FROM public.omnichannel_contacts
        WHERE id = $1::uuid
        LIMIT 1`,
      [conversation.contact_id],
    ),
    db.query(
      `SELECT ${detailMessageColumns}
         FROM public.omnichannel_messages
        WHERE conversation_id = $1::uuid
        ORDER BY occurred_at DESC, created_at DESC
        LIMIT 500`,
      [conversationId],
    ),
  ]);
  const contact = contactResult.rows[0]
    ? record(contactResult.rows[0])
    : {
        id: conversation.contact_id,
        external_id: conversation.external_id,
        display_name: null,
        username: null,
        phone: null,
      };

  return {
    conversation: { ...conversation, contact },
    messages: [...messagesResult.rows]
      .reverse()
      .map((row) => mapTimestamps(record(row))),
  };
}

export interface DevelopmentAdminConversationPatch {
  status?: OmnichannelConversationStatus;
  auto_reply_override?: boolean | null;
  send_suppressed?: boolean;
}

export async function updateDevelopmentAdminConversation(
  conversationId: string,
  patch: DevelopmentAdminConversationPatch,
  db: Queryable = developmentAdminPool(),
): Promise<Record<string, unknown> | null> {
  assertDevelopmentAdminPostgres();
  const hasStatus = patch.status !== undefined;
  const hasOverride = patch.auto_reply_override !== undefined;
  const hasSuppression = patch.send_suppressed !== undefined;
  const result = await db.query(
    `UPDATE public.omnichannel_conversations
        SET status = CASE WHEN $2::boolean THEN $3::text ELSE status END,
            auto_reply_override = CASE
              WHEN $4::boolean THEN $5::boolean ELSE auto_reply_override
            END,
            send_suppressed = CASE
              WHEN $6::boolean THEN $7::boolean ELSE send_suppressed
            END,
            suppression_reason = CASE
              WHEN NOT $6::boolean THEN suppression_reason
              WHEN $7::boolean THEN 'admin_suppressed'
              ELSE NULL
            END,
            suppressed_at = CASE
              WHEN NOT $6::boolean THEN suppressed_at
              WHEN $7::boolean THEN now()
              ELSE NULL
            END
      WHERE id = $1::uuid
      RETURNING ${conversationColumns}`,
    [
      conversationId,
      hasStatus,
      patch.status ?? null,
      hasOverride,
      patch.auto_reply_override ?? null,
      hasSuppression,
      patch.send_suppressed ?? null,
    ],
  );
  return result.rows[0] ? mapTimestamps(record(result.rows[0])) : null;
}

export async function listDevelopmentAdminSettings(
  db: Queryable = developmentAdminPool(),
): Promise<Record<string, unknown>[]> {
  assertDevelopmentAdminPostgres();
  const result = await db.query(
    `SELECT ${settingColumns}
       FROM public.omnichannel_settings
      ORDER BY channel`,
  );
  return result.rows.map((row) => mapTimestamps(record(row)));
}

export interface DevelopmentAdminSettingPatch {
  enabled?: boolean;
  mode?: OmnichannelMode;
  business_context?: string | null;
  confidence_threshold?: number;
  reply_delay_seconds?: number;
}

export async function updateDevelopmentAdminSetting(
  channel: OmnichannelChannel,
  patch: DevelopmentAdminSettingPatch,
  db: Queryable = developmentAdminPool(),
): Promise<Record<string, unknown> | null> {
  assertDevelopmentAdminPostgres();
  const result = await db.query(
    `UPDATE public.omnichannel_settings
        SET enabled = CASE WHEN $2::boolean THEN $3::boolean ELSE enabled END,
            mode = CASE WHEN $4::boolean THEN $5::text ELSE mode END,
            business_context = CASE
              WHEN $6::boolean THEN $7::text ELSE business_context
            END,
            confidence_threshold = CASE
              WHEN $8::boolean THEN $9::numeric ELSE confidence_threshold
            END,
            reply_delay_seconds = CASE
              WHEN $10::boolean THEN $11::integer ELSE reply_delay_seconds
            END
      WHERE channel = $1
      RETURNING ${settingColumns}`,
    [
      channel,
      patch.enabled !== undefined,
      patch.enabled ?? null,
      patch.mode !== undefined,
      patch.mode ?? null,
      patch.business_context !== undefined,
      patch.business_context ?? null,
      patch.confidence_threshold !== undefined,
      patch.confidence_threshold ?? null,
      patch.reply_delay_seconds !== undefined,
      patch.reply_delay_seconds ?? null,
    ],
  );
  return result.rows[0] ? mapTimestamps(record(result.rows[0])) : null;
}

export async function setDevelopmentEquipmentFlowEnabled(
  channel: OmnichannelChannel,
  enabled: boolean,
  db: Queryable = developmentAdminPool(),
): Promise<Record<string, unknown> | null> {
  assertDevelopmentAdminPostgres();
  const result = await db.query(
    `SELECT ${settingColumns}
       FROM public.set_omnichannel_equipment_flow_enabled($1::text, $2::boolean)
      LIMIT 1`,
    [channel, enabled],
  );
  return result.rows[0] ? mapTimestamps(record(result.rows[0])) : null;
}

export interface DevelopmentManualReplyConversation {
  id: string;
  channel: OmnichannelChannel;
  account_external_id: string;
  external_id: string;
  contact_id: string;
  send_suppressed: boolean;
  suppression_reason: string | null;
}

export interface DevelopmentManualReplyInbound {
  id: string;
  external_message_id: string;
  occurred_at: string;
  metadata: JsonObject;
}

export interface DevelopmentManualReplyContext {
  conversation: DevelopmentManualReplyConversation;
  contact: { external_id: string } | null;
  latestInbound: DevelopmentManualReplyInbound | null;
}

export async function getDevelopmentManualReplyContext(
  conversationId: string,
  db: Queryable = developmentAdminPool(),
): Promise<DevelopmentManualReplyContext | null> {
  assertDevelopmentAdminPostgres();
  const conversationResult = await db.query(
    `SELECT id, channel, account_external_id, external_id, contact_id,
            send_suppressed, suppression_reason
       FROM public.omnichannel_conversations
      WHERE id = $1::uuid
      LIMIT 1`,
    [conversationId],
  );
  const conversationRow = conversationResult.rows[0];
  if (!conversationRow) return null;
  const conversation = record(
    conversationRow,
  ) as unknown as DevelopmentManualReplyConversation;

  const [contactResult, inboundResult] = await Promise.all([
    db.query(
      `SELECT external_id
         FROM public.omnichannel_contacts
        WHERE id = $1::uuid
        LIMIT 1`,
      [conversation.contact_id],
    ),
    db.query(
      `SELECT id, external_message_id, occurred_at, metadata
         FROM public.omnichannel_messages
        WHERE conversation_id = $1::uuid
          AND direction = 'in'
        ORDER BY occurred_at DESC, created_at DESC
        LIMIT 1`,
      [conversation.id],
    ),
  ]);

  const inbound = inboundResult.rows[0] ? record(inboundResult.rows[0]) : null;
  return {
    conversation,
    contact: contactResult.rows[0]
      ? { external_id: String(contactResult.rows[0].external_id) }
      : null,
    latestInbound: inbound
      ? {
          id: String(inbound.id),
          external_message_id: String(inbound.external_message_id),
          occurred_at: iso(inbound.occurred_at) ?? new Date().toISOString(),
          metadata: record(inbound.metadata) as JsonObject,
        }
      : null,
  };
}

export async function reserveDevelopmentManualReply(
  conversationId: string,
  db: Queryable = developmentAdminPool(),
): Promise<{ reserved: boolean; reason: string }> {
  assertDevelopmentAdminPostgres();
  const result = await db.query(
    `SELECT reserved, reason
       FROM public.reserve_omnichannel_manual_reply($1::uuid)`,
    [conversationId],
  );
  const row = result.rows[0];
  if (!row)
    throw new Error(
      "reserve omnichannel manual reply: database returned no row",
    );
  return {
    reserved: row.reserved === true,
    reason: typeof row.reason === "string" ? row.reason : "reservation_denied",
  };
}

async function inTransaction<T>(
  run: (client: PoolClient) => Promise<T>,
  pool: TransactionPool = developmentAdminPool(),
): Promise<T> {
  assertDevelopmentAdminPostgres();
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
      // Keep the original persistence error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export interface DevelopmentManualReplyUnknownInput {
  conversationId: string;
  channel: OmnichannelChannel;
  externalMessageId: string;
  text: string;
  latestInboundId: string | null;
  replyToExternalId: string | null;
  providerErrorCode: string | null;
  actorId: string;
  actorKind: string;
}

export async function recordDevelopmentManualReplyUnknown(
  input: DevelopmentManualReplyUnknownInput,
  pool: TransactionPool = developmentAdminPool(),
): Promise<void> {
  const now = new Date().toISOString();
  await inTransaction(async (client) => {
    await client.query(
      `INSERT INTO public.omnichannel_messages
        (conversation_id, channel, external_message_id, direction, message_type,
         text, status, reply_to_external_id, ai_generated, occurred_at,
         processed_at, metadata)
       VALUES
        ($1::uuid, $2, $3, 'out', 'text', $4, 'failed', $5, FALSE,
         $6::timestamptz, $6::timestamptz, $7::jsonb)
       ON CONFLICT (channel, external_message_id) DO NOTHING`,
      [
        input.conversationId,
        input.channel,
        input.externalMessageId,
        input.text,
        input.replyToExternalId,
        now,
        json({
          source: "giga_admin_manual",
          actorId: input.actorId,
          actorKind: input.actorKind,
          deliveryUnknown: true,
          providerErrorCode: input.providerErrorCode,
        }),
      ],
    );
    if (input.latestInboundId) {
      await client.query(
        `UPDATE public.omnichannel_messages
            SET status = 'superseded',
                ai_reason = 'manual_reply_delivery_unknown',
                processed_at = $2::timestamptz
          WHERE id = $1::uuid`,
        [input.latestInboundId, now],
      );
    }
    await client.query(
      `UPDATE public.omnichannel_conversations
          SET status = 'needs_human', auto_reply_override = FALSE
        WHERE id = $1::uuid`,
      [input.conversationId],
    );
  }, pool);
}

export interface DevelopmentManualReplySuccessInput {
  conversationId: string;
  channel: OmnichannelChannel;
  externalMessageId: string;
  text: string;
  latestInboundId: string | null;
  replyToExternalId: string | null;
  metadata: JsonObject;
}

export async function persistDevelopmentManualReplySuccess(
  input: DevelopmentManualReplySuccessInput,
  pool: TransactionPool = developmentAdminPool(),
): Promise<string> {
  const now = new Date().toISOString();
  return inTransaction(async (client) => {
    if (input.latestInboundId) {
      await client.query(
        `UPDATE public.omnichannel_messages
            SET status = 'replied',
                ai_reason = 'manual_operator_reply',
                processed_at = $2::timestamptz
          WHERE id = $1::uuid
            AND direction = 'in'`,
        [input.latestInboundId, now],
      );
    }
    const result = await client.query(
      `INSERT INTO public.omnichannel_messages
        (conversation_id, channel, external_message_id, direction, message_type,
         text, status, reply_to_external_id, ai_generated, metadata,
         occurred_at, processed_at)
       VALUES
        ($1::uuid, $2, $3, 'out', 'text', $4, 'sent', $5, FALSE,
         $6::jsonb, $7::timestamptz, $7::timestamptz)
       ON CONFLICT (channel, external_message_id) DO UPDATE SET
         direction = 'out',
         message_type = EXCLUDED.message_type,
         text = EXCLUDED.text,
         status = CASE
           WHEN omnichannel_messages.status IN ('delivered', 'read', 'failed')
             THEN omnichannel_messages.status
           ELSE EXCLUDED.status
         END,
         reply_to_external_id = EXCLUDED.reply_to_external_id,
         ai_generated = omnichannel_messages.ai_generated OR EXCLUDED.ai_generated,
         metadata = omnichannel_messages.metadata || EXCLUDED.metadata,
         processed_at = EXCLUDED.processed_at
       RETURNING id`,
      [
        input.conversationId,
        input.channel,
        input.externalMessageId,
        input.text,
        input.replyToExternalId,
        json(input.metadata),
        now,
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("persist manual reply: database returned no row");
    return String(id);
  }, pool);
}
