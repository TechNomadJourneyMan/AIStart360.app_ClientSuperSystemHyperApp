import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-service";
import type {
  JsonObject,
  NormalizedOmnichannelMessage,
  NormalizedWhatsAppStatus,
  OmnichannelContact,
  OmnichannelConversation,
  OmnichannelMessage,
  OmnichannelMessageType,
  OmnichannelMessageStatus,
  OmnichannelSettings,
  OmnichannelWebhookEventStatus,
} from "./types";
import { shouldQueueDuplicateOmnichannelMessage } from "./retry-policy";
import {
  claimEquipmentFlowForAutoSendViaPostgres,
  claimMessageForAutoSendViaPostgres,
  finalizeEquipmentFlowReplyViaPostgres,
  getMessageContextViaPostgres,
  listImportedWhatsAppHistoryForDraftViaPostgres,
  logOutboundMessageViaPostgres,
  markMessageIgnoredViaPostgres,
  markMessageNeedsHumanViaPostgres,
  markMessageOutcomeViaPostgres,
  markMessageProcessingViaPostgres,
  persistAiAnalysisViaPostgres,
  shouldUseDevelopmentPostgres,
} from "./development-postgres";

export function createOmnichannelAdminClient(): SupabaseClient {
  return createServiceClient();
}

export interface ImportedWhatsAppHistoryCandidate {
  messageId: string;
  conversationId: string;
}

/**
 * Return a bounded batch of inbound history already persisted by the
 * WhatsApp Web QR bridge. This does not (and cannot) fetch Cloud API history.
 */
export async function listImportedWhatsAppHistoryForDraft(
  limit = 100,
  client?: SupabaseClient,
): Promise<ImportedWhatsAppHistoryCandidate[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  if (!client && shouldUseDevelopmentPostgres()) {
    return listImportedWhatsAppHistoryForDraftViaPostgres(safeLimit);
  }
  client ??= createOmnichannelAdminClient();
  const { data, error } = await client
    .from("omnichannel_messages")
    .select("id, conversation_id")
    .eq("channel", "whatsapp")
    .eq("direction", "in")
    .eq("status", "imported")
    .is("ai_draft", null)
    .contains("metadata", { transport: "whatsapp_web", catchUp: true })
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw dbError("list imported WhatsApp history", error);
  return (data ?? []).map((row) => ({
    messageId: String(row.id),
    conversationId: String(row.conversation_id),
  }));
}

export async function listOmnichannelExternalMessageIds(
  channel: "instagram" | "whatsapp",
  limit = 10_000,
  client: SupabaseClient = createOmnichannelAdminClient(),
): Promise<string[]> {
  const { data, error } = await client
    .from("omnichannel_messages")
    .select("external_message_id")
    .eq("channel", channel)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(1, limit), 10_000));
  if (error) throw dbError("list omnichannel provider ids", error);
  return (data ?? [])
    .map((row) => row.external_message_id)
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
}

function dbError(operation: string, error: { message?: string } | null): Error {
  return new Error(
    `${operation}: ${error?.message?.slice(0, 300) || "database error"}`,
  );
}

function asJsonObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asIso(
  value: string | null | undefined,
  fallback = new Date().toISOString(),
): string {
  if (!value) return fallback;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

function normalizeProviderTimestamp(value: string | null | undefined): {
  occurredAt: string;
  trusted: boolean;
} {
  if (value) {
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) {
      return { occurredAt: new Date(time).toISOString(), trusted: true };
    }
  }
  // Postgres requires occurred_at, but this ingestion timestamp must never be
  // interpreted as a provider-confirmed policy window.
  return { occurredAt: new Date().toISOString(), trusted: false };
}

export interface RecordWebhookEventInput {
  channel: "instagram" | "whatsapp";
  eventHash: string;
  eventType?: string | null;
  accountExternalId?: string | null;
  metadata?: JsonObject;
}

export interface RecordedWebhookEvent {
  id: string;
  duplicate: boolean;
  status: OmnichannelWebhookEventStatus;
}

