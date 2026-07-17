import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  claimEquipmentFlowForAutoSend: vi.fn(),
  claimMessageForAutoSend: vi.fn(),
  finalizeEquipmentFlowReply: vi.fn(),
  getMessageContext: vi.fn(),
  logOutboundMessage: vi.fn(),
  markMessageDrafted: vi.fn(),
  markMessageFailed: vi.fn(),
  markMessageIgnored: vi.fn(),
  markMessageNeedsHuman: vi.fn(),
  markMessageProcessing: vi.fn(),
  markMessageReplied: vi.fn(),
  markMessageSuperseded: vi.fn(),
  persistAiAnalysis: vi.fn(),
}));
const ai = vi.hoisted(() => ({ generateOmnichannelReply: vi.fn() }));
const meta = vi.hoisted(() => ({
  createMetaClient: vi.fn(),
  isConfiguredMetaAccount: vi.fn(),
  sendInstagram: vi.fn(),
  sendInstagramQuickReplies: vi.fn(),
  sendWhatsApp: vi.fn(),
  sendWhatsAppList: vi.fn(),
}));
const web = vi.hoisted(() => ({
  createClient: vi.fn(),
  configured: vi.fn(),
  sendPresence: vi.fn(),
  sendText: vi.fn(),
}));
const outbound = vi.hoisted(() => ({
  pull: false,
  enqueue: vi.fn(),
}));

vi.mock("@/lib/omnichannel/repository", () => repository);
vi.mock("@/lib/omnichannel/ai", () => ai);
vi.mock("@/lib/omnichannel/meta-client", () => ({
  createMetaClient: meta.createMetaClient,
  isConfiguredMetaAccount: meta.isConfiguredMetaAccount,
}));
vi.mock("@/lib/omnichannel/whatsapp-web-client", () => ({
  createWhatsAppWebClient: web.createClient,
  isConfiguredWhatsAppWebAccount: web.configured,
}));
vi.mock("@/lib/omnichannel/outbound-deliveries", () => ({
  isWhatsAppWebPullDeliveryEnabled: () => outbound.pull,
  whatsappWebDeliveryMode: () => outbound.pull ? "pull" : "direct",
  enqueueOutboundDelivery: outbound.enqueue,
}));
vi.mock("@/lib/omnichannel/postgres-runtime", () => ({
  shouldUseOmnichannelPostgres: () => true,
}));

import { processOmnichannelMessage } from "@/lib/functions/process-omnichannel-message";

const now = new Date().toISOString();

function context(overrides: Record<string, unknown> = {}) {
  const message = {
    id: "message-1",
    conversationId: "conversation-1",
    channel: "instagram",
    externalMessageId: "provider-in-1",
    direction: "in",
    messageType: "text",
    text: "Расскажите о диагностике",
    status: "received",
    replyToExternalId: null,
    aiDraft: null,
    aiConfidence: null,
    aiReason: null,
    aiGenerated: false,
    metadata: { providerTimestampTrusted: true },
    occurredAt: now,
    processedAt: null,
    ...((overrides.message as Record<string, unknown> | undefined) ?? {}),
  };
  return {
    message,
    conversation: {
      id: "conversation-1",
      channel: "instagram",
      accountExternalId: "ig-account-1",
      externalId: "contact-1",
      contactId: "contact-db-1",
      status: "open",
      autoReplyOverride: null,
      sendSuppressed: false,
      suppressionReason: null,
      suppressedAt: null,
      intent: null,
      sentiment: null,
      leadScore: null,
      summary: null,
      lastMessageAt: now,
      lastInboundAt: now,
      lastOutboundAt: null,
      metadata: {},
      ...((overrides.conversation as Record<string, unknown> | undefined) ??
        {}),
    },
    contact: {
      id: "contact-db-1",
      channel: "instagram",
      externalId: "contact-1",
      displayName: null,
      username: null,
      phone: null,
      metadata: {},
      firstSeenAt: now,
      lastSeenAt: now,
      ...((overrides.contact as Record<string, unknown> | undefined) ?? {}),
    },
    settings: {
      channel: "instagram",
      mode: "auto",
      enabled: true,
      businessContext: "Honor Group: магазин проверенной экипировки для охоты, рыбалки и активного отдыха.",
      automationConfig: {},
      confidenceThreshold: 0.75,
      replyDelaySeconds: 0,
      updatedAt: now,
      ...((overrides.settings as Record<string, unknown> | undefined) ?? {}),
    },
    history: (overrides.history as unknown[] | undefined) ?? [message],
    newestInboundMessageId:
      (overrides.newestInboundMessageId as string | null | undefined) ??
      message.id,
  };
}

function fakeStep() {
  return {
    run: vi.fn(async (_name: string, callback: () => unknown) => callback()),
    sleep: vi.fn(async () => undefined),
    sleepUntil: vi.fn(async () => undefined),
    sendEvent: vi.fn(async () => undefined),
  };
}

async function invokeWithStep(
  forceDraft = false,
  step = fakeStep(),
  eventOverrides: Record<string, unknown> = {},
) {
  const handler = (
    processOmnichannelMessage as unknown as {
      fn: (input: unknown) => Promise<unknown>;
    }
  ).fn;
  return handler({
    event: {
      data: {
        message_id: "message-1",
        conversation_id: "conversation-1",
        force_draft: forceDraft,
        ...eventOverrides,
      },
    },
    step,
  });
}

async function invoke(forceDraft = false) {
  return invokeWithStep(forceDraft);
}

