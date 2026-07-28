import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  omnichannelPostgresPool,
  shouldUseOmnichannelPostgres,
} from "./postgres-runtime";
import type {
  JsonObject,
  OmnichannelContact,
  OmnichannelConversation,
  OmnichannelMessage,
  OmnichannelMessageStatus,
  OmnichannelMessageType,
  OmnichannelSettings,
} from "./types";

/**
 * Backwards-compatible name retained for existing routes. Production remains
 * fail-closed unless a dedicated direct-Postgres configuration is explicit.
 */
export function shouldUseDevelopmentPostgres(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return shouldUseOmnichannelPostgres(env);
}

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

function developmentPool(): Pool {
  if (!shouldUseDevelopmentPostgres()) {
    throw new Error("direct omnichannel Postgres access is disabled");
  }
  return omnichannelPostgresPool();
}

function asJsonObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function timestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : String(value);
}

function nullableTimestamp(value: unknown): string | null {
  return value == null ? null : timestamp(value);
}

function mapSettings(row: Record<string, unknown>): OmnichannelSettings {
  return {
    channel: row.channel as OmnichannelSettings["channel"],
    mode: row.mode as OmnichannelSettings["mode"],
    enabled: row.enabled === true,
    businessContext:
      typeof row.business_context === "string" ? row.business_context : null,
    automationConfig: asJsonObject(row.automation_config),
    confidenceThreshold: Number(row.confidence_threshold ?? 0.75),
    replyDelaySeconds: Number(row.reply_delay_seconds ?? 0),
    // node-postgres maps TIMESTAMPTZ to Date and truncates PostgreSQL's
    // microseconds to milliseconds.  The equipment-flow send claim compares
    // this revision exactly, so keep the server-rendered text when available.
    updatedAt:
      typeof row.updated_at_precise === "string"
        ? row.updated_at_precise
        : timestamp(row.updated_at),
  };
}

function mapContact(row: Record<string, unknown>): OmnichannelContact {
  return {
    id: String(row.id),
    channel: row.channel as OmnichannelContact["channel"],
    externalId: String(row.external_id),
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    username: typeof row.username === "string" ? row.username : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    metadata: asJsonObject(row.metadata),
    firstSeenAt: timestamp(row.first_seen_at),
    lastSeenAt: timestamp(row.last_seen_at),
  };
}

function mapConversation(
  row: Record<string, unknown>,
): OmnichannelConversation {
  return {
    id: String(row.id),
    channel: row.channel as OmnichannelConversation["channel"],
    accountExternalId: String(row.account_external_id),
    externalId: String(row.external_id),
    contactId: String(row.contact_id),
    status: row.status as OmnichannelConversation["status"],
    autoReplyOverride:
      typeof row.auto_reply_override === "boolean"
        ? row.auto_reply_override
        : null,
    sendSuppressed: row.send_suppressed === true,
    suppressionReason:
      typeof row.suppression_reason === "string"
        ? row.suppression_reason
        : null,
    suppressedAt: nullableTimestamp(row.suppressed_at),
    intent: typeof row.intent === "string" ? row.intent : null,
    sentiment: typeof row.sentiment === "string" ? row.sentiment : null,
    leadScore: row.lead_score == null ? null : Number(row.lead_score),
    summary: typeof row.summary === "string" ? row.summary : null,
    lastMessageAt: nullableTimestamp(row.last_message_at),
    lastInboundAt: nullableTimestamp(row.last_inbound_at),
    lastOutboundAt: nullableTimestamp(row.last_outbound_at),
    metadata: asJsonObject(row.metadata),
  };
}

function mapMessage(row: Record<string, unknown>): OmnichannelMessage {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    channel: row.channel as OmnichannelMessage["channel"],
    externalMessageId: String(row.external_message_id),
    direction: row.direction as OmnichannelMessage["direction"],
    messageType: row.message_type as OmnichannelMessage["messageType"],
    text: typeof row.text === "string" ? row.text : null,
    status: row.status as OmnichannelMessage["status"],
    replyToExternalId:
      typeof row.reply_to_external_id === "string"
        ? row.reply_to_external_id
        : null,
    aiDraft: typeof row.ai_draft === "string" ? row.ai_draft : null,
    aiConfidence: row.ai_confidence == null ? null : Number(row.ai_confidence),
    aiReason: typeof row.ai_reason === "string" ? row.ai_reason : null,
    aiGenerated: row.ai_generated === true,
    metadata: asJsonObject(row.metadata),
    occurredAt: timestamp(row.occurred_at),
    processedAt: nullableTimestamp(row.processed_at),
  };
}

