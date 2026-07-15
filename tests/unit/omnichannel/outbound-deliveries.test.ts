import { describe, expect, it, vi } from "vitest";
import {
  authorizeOutboundDeliveryViaPostgres,
  claimOutboundDeliveryViaPostgres,
  enqueueOutboundDeliveryViaPostgres,
  reportOutboundDeliveryViaPostgres,
  whatsappWebDeliveryMode,
} from "@/lib/omnichannel/outbound-deliveries";

const conversationId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000002";
const deliveryId = "00000000-0000-4000-8000-000000000003";
const leaseToken = "00000000-0000-4000-8000-000000000004";

describe("outbound delivery RPC client", () => {
  it("defaults to direct and rejects an unknown delivery mode", () => {
    expect(
      whatsappWebDeliveryMode({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
    ).toBe("direct");
    expect(
      whatsappWebDeliveryMode({
        NODE_ENV: "test",
        WHATSAPP_WEB_DELIVERY_MODE: "pull",
      } as NodeJS.ProcessEnv),
    ).toBe("pull");
    expect(
      whatsappWebDeliveryMode({
        NODE_ENV: "test",
        WHATSAPP_WEB_DELIVERY_MODE: "other",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it("enqueues through one RPC without a control-queue text column", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          delivery_id: deliveryId,
          delivery_status: "queued",
          idempotency_key: `omnichannel:auto:${messageId}`,
          created: true,
        },
      ],
    });
    await expect(
      enqueueOutboundDeliveryViaPostgres(
        {
          conversationId,
          sourceInboundMessageId: messageId,
          sessionId: "primary",
          idempotencyKey: `omnichannel:auto:${messageId}`,
          text: "Добрый день",
          actor: "automated",
          aiGenerated: true,
          metadata: { transport: "whatsapp_web" },
          finalization: { kind: "auto", reason: "safe_auto_reply" },
          typingDelayMs: 2_000,
        },
        { query } as never,
      ),
    ).resolves.toMatchObject({ id: deliveryId, status: "queued", created: true });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("enqueue_omnichannel_outbound_delivery"),
      expect.arrayContaining(["Добрый день", "automated", 2_000]),
    );
  });

  it("maps a fenced claim and an authorized payload", async () => {
    const claimQuery = vi.fn().mockResolvedValue({
      rows: [
        {
          delivery_id: deliveryId,
          lease_token: leaseToken,
          lease_until: "2026-07-15T01:00:00.000Z",
          recipient: "77001234567@s.whatsapp.net",
          typing_delay_ms: 3_000,
        },
      ],
    });
    await expect(
      claimOutboundDeliveryViaPostgres(
        { sessionId: "primary" },
        { query: claimQuery } as never,
      ),
    ).resolves.toMatchObject({ id: deliveryId, leaseToken, typingDelayMs: 3_000 });

    const authorizeQuery = vi.fn().mockResolvedValue({
      rows: [
        {
          authorized: true,
          reason: "authorized",
          recipient: "77001234567@s.whatsapp.net",
          message_text: "Ответ",
          reply_to_external_id: "raw-in-1",
          idempotency_key: `omnichannel:auto:${messageId}`,
        },
      ],
    });
    await expect(
      authorizeOutboundDeliveryViaPostgres(
        { deliveryId, leaseToken, sessionId: "primary" },
        { query: authorizeQuery } as never,
      ),
    ).resolves.toMatchObject({ authorized: true, text: "Ответ" });
  });

  it("reports ambiguity explicitly and validates machine error codes", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          accepted: true,
          delivery_status: "delivery_unknown",
          external_message_id: null,
        },
      ],
    });
    await expect(
      reportOutboundDeliveryViaPostgres(
        {
          deliveryId,
          leaseToken,
          sessionId: "primary",
          outcome: "delivery_unknown",
          errorCode: "provider_send_ambiguous",
        },
        { query } as never,
      ),
    ).resolves.toEqual({
      accepted: true,
      status: "delivery_unknown",
      externalMessageId: null,
    });
    await expect(
      reportOutboundDeliveryViaPostgres(
        {
          deliveryId,
          leaseToken,
          sessionId: "primary",
          outcome: "delivery_unknown",
          errorCode: "customer text is forbidden",
        },
        { query } as never,
      ),
    ).rejects.toThrow("errorCode is invalid");
  });
});