describe("omnichannel message processor safety", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repository.markMessageProcessing.mockResolvedValue(true);
    repository.claimEquipmentFlowForAutoSend.mockResolvedValue({
      claimed: true,
      reason: "claimed",
    });
    repository.claimMessageForAutoSend.mockResolvedValue({
      claimed: true,
      reason: "claimed",
    });
    meta.isConfiguredMetaAccount.mockReturnValue(true);
    web.configured.mockReturnValue(true);
    web.createClient.mockReturnValue({
      sendPresence: web.sendPresence,
      sendText: web.sendText,
    });
    meta.createMetaClient.mockReturnValue({
      sendInstagramText: meta.sendInstagram,
      sendInstagramQuickReplies: meta.sendInstagramQuickReplies,
      sendWhatsAppText: meta.sendWhatsApp,
      sendWhatsAppList: meta.sendWhatsAppList,
    });
    ai.generateOmnichannelReply.mockResolvedValue({
      answer: "Начните с mini-GRI в личном кабинете.",
      intent: "lead",
      sentiment: "neutral",
      language: "ru",
      confidence: 0.94,
      risk: "low",
      needs_human: false,
      reason: "safe_product_question",
      lead_score: 70,
      conversation_summary: "Клиент интересуется диагностикой.",
    });
    meta.sendInstagram.mockResolvedValue({
      ok: true,
      externalMessageId: "provider-out-1",
    });
    meta.sendInstagramQuickReplies.mockResolvedValue({
      ok: true,
      externalMessageId: "provider-out-quick-1",
    });
    meta.sendWhatsAppList.mockResolvedValue({
      ok: true,
      externalMessageId: "provider-out-list-1",
    });
    meta.sendWhatsApp.mockResolvedValue({
      ok: true,
      externalMessageId: "provider-out-wa-1",
    });
    web.sendText.mockResolvedValue({
      ok: true,
      externalMessageId: "waweb:primary:out-1",
    });
    web.sendPresence.mockResolvedValue({ ok: true, rawStatus: 200 });
    outbound.pull = false;
    outbound.enqueue.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000003",
      status: "queued",
      idempotencyKey: "omnichannel:auto:message-1",
      created: true,
    });
  });

  it("persists opt-out even when the channel is disabled and never calls AI", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: { text: "Не пишите мне больше" },
        settings: { enabled: false, mode: "off" },
      }),
    );

    await expect(invoke()).resolves.toMatchObject({
      action: "ignore",
      reason: "customer_opted_out",
    });
    expect(repository.markMessageIgnored).toHaveBeenCalledWith(
      "message-1",
      "customer_opted_out",
      expect.objectContaining({ suppressSends: true, muteConversation: true }),
    );
    expect(ai.generateOmnichannelReply).not.toHaveBeenCalled();
    expect(meta.sendInstagram).not.toHaveBeenCalled();
  });

  it("escalates an interrupted send recovery without calling the provider again", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: {
          status: "sending",
          aiDraft: "Уже подготовленный ответ",
          aiConfidence: 0.91,
        },
      }),
    );

    await expect(invoke()).resolves.toEqual({
      action: "escalate",
      reason: "delivery_unknown_after_interrupted_send",
    });

    expect(repository.markMessageNeedsHuman).toHaveBeenCalledWith(
      "message-1",
      "conversation-1",
      {
        draft: "Уже подготовленный ответ",
        confidence: 0.91,
        reason: "delivery_unknown_after_interrupted_send",
      },
    );
    expect(repository.markMessageProcessing).not.toHaveBeenCalled();
    expect(ai.generateOmnichannelReply).not.toHaveBeenCalled();
    expect(repository.claimMessageForAutoSend).not.toHaveBeenCalled();
    expect(repository.claimEquipmentFlowForAutoSend).not.toHaveBeenCalled();
    expect(meta.sendInstagram).not.toHaveBeenCalled();
    expect(web.sendText).not.toHaveBeenCalled();
  });

  it("leaves a send owned by a different durable run untouched", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: {
          status: "sending",
          metadata: {
            providerTimestampTrusted: true,
            sendClaimOwner: "workflow:wrun-first",
          },
        },
      }),
    );

    await expect(invokeWithStep(false, fakeStep(), {
      processing_owner: "workflow:wrun-duplicate",
    })).resolves.toEqual({
      skipped: true,
      reason: "send_owned_by_other_worker",
    });

    expect(repository.markMessageNeedsHuman).not.toHaveBeenCalled();
    expect(repository.markMessageDrafted).not.toHaveBeenCalled();
    expect(meta.sendInstagram).not.toHaveBeenCalled();
  });

  it("reconciles the same database job after its lease token rotates", async () => {
    const jobId = "00000000-0000-4000-8000-000000000099";
    repository.getMessageContext.mockResolvedValue(
      context({
        message: {
          status: "sending",
          aiDraft: "Подготовленный ответ",
          aiConfidence: 0.9,
          metadata: {
            providerTimestampTrusted: true,
            sendClaimOwner: `database-job:${jobId}:expired-lease`,
          },
        },
      }),
    );

    await expect(invokeWithStep(false, fakeStep(), {
      processing_owner: `database-job:${jobId}`,
    })).resolves.toEqual({
      action: "escalate",
      reason: "delivery_unknown_after_interrupted_send",
    });

    expect(repository.markMessageNeedsHuman).toHaveBeenCalled();
    expect(meta.sendInstagram).not.toHaveBeenCalled();
  });

  it("completes recovery when a durable pull delivery already owns the send", async () => {
    outbound.pull = true;
    repository.getMessageContext.mockResolvedValue(
      context({
        message: {
          channel: "whatsapp",
          status: "sending",
          metadata: {
            providerTimestampTrusted: true,
            transport: "whatsapp_web",
            bridgeSessionId: "primary",
            outboundDeliveryId: "00000000-0000-4000-8000-000000000003",
          },
        },
        conversation: {
          channel: "whatsapp",
          accountExternalId: "waweb:primary",
          externalId: "77001234567@s.whatsapp.net",
        },
      }),
    );

    await expect(invoke()).resolves.toMatchObject({
      action: "queued",
      delivery_id: "00000000-0000-4000-8000-000000000003",
      recovered: true,
    });
    expect(repository.markMessageNeedsHuman).not.toHaveBeenCalled();
    expect(repository.claimMessageForAutoSend).not.toHaveBeenCalled();
    expect(web.sendText).not.toHaveBeenCalled();
  });

  it("analyses media for triage but escalates instead of auto-sending", async () => {
    const mediaContext = context({
      message: { messageType: "image", text: "[WhatsApp image] Фото товара" },
    });
    repository.getMessageContext.mockResolvedValue(mediaContext);

    await expect(invoke()).resolves.toMatchObject({ action: "escalate" });
    expect(repository.markMessageNeedsHuman).toHaveBeenCalled();
    expect(repository.claimMessageForAutoSend).not.toHaveBeenCalled();
    expect(meta.sendInstagram).not.toHaveBeenCalled();
  });

  it("fails closed instead of inventing another brand when business context is empty", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({ settings: { businessContext: "" } }),
    );

    await expect(invoke()).resolves.toEqual({
      action: "escalate",
      reason: "business_context_missing",
    });
    expect(ai.generateOmnichannelReply).not.toHaveBeenCalled();
    expect(meta.sendInstagram).not.toHaveBeenCalled();
    expect(repository.markMessageNeedsHuman).toHaveBeenCalledWith(
      "message-1",
      "conversation-1",
      {
        draft: null,
        confidence: null,
        reason: "business_context_missing",
      },
    );
  });

  it("passes the unanswered burst to AI without current or failed outbound duplicates", async () => {
    const base = context({ message: { text: "Спасибо" } });
    const oldInbound = {
      ...base.message,
      id: "message-old-inbound",
      externalMessageId: "provider-old-inbound",
      text: "Старый вопрос",
    };
    const confirmedOutbound = {
      ...base.message,
      id: "message-confirmed-outbound",
      externalMessageId: "provider-confirmed-outbound",
      direction: "out",
      text: "На старый вопрос уже ответили",
      status: "sent",
      aiGenerated: false,
    };
    const substantiveInbound = {
      ...base.message,
      id: "message-substantive-inbound",
      externalMessageId: "provider-substantive-inbound",
      text: "Нужен полный комплект",
    };
    const failedOutbound = {
      ...base.message,
      id: "message-failed-outbound",
      externalMessageId: "provider-failed-outbound",
      direction: "out",
      text: "Этот текст клиент не видел",
      status: "failed",
      aiGenerated: true,
    };
    repository.getMessageContext.mockResolvedValue({
      ...base,
      history: [
        oldInbound,
        confirmedOutbound,
        substantiveInbound,
        failedOutbound,
        base.message,
      ],
    });

    await expect(invoke()).resolves.toMatchObject({ action: "send" });
    expect(ai.generateOmnichannelReply).toHaveBeenCalledWith({
      channel: "instagram",
      businessContext: base.settings.businessContext,
      currentMessage: "Спасибо",
      history: [
        expect.objectContaining({
          direction: "in",
          text: "Старый вопрос",
          actor: "customer",
        }),
        expect.objectContaining({
          direction: "out",
          text: "На старый вопрос уже ответили",
          actor: "human",
        }),
        expect.objectContaining({
          direction: "in",
          text: "Нужен полный комплект",
          actor: "customer",
        }),
      ],
    });
  });

  it("keeps a draft when the webhook account differs from the configured sender", async () => {
    repository.getMessageContext.mockResolvedValue(context());
    meta.isConfiguredMetaAccount.mockReturnValue(false);

    await expect(invoke()).resolves.toMatchObject({ action: "draft" });
    expect(repository.markMessageDrafted).toHaveBeenCalled();
    expect(repository.claimMessageForAutoSend).not.toHaveBeenCalled();
  });

  it("always keeps imported WhatsApp history as a draft even when auto mode is enabled", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: {
          channel: "whatsapp",
          status: "imported",
          metadata: {
            providerTimestampTrusted: true,
            transport: "whatsapp_web",
            catchUp: true,
          },
        },
        conversation: {
          channel: "whatsapp",
          accountExternalId: "waweb:primary",
          externalId: "77001234567@s.whatsapp.net",
        },
        contact: { channel: "whatsapp", externalId: "77001234567" },
        settings: { channel: "whatsapp", enabled: true, mode: "auto" },
      }),
    );

    await expect(invoke(true)).resolves.toMatchObject({ action: "draft" });

    expect(repository.markMessageDrafted).toHaveBeenCalledWith(
      "message-1",
      expect.objectContaining({ draft: expect.any(String) }),
    );
    expect(repository.claimMessageForAutoSend).not.toHaveBeenCalled();
    expect(repository.claimEquipmentFlowForAutoSend).not.toHaveBeenCalled();
    expect(web.sendPresence).not.toHaveBeenCalled();
    expect(web.sendText).not.toHaveBeenCalled();
    expect(meta.sendWhatsApp).not.toHaveBeenCalled();
    expect(meta.sendWhatsAppList).not.toHaveBeenCalled();
  });

  it("derives draft-only safety from imported metadata even when force_draft is missing", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: {
          channel: "whatsapp",
          status: "imported",
          metadata: {
            providerTimestampTrusted: true,
            transport: "whatsapp_web",
            catchUp: true,
            live: false,
          },
        },
        conversation: {
          channel: "whatsapp",
          accountExternalId: "waweb:primary",
          externalId: "77001234567@s.whatsapp.net",
        },
        contact: { channel: "whatsapp", externalId: "77001234567" },
        settings: { channel: "whatsapp", enabled: true, mode: "auto" },
      }),
    );

    await expect(invoke(false)).resolves.toMatchObject({ action: "draft" });
    expect(repository.markMessageDrafted).toHaveBeenCalled();
    expect(repository.claimMessageForAutoSend).not.toHaveBeenCalled();
    expect(repository.claimEquipmentFlowForAutoSend).not.toHaveBeenCalled();
    expect(web.sendText).not.toHaveBeenCalled();
    expect(meta.sendWhatsApp).not.toHaveBeenCalled();
  });

  it("adds one natural apology to a fresh follow-up after an unanswered two-hour gap", async () => {
    const current = context();
    const earlier = {
      ...current.message,
      id: "message-earlier",
      externalMessageId: "provider-earlier",
      status: "imported",
      text: "Здравствуйте",
      metadata: {
        providerTimestampTrusted: true,
        catchUp: true,
        live: false,
      },
      occurredAt: new Date(new Date(now).getTime() - 2 * 60 * 60 * 1_000).toISOString(),
    };
    repository.getMessageContext.mockResolvedValue({
      ...current,
      history: [earlier, current.message],
    });

    await expect(invoke()).resolves.toMatchObject({ action: "send" });
    expect(meta.sendInstagram).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringMatching(/^Извините, что ответили не сразу\.\n\n/u),
      }),
    );
    expect(repository.logOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          delayedReplyApologyIncluded: true,
          delayedReplyUnansweredAgeMinutes: 120,
        }),
      }),
    );
    expect(repository.markMessageReplied).toHaveBeenCalledWith(
      "message-1",
      expect.objectContaining({ reason: "safe_auto_reply_delayed_apology" }),
    );
  });

  it("does not repeat a confirmed delay apology on a later unanswered episode", async () => {
    const current = context();
    const apology = {
      ...current.message,
      id: "message-apology",
      externalMessageId: "provider-apology",
      direction: "out",
      status: "sent",
      text: "Извините, что ответили не сразу.\n\nЧем помочь?",
      metadata: { delayedReplyApologyIncluded: true },
      occurredAt: new Date(new Date(now).getTime() - 4 * 60 * 60 * 1_000).toISOString(),
    };
    const earlier = {
      ...current.message,
      id: "message-earlier",
      externalMessageId: "provider-earlier",
      status: "imported",
      text: "Подскажите по экипировке",
      metadata: {
        providerTimestampTrusted: true,
        catchUp: true,
        live: false,
      },
      occurredAt: new Date(new Date(now).getTime() - 2 * 60 * 60 * 1_000).toISOString(),
    };
    repository.getMessageContext.mockResolvedValue({
      ...current,
      history: [apology, earlier, current.message],
    });

    await expect(invoke()).resolves.toMatchObject({ action: "send" });
    expect(meta.sendInstagram).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Начните с mini-GRI в личном кабинете." }),
    );
    expect(repository.logOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.not.objectContaining({
          delayedReplyApologyIncluded: true,
        }),
      }),
    );
  });

  it("never auto-sends another manager link after a confirmed equipment handoff", async () => {
    const current = context({
      message: { text: "Позовите менеджера" },
      settings: { automationConfig: equipmentAutomationConfig() },
    });
    const priorHandoff = {
      ...current.message,
      id: "message-prior-handoff",
      externalMessageId: "provider-prior-handoff",
      direction: "out",
      status: "sent",
      text: "Напишите менеджеру: https://wa.me/77054057775",
      metadata: { catchUp: true, fromMe: true },
      occurredAt: new Date(new Date(now).getTime() - 60 * 60 * 1_000).toISOString(),
    };
    repository.getMessageContext.mockResolvedValue({
      ...current,
      history: [priorHandoff, current.message],
    });

    await expect(invoke()).resolves.toMatchObject({ action: "escalate" });
    expect(repository.markMessageNeedsHuman).toHaveBeenCalled();
    expect(repository.claimMessageForAutoSend).not.toHaveBeenCalled();
    expect(repository.claimEquipmentFlowForAutoSend).not.toHaveBeenCalled();
    expect(meta.sendInstagram).not.toHaveBeenCalled();
    expect(meta.sendInstagramQuickReplies).not.toHaveBeenCalled();
  });

  it("hands a fresh follow-up with 72-hour unanswered context to a person", async () => {
    const current = context();
    const earlier = {
      ...current.message,
      id: "message-earlier",
      externalMessageId: "provider-earlier",
      status: "imported",
      text: "Здравствуйте",
      metadata: {
        providerTimestampTrusted: true,
        catchUp: true,
        live: false,
      },
      occurredAt: new Date(new Date(now).getTime() - 72 * 60 * 60 * 1_000).toISOString(),
    };
    repository.getMessageContext.mockResolvedValue({
      ...current,
      history: [earlier, current.message],
    });

    await expect(invoke()).resolves.toEqual({
      action: "escalate",
      reason: "very_stale_unanswered_context",
    });
    expect(repository.markMessageNeedsHuman).toHaveBeenCalledWith(
      "message-1",
      "conversation-1",
      expect.objectContaining({
        draft: expect.stringMatching(/^Извините, что ответили не сразу\./u),
        reason: "very_stale_unanswered_context",
      }),
    );
    expect(repository.claimMessageForAutoSend).not.toHaveBeenCalled();
    expect(meta.sendInstagram).not.toHaveBeenCalled();
  });

  it("keeps a live WhatsApp message older than 24 hours as a draft", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: {
          channel: "whatsapp",
          occurredAt: new Date(Date.now() - 25 * 60 * 60 * 1_000).toISOString(),
          metadata: {
            providerTimestampTrusted: true,
            transport: "whatsapp_web",
            live: true,
          },
        },
        conversation: {
          channel: "whatsapp",
          accountExternalId: "waweb:primary",
          externalId: "77001234567@s.whatsapp.net",
        },
        contact: { channel: "whatsapp", externalId: "77001234567" },
        settings: { channel: "whatsapp", enabled: true, mode: "auto" },
      }),
    );

    await expect(invoke()).resolves.toEqual({
      action: "draft",
      reason: "whatsapp_template_required_outside_24h",
    });
    expect(repository.claimMessageForAutoSend).not.toHaveBeenCalled();
    expect(web.sendText).not.toHaveBeenCalled();
  });

  it("preserves the configured reply delay for legacy events", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-15T10:00:00.000Z");
    try {
      repository.getMessageContext.mockResolvedValue(
        context({
          message: { occurredAt: "2026-07-15T10:00:00.000Z" },
          settings: { replyDelaySeconds: 9 },
        }),
      );
      const step = fakeStep();

      await expect(invokeWithStep(false, step)).resolves.toMatchObject({
        action: "send",
      });

      expect(step.run).toHaveBeenCalledWith(
        "resolve-reply-delay-deadline",
        expect.any(Function),
      );
      expect(step.sleepUntil).toHaveBeenCalledWith(
        "configured-reply-delay",
        "2026-07-15T10:00:09.000Z",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits only the remainder of the quiet window when an Inngest event starts late", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-15T10:00:20.000Z");
    try {
      repository.getMessageContext.mockResolvedValue(
        context({
          message: {
            occurredAt: "2026-07-15T10:00:05.000Z",
            metadata: {
              providerTimestampTrusted: true,
              ingestedAt: "2026-07-15T10:00:05.000Z",
            },
          },
          settings: { replyDelaySeconds: 20 },
        }),
      );
      const step = fakeStep();

      await expect(invokeWithStep(false, step)).resolves.toMatchObject({
        action: "send",
      });

      expect(step.sleepUntil).toHaveBeenCalledWith(
        "configured-reply-delay",
        "2026-07-15T10:00:25.000Z",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("supersedes an older burst event after the quiet window and never calls AI", async () => {
    const first = context({ settings: { replyDelaySeconds: 20 } });
    const newerMessage = {
      ...first.message,
      id: "message-2",
      externalMessageId: "provider-in-2",
      text: "И ещё нужен размер 52",
      occurredAt: new Date(Date.now() + 1_000).toISOString(),
    };
    repository.getMessageContext
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({
        ...first,
        history: [first.message, newerMessage],
        newestInboundMessageId: newerMessage.id,
      });
    const step = fakeStep();

    await expect(invokeWithStep(false, step)).resolves.toEqual({
      action: "ignore",
      reason: "superseded_by_newer_message",
    });

    expect(repository.markMessageSuperseded).toHaveBeenCalledWith("message-1");
    expect(ai.generateOmnichannelReply).not.toHaveBeenCalled();
    expect(repository.claimMessageForAutoSend).not.toHaveBeenCalled();
  });

  it("skips the configured reply delay after a durable queue run_at has applied it", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        settings: { replyDelaySeconds: 9 },
      }),
    );
    const step = fakeStep();

    await expect(
      invokeWithStep(false, step, { delay_already_applied: true }),
    ).resolves.toMatchObject({ action: "send" });

    expect(step.sleepUntil).not.toHaveBeenCalled();
  });

  it("skips the configured reply delay for forced historical drafts", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: { status: "imported" },
        settings: { replyDelaySeconds: 9 },
      }),
    );
    const step = fakeStep();

    await expect(invokeWithStep(true, step)).resolves.toMatchObject({
      action: "draft",
    });

    expect(step.sleepUntil).not.toHaveBeenCalled();
  });

  it("never automatically retries an ambiguous provider timeout", async () => {
    repository.getMessageContext.mockResolvedValue(context());
    meta.sendInstagram.mockResolvedValue({
      ok: false,
      status: null,
      code: "timeout",
      message: "timed out",
      retryable: true,
    });

    await expect(invoke()).resolves.toMatchObject({ action: "escalate" });
    expect(meta.sendInstagram).toHaveBeenCalledTimes(1);
    expect(repository.claimMessageForAutoSend).toHaveBeenCalledTimes(1);
    expect(repository.markMessageNeedsHuman).toHaveBeenCalledWith(
      "message-1",
      "conversation-1",
      expect.objectContaining({
        reason: expect.stringContaining("ambiguous_"),
      }),
    );
  });

  it("never repeats a provider POST when the same execution already acquired the send claim", async () => {
    repository.getMessageContext.mockResolvedValue(context());
    repository.claimMessageForAutoSend.mockResolvedValueOnce({
      claimed: false,
      reason: "send_claim_already_acquired",
    });

    await expect(invokeWithStep(false, fakeStep(), {
      processing_owner: "inngest:event-1",
    })).resolves.toEqual({
      action: "escalate",
      reason: "delivery_unknown_after_interrupted_send",
    });

    expect(meta.sendInstagram).not.toHaveBeenCalled();
    expect(repository.markMessageNeedsHuman).toHaveBeenCalledWith(
      "message-1",
      "conversation-1",
      expect.objectContaining({
        reason: "delivery_unknown_after_interrupted_send",
      }),
    );
  });

  it("cancels send when a newer message appears during AI generation", async () => {
    const first = context();
    const outbound = {
      ...first.message,
      id: "operator-out-1",
      direction: "out",
      text: "Уже ответили",
    };
    const second = context({ history: [first.message, outbound] });
    repository.getMessageContext
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await expect(invoke()).resolves.toMatchObject({ action: "ignore" });
    expect(repository.claimMessageForAutoSend).not.toHaveBeenCalled();
    expect(meta.sendInstagram).not.toHaveBeenCalled();
  });

  it("uses a concise deterministic Instagram welcome before showing choices", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: { text: "Здравствуйте" },
        settings: { automationConfig: equipmentAutomationConfig() },
      }),
    );

    await expect(invoke()).resolves.toMatchObject({ action: "send" });
    expect(ai.generateOmnichannelReply).not.toHaveBeenCalled();
    expect(meta.sendInstagram).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "contact-1",
        text: expect.stringContaining("Вы из какого города?"),
      }),
    );
    expect(meta.sendInstagramQuickReplies).not.toHaveBeenCalled();
    expect(repository.logOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "text",
        metadata: expect.objectContaining({
          source: "omnichannel_equipment_sales_flow",
          equipmentFlowStage: "welcome",
        }),
      }),
    );
    expect(repository.claimEquipmentFlowForAutoSend).toHaveBeenCalledTimes(1);
    expect(repository.claimMessageForAutoSend).not.toHaveBeenCalled();
    expect(repository.finalizeEquipmentFlowReply).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "welcome",
        communityIncluded: false,
      }),
    );
  });

  it("uses a concise WhatsApp text welcome before showing choices", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: { channel: "whatsapp", text: "Здравствуйте" },
        conversation: {
          channel: "whatsapp",
          accountExternalId: "wa-phone-number-1",
        },
        contact: { channel: "whatsapp", externalId: "77001234567" },
        settings: {
          channel: "whatsapp",
          automationConfig: equipmentAutomationConfig(),
        },
      }),
    );

    await expect(invoke()).resolves.toMatchObject({
      action: "send",
      channel: "whatsapp",
    });
    expect(ai.generateOmnichannelReply).not.toHaveBeenCalled();
    expect(meta.sendWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "77001234567",
        text: expect.stringContaining("Вы из какого города?"),
      }),
    );
    expect(meta.sendWhatsAppList).not.toHaveBeenCalled();
    expect(repository.logOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "whatsapp",
        messageType: "text",
      }),
    );
    expect(web.sendPresence).not.toHaveBeenCalled();
  });

  it("shows a bounded typing pause before claiming and sending a Web auto-reply", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: {
          channel: "whatsapp",
          metadata: {
            providerTimestampTrusted: true,
            transport: "whatsapp_web",
            bridgeSessionId: "primary",
            bridgeMessageId: "raw-in-1",
          },
        },
        conversation: {
          channel: "whatsapp",
          accountExternalId: "waweb:primary",
          externalId: "77001234567@s.whatsapp.net",
        },
        contact: { channel: "whatsapp", externalId: "77001234567" },
        settings: { channel: "whatsapp", replyDelaySeconds: 30 },
      }),
    );
    const step = fakeStep();

    await expect(
      invokeWithStep(false, step, { delay_already_applied: true }),
    ).resolves.toMatchObject({ action: "send" });

    expect(step.sleepUntil).not.toHaveBeenCalled();
    expect(web.sendPresence).toHaveBeenNthCalledWith(1, {
      recipientId: "77001234567@s.whatsapp.net",
      accountExternalId: "waweb:primary",
      presence: "composing",
    });
    expect(step.sleep).toHaveBeenCalledWith(
      "human-whatsapp-typing-delay",
      expect.stringMatching(/^[2-6]s$/),
    );
    expect(web.sendPresence).toHaveBeenNthCalledWith(2, {
      recipientId: "77001234567@s.whatsapp.net",
      accountExternalId: "waweb:primary",
      presence: "paused",
    });
    expect(web.sendPresence.mock.invocationCallOrder[0]).toBeLessThan(
      step.sleep.mock.invocationCallOrder[0],
    );
    expect(step.sleep.mock.invocationCallOrder[0]).toBeLessThan(
      web.sendPresence.mock.invocationCallOrder[1],
    );
    expect(web.sendPresence.mock.invocationCallOrder[1]).toBeLessThan(
      repository.claimMessageForAutoSend.mock.invocationCallOrder[0],
    );
    expect(web.sendText).toHaveBeenCalledTimes(1);
  });

  it("queues Web pull delivery and leaves finalization to the fenced result RPC", async () => {
    outbound.pull = true;
    vi.stubEnv("WHATSAPP_WEB_BRIDGE_ENABLED", "true");
    vi.stubEnv("WHATSAPP_WEB_BRIDGE_SESSION_ID", "primary");
    repository.getMessageContext.mockResolvedValue(
      context({
        message: {
          channel: "whatsapp",
          metadata: {
            providerTimestampTrusted: true,
            transport: "whatsapp_web",
            bridgeSessionId: "primary",
            bridgeMessageId: "raw-in-1",
          },
        },
        conversation: {
          channel: "whatsapp",
          accountExternalId: "waweb:primary",
          externalId: "77001234567@s.whatsapp.net",
        },
        contact: { channel: "whatsapp", externalId: "77001234567" },
        settings: { channel: "whatsapp" },
      }),
    );

    await expect(invoke()).resolves.toMatchObject({
      action: "queued",
      delivery_id: "00000000-0000-4000-8000-000000000003",
    });
    expect(outbound.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        sourceInboundMessageId: "message-1",
        sessionId: "primary",
        finalization: expect.objectContaining({ kind: "auto" }),
      }),
    );
    expect(web.sendPresence).not.toHaveBeenCalled();
    expect(web.sendText).not.toHaveBeenCalled();
    expect(repository.logOutboundMessage).not.toHaveBeenCalled();
    expect(repository.markMessageReplied).not.toHaveBeenCalled();
  });

  it("claims atomically after typing and cancels a stale Web reply", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: {
          channel: "whatsapp",
          metadata: {
            providerTimestampTrusted: true,
            transport: "whatsapp_web",
            bridgeMessageId: "raw-in-1",
          },
        },
        conversation: {
          channel: "whatsapp",
          accountExternalId: "waweb:primary",
          externalId: "77001234567@s.whatsapp.net",
        },
        settings: { channel: "whatsapp" },
      }),
    );
    repository.claimMessageForAutoSend.mockResolvedValueOnce({
      claimed: false,
      reason: "superseded_by_newer_message",
    });

    await expect(invoke()).resolves.toMatchObject({
      action: "ignore",
      reason: expect.stringContaining("superseded_by_newer_message"),
    });

    expect(web.sendPresence).toHaveBeenCalledTimes(2);
    expect(web.sendText).not.toHaveBeenCalled();
    expect(repository.markMessageSuperseded).toHaveBeenCalled();
  });

  it("still sends when transient Web presence is unavailable", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: {
          channel: "whatsapp",
          metadata: {
            providerTimestampTrusted: true,
            transport: "whatsapp_web",
            bridgeMessageId: "raw-in-1",
          },
        },
        conversation: {
          channel: "whatsapp",
          accountExternalId: "waweb:primary",
          externalId: "77001234567@s.whatsapp.net",
        },
        settings: { channel: "whatsapp" },
      }),
    );
    web.sendPresence.mockRejectedValue(new Error("presence unavailable"));

    await expect(invoke()).resolves.toMatchObject({ action: "send" });
    expect(web.sendPresence).toHaveBeenCalledTimes(2);
    expect(web.sendText).toHaveBeenCalledTimes(1);
  });

  it("does not show typing for a Web conversation in draft mode", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: {
          channel: "whatsapp",
          metadata: {
            providerTimestampTrusted: true,
            transport: "whatsapp_web",
          },
        },
        conversation: {
          channel: "whatsapp",
          accountExternalId: "waweb:primary",
          externalId: "77001234567@s.whatsapp.net",
        },
        settings: { channel: "whatsapp", mode: "draft" },
      }),
    );

    await expect(invoke()).resolves.toMatchObject({ action: "draft" });
    expect(web.sendPresence).not.toHaveBeenCalled();
    expect(web.sendText).not.toHaveBeenCalled();
  });

  it("sends the concise Web welcome as idempotent plain text to the conversation JID", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: {
          channel: "whatsapp",
          text: "Здравствуйте",
          metadata: {
            providerTimestampTrusted: true,
            transport: "whatsapp_web",
            bridgeSessionId: "primary",
            bridgeMessageId: "raw-in-1",
          },
        },
        conversation: {
          channel: "whatsapp",
          accountExternalId: "waweb:primary",
          externalId: "77001234567@s.whatsapp.net",
        },
        contact: { channel: "whatsapp", externalId: "77001234567" },
        settings: {
          channel: "whatsapp",
          automationConfig: equipmentAutomationConfig(),
        },
      }),
    );

    await expect(invoke()).resolves.toMatchObject({
      action: "send",
      channel: "whatsapp",
      external_message_id: "waweb:primary:out-1",
    });
    expect(web.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "77001234567@s.whatsapp.net",
        accountExternalId: "waweb:primary",
        replyToExternalId: "raw-in-1",
        idempotencyKey: "omnichannel:auto:message-1",
        text: "Добрый день! Вы из какого города?",
      }),
    );
    expect(meta.sendWhatsAppList).not.toHaveBeenCalled();
    expect(repository.logOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "whatsapp",
        messageType: "text",
        metadata: expect.objectContaining({
          transport: "whatsapp_web",
          bridgeSessionId: "primary",
        }),
      }),
    );
  });

  it("sends the configured manager link through WhatsApp and completes handoff", async () => {
    const current = context({
      message: {
        channel: "whatsapp",
        text: "Открыть каталог",
        messageType: "interactive",
        metadata: {
          providerTimestampTrusted: true,
          interactiveId: "equipment_v1:interest:catalog",
        },
      },
      conversation: {
        channel: "whatsapp",
        accountExternalId: "wa-phone-number-1",
      },
      contact: { channel: "whatsapp", externalId: "77001234567" },
      settings: {
        channel: "whatsapp",
        automationConfig: equipmentAutomationConfig(),
      },
    });
    const welcome = {
      ...current.message,
      id: "message-welcome",
      externalMessageId: "provider-welcome",
      direction: "out",
      messageType: "interactive",
      text: "Добрый день!",
      status: "sent",
      metadata: {
        source: "omnichannel_equipment_sales_flow",
        equipmentFlowStage: "welcome",
        equipmentFlowCommunityIncluded: true,
      },
    };
    const city = {
      ...current.message,
      id: "message-city",
      externalMessageId: "provider-city",
      messageType: "text",
      text: "Өскемен",
      status: "replied",
      metadata: { providerTimestampTrusted: true },
    };
    repository.getMessageContext.mockResolvedValue({
      ...current,
      history: [welcome, city, current.message],
    });

    await expect(invoke()).resolves.toMatchObject({
      action: "send",
      channel: "whatsapp",
      handoff: true,
    });
    expect(meta.sendWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "77001234567",
        text: expect.stringContaining("https://wa.me/77714057775"),
        replyToExternalId: "provider-in-1",
      }),
    );
    expect(repository.finalizeEquipmentFlowReply).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "routed",
        cityRouteId: "ust_kamenogorsk",
        choiceId: "catalog",
        managerUrl: "https://wa.me/77714057775",
      }),
    );
  });

  it("keeps the equipment answer as a draft when the channel is in draft mode", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: { text: "Здравствуйте" },
        settings: {
          mode: "draft",
          automationConfig: equipmentAutomationConfig(),
        },
      }),
    );

    await expect(invoke()).resolves.toMatchObject({ action: "draft" });
    expect(ai.generateOmnichannelReply).not.toHaveBeenCalled();
    expect(repository.markMessageDrafted).toHaveBeenCalledWith(
      "message-1",
      expect.objectContaining({
        draft: expect.stringContaining("Вы из какого города?"),
      }),
    );
    expect(repository.claimEquipmentFlowForAutoSend).not.toHaveBeenCalled();
    expect(meta.sendInstagramQuickReplies).not.toHaveBeenCalled();
  });

  it("cancels a deterministic send when the flow is disabled during processing", async () => {
    const first = context({
      message: { text: "Здравствуйте" },
      settings: { automationConfig: equipmentAutomationConfig() },
    });
    const disabledConfig = equipmentAutomationConfig();
    disabledConfig.equipment_sales_flow.enabled = false;
    const second = {
      ...first,
      settings: {
        ...first.settings,
        automationConfig: disabledConfig,
        updatedAt: new Date(Date.now() + 1_000).toISOString(),
      },
    };
    repository.getMessageContext
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await expect(invoke()).resolves.toEqual({
      action: "draft",
      reason: "equipment_flow_configuration_changed",
    });
    expect(repository.claimEquipmentFlowForAutoSend).not.toHaveBeenCalled();
    expect(meta.sendInstagramQuickReplies).not.toHaveBeenCalled();
  });

  it("keeps a draft when the final equipment-flow claim is denied", async () => {
    repository.getMessageContext.mockResolvedValue(
      context({
        message: { text: "Здравствуйте" },
        settings: { automationConfig: equipmentAutomationConfig() },
      }),
    );
    repository.claimEquipmentFlowForAutoSend.mockResolvedValueOnce({
      claimed: false,
      reason: "equipment_flow_configuration_changed",
    });

    await expect(invoke()).resolves.toMatchObject({
      action: "draft",
      reason: expect.stringContaining("equipment_flow_configuration_changed"),
    });
    expect(meta.sendInstagramQuickReplies).not.toHaveBeenCalled();
    expect(repository.markMessageDrafted).toHaveBeenCalled();
  });

  it("escalates when an earlier message in the active burst contains a complaint", async () => {
    const current = context({
      message: { text: "Да, на лето" },
      settings: { automationConfig: equipmentAutomationConfig() },
    });
    const complaint = {
      ...current.message,
      id: "message-complaint",
      externalMessageId: "provider-complaint",
      text: "Хочу подать жалобу",
    };
    const city = {
      ...current.message,
      id: "message-city",
      externalMessageId: "provider-city",
      text: "Астана",
    };
    repository.getMessageContext.mockResolvedValue({
      ...current,
      history: [complaint, city, current.message],
    });

    await expect(invoke()).resolves.toMatchObject({ action: "escalate" });
    expect(ai.generateOmnichannelReply).toHaveBeenCalled();
    expect(repository.markMessageNeedsHuman).toHaveBeenCalled();
    expect(repository.claimEquipmentFlowForAutoSend).not.toHaveBeenCalled();
    expect(meta.sendInstagram).not.toHaveBeenCalled();
  });

  it("does not label local validation failures as ambiguous provider sends", async () => {
    repository.getMessageContext.mockResolvedValue(context());
    meta.sendInstagram.mockResolvedValue({
      ok: false,
      status: null,
      code: "invalid_input",
      message: "invalid local payload",
      retryable: false,
    });

    await expect(invoke()).resolves.toMatchObject({ action: "escalate" });
    expect(repository.markMessageNeedsHuman).toHaveBeenCalledWith(
      "message-1",
      "conversation-1",
      expect.objectContaining({
        reason: expect.not.stringContaining("ambiguous_"),
      }),
    );
  });

  it("routes a selected interest to the city manager and hands the conversation to a person", async () => {
    const current = context({
      message: {
        text: "Да, на лето",
        messageType: "interactive",
        metadata: {
          providerTimestampTrusted: true,
          interactiveId: "equipment_v1:interest:summer",
        },
      },
      settings: { automationConfig: equipmentAutomationConfig() },
    });
    const cityMessage = {
      ...current.message,
      id: "message-city",
      externalMessageId: "provider-city",
      text: "Астана",
      messageType: "text",
      status: "replied",
      metadata: { providerTimestampTrusted: true },
    };
    const welcomeMessage = {
      ...current.message,
      id: "message-welcome",
      externalMessageId: "provider-welcome",
      direction: "out",
      text: "Добрый день!\nhttps://chat.whatsapp.com/JDaVNsnloFMF0RpOtLSDRW?mode=gi_t",
      status: "sent",
      metadata: {
        source: "omnichannel_equipment_sales_flow",
        equipmentFlowStage: "welcome",
        equipmentFlowCommunityIncluded: true,
      },
    };
    const routedContext = {
      ...current,
      history: [welcomeMessage, cityMessage, current.message],
    };
    repository.getMessageContext.mockResolvedValue(routedContext);

    await expect(invoke()).resolves.toMatchObject({
      action: "send",
      handoff: true,
    });
    expect(ai.generateOmnichannelReply).not.toHaveBeenCalled();
    expect(meta.sendInstagram).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("https://wa.me/77054057775"),
      }),
    );
    expect(meta.sendInstagramQuickReplies).not.toHaveBeenCalled();
    expect(repository.finalizeEquipmentFlowReply).toHaveBeenCalledWith({
      messageId: "message-1",
      conversationId: "conversation-1",
      stage: "routed",
      cityRouteId: "astana",
      cityLabel: "Астана",
      choiceId: "summer",
      choiceLabel: "Да, на лето",
      managerUrl: "https://wa.me/77054057775",
      communityIncluded: false,
      reason: "safe_auto_reply",
    });
  });
});