export async function recordWebhookEvent(
  input: RecordWebhookEventInput,
  client: SupabaseClient = createOmnichannelAdminClient(),
): Promise<RecordedWebhookEvent> {
  const { data, error } = await client
    .from("omnichannel_webhook_events")
    .insert({
      channel: input.channel,
      event_hash: input.eventHash,
      event_type: input.eventType ?? null,
      account_external_id: input.accountExternalId ?? null,
      metadata: input.metadata ?? {},
      status: "received",
    })
    .select("id, status")
    .single();

  if (!error && data) {
    return { id: data.id, status: data.status, duplicate: false };
  }
  if (error?.code !== "23505") throw dbError("record webhook event", error);

  const existing = await client
    .from("omnichannel_webhook_events")
    .select("id, status")
    .eq("channel", input.channel)
    .eq("event_hash", input.eventHash)
    .maybeSingle();
  if (existing.error || !existing.data) {
    throw dbError("load duplicate webhook event", existing.error);
  }
  return {
    id: existing.data.id,
    status: existing.data.status,
    duplicate: true,
  };
}

/**
 * Atomically acquires a recoverable webhook delivery for processing.
 *
 * The database function implements a short processing lease. Concurrent
 * provider retries cannot both enqueue/process the same durable event, while
 * a worker that crashed after claiming can be recovered once its lease is
 * stale. The message upsert happens first and is independently idempotent.
 */
export async function claimWebhookEventForProcessing(
  eventId: string,
  client: SupabaseClient = createOmnichannelAdminClient(),
): Promise<boolean> {
  const { data, error } = await client
    .rpc("claim_omnichannel_webhook_event", { p_event_id: eventId })
    .maybeSingle();
  if (error) throw dbError("claim webhook event for processing", error);
  const row = data as { claimed?: unknown } | null;
  return row?.claimed === true;
}

export async function transitionWebhookEvent(
  eventId: string,
  status: OmnichannelWebhookEventStatus,
  errorMessage: string | null = null,
  client: SupabaseClient = createOmnichannelAdminClient(),
): Promise<void> {
  const terminal = ["processed", "failed", "ignored"].includes(status);
  const { error } = await client
    .from("omnichannel_webhook_events")
    .update({
      status,
      error: errorMessage?.slice(0, 500) ?? null,
      processed_at: terminal ? new Date().toISOString() : null,
    })
    .eq("id", eventId);
  if (error) throw dbError("transition webhook event", error);
}

export interface IngestNormalizedMessageResult {
  duplicate: boolean;
  messageId: string;
  conversationId: string;
  shouldQueue: boolean;
}