export interface DevelopmentMessageContext {
  message: OmnichannelMessage;
  conversation: OmnichannelConversation;
  contact: OmnichannelContact;
  settings: OmnichannelSettings;
  history: OmnichannelMessage[];
  newestInboundMessageId: string | null;
}

export interface DevelopmentImportedHistoryCandidate {
  messageId: string;
  conversationId: string;
}

/**
 * Lists only QR-bridge catch-up rows that have not entered AI processing yet.
 * The query is deliberately bounded; a repeated admin request is idempotent
 * because processed rows no longer have status `imported`.
 */
export async function listImportedWhatsAppHistoryForDraftViaPostgres(
  limit = 100,
  db: Queryable = developmentPool(),
): Promise<DevelopmentImportedHistoryCandidate[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const result = await db.query(
    `SELECT latest.id, latest.conversation_id
       FROM (
         SELECT DISTINCT ON (conversation_id)
           id, conversation_id, occurred_at, created_at
         FROM public.omnichannel_messages
         WHERE channel = 'whatsapp'
           AND direction = 'in'
           AND status = 'imported'
           AND ai_draft IS NULL
           AND metadata @> $1::jsonb
         ORDER BY conversation_id, occurred_at DESC, created_at DESC, id DESC
       ) AS latest
      ORDER BY latest.occurred_at DESC, latest.created_at DESC, latest.id DESC
      LIMIT $2::integer`,
    [JSON.stringify({ transport: "whatsapp_web", catchUp: true }), safeLimit],
  );
  return result.rows.map((row) => ({
    messageId: String(row.id),
    conversationId: String(row.conversation_id),
  }));
}

const messageColumns = `
  id, conversation_id, channel, external_message_id, direction, message_type,
  text, status, reply_to_external_id, ai_draft, ai_confidence, ai_reason,
  ai_generated, metadata, occurred_at, processed_at, created_at
`;

export async function getMessageContextViaPostgres(
  messageId: string,
  db: Queryable = developmentPool(),
): Promise<DevelopmentMessageContext | null> {
  const messageResult = await db.query(
    `SELECT ${messageColumns}
       FROM public.omnichannel_messages
      WHERE id = $1::uuid
      LIMIT 1`,
    [messageId],
  );
  const messageRow = messageResult.rows[0] as
    Record<string, unknown> | undefined;
  if (!messageRow) return null;

  const conversationResult = await db.query(
    `SELECT *
       FROM public.omnichannel_conversations
      WHERE id = $1::uuid
      LIMIT 1`,
    [messageRow.conversation_id],
  );
  const conversationRow = conversationResult.rows[0] as
    Record<string, unknown> | undefined;
  if (!conversationRow)
    throw new Error("load omnichannel conversation: row not found");

  const [contactResult, settingsResult, historyResult, newestInboundResult] =
    await Promise.all([
      db.query(
        `SELECT * FROM public.omnichannel_contacts WHERE id = $1::uuid LIMIT 1`,
        [conversationRow.contact_id],
      ),
      db.query(
        `SELECT s.*, s.updated_at::text AS updated_at_precise
         FROM public.omnichannel_settings s
        WHERE s.channel = $1
        LIMIT 1`,
        [conversationRow.channel],
      ),
      db.query(
        `SELECT ${messageColumns}
         FROM public.omnichannel_messages
        WHERE conversation_id = $1::uuid
        ORDER BY occurred_at DESC, created_at DESC
        LIMIT 20`,
        [conversationRow.id],
      ),
      db.query(
        `SELECT id
         FROM public.omnichannel_messages
        WHERE conversation_id = $1::uuid AND direction = 'in'
        ORDER BY occurred_at DESC, created_at DESC
        LIMIT 1`,
        [conversationRow.id],
      ),
    ]);

  const contactRow = contactResult.rows[0] as
    Record<string, unknown> | undefined;
  const settingsRow = settingsResult.rows[0] as
    Record<string, unknown> | undefined;
  if (!contactRow) throw new Error("load omnichannel contact: row not found");
  if (!settingsRow) throw new Error("load omnichannel settings: row not found");

  return {
    message: mapMessage(messageRow),
    conversation: mapConversation(conversationRow),
    contact: mapContact(contactRow),
    settings: mapSettings(settingsRow),
    history: [...historyResult.rows].reverse().map((row) => mapMessage(row)),
    newestInboundMessageId: newestInboundResult.rows[0]?.id
      ? String(newestInboundResult.rows[0].id)
      : null,
  };
}

