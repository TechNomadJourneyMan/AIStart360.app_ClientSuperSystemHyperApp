import { inngest } from "@/lib/inngest";
import { humanTypingDelaySeconds } from "@/lib/omnichannel/human-reply-timing";
import {
  generateOmnichannelReply,
  type OmnichannelAiReply,
} from "@/lib/omnichannel/ai";
import {
  hasConfirmedEquipmentManagerHandoff,
  planEquipmentSalesFlow,
  type EquipmentSalesFlowPlan,
} from "@/lib/omnichannel/equipment-sales-flow";
import {
  assessDelayedReply,
  isHistoricalCatchUpMessage,
  prependDelayedReplyApology,
  type DelayedReplyAssessment,
} from "@/lib/omnichannel/delayed-reply-policy";
import { OMNICHANNEL_MESSAGE_RECEIVED_EVENT } from "@/lib/omnichannel/events";
import {
  decideReplyPolicy,
  detectDeterministicRisk,
  getSendWindow,
  isAutoReplyContentType,
  type DeterministicRiskResult,
  type OmnichannelReplyMode,
  type RiskCategory,
} from "@/lib/omnichannel/guardrails";
import type { MetaSendResult } from "@/lib/omnichannel/meta-client";
import { isWhatsAppWebPullDeliveryEnabled } from "@/lib/omnichannel/outbound-deliveries";
import {
  claimEquipmentFlowForAutoSend,
  claimMessageForAutoSend,
  finalizeEquipmentFlowReply,
  getMessageContext,
  logOutboundMessage,
  markMessageDrafted,
  markMessageFailed,
  markMessageIgnored,
  markMessageNeedsHuman,
  markMessageProcessing,
  markMessageReplied,
  markMessageSuperseded,
  persistAiAnalysis,
} from "@/lib/omnichannel/repository";
import {
  dispatchOmnichannelPresence,
  dispatchOmnichannelReply,
  isConfiguredOmnichannelSender,
  outboundTransportMetadata,
  resolveOmnichannelTransport,
  type OmnichannelDispatchResult,
  type OmnichannelQueuedDispatch,
} from "@/lib/omnichannel/transport-dispatch";
import type { OmnichannelMessageReceivedEventData } from "@/lib/omnichannel/events";
import type { JsonObject, OmnichannelMessage } from "@/lib/omnichannel/types";

function effectiveMode(input: {
  forceDraft: boolean;
  configured: OmnichannelReplyMode;
  override: boolean | null;
}): OmnichannelReplyMode {
  if (input.forceDraft) return "draft";
  if (input.override === true) return "auto";
  if (input.override === false) return "off";
  return input.configured;
}

function safeFailureReason(
  result: Extract<MetaSendResult, { ok: false }>,
): string {
  return `meta_send_failed:${result.code ?? result.status ?? "unknown"}:${result.message}`.slice(
    0,
    500,
  );
}

function isQueuedDispatch(
  result: OmnichannelDispatchResult,
): result is OmnichannelQueuedDispatch {
  return result.ok && (result as Partial<OmnichannelQueuedDispatch>).queued === true;
}

function parsedTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Inngest serializes a conversation, so a newer event may begin only after an
 * older event has finished its own sleep. Anchor the wait to the server-side
 * ingestion timestamp instead of sleeping the full duration again. The
 * deadline itself is persisted through step.run and sleepUntil is always
 * invoked with that fixed value, so an Inngest replay cannot change the step
 * graph as wall-clock time advances. Database jobs pass delay_already_applied
 * because their run_at is the durable anchor.
 */
function replyDelayDeadline(
  configuredSeconds: number,
  message: OmnichannelMessage,
  fallbackNowMs = Date.now(),
): string {
  const bounded = Math.min(86_400, Math.max(0, Math.trunc(configuredSeconds)));
  const ingestedAt = message.metadata.ingestedAt;
  const ingestedAtMs =
    typeof ingestedAt === "string" ? parsedTime(ingestedAt) : null;
  return new Date(
    (ingestedAtMs ?? fallbackNowMs) + bounded * 1_000,
  ).toISOString();
}

/**
 * Risk belongs to the customer's current message burst, not just its last row.
 * This prevents a short follow-up such as "Астана" from hiding an immediately
 * preceding complaint or opt-out.
 */