export async function ingestNormalizedMessage(
  message: NormalizedOmnichannelMessage,
  client: SupabaseClient = createOmnichannelAdminClient(),
): Promise<IngestNormalizedMessageResult> {
  const providerTime = normalizeProviderTimestamp(message.occurredAt);
  const occurredAt = providerTime.occurredAt;
  const now = new Date().toISOString();
  const contactPayload: Record<string, unknown> = {
    channel: message.channel,
    external_id: message.contactExternalId,
    last_seen_at: now,
  };
  if (message.contactName) {
    contactPayload.display_name = message.contactName;
    if (message.channel === "instagram")
      contactPayload.username = message.contactName;
  }
  if (message.channel === "whatsapp") {
    // WhatsApp Web v7 can identify a contact by an opaque LID. Never present
    // that value as a phone number; only the bridge's verified PN JID may fill
    // the phone column. Cloud API messages keep their existing fallback.
    contactPayload.phone =
      message.contactPhone === undefined
        ? message.contactExternalId
        : message.contactPhone;
  }

  const contactResult = await client
    .from("omnichannel_contacts")
    .upsert(contactPayload, { onConflict: "channel,external_id" })
    .select("id")
    .single();
  if (contactResult.error || !contactResult.data) {
    throw dbError("upsert omnichannel contact", contactResult.error);
  }

  // Only identity fields are included in the upsert so a new message can never
  // reset operator state, summaries, overrides, or timestamps on conflict.
  const conversationResult = await client
    .from("omnichannel_conversations")
    .upsert(
      {
        channel: message.channel,
        account_external_id: message.accountExternalId,
        external_id: message.conversationExternalId,
        contact_id: contactResult.data.id,
      },
      { onConflict: "channel,account_external_id,external_id" },
    )
    .select("id")
    .single();
  if (conversationResult.error || !conversationResult.data) {
    throw dbError("upsert omnichannel conversation", conversationResult.error);
  }

  const conversationId = conversationResult.data.id as string;
  const insertResult = await client
    .from("omnichannel_messages")
    .insert({
      conversation_id: conversationId,
      channel: message.channel,
      external_message_id: message.externalMessageId,
      direction: message.direction,
      message_type: message.messageType,
      text: message.text,
      status: message.status,
      reply_to_external_id: message.replyToExternalId,
      metadata: {
        ...message.metadata,
        providerTimestampTrusted: providerTime.trusted,
      },
      occurred_at: occurredAt,
    })
    .select("id, direction, status")
    .single();

  if (insertResult.error?.code === "23505") {
    const existing = await client
      .from("omnichannel_messages")
      .select("id, conversation_id, direction, status")
      .eq("channel", message.channel)
      .eq("external_message_id", message.externalMessageId)
      .maybeSingle();
    if (existing.error || !existing.data) {
      throw dbError("load duplicate omnichannel message", existing.error);
    }
    return {
      duplicate: true,
      messageId: existing.data.id,
      conversationId: existing.data.conversation_id,
      // Recover only the narrow failure mode where persistence succeeded but
      // the first webhook response failed before enqueueing.
      shouldQueue: shouldQueueDuplicateOmnichannelMessage({
        direction: existing.data.direction,
        status: existing.data.status,
      }),
    };
  }
  if (insertResult.error || !insertResult.data) {
    throw dbError("insert omnichannel message", insertResult.error);
  }

  return {
    duplicate: false,
    messageId: insertResult.data.id,
    conversationId,
    shouldQueue: message.direction === "in" && message.status === "received",
  };
}

export interface ApplyDeliveryStatusResult {
  matched: boolean;
  messageId: string | null;
}

export async function applyWhatsAppDeliveryStatus(
  event: NormalizedWhatsAppStatus,
  client: SupabaseClient = createOmnichannelAdminClient(),
): Promise<ApplyDeliveryStatusResult> {
  const found = await client
    .from("omnichannel_messages")
    .select("id, status, metadata")
    .eq("channel", "whatsapp")
    .eq("external_message_id", event.externalMessageId)
    .maybeSingle();
  if (found.error) throw dbError("load WhatsApp delivery target", found.error);
  if (!found.data) {
    // A delivery webhook can beat the send-response persistence write. Keep a
    // minimal placeholder so the status is not lost; logOutboundMessage later
    // enriches the same provider id without downgrading its delivery state.
    const placeholder = await ingestNormalizedMessage(
      {
        eventType: "message",
        channel: "whatsapp",
        accountExternalId: event.accountExternalId,
        conversationExternalId: event.conversationExternalId,
        contactExternalId: event.contactExternalId,
        contactName: null,
        externalMessageId: event.externalMessageId,
        direction: "out",
        messageType: "unknown",
        text: null,
        status: event.status,
        replyToExternalId: null,
        occurredAt: event.occurredAt,
        metadata: {
          source: "whatsapp_delivery_status_placeholder",
          delivery: event.metadata,
          ...(event.errorReason
            ? { errorReason: event.errorReason.slice(0, 300) }
            : {}),
        },
      },
      client,
    );
    return { matched: true, messageId: placeholder.messageId };
  }

  const rank: Record<string, number> = {
    sent: 1,
    delivered: 2,
    read: 3,
    failed: 4,
  };
  const nextStatus =
    (rank[event.status] ?? 0) >= (rank[found.data.status] ?? 0)
      ? event.status
      : found.data.status;
  const metadata = {
    ...asJsonObject(found.data.metadata),
    delivery: {
      ...event.metadata,
      occurredAt: event.occurredAt,
      ...(event.errorReason
        ? { errorReason: event.errorReason.slice(0, 300) }
        : {}),
    },
  };
  const updated = await client
    .from("omnichannel_messages")
    .update({ status: nextStatus, metadata })
    .eq("id", found.data.id);
  if (updated.error)
    throw dbError("apply WhatsApp delivery status", updated.error);
  return { matched: true, messageId: found.data.id };
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
    updatedAt: String(row.updated_at),
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
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
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
    suppressedAt:
      typeof row.suppressed_at === "string" ? row.suppressed_at : null,
    intent: typeof row.intent === "string" ? row.intent : null,
    sentiment: typeof row.sentiment === "string" ? row.sentiment : null,
    leadScore: typeof row.lead_score === "number" ? row.lead_score : null,
    summary: typeof row.summary === "string" ? row.summary : null,
    lastMessageAt:
      typeof row.last_message_at === "string" ? row.last_message_at : null,
    lastInboundAt:
      typeof row.last_inbound_at === "string" ? row.last_inbound_at : null,
    lastOutboundAt:
      typeof row.last_outbound_at === "string" ? row.last_outbound_at : null,
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
    occurredAt: String(row.occurred_at),
    processedAt: typeof row.processed_at === "string" ? row.processed_at : null,
  };
}