export async function markMessageProcessingViaPostgres(
  messageId: string,
  db: Queryable = developmentPool(),
): Promise<boolean> {
  const result = await db.query(
    `UPDATE public.omnichannel_messages
        SET status = 'processing', processed_at = NULL
      WHERE id = $1::uuid
        AND status IN ('received', 'imported', 'failed')
      RETURNING id`,
    [messageId],
  );
  return result.rowCount === 1;
}

export interface DevelopmentAutoSendClaim {
  claimed: boolean;
  reason: string;
}

function mapClaim(row: QueryResultRow | undefined): DevelopmentAutoSendClaim {
  if (!row)
    throw new Error("claim omnichannel auto send: database returned no row");
  return {
    claimed: row.claimed === true,
    reason: typeof row.reason === "string" ? row.reason : "claim_denied",
  };
}

export async function claimMessageForAutoSendViaPostgres(
  messageId: string,
  ownerToken: string,
  db: Queryable = developmentPool(),
): Promise<DevelopmentAutoSendClaim> {
  const result = await db.query(
    `SELECT claimed, reason
       FROM public.claim_omnichannel_auto_send_owned($1::uuid, $2::text)`,
    [messageId, ownerToken],
  );
  return mapClaim(result.rows[0]);
}

export async function claimEquipmentFlowForAutoSendViaPostgres(
  messageId: string,
  expectedSettingsUpdatedAt: string,
  ownerToken: string,
  db: Queryable = developmentPool(),
): Promise<DevelopmentAutoSendClaim> {
  const result = await db.query(
    `SELECT claimed, reason
       FROM public.claim_omnichannel_equipment_flow_send_owned(
         $1::uuid, $2::timestamptz, $3::text
       )`,
    [messageId, expectedSettingsUpdatedAt, ownerToken],
  );
  return mapClaim(result.rows[0]);
}