function equipmentAutomationConfig() {
  return {
    equipment_sales_flow: {
      version: 1,
      opt_in_revision: 1,
      enabled: true,
      messages: {
        welcome: "Добрый день! Вы из какого города?",
        ask_city: "Подскажите, пожалуйста, из какого Вы города?",
        ask_interest: "Спасибо! Что Вас интересует?",
        options_prompt: "Выберите вариант:",
        handoff: "Подключаю к Вам менеджера 🙋‍♂️",
      },
      choices: [
        { id: "summer", label: "Да, на лето", button_label: "Да, на лето" },
        {
          id: "autumn_winter",
          label: "Да, осень-зима",
          button_label: "Да, осень-зима",
        },
        {
          id: "catalog",
          label: "Хочу ознакомиться с каталогом",
          button_label: "Открыть каталог",
        },
        { id: "beginner", label: "Я-новичок", button_label: "Я-новичок" },
        {
          id: "manager",
          label: "Позовите менеджера",
          button_label: "Позовите менеджера",
        },
      ],
      city_routes: [
        {
          id: "astana",
          label: "Астана",
          aliases: ["астана"],
          manager_phone: "77054057775",
        },
        {
          id: "ust_kamenogorsk",
          label: "Усть-Каменогорск",
          aliases: ["усть-каменогорск", "өскемен"],
          manager_phone: "77714057775",
        },
        {
          id: "other",
          label: "Другой город",
          aliases: ["другой город"],
          manager_phone: "77714057775",
        },
      ],
      fallback_route_id: "other",
      community: {
        text: "Присоединяйтесь в чат, здесь будем публиковать все новинки и акции",
        url: "https://chat.whatsapp.com/JDaVNsnloFMF0RpOtLSDRW?mode=gi_t",
      },
    },
  };
}