export interface OmnichannelMessageContext {
  message: OmnichannelMessage;
  conversation: OmnichannelConversation;
  contact: OmnichannelContact;
  settings: OmnichannelSettings;
  history: OmnichannelMessage[];
  newestInboundMessageId: string | null;
}

const messageSelect =
  "id, conversation_id, channel, external_message_id, direction, message_type, text, status, reply_to_external_id, ai_draft, ai_confidence, ai_reason, ai_generated, metadata, occurred_at, processed_at";

export async function getMessageContext(
  messageId: string,
  client?: SupabaseClient,
): Promise<OmnichannelMessageContext | null> {
  if (!client && shouldUseDevelopmentPostgres()) {
    return getMessageContextViaPostgres(messageId);
  }
  client ??= createOmnichannelAdminClient();
  const messageResult = await client
    .from("omnichannel_messages")
    .select(messageSelect)
    .eq("id", messageId)
    .maybeSingle();
  if (messageResult.error)
    throw dbError("load omnichannel message", messageResult.error);
  if (!messageResult.data) return null;

  const conversationResult = await client
    .from("omnichannel_conversations")
    .select("*")
    .eq("id", messageResult.data.conversation_id)
    .maybeSingle();
  if (conversationResult.error || !conversationResult.data) {
    throw dbError("load omnichannel conversation", conversationResult.error);
  }

  const [contactResult, settingsResult, historyResult, newestInboundResult] =
    await Promise.all([
      client
        .from("omnichannel_contacts")
        .select("*")
        .eq("id", conversationResult.data.contact_id)
        .maybeSingle(),
      client
        .from("omnichannel_settings")
        .select("*")
        .eq("channel", conversationResult.data.channel)
        .maybeSingle(),
      client
        .from("omnichannel_messages")
        .select(messageSelect)
        .eq("conversation_id", conversationResult.data.id)
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(20),
      client
        .from("omnichannel_messages")
        .select("id")
        .eq("conversation_id", conversationResult.data.id)
        .eq("direction", "in")
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (contactResult.error || !contactResult.data) {
    throw dbError("load omnichannel contact", contactResult.error);
  }
  if (settingsResult.error || !settingsResult.data) {
    throw dbError("load omnichannel settings", settingsResult.error);
  }
  if (historyResult.error)
    throw dbError("load omnichannel history", historyResult.error);
  if (newestInboundResult.error) {
    throw dbError("load newest omnichannel inbound", newestInboundResult.error);
  }

  return {
    message: mapMessage(messageResult.data),
    conversation: mapConversation(conversationResult.data),
    contact: mapContact(contactResult.data),
    settings: mapSettings(settingsResult.data),
    history: (historyResult.data ?? []).reverse().map(mapMessage),
    newestInboundMessageId: newestInboundResult.data?.id ?? null,
  };
}

export async function markMessageProcessing(
  messageId: string,
  client?: SupabaseClient,
): Promise<boolean> {
  if (!client && shouldUseDevelopmentPostgres()) {
    return markMessageProcessingViaPostgres(messageId);
  }
  client ??= createOmnichannelAdminClient();
  const { data, error } = await client
    .from("omnichannel_messages")
    .update({ status: "processing", processed_at: null })
    .eq("id", messageId)
    .in("status", ["received", "imported", "failed"])
    .select("id")
    .maybeSingle();
  if (error) throw dbError("mark omnichannel message processing", error);
  return Boolean(data);
}

export interface AutoSendClaim {
  claimed: boolean;
  reason: string;
}

export async function claimMessageForAutoSend(
  messageId: string,
  client?: SupabaseClient,
): Promise<AutoSendClaim> {
  if (!client && shouldUseDevelopmentPostgres()) {
    return claimMessageForAutoSendViaPostgres(messageId);
  }
  client ??= createOmnichannelAdminClient();
  const { data, error } = await client
    .rpc("claim_omnichannel_auto_send", { p_message_id: messageId })
    .maybeSingle();
  if (error || !data) throw dbError("claim omnichannel auto send", error);
  const row = data as { claimed?: boolean; reason?: string };
  return {
    claimed: row.claimed === true,
    reason: typeof row.reason === "string" ? row.reason : "claim_denied",
  };
}

export async function claimEquipmentFlowForAutoSend(
  messageId: string,
  expectedSettingsUpdatedAt: string,
  client?: SupabaseClient,
): Promise<AutoSendClaim> {
  if (!client && shouldUseDevelopmentPostgres()) {
    return claimEquipmentFlowForAutoSendViaPostgres(
      messageId,
      expectedSettingsUpdatedAt,
    );
  }
  client ??= createOmnichannelAdminClient();
  const { data, error } = await client
    .rpc("claim_omnichannel_equipment_flow_send", {
      p_message_id: messageId,
      p_expected_settings_updated_at: expectedSettingsUpdatedAt,
    })
    .maybeSingle();
  if (error || !data) throw dbError("claim equipment flow auto send", error);
  const row = data as { claimed?: boolean; reason?: string };
  return {
    claimed: row.claimed === true,
    reason: typeof row.reason === "string" ? row.reason : "claim_denied",
  };
}

export async function reserveConversationForManualReply(
  conversationId: string,
  client: SupabaseClient = createOmnichannelAdminClient(),
): Promise<{ reserved: boolean; reason: string }> {
  const { data, error } = await client
    .rpc("reserve_omnichannel_manual_reply", {
      p_conversation_id: conversationId,
    })
    .maybeSingle();
  if (error || !data) throw dbError("reserve omnichannel manual reply", error);
  const row = data as { reserved?: boolean; reason?: string };
  return {
    reserved: row.reserved === true,
    reason: typeof row.reason === "string" ? row.reason : "reservation_denied",
  };
}

export interface PersistAiAnalysisInput {
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

export async function persistAiAnalysis(
  input: PersistAiAnalysisInput,
  client?: SupabaseClient,
): Promise<void> {
  if (!client && shouldUseDevelopmentPostgres()) {
    await persistAiAnalysisViaPostgres(input);
    return;
  }
  client ??= createOmnichannelAdminClient();
  const [messageResult, conversationResult] = await Promise.all([
    client
      .from("omnichannel_messages")
      .update({
        ai_draft: input.draft,
        ai_confidence: input.confidence,
        ai_reason: input.reason.slice(0, 500),
      })
      .eq("id", input.messageId),
    client
      .from("omnichannel_conversations")
      .update({
        intent: input.intent,
        sentiment: input.sentiment,
        lead_score: input.leadScore,
        summary: input.summary.slice(0, 800),
      })
      .eq("id", input.conversationId),
  ]);
  if (messageResult.error)
    throw dbError("save omnichannel AI draft", messageResult.error);
  if (conversationResult.error)
    throw dbError("save omnichannel AI analysis", conversationResult.error);
}

interface MessageOutcomePayload {
  draft?: string | null;
  confidence?: number | null;
  reason: string;
}

async function markMessageOutcome(
  messageId: string,
  status: OmnichannelMessageStatus,
  payload: MessageOutcomePayload,
  client: SupabaseClient,
): Promise<void> {
  const patch: Record<string, unknown> = {
    status,
    ai_reason: payload.reason.slice(0, 500),
    processed_at: new Date().toISOString(),
  };
  if (payload.draft !== undefined) patch.ai_draft = payload.draft;
  if (payload.confidence !== undefined)
    patch.ai_confidence = payload.confidence;
  const { error } = await client
    .from("omnichannel_messages")
    .update(patch)
    .eq("id", messageId);
  if (error) throw dbError(`mark omnichannel message ${status}`, error);
}

export async function markMessageDrafted(
  messageId: string,
  payload: MessageOutcomePayload,
  client?: SupabaseClient,
): Promise<void> {
  if (!client && shouldUseDevelopmentPostgres()) {
    await markMessageOutcomeViaPostgres(messageId, "drafted", payload);
    return;
  }
  client ??= createOmnichannelAdminClient();
  await markMessageOutcome(messageId, "drafted", payload, client);
}

export async function markMessageIgnored(
  messageId: string,
  reason: string,
  options: {
    conversationId?: string;
    muteConversation?: boolean;
    suppressSends?: boolean;
  } = {},
  client?: SupabaseClient,
): Promise<void> {
  if (!client && shouldUseDevelopmentPostgres()) {
    await markMessageIgnoredViaPostgres(messageId, reason, options);
    return;
  }
  client ??= createOmnichannelAdminClient();
  // For opt-out, persist the send prohibition first. If a later message-state
  // write fails, a retry is safe; the inverse order could lose suppression.
  if (
    (options.muteConversation || options.suppressSends) &&
    options.conversationId
  ) {
    const conversationPatch: Record<string, unknown> = {};
    if (options.muteConversation) conversationPatch.status = "muted";
    if (options.suppressSends) {
      conversationPatch.send_suppressed = true;
      conversationPatch.suppression_reason = "customer_opt_out";
      conversationPatch.suppressed_at = new Date().toISOString();
    }
    const { error } = await client
      .from("omnichannel_conversations")
      .update(conversationPatch)
      .eq("id", options.conversationId);
    if (error) throw dbError("mute omnichannel conversation", error);
  }
  await markMessageOutcome(messageId, "ignored", { reason }, client);
}

export async function markMessageSuperseded(
  messageId: string,
  reason = "superseded_by_newer_message",
  client?: SupabaseClient,
): Promise<void> {
  if (!client && shouldUseDevelopmentPostgres()) {
    await markMessageOutcomeViaPostgres(messageId, "superseded", { reason });
    return;
  }
  client ??= createOmnichannelAdminClient();
  await markMessageOutcome(messageId, "superseded", { reason }, client);
}

export async function markMessageFailed(
  messageId: string,
  reason: string,
  client?: SupabaseClient,
): Promise<void> {
  if (!client && shouldUseDevelopmentPostgres()) {
    await markMessageOutcomeViaPostgres(messageId, "failed", { reason });
    return;
  }
  client ??= createOmnichannelAdminClient();
  await markMessageOutcome(messageId, "failed", { reason }, client);
}

export async function markMessageNeedsHuman(
  messageId: string,
  conversationId: string,
  payload: MessageOutcomePayload,
  client?: SupabaseClient,
): Promise<void> {
  if (!client && shouldUseDevelopmentPostgres()) {
    await markMessageNeedsHumanViaPostgres(messageId, conversationId, payload);
    return;
  }
  client ??= createOmnichannelAdminClient();
  const { error } = await client
    .from("omnichannel_conversations")
    .update({ status: "needs_human" })
    .eq("id", conversationId);
  if (error) throw dbError("escalate omnichannel conversation", error);
  await markMessageOutcome(messageId, "needs_human", payload, client);
}

export async function markMessageReplied(
  messageId: string,
  payload: MessageOutcomePayload,
  client?: SupabaseClient,
): Promise<void> {
  if (!client && shouldUseDevelopmentPostgres()) {
    await markMessageOutcomeViaPostgres(messageId, "replied", payload);
    return;
  }
  client ??= createOmnichannelAdminClient();
  await markMessageOutcome(messageId, "replied", payload, client);
}

export interface LogOutboundMessageInput {
  conversationId: string;
  channel: "instagram" | "whatsapp";
  externalMessageId: string;
  text: string;
  messageType?: OmnichannelMessageType;
  aiGenerated: boolean;
  replyToExternalId?: string | null;
  status?: "sent" | "delivered" | "read";
  metadata?: JsonObject;
  occurredAt?: string;
}

export async function logOutboundMessage(
  input: LogOutboundMessageInput,
  client?: SupabaseClient,
): Promise<string> {
  const occurredAt = asIso(input.occurredAt);
  if (!client && shouldUseDevelopmentPostgres()) {
    return logOutboundMessageViaPostgres({ ...input, occurredAt });
  }
  client ??= createOmnichannelAdminClient();
  const { data, error } = await client
    .from("omnichannel_messages")
    .insert({
      conversation_id: input.conversationId,
      channel: input.channel,
      external_message_id: input.externalMessageId,
      direction: "out",
      message_type: input.messageType ?? "text",
      text: input.text,
      status: input.status ?? "sent",
      reply_to_external_id: input.replyToExternalId ?? null,
      ai_generated: input.aiGenerated,
      metadata: input.metadata ?? {},
      occurred_at: occurredAt,
      processed_at: occurredAt,
    })
    .select("id")
    .single();
  let messageId: string;
  if (!error && data) {
    messageId = data.id;
  } else if (error?.code === "23505") {
    // Instagram echoes and WhatsApp delivery callbacks may arrive before this
    // persistence step. Enrich the provider row instead of treating it as a
    // second send or downgrading delivered/read to sent.
    const existing = await client
      .from("omnichannel_messages")
      .select(
        "id, conversation_id, status, metadata, ai_generated, occurred_at",
      )
      .eq("channel", input.channel)
      .eq("external_message_id", input.externalMessageId)
      .maybeSingle();
    if (existing.error || !existing.data) {
      throw dbError("load echoed outbound omnichannel message", existing.error);
    }
    const terminalDelivery = ["delivered", "read", "failed"].includes(
      existing.data.status,
    );
    const enriched = await client
      .from("omnichannel_messages")
      .update({
        direction: "out",
        message_type: input.messageType ?? "text",
        text: input.text,
        status: terminalDelivery
          ? existing.data.status
          : (input.status ?? "sent"),
        reply_to_external_id: input.replyToExternalId ?? null,
        ai_generated: input.aiGenerated || existing.data.ai_generated === true,
        metadata: {
          ...asJsonObject(existing.data.metadata),
          ...(input.metadata ?? {}),
        },
        processed_at: occurredAt,
      })
      .eq("id", existing.data.id);
    if (enriched.error)
      throw dbError("enrich outbound omnichannel message", enriched.error);
    messageId = existing.data.id;
  } else {
    throw dbError("log outbound omnichannel message", error);
  }

  return messageId;
}

export async function finalizeEquipmentFlowReply(
  input: {
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
  },
  client?: SupabaseClient,
): Promise<void> {
  if (!client && shouldUseDevelopmentPostgres()) {
    await finalizeEquipmentFlowReplyViaPostgres(input);
    return;
  }
  client ??= createOmnichannelAdminClient();
  const { error } = await client.rpc(
    "finalize_omnichannel_equipment_flow_reply",
    {
      p_message_id: input.messageId,
      p_conversation_id: input.conversationId,
      p_stage: input.stage,
      p_choice_id: input.choiceId,
      p_choice_label: input.choiceLabel,
      p_city_route_id: input.cityRouteId,
      p_city_label: input.cityLabel,
      p_manager_url: input.managerUrl,
      p_community_included: input.communityIncluded,
      p_reason: input.reason,
    },
  );
  if (error) throw dbError("finalize equipment sales flow reply", error);
}
