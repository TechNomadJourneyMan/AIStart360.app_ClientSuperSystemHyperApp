import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";
import { createServiceClient } from "@/lib/supabase-service";
import {
  omnichannelPostgresPool,
  shouldUseOmnichannelPostgres,
} from "@/lib/omnichannel/postgres-runtime";
import type { JsonObject, OmnichannelMessageType } from "./types";

export const WHATSAPP_WEB_DELIVERY_MODES = ["direct", "pull"] as const;
export type WhatsAppWebDeliveryMode =
  (typeof WHATSAPP_WEB_DELIVERY_MODES)[number];

export type OutboundDeliveryFinalization =
  | { kind: "auto"; reason: string }
  | { kind: "manual"; reason: string }
  | {
      kind: "equipment";
      reason: string;
      settingsUpdatedAt: string;
      stage: "welcome" | "awaiting_city" | "awaiting_interest" | "routed";
      choiceId: string | null;
      choiceLabel: string | null;
      cityRouteId: string | null;
      cityLabel: string | null;
      managerUrl: string | null;
      communityIncluded: boolean;
    };

export interface EnqueueOutboundDeliveryInput {
  conversationId: string;
  sourceInboundMessageId?: string | null;
  sessionId: string;
  idempotencyKey: string;
  text: string;
  replyToExternalId?: string | null;
  actor: "automated" | "manual";
  aiGenerated: boolean;
  messageType?: Extract<OmnichannelMessageType, "text" | "button" | "interactive">;
  metadata?: JsonObject;
  finalization: OutboundDeliveryFinalization;
  typingDelayMs?: number;
  maxAttempts?: number;
}

export interface EnqueuedOutboundDelivery {
  id: string;
  status:
    | "queued"
    | "leased"
    | "authorized"
    | "sent"
    | "cancelled"
    | "delivery_unknown"
    | "dead";
  idempotencyKey: string;
  created: boolean;
}

export interface ClaimedOutboundDelivery {
  id: string;
  leaseToken: string;
  leaseUntil: string;
  recipient: string;
  typingDelayMs: number;
}

export interface AuthorizedOutboundDelivery {
  authorized: boolean;
  reason: string;
  recipient: string | null;
  text: string | null;
  replyToExternalId: string | null;
  idempotencyKey: string | null;
}

export type OutboundDeliveryOutcome =
  | {
      outcome: "sent";
      providerMessageId: string;
      errorCode?: never;
    }
  | {
      outcome: "retryable_failure" | "delivery_unknown";
      errorCode: string;
      providerMessageId?: never;
    };

export type ReportOutboundDeliveryInput = OutboundDeliveryOutcome & {
  deliveryId: string;
  leaseToken: string;
  sessionId: string;
};

export interface ReportOutboundDeliveryResult {
  accepted: boolean;
  status: EnqueuedOutboundDelivery["status"] | null;
  externalMessageId: string | null;
}

type Queryable = Pick<Pool, "query">;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,119}$/;

function requiredUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID`);
  return value;
}

function sessionId(value: string): string {
  if (!SESSION_PATTERN.test(value)) throw new Error("sessionId is invalid");
  return value;
}

function idempotencyKey(value: string): string {
  if (!IDEMPOTENCY_PATTERN.test(value)) {
    throw new Error("idempotencyKey is invalid");
  }
  return value;
}

function boundedInteger(
  value: number,
  field: string,
  min: number,
  max: number,
): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function requiredText(value: string): string {
  const text = value.trim();
  if (!text || text.length > 4_096) throw new Error("text is invalid");
  return text;
}

function jsonObject(value: JsonObject | undefined, field: string): JsonObject {
  const object = value ?? {};
  if (Buffer.byteLength(JSON.stringify(object), "utf8") > 24_000) {
    throw new Error(`${field} is too large`);
  }
  return object;
}

function normalizedFinalization(
  value: OutboundDeliveryFinalization,
): JsonObject {
  if (!value || !["auto", "manual", "equipment"].includes(value.kind)) {
    throw new Error("finalization is invalid");
  }
  if (!value.reason.trim() || value.reason.length > 500) {
    throw new Error("finalization reason is invalid");
  }
  if (value.kind === "equipment") {
    const revision = new Date(value.settingsUpdatedAt);
    if (!Number.isFinite(revision.getTime())) {
      throw new Error("equipment settings revision is invalid");
    }
  }
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function databaseError(operation: string, error: { message?: string } | null): Error {
  return new Error(
    `${operation}: ${error?.message?.slice(0, 300) || "database error"}`,
  );
}

function timestamp(value: unknown, field: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`outbound delivery database returned invalid ${field}`);
  }
  return date.toISOString();
}

function deliveryStatus(value: unknown): EnqueuedOutboundDelivery["status"] {
  if (
    value === "queued" ||
    value === "leased" ||
    value === "authorized" ||
    value === "sent" ||
    value === "cancelled" ||
    value === "delivery_unknown" ||
    value === "dead"
  ) {
    return value;
  }
  throw new Error("outbound delivery database returned invalid status");
}

function enqueueArgs(input: EnqueueOutboundDeliveryInput) {
  if (input.actor === "manual" && input.aiGenerated) {
    throw new Error("manual outbound delivery cannot be AI-generated");
  }
  return {
    conversationId: requiredUuid(input.conversationId, "conversationId"),
    sourceInboundMessageId: input.sourceInboundMessageId
      ? requiredUuid(input.sourceInboundMessageId, "sourceInboundMessageId")
      : null,
    sessionId: sessionId(input.sessionId),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    text: requiredText(input.text),
    replyToExternalId: input.replyToExternalId?.trim() || null,
    actor: input.actor,
    aiGenerated: input.aiGenerated,
    messageType: input.messageType ?? "text",
    metadata: jsonObject(input.metadata, "metadata"),
    finalization: normalizedFinalization(input.finalization),
    typingDelayMs: boundedInteger(
      input.typingDelayMs ?? 0,
      "typingDelayMs",
      0,
      15_000,
    ),
    maxAttempts: boundedInteger(input.maxAttempts ?? 20, "maxAttempts", 1, 50),
  };
}

function mapEnqueued(row: Record<string, unknown> | undefined): EnqueuedOutboundDelivery {
  if (!row || typeof row.delivery_id !== "string") {
    throw new Error("enqueue outbound delivery: database returned no row");
  }
  return {
    id: requiredUuid(row.delivery_id, "delivery_id"),
    status: deliveryStatus(row.delivery_status),
    idempotencyKey: idempotencyKey(String(row.idempotency_key ?? "")),
    created: row.created === true,
  };
}

export function whatsappWebDeliveryMode(
  env: NodeJS.ProcessEnv = process.env,
): WhatsAppWebDeliveryMode | null {
  const raw = env.WHATSAPP_WEB_DELIVERY_MODE?.trim().toLowerCase();
  if (!raw) return "direct";
  return raw === "direct" || raw === "pull" ? raw : null;
}

export function isWhatsAppWebPullDeliveryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return whatsappWebDeliveryMode(env) === "pull";
}

export async function enqueueOutboundDeliveryViaPostgres(
  input: EnqueueOutboundDeliveryInput,
  db: Queryable = omnichannelPostgresPool(),
): Promise<EnqueuedOutboundDelivery> {
  const value = enqueueArgs(input);
  const result = await db.query(
    `SELECT * FROM public.enqueue_omnichannel_outbound_delivery(
       $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text,
       $7::text, $8::boolean, $9::text, $10::jsonb, $11::jsonb,
       $12::integer, $13::integer
     )`,
    [
      value.conversationId,
      value.sourceInboundMessageId,
      value.sessionId,
      value.idempotencyKey,
      value.text,
      value.replyToExternalId,
      value.actor,
      value.aiGenerated,
      value.messageType,
      value.metadata,
      value.finalization,
      value.typingDelayMs,
      value.maxAttempts,
    ],
  );
  return mapEnqueued(result.rows[0]);
}

export async function enqueueOutboundDelivery(
  input: EnqueueOutboundDeliveryInput,
  client?: SupabaseClient,
): Promise<EnqueuedOutboundDelivery> {
  if (!client && shouldUseOmnichannelPostgres()) {
    return enqueueOutboundDeliveryViaPostgres(input);
  }
  client ??= createServiceClient();
  const value = enqueueArgs(input);
  const { data, error } = await client
    .rpc("enqueue_omnichannel_outbound_delivery", {
      p_conversation_id: value.conversationId,
      p_source_inbound_message_id: value.sourceInboundMessageId,
      p_session_id: value.sessionId,
      p_idempotency_key: value.idempotencyKey,
      p_text: value.text,
      p_reply_to_external_id: value.replyToExternalId,
      p_actor: value.actor,
      p_ai_generated: value.aiGenerated,
      p_message_type: value.messageType,
      p_metadata: value.metadata,
      p_finalization: value.finalization,
      p_typing_delay_ms: value.typingDelayMs,
      p_max_attempts: value.maxAttempts,
    })
    .maybeSingle();
  if (error) throw databaseError("enqueue outbound delivery", error);
  return mapEnqueued(data as Record<string, unknown> | undefined);
}

export async function claimOutboundDeliveryViaPostgres(
  input: { sessionId: string; leaseSeconds?: number },
  db: Queryable = omnichannelPostgresPool(),
): Promise<ClaimedOutboundDelivery | null> {
  const result = await db.query(
    `SELECT * FROM public.claim_omnichannel_outbound_delivery($1::text, $2::integer)`,
    [
      sessionId(input.sessionId),
      boundedInteger(input.leaseSeconds ?? 180, "leaseSeconds", 30, 600),
    ],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  if (
    typeof row.delivery_id !== "string" ||
    typeof row.lease_token !== "string" ||
    typeof row.recipient !== "string" ||
    typeof row.typing_delay_ms !== "number"
  ) {
    throw new Error("claim outbound delivery: database returned an invalid row");
  }
  return {
    id: requiredUuid(row.delivery_id, "delivery_id"),
    leaseToken: requiredUuid(row.lease_token, "lease_token"),
    leaseUntil: timestamp(row.lease_until, "lease_until"),
    recipient: row.recipient,
    typingDelayMs: boundedInteger(
      row.typing_delay_ms,
      "typing_delay_ms",
      0,
      15_000,
    ),
  };
}

export async function authorizeOutboundDeliveryViaPostgres(
  input: {
    deliveryId: string;
    leaseToken: string;
    sessionId: string;
    authorizedLeaseSeconds?: number;
  },
  db: Queryable = omnichannelPostgresPool(),
): Promise<AuthorizedOutboundDelivery> {
  const result = await db.query(
    `SELECT * FROM public.authorize_omnichannel_outbound_delivery(
       $1::uuid, $2::uuid, $3::text, $4::integer
     )`,
    [
      requiredUuid(input.deliveryId, "deliveryId"),
      requiredUuid(input.leaseToken, "leaseToken"),
      sessionId(input.sessionId),
      boundedInteger(
        input.authorizedLeaseSeconds ?? 180,
        "authorizedLeaseSeconds",
        30,
        600,
      ),
    ],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row || typeof row.authorized !== "boolean" || typeof row.reason !== "string") {
    throw new Error("authorize outbound delivery: database returned an invalid row");
  }
  const optional = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;
  return {
    authorized: row.authorized,
    reason: row.reason,
    recipient: optional(row.recipient),
    text: optional(row.message_text),
    replyToExternalId: optional(row.reply_to_external_id),
    idempotencyKey: optional(row.idempotency_key),
  };
}

export async function reportOutboundDeliveryViaPostgres(
  input: ReportOutboundDeliveryInput,
  db: Queryable = omnichannelPostgresPool(),
): Promise<ReportOutboundDeliveryResult> {
  if (input.outcome !== "sent" && !ERROR_CODE_PATTERN.test(input.errorCode)) {
    throw new Error("errorCode is invalid");
  }
  const result = await db.query(
    `SELECT * FROM public.report_omnichannel_outbound_delivery(
       $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text
     )`,
    [
      requiredUuid(input.deliveryId, "deliveryId"),
      requiredUuid(input.leaseToken, "leaseToken"),
      sessionId(input.sessionId),
      input.outcome,
      input.outcome === "sent" ? input.providerMessageId : null,
      input.outcome === "sent" ? null : input.errorCode,
    ],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row || typeof row.accepted !== "boolean") {
    throw new Error("report outbound delivery: database returned an invalid row");
  }
  return {
    accepted: row.accepted,
    status: row.delivery_status == null ? null : deliveryStatus(row.delivery_status),
    externalMessageId:
      typeof row.external_message_id === "string" ? row.external_message_id : null,
  };
}