async function inTransaction<T>(
  action: (client: PoolClient) => Promise<T>,
  pool: Pool = developmentPool(),
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await action(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface DevelopmentAiAnalysisInput {
  messageId: string;
  conversationId: string;
  draft: string;
  confidence: number;
  reason: string;
  intent: string;
  sentiment: string;
  leadScore: number;
  summary: string;
}

export async function persistAiAnalysisViaPostgres(
  input: DevelopmentAiAnalysisInput,
): Promise<void> {
  await inTransaction(async (client) => {
    await client.query(
      `UPDATE public.omnichannel_messages
          SET ai_draft = $2, ai_confidence = $3, ai_reason = left($4, 500)
        WHERE id = $1::uuid`,
      [input.messageId, input.draft, input.confidence, input.reason],
    );
    await client.query(
      `UPDATE public.omnichannel_conversations
          SET intent = $2, sentiment = $3, lead_score = $4, summary = left($5, 800)
        WHERE id = $1::uuid`,
      [
        input.conversationId,
        input.intent,
        input.sentiment,
        input.leadScore,
        input.summary,
      ],
    );
  });
}

export interface DevelopmentMessageOutcomePayload {
  draft?: string | null;
  confidence?: number | null;
  reason: string;
}

export async function markMessageOutcomeViaPostgres(
  messageId: string,
  status: OmnichannelMessageStatus,
  payload: DevelopmentMessageOutcomePayload,
  db: Queryable = developmentPool(),
): Promise<void> {
  await db.query(
    `UPDATE public.omnichannel_messages
        SET status = $2,
            ai_reason = left($3, 500),
            processed_at = now(),
            ai_draft = CASE WHEN $4::boolean THEN $5::text ELSE ai_draft END,
            ai_confidence = CASE WHEN $6::boolean THEN $7::numeric ELSE ai_confidence END
      WHERE id = $1::uuid`,
    [
      messageId,
      status,
      payload.reason,
      payload.draft !== undefined,
      payload.draft ?? null,
      payload.confidence !== undefined,
      payload.confidence ?? null,
    ],
  );
}

export async function markMessageIgnoredViaPostgres(
  messageId: string,
  reason: string,
  options: {
    conversationId?: string;
    muteConversation?: boolean;
    suppressSends?: boolean;
  } = {},
): Promise<void> {
  if (
    !(options.muteConversation || options.suppressSends) ||
    !options.conversationId
  ) {
    await markMessageOutcomeViaPostgres(messageId, "ignored", { reason });
    return;
  }

  await inTransaction(async (client) => {
    await client.query(
      `UPDATE public.omnichannel_conversations
          SET status = CASE WHEN $2::boolean THEN 'muted' ELSE status END,
              send_suppressed = CASE WHEN $3::boolean THEN TRUE ELSE send_suppressed END,
              suppression_reason = CASE WHEN $3::boolean THEN 'customer_opt_out' ELSE suppression_reason END,
              suppressed_at = CASE WHEN $3::boolean THEN now() ELSE suppressed_at END
        WHERE id = $1::uuid`,
      [
        options.conversationId,
        options.muteConversation === true,
        options.suppressSends === true,
      ],
    );
    await markMessageOutcomeViaPostgres(
      messageId,
      "ignored",
      { reason },
      client,
    );
  });
}

export async function markMessageNeedsHumanViaPostgres(
  messageId: string,
  conversationId: string,
  payload: DevelopmentMessageOutcomePayload,
): Promise<void> {
  await inTransaction(async (client) => {
    await client.query(
      `UPDATE public.omnichannel_conversations SET status = 'needs_human' WHERE id = $1::uuid`,
      [conversationId],
    );
    await markMessageOutcomeViaPostgres(
      messageId,
      "needs_human",
      payload,
      client,
    );
  });
}

export interface DevelopmentLogOutboundMessageInput {
  conversationId: string;
  channel: "instagram" | "whatsapp";
  externalMessageId: string;
  text: string;
  messageType?: OmnichannelMessageType;
  aiGenerated: boolean;
  replyToExternalId?: string | null;
  status?: "sent" | "delivered" | "read";
  metadata?: JsonObject;
  occurredAt: string;
}

export async function logOutboundMessageViaPostgres(
  input: DevelopmentLogOutboundMessageInput,
  db: Queryable = developmentPool(),
): Promise<string> {
  const result = await db.query(
    `INSERT INTO public.omnichannel_messages (
       conversation_id, channel, external_message_id, direction, message_type,
       text, status, reply_to_external_id, ai_generated, metadata, occurred_at, processed_at
     ) VALUES (
       $1::uuid, $2, $3, 'out', $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz, $10::timestamptz
     )
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
      input.messageType ?? "text",
      input.text,
      input.status ?? "sent",
      input.replyToExternalId ?? null,
      input.aiGenerated,
      input.metadata ?? {},
      input.occurredAt,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id)
    throw new Error(
      "log outbound omnichannel message: database returned no row",
    );
  return String(id);
}

export interface DevelopmentFinalizeEquipmentFlowInput {
  messageId: string;
  conversationId: string;
  stage: "welcome" | "awaiting_city" | "awaiting_interest" | "routed";
  choiceId: string | null;
  choiceLabel: string | null;
  cityRouteId: string | null;
  cityLabel: string | null;
  managerUrl: string | null;
  communityIncluded: boolean;
  reason: string;
}

export async function finalizeEquipmentFlowReplyViaPostgres(
  input: DevelopmentFinalizeEquipmentFlowInput,
  db: Queryable = developmentPool(),
): Promise<void> {
  await db.query(
    `SELECT public.finalize_omnichannel_equipment_flow_reply(
       $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10
     )`,
    [
      input.messageId,
      input.conversationId,
      input.stage,
      input.choiceId,
      input.choiceLabel,
      input.cityRouteId,
      input.cityLabel,
      input.managerUrl,
      input.communityIncluded,
      input.reason,
    ],
  );
}
