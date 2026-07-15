import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({ create: vi.fn() }));
const postgres = vi.hoisted(() => ({
  enabled: vi.fn(),
  claim: vi.fn(),
  claimEquipment: vi.fn(),
  finalizeEquipment: vi.fn(),
  getContext: vi.fn(),
  listImportedHistory: vi.fn(),
  logOutbound: vi.fn(),
  markIgnored: vi.fn(),
  markNeedsHuman: vi.fn(),
  markOutcome: vi.fn(),
  markProcessing: vi.fn(),
  persistAnalysis: vi.fn(),
}));

vi.mock("@/lib/supabase-service", () => ({
  createServiceClient: service.create,
}));
vi.mock("@/lib/omnichannel/development-postgres", () => ({
  shouldUseDevelopmentPostgres: postgres.enabled,
  claimMessageForAutoSendViaPostgres: postgres.claim,
  claimEquipmentFlowForAutoSendViaPostgres: postgres.claimEquipment,
  finalizeEquipmentFlowReplyViaPostgres: postgres.finalizeEquipment,
  getMessageContextViaPostgres: postgres.getContext,
  listImportedWhatsAppHistoryForDraftViaPostgres: postgres.listImportedHistory,
  logOutboundMessageViaPostgres: postgres.logOutbound,
  markMessageIgnoredViaPostgres: postgres.markIgnored,
  markMessageNeedsHumanViaPostgres: postgres.markNeedsHuman,
  markMessageOutcomeViaPostgres: postgres.markOutcome,
  markMessageProcessingViaPostgres: postgres.markProcessing,
  persistAiAnalysisViaPostgres: postgres.persistAnalysis,
}));

import {
  claimWebhookEventForProcessing,
  claimMessageForAutoSend,
  listImportedWhatsAppHistoryForDraft,
  markMessageReplied,
} from "@/lib/omnichannel/repository";

describe("omnichannel repository development fallback routing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("routes a claim and an outcome to direct Postgres when the fallback is enabled", async () => {
    postgres.enabled.mockReturnValue(true);
    postgres.claim.mockResolvedValue({ claimed: true, reason: "claimed" });

    await expect(claimMessageForAutoSend("message-1")).resolves.toEqual({
      claimed: true,
      reason: "claimed",
    });
    await markMessageReplied("message-1", {
      draft: "Ответ",
      confidence: 0.95,
      reason: "safe_auto_reply",
    });

    expect(postgres.claim).toHaveBeenCalledWith("message-1");
    expect(postgres.markOutcome).toHaveBeenCalledWith("message-1", "replied", {
      draft: "Ответ",
      confidence: 0.95,
      reason: "safe_auto_reply",
    });
    expect(service.create).not.toHaveBeenCalled();
  });

  it("lists imported QR history through the bounded development fallback", async () => {
    postgres.enabled.mockReturnValue(true);
    postgres.listImportedHistory.mockResolvedValue([
      {
        messageId: "history-1",
        conversationId: "conversation-1",
      },
    ]);

    await expect(listImportedWhatsAppHistoryForDraft(1_000)).resolves.toEqual([
      {
        messageId: "history-1",
        conversationId: "conversation-1",
      },
    ]);

    expect(postgres.listImportedHistory).toHaveBeenCalledWith(100);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("applies the same imported QR-only filters on the production repository path", async () => {
    postgres.enabled.mockReturnValue(false);
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.contains = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(async () => ({
      data: [{ id: "history-1", conversation_id: "conversation-1" }],
      error: null,
    }));
    const from = vi.fn(() => chain);
    service.create.mockReturnValue({ from });

    await expect(listImportedWhatsAppHistoryForDraft(200)).resolves.toEqual([
      {
        messageId: "history-1",
        conversationId: "conversation-1",
      },
    ]);

    expect(from).toHaveBeenCalledWith("omnichannel_messages");
    expect(chain.eq).toHaveBeenNthCalledWith(1, "channel", "whatsapp");
    expect(chain.eq).toHaveBeenNthCalledWith(2, "direction", "in");
    expect(chain.eq).toHaveBeenNthCalledWith(3, "status", "imported");
    expect(chain.is).toHaveBeenCalledWith("ai_draft", null);
    expect(chain.contains).toHaveBeenCalledWith("metadata", {
      transport: "whatsapp_web",
      catchUp: true,
    });
    expect(chain.limit).toHaveBeenCalledWith(100);
    expect(postgres.listImportedHistory).not.toHaveBeenCalled();
  });

  it("keeps the existing Supabase RPC path when direct Postgres is disabled", async () => {
    postgres.enabled.mockReturnValue(false);
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { claimed: true, reason: "claimed" },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ maybeSingle });
    service.create.mockReturnValue({ rpc });

    await expect(claimMessageForAutoSend("message-2")).resolves.toEqual({
      claimed: true,
      reason: "claimed",
    });

    expect(rpc).toHaveBeenCalledWith("claim_omnichannel_auto_send", {
      p_message_id: "message-2",
    });
    expect(postgres.claim).not.toHaveBeenCalled();
  });

  it("uses the leased webhook claim RPC and fails closed on an unowned event", async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { claimed: true }, error: null })
      .mockResolvedValueOnce({ data: { claimed: false }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const rpc = vi.fn().mockReturnValue({ maybeSingle });
    const client = { rpc } as never;

    await expect(
      claimWebhookEventForProcessing("event-1", client),
    ).resolves.toBe(true);
    await expect(
      claimWebhookEventForProcessing("event-2", client),
    ).resolves.toBe(false);
    await expect(
      claimWebhookEventForProcessing("event-missing", client),
    ).resolves.toBe(false);

    expect(rpc).toHaveBeenNthCalledWith(1, "claim_omnichannel_webhook_event", {
      p_event_id: "event-1",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "claim_omnichannel_webhook_event", {
      p_event_id: "event-2",
    });
  });

  it("surfaces a leased webhook claim RPC error", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "rpc unavailable" },
    });
    const client = { rpc: vi.fn().mockReturnValue({ maybeSingle }) } as never;

    await expect(
      claimWebhookEventForProcessing("event-1", client),
    ).rejects.toThrow("claim webhook event for processing: rpc unavailable");
  });

  it("fails closed when neither the development fallback nor service client is available", async () => {
    postgres.enabled.mockReturnValue(false);
    service.create.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
    });

    await expect(claimMessageForAutoSend("message-3")).rejects.toThrow(
      "SUPABASE_SERVICE_ROLE_KEY is not configured",
    );
    expect(postgres.claim).not.toHaveBeenCalled();
  });
});