function detectRecentInboundRisk(
  history: OmnichannelMessage[],
  currentMessage: OmnichannelMessage,
): DeterministicRiskResult {
  const currentIndex = history.findIndex(
    (message) => message.id === currentMessage.id,
  );
  const throughCurrent =
    currentIndex >= 0 ? history.slice(0, currentIndex + 1) : history;
  let lastOutboundIndex = -1;
  throughCurrent.forEach((message, index) => {
    if (message.direction === "out") lastOutboundIndex = index;
  });

  const currentMs = parsedTime(currentMessage.occurredAt) ?? Date.now();
  const candidates = throughCurrent
    .slice(lastOutboundIndex + 1)
    .filter((message) => {
      if (message.direction !== "in") return false;
      const occurredAt = parsedTime(message.occurredAt);
      if (occurredAt === null) return message.id === currentMessage.id;
      const ageMs = currentMs - occurredAt;
      return ageMs >= -5 * 60 * 1_000 && ageMs <= 10 * 60 * 1_000;
    });
  if (!candidates.some((message) => message.id === currentMessage.id)) {
    candidates.push(currentMessage);
  }

  const categories = Array.from(
    new Set(
      candidates.flatMap(
        (message) => detectDeterministicRisk(message.text ?? "").categories,
      ),
    ),
  ) as RiskCategory[];
  return {
    risk: categories.length > 0 ? "high" : "low",
    categories,
    optOut: categories.includes("opt_out"),
    promptInjection: categories.includes("prompt_injection"),
  };
}

function sameEquipmentFlowPlan(
  first: EquipmentSalesFlowPlan,
  second: EquipmentSalesFlowPlan,
): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

async function bestEffortWhatsAppPresence(
  input: Parameters<typeof dispatchOmnichannelPresence>[0],
): Promise<unknown> {
  try {
    return await dispatchOmnichannelPresence(input);
  } catch {
    // Typing presence is cosmetic. It must never suppress a valid reply.
    return null;
  }
}

