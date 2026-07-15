import { beforeEach, describe, expect, it, vi } from "vitest";

const outbound = vi.hoisted(() => ({ enqueue: vi.fn() }));
const web = vi.hoisted(() => ({ createClient: vi.fn(), configured: vi.fn() }));

vi.mock("@/lib/omnichannel/outbound-deliveries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/omnichannel/outbound-deliveries")>();
  return {
    ...actual,
    isWhatsAppWebPullDeliveryEnabled: () => true,
    whatsappWebDeliveryMode: () => "pull",
    enqueueOutboundDelivery: outbound.enqueue,
  };
});
vi.mock("@/lib/omnichannel/postgres-runtime", () => ({
  shouldUseOmnichannelPostgres: () => true,
}));
vi.mock("@/lib/omnichannel/whatsapp-web-client", () => ({
  createWhatsAppWebClient: web.createClient,
  isConfiguredWhatsAppWebAccount: web.configured,
}));
vi.mock("@/lib/omnichannel/meta-client", () => ({
  createMetaClient: vi.fn(),
  isConfiguredMetaAccount: vi.fn(),
}));

import {
  dispatchOmnichannelReply,
  isConfiguredOmnichannelSender,
} from "@/lib/omnichannel/transport-dispatch";

describe("WhatsApp Web pull transport dispatch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("WHATSAPP_WEB_BRIDGE_ENABLED", "true");
    vi.stubEnv("WHATSAPP_WEB_BRIDGE_SESSION_ID", "primary");
    outbound.enqueue.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000003",
      status: "queued",
      idempotencyKey: "omnichannel:auto:message-1",
      created: true,
    });
  });

  it("validates the configured session without requiring a public bridge URL", () => {
    expect(
      isConfiguredOmnichannelSender({
        channel: "whatsapp",
        metadata: { transport: "whatsapp_web", bridgeSessionId: "primary" },
        accountExternalId: "waweb:primary",
      }),
    ).toBe(true);
    expect(web.configured).not.toHaveBeenCalled();
  });

  it("queues the canonical payload and never calls the direct Web client", async () => {
    await expect(
      dispatchOmnichannelReply({
        channel: "whatsapp",
        metadata: {
          transport: "whatsapp_web",
          bridgeSessionId: "primary",
          bridgeMessageId: "raw-in-1",
        },
        accountExternalId: "waweb:primary",
        conversationExternalId: "77001234567@s.whatsapp.net",
        contactExternalId: "waweb:primary:77001234567@s.whatsapp.net",
        text: "Добрый день",
        actor: "automated",
        replyToExternalId: "waweb:primary:raw-in-1",
        idempotencyKey: "omnichannel:auto:message-1",
        durableDelivery: {
          conversationId: "00000000-0000-4000-8000-000000000001",
          sourceInboundMessageId: "00000000-0000-4000-8000-000000000002",
          aiGenerated: true,
          messageType: "text",
          metadata: { transport: "whatsapp_web" },
          finalization: { kind: "auto", reason: "safe_auto_reply" },
          typingDelayMs: 2_000,
        },
      }),
    ).resolves.toEqual({
      ok: true,
      queued: true,
      deliveryId: "00000000-0000-4000-8000-000000000003",
      deliveryStatus: "queued",
    });
    expect(outbound.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "primary",
        replyToExternalId: "raw-in-1",
        text: "Добрый день",
      }),
    );
    expect(web.createClient).not.toHaveBeenCalled();
  });
});