async function handleOmnichannelMessage({ event, step }: any) {
  const data = event.data as OmnichannelMessageReceivedEventData;
  if (!data?.message_id || !data?.conversation_id) {
    return { skipped: true, reason: "invalid_event_data" };
  }
  const eventForceDraft = data.force_draft === true;
  const delayAlreadyApplied = data.delay_already_applied === true;

  let context = await step.run("load-message-context", () =>
    getMessageContext(data.message_id),
  );
  if (!context) return { skipped: true, reason: "message_not_found" };
  // Never trust the queue hint as the only historical-send barrier. An
  // imported/offline row remains draft-only even if a malformed or manually
  // created job omitted force_draft.
  const forceDraft =
    eventForceDraft || isHistoricalCatchUpMessage(context.message);
  if (context.message.direction !== "in")
    return { skipped: true, reason: "not_inbound" };
  if (context.message.status === "sending") {
    const durableDeliveryId = context.message.metadata.outboundDeliveryId;
    if (
      context.message.metadata.transport === "whatsapp_web" &&
      isWhatsAppWebPullDeliveryEnabled() &&
      typeof durableDeliveryId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        durableDeliveryId,
      )
    ) {
      return {
        action: "queued",
        channel: context.conversation.channel,
        delivery_id: durableDeliveryId,
        delivery_status: "pending",
        recovered: true,
      };
    }
    // The database claim is intentionally the last authorization before the
    // provider call. If a worker disappears after that claim, `sending` cannot
    // tell us whether the provider accepted the reply. Retrying automatically
    // could duplicate a customer-visible message, while treating this as a
    // successful skip would lose the reply. Make the uncertainty explicit and
    // pause automation so a person can reconcile it in the provider inbox.
    const reason = "delivery_unknown_after_interrupted_send";
    await step.run("escalate-interrupted-send", () =>
      markMessageNeedsHuman(context!.message.id, context!.conversation.id, {
        draft: context!.message.aiDraft,
        confidence: context!.message.aiConfidence,
        reason,
      }),
    );
    return { action: "escalate", reason };
  }
  if (
    !["received", "imported", "failed", "processing"].includes(
      context.message.status,
    )
  ) {
    return { skipped: true, reason: `already_${context.message.status}` };
  }

  const initialRisk = detectRecentInboundRisk(context.history, context.message);
  if (initialRisk.optOut) {
    await step.run("persist-customer-opt-out", () =>
      markMessageIgnored(context!.message.id, "customer_opted_out", {
        conversationId: context!.conversation.id,
        muteConversation: true,
        suppressSends: true,
      }),
    );
    return { action: "ignore", reason: "customer_opted_out" };
  }

  if (
    context.conversation.status === "muted" ||
    context.conversation.sendSuppressed
  ) {
    await step.run("mark-muted-message-ignored", () =>
      markMessageIgnored(context!.message.id, "conversation_muted"),
    );
    return { action: "ignore", reason: "conversation_muted" };
  }
  if (
    !forceDraft &&
    (!context.settings.enabled || context.settings.mode === "off")
  ) {
    await step.run("mark-disabled-message-ignored", () =>
      markMessageIgnored(context!.message.id, "channel_disabled_or_off"),
    );
    return { action: "ignore", reason: "channel_disabled_or_off" };
  }
  if (!forceDraft && context.conversation.autoReplyOverride === false) {
    await step.run("mark-human-takeover-message-ignored", () =>
      markMessageIgnored(context!.message.id, "conversation_manual_takeover"),
    );
    return { action: "ignore", reason: "conversation_manual_takeover" };
  }

  const delaySeconds =
    forceDraft || delayAlreadyApplied
      ? 0
      : Math.min(
          86_400,
          Math.max(0, Math.trunc(context.settings.replyDelaySeconds)),
        );
  if (delaySeconds > 0) {
    const deadline = await step.run("resolve-reply-delay-deadline", () =>
      replyDelayDeadline(delaySeconds, context!.message),
    );
    await step.sleepUntil("configured-reply-delay", deadline);
    context = await step.run("reload-message-context-after-delay", () =>
      getMessageContext(data.message_id),
    );
    if (!context)
      return { skipped: true, reason: "message_removed_after_delay" };
  }

  const newestMessageId =
    context.history[context.history.length - 1]?.id ?? null;
  if (
    context.newestInboundMessageId !== context.message.id ||
    (!forceDraft && newestMessageId !== context.message.id)
  ) {
    await step.run("mark-superseded", () =>
      markMessageSuperseded(context!.message.id),
    );
    return { action: "ignore", reason: "superseded_by_newer_message" };
  }

  if (!context.message.text?.trim()) {
    await step.run("escalate-non-text-message", () =>
      markMessageNeedsHuman(context!.message.id, context!.conversation.id, {
        draft: null,
        confidence: null,
        reason: "message_has_no_text",
      }),
    );
    return { action: "escalate", reason: "message_has_no_text" };
  }

  await step.run("mark-message-processing", () =>
    markMessageProcessing(context!.message.id),
  );

  let delayedReplyAssessment: DelayedReplyAssessment = assessDelayedReply({
    currentMessage: context.message,
    history: context.history,
    forceDraft,
  });

  let salesFlowPlan: EquipmentSalesFlowPlan | null =
    initialRisk.risk === "low" &&
    isAutoReplyContentType(context.message.messageType)
      ? planEquipmentSalesFlow({
          currentMessage: context.message,
          history: context.history,
          automationConfig: context.settings.automationConfig,
          conversationMetadata: context.conversation.metadata,
          forceDraft,
        })
      : null;

  const proposedReply: OmnichannelAiReply | null = salesFlowPlan
    ? {
        answer: salesFlowPlan.answer,
        intent: "lead",
        sentiment: "neutral",
        language: "ru",
        confidence: 1,
        risk: "low",
        needs_human: false,
        reason: salesFlowPlan.reason,
        lead_score: salesFlowPlan.leadScore,
        conversation_summary: salesFlowPlan.summary,
      }
    : await step.run("generate-safe-ai-reply", () =>
        generateOmnichannelReply({
          channel: context!.conversation.channel,
          businessContext: context!.settings.businessContext,
          currentMessage: context!.message.text!,
          history: context!.history.map((message: OmnichannelMessage) => ({
            direction: message.direction,
            text: message.text,
            occurredAt: message.occurredAt,
            actor:
              message.direction === "in"
                ? "customer"
                : message.aiGenerated
                  ? "ai"
                  : "human",
          })),
        }),
      );

  const aiReply: OmnichannelAiReply | null = proposedReply
    ? {
        ...proposedReply,
        answer: prependDelayedReplyApology(
          proposedReply.answer,
          delayedReplyAssessment,
        ),
      }
    : null;

  if (!aiReply) {
    await step.run("escalate-ai-unavailable", () =>
      markMessageNeedsHuman(context!.message.id, context!.conversation.id, {
        draft: null,
        confidence: null,
        reason: "ai_generation_unavailable",
      }),
    );
    return { action: "escalate", reason: "ai_generation_unavailable" };
  }

  await step.run("persist-ai-analysis", () =>
    persistAiAnalysis({
      messageId: context!.message.id,
      conversationId: context!.conversation.id,
      draft: aiReply.answer,
      confidence: aiReply.confidence,
      reason: aiReply.reason,
      intent: aiReply.intent,
      sentiment: aiReply.sentiment,
      leadScore: aiReply.lead_score,
      summary: aiReply.conversation_summary,
    }),
  );

  // The model call may take seconds. Re-read every operator-controlled gate
  // and the conversation tail before deciding whether anything may leave.
  context = await step.run("reload-context-before-policy", () =>
    getMessageContext(data.message_id),
  );
  if (!context)
    return { skipped: true, reason: "message_removed_before_policy" };

  const latestAfterAnalysis =
    context.history[context.history.length - 1]?.id ?? null;
  if (
    forceDraft &&
    context.newestInboundMessageId === context.message.id &&
    latestAfterAnalysis !== context.message.id
  ) {
    await step.run("mark-historical-analysis-complete", () =>
      markMessageSuperseded(
        context!.message.id,
        "historical_analysis_completed",
      ),
    );
    return { action: "analyzed", reason: "historical_analysis_completed" };
  }

  if (salesFlowPlan) {
    const refreshedPlan = planEquipmentSalesFlow({
      currentMessage: context.message,
      history: context.history,
      automationConfig: context.settings.automationConfig,
      conversationMetadata: context.conversation.metadata,
      forceDraft,
    });
    if (
      !refreshedPlan ||
      !sameEquipmentFlowPlan(salesFlowPlan, refreshedPlan)
    ) {
      const reason = "equipment_flow_configuration_changed";
      await step.run("mark-changed-equipment-flow-draft", () =>
        markMessageDrafted(context!.message.id, {
          draft: aiReply.answer || null,
          confidence: aiReply.confidence,
          reason,
        }),
      );
      return { action: "draft", reason };
    }
    salesFlowPlan = refreshedPlan;
  }

  const refreshedDelayedReplyAssessment = assessDelayedReply({
    currentMessage: context.message,
    history: context.history,
    forceDraft,
  });
  const refreshedAnswer = prependDelayedReplyApology(
    aiReply.answer,
    refreshedDelayedReplyAssessment,
  );
  if (refreshedAnswer !== aiReply.answer) {
    aiReply.answer = refreshedAnswer;
    // This narrow second write is needed only when the delay threshold crossed
    // during model generation. It keeps the Inbox draft identical to the text
    // that is later authorized for delivery.
    await step.run("persist-delayed-reply-apology", () =>
      persistAiAnalysis({
        messageId: context!.message.id,
        conversationId: context!.conversation.id,
        draft: aiReply.answer,
        confidence: aiReply.confidence,
        reason: aiReply.reason,
        intent: aiReply.intent,
        sentiment: aiReply.sentiment,
        leadScore: aiReply.lead_score,
        summary: aiReply.conversation_summary,
      }),
    );
  }
  delayedReplyAssessment = refreshedDelayedReplyAssessment;

  const deterministicRisk = detectRecentInboundRisk(
    context.history,
    context.message,
  );
  const newestMessageIdBeforePolicy =
    context.history[context.history.length - 1]?.id ?? null;
  const isNewest =
    context.newestInboundMessageId === context.message.id &&
    newestMessageIdBeforePolicy === context.message.id;
  const providerTimestampTrusted =
    context.message.metadata.providerTimestampTrusted === true;
  const contentRequiresHuman =
    !isAutoReplyContentType(context.message.messageType) ||
    hasConfirmedEquipmentManagerHandoff({
      history: context.history,
      automationConfig: context.settings.automationConfig,
    });
  const configuredMode = effectiveMode({
    forceDraft,
    configured:
      context.settings.enabled && !context.conversation.sendSuppressed
        ? context.settings.mode
        : "off",
    override: context.conversation.autoReplyOverride,
  });
  const accountMatches = isConfiguredOmnichannelSender({
    channel: context.conversation.channel,
    metadata: context.message.metadata,
    accountExternalId: context.conversation.accountExternalId,
  });
  const mode = accountMatches ? configuredMode : "draft";
  const sendWindow = getSendWindow({
    channel: context.conversation.channel,
    lastInboundAt: providerTimestampTrusted ? context.message.occurredAt : null,
    actor: "automated",
  });
  let decision = decideReplyPolicy({
    mode,
    conversationStatus: context.conversation.status,
    answer: aiReply.answer,
    confidence: aiReply.confidence,
    threshold: context.settings.confidenceThreshold,
    risk: aiReply.risk,
    needsHuman: aiReply.needs_human || contentRequiresHuman,
    deterministicRisk,
    isNewestInbound: isNewest,
    sendWindow,
  });
  // The normal guardrails run first so opt-out/mute/risk decisions keep their
  // stronger semantics. Timing can only make an otherwise-sendable answer more
  // conservative; it can never promote a draft or escalation to auto-send.
  if (decision.action === "send") {
    if (delayedReplyAssessment.gate === "human") {
      decision = {
        action: "escalate",
        reason: delayedReplyAssessment.reason,
      };
    } else if (delayedReplyAssessment.gate === "draft") {
      decision = {
        action: "draft",
        reason: delayedReplyAssessment.reason,
      };
    }
  }
  const outcome = {
    draft: aiReply.answer || null,
    confidence: aiReply.confidence,
    reason:
      decision.reason === "safe_auto_reply" &&
      delayedReplyAssessment.prependApology
        ? "safe_auto_reply_delayed_apology"
        : decision.reason,
  };

  if (decision.action === "ignore") {
    await step.run("mark-policy-ignored", () =>
      markMessageIgnored(context!.message.id, decision.reason, {
        conversationId: context!.conversation.id,
        muteConversation: deterministicRisk.optOut,
        suppressSends: deterministicRisk.optOut,
      }),
    );
    return { action: "ignore", reason: decision.reason };
  }
  if (decision.action === "escalate") {
    await step.run("mark-policy-needs-human", () =>
      markMessageNeedsHuman(
        context!.message.id,
        context!.conversation.id,
        outcome,
      ),
    );
    return { action: "escalate", reason: decision.reason };
  }
  if (decision.action === "draft") {
    await step.run("mark-policy-drafted", () =>
      markMessageDrafted(context!.message.id, outcome),
    );
    return { action: "draft", reason: decision.reason };
  }

  const outboundTransport = resolveOmnichannelTransport(
    context.conversation.channel,
    context.message.metadata,
  );
  const pullWebDelivery =
    outboundTransport === "whatsapp_web" &&
    isWhatsAppWebPullDeliveryEnabled();
  const typingDelaySeconds =
    outboundTransport === "whatsapp_web"
      ? humanTypingDelaySeconds(aiReply.answer, context.message.id)
      : 0;
  const delayedReplyMetadata: JsonObject = delayedReplyAssessment.prependApology
    ? {
        delayedReplyApologyIncluded: true,
        delayedReplyUnansweredAgeMinutes: Math.max(
          0,
          Math.floor((delayedReplyAssessment.unansweredAgeMs ?? 0) / 60_000),
        ),
      }
    : {};
  if (outboundTransport === "whatsapp_web" && !pullWebDelivery) {
    const presenceTarget = {
      channel: context.conversation.channel,
      metadata: context.message.metadata,
      accountExternalId: context.conversation.accountExternalId,
      conversationExternalId: context.conversation.externalId,
    };
    await step.run("start-whatsapp-typing", () =>
      bestEffortWhatsAppPresence({ ...presenceTarget, presence: "composing" }),
    );
    await step.sleep(
      "human-whatsapp-typing-delay",
      `${typingDelaySeconds}s`,
    );
    await step.run("stop-whatsapp-typing", () =>
      bestEffortWhatsAppPresence({ ...presenceTarget, presence: "paused" }),
    );
  }

  const claim = await step.run("claim-auto-send", () =>
    salesFlowPlan
      ? claimEquipmentFlowForAutoSend(
          context!.message.id,
          context!.settings.updatedAt,
        )
      : claimMessageForAutoSend(context!.message.id),
  );
  if (!claim.claimed) {
    const reason = `auto_send_claim_denied:${claim.reason}`;
    if (claim.reason === "superseded_by_newer_message") {
      await step.run("mark-claim-superseded", () =>
        markMessageSuperseded(context!.message.id, reason),
      );
      return { action: "ignore", reason };
    }
    await step.run("mark-claim-denied-draft", () =>
      markMessageDrafted(context!.message.id, { ...outcome, reason }),
    );
    return { action: "draft", reason };
  }

  let sendResult: OmnichannelDispatchResult;
  try {
    sendResult = await step.run("send-meta-auto-reply", async () => {
      const finalClaim = salesFlowPlan
        ? await claimEquipmentFlowForAutoSend(
            context!.message.id,
            context!.settings.updatedAt,
          )
        : await claimMessageForAutoSend(context!.message.id);
      if (!finalClaim.claimed) {
        return {
          ok: false as const,
          status: null,
          code: "auto_send_cancelled",
          message: finalClaim.reason,
          retryable: false,
        };
      }
      const outboundMessageType =
        salesFlowPlan?.presentation.kind === "choices"
          ? context!.conversation.channel === "instagram"
            ? "button"
            : outboundTransport === "whatsapp_cloud"
              ? "interactive"
              : "text"
          : "text";
      const outboundMetadata = {
        ...(salesFlowPlan
          ? salesFlowPlan.outboundMetadata
          : { source: "omnichannel_auto_reply" }),
        ...delayedReplyMetadata,
        ...outboundTransportMetadata(
          context!.conversation.channel,
          context!.message.metadata,
        ),
      };
      return dispatchOmnichannelReply({
        channel: context!.conversation.channel,
        metadata: context!.message.metadata,
        accountExternalId: context!.conversation.accountExternalId,
        conversationExternalId: context!.conversation.externalId,
        contactExternalId: context!.contact.externalId,
        text: aiReply.answer,
        actor: "automated",
        useHumanAgent: false,
        replyToExternalId: context!.message.externalMessageId,
        idempotencyKey: `omnichannel:auto:${context!.message.id}`,
        ...(pullWebDelivery
          ? {
              durableDelivery: {
                conversationId: context!.conversation.id,
                sourceInboundMessageId: context!.message.id,
                aiGenerated: true,
                messageType: outboundMessageType,
                metadata: outboundMetadata,
                typingDelayMs: typingDelaySeconds * 1_000,
                finalization: salesFlowPlan
                  ? {
                      kind: "equipment" as const,
                      reason: outcome.reason,
                      settingsUpdatedAt: context!.settings.updatedAt,
                      stage: salesFlowPlan.stage,
                      choiceId: salesFlowPlan.choiceId,
                      choiceLabel: salesFlowPlan.choiceLabel,
                      cityRouteId: salesFlowPlan.cityRouteId,
                      cityLabel: salesFlowPlan.cityLabel,
                      managerUrl: salesFlowPlan.managerUrl,
                      communityIncluded: salesFlowPlan.communityIncluded,
                    }
                  : { kind: "auto" as const, reason: outcome.reason },
              },
            }
          : {}),
        choices:
          salesFlowPlan?.presentation.kind === "choices"
            ? {
                options: salesFlowPlan.presentation.options,
                buttonText: "Выбрать",
                sectionTitle: "Экипировка",
              }
            : null,
      });
    });
  } catch (error) {
    // MetaClient converts network/timeout outcomes into a result. Reaching
    // this branch means a local unexpected failure, before normal handling.
    const reason =
      error instanceof Error ? error.message : "unexpected_meta_send_failure";
    await step.run("mark-unexpected-send-failed", () =>
      markMessageFailed(context!.message.id, reason),
    );
    throw error;
  }

  if (!sendResult.ok) {
    if (sendResult.code === "auto_send_cancelled") {
      const reason = `auto_send_cancelled:${sendResult.message}`;
      await step.run("mark-late-cancel-superseded", () =>
        markMessageSuperseded(context!.message.id, reason),
      );
      return { action: "ignore", reason };
    }
    // A timeout/network error is ambiguous: Meta may have accepted the POST.
    // Never retry it automatically and risk sending the customer twice.
    const ambiguous =
      sendResult.status === null &&
      (sendResult.code === "timeout" || sendResult.code === "network_error");
    const reason = `${ambiguous ? "ambiguous_" : ""}${safeFailureReason(sendResult)}`;
    await step.run("escalate-send-failure", () =>
      markMessageNeedsHuman(context!.message.id, context!.conversation.id, {
        ...outcome,
        reason,
      }),
    );
    return { action: "escalate", reason };
  }

  if (isQueuedDispatch(sendResult)) {
    return {
      action: "queued",
      channel: context.conversation.channel,
      delivery_id: sendResult.deliveryId,
      delivery_status: sendResult.deliveryStatus,
      ...(salesFlowPlan?.handoffAfterSend ? { handoff_pending: true } : {}),
    };
  }

  await step.run("persist-auto-reply", () =>
    logOutboundMessage({
      conversationId: context!.conversation.id,
      channel: context!.conversation.channel,
      externalMessageId: sendResult.externalMessageId,
      text: aiReply.answer,
      messageType:
        salesFlowPlan?.presentation.kind === "choices"
          ? context!.conversation.channel === "instagram"
            ? "button"
            : outboundTransport === "whatsapp_cloud"
              ? "interactive"
              : "text"
          : "text",
      aiGenerated: true,
      replyToExternalId: context!.message.externalMessageId,
      status: "sent",
      metadata: {
        ...(salesFlowPlan
          ? salesFlowPlan.outboundMetadata
          : { source: "omnichannel_auto_reply" }),
        ...delayedReplyMetadata,
        ...outboundTransportMetadata(
          context!.conversation.channel,
          context!.message.metadata,
        ),
      },
    }),
  );
  if (salesFlowPlan) {
    await step.run("finalize-equipment-flow-reply", () =>
      finalizeEquipmentFlowReply({
        messageId: context!.message.id,
        conversationId: context!.conversation.id,
        stage: salesFlowPlan!.stage,
        choiceId: salesFlowPlan!.choiceId,
        choiceLabel: salesFlowPlan!.choiceLabel,
        cityRouteId: salesFlowPlan!.cityRouteId,
        cityLabel: salesFlowPlan!.cityLabel,
        managerUrl: salesFlowPlan!.managerUrl,
        communityIncluded: salesFlowPlan!.communityIncluded,
        reason: outcome.reason,
      }),
    );
  } else {
    await step.run("mark-inbound-replied", () =>
      markMessageReplied(context!.message.id, outcome),
    );
  }

  return {
    action: "send",
    channel: context.conversation.channel,
    external_message_id: sendResult.externalMessageId,
    ...(salesFlowPlan?.handoffAfterSend ? { handoff: true } : {}),
  };
}

function inlineSleepDuration(value: string): number {
  const match = /^(\d+)(ms|s|m)$/.exec(value.trim());
  if (!match) throw new Error("unsupported_inline_sleep_duration");
  const amount = Number(match[1]);
  const multiplier = match[2] === "ms" ? 1 : match[2] === "s" ? 1_000 : 60_000;
  return amount * multiplier;
}

/**
 * Self-contained processing path for installations that do not have an
 * Inngest account yet. It deliberately uses the exact same handler and policy
 * gates as the durable Inngest function; only step persistence/retries differ.
 * Keep this opt-in and use draft mode while operating inline.
 */
export async function processOmnichannelMessageDirect(
  data: OmnichannelMessageReceivedEventData,
): Promise<unknown> {
  const step = {
    run: async <T>(_id: string, action: () => Promise<T> | T): Promise<T> =>
      action(),
    sleep: async (_id: string, duration: string): Promise<void> => {
      const delayMs = inlineSleepDuration(duration);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    },
    sleepUntil: async (_id: string, deadline: string | Date): Promise<void> => {
      const deadlineMs = new Date(deadline).getTime();
      if (!Number.isFinite(deadlineMs)) {
        throw new Error("unsupported_inline_sleep_deadline");
      }
      const delayMs = Math.max(0, deadlineMs - Date.now());
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    },
  };

  return handleOmnichannelMessage({ event: { data }, step });
}

export const processOmnichannelMessage = inngest.createFunction(
  {
    id: "process-omnichannel-message",
    retries: 3,
    concurrency: { limit: 1, key: "event.data.conversation_id" },
    triggers: [{ event: OMNICHANNEL_MESSAGE_RECEIVED_EVENT }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  handleOmnichannelMessage,
);
