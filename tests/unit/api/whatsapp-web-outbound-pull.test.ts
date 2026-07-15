import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  createSignedBridgeHeaders,
  WHATSAPP_WEB_PORTAL_AUDIENCE,
} from "@/lib/omnichannel/whatsapp-web-signature";

const outbound = vi.hoisted(() => ({
  claim: vi.fn(),
  authorize: vi.fn(),
  report: vi.fn(),
}));

vi.mock("@/lib/omnichannel/postgres-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/omnichannel/postgres-runtime")>();
  return { ...actual, shouldUseOmnichannelPostgres: () => true };
});
vi.mock("@/lib/omnichannel/outbound-deliveries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/omnichannel/outbound-deliveries")>();
  return {
    ...actual,
    claimOutboundDeliveryViaPostgres: outbound.claim,
    authorizeOutboundDeliveryViaPostgres: outbound.authorize,
    reportOutboundDeliveryViaPostgres: outbound.report,
  };
});

import { POST as claim } from "@/app/api/webhooks/whatsapp-web/outbound/claim/route";
import { POST as authorize } from "@/app/api/webhooks/whatsapp-web/outbound/authorize/route";
import { POST as result } from "@/app/api/webhooks/whatsapp-web/outbound/result/route";

const secret = "portal-outbound-webhook-secret-with-32-bytes";
const deliveryId = "00000000-0000-4000-8000-000000000001";
const leaseToken = "00000000-0000-4000-8000-000000000002";

function request(path: string, payload: unknown, signed = true): NextRequest {
  const rawBody = JSON.stringify(payload);
  return new NextRequest(`https://portal.example.kz${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signed
        ? createSignedBridgeHeaders({
            method: "POST",
            path,
            body: rawBody,
            secret,
            audience: WHATSAPP_WEB_PORTAL_AUDIENCE,
            nonce: crypto.randomUUID(),
          })
        : {}),
    },
    body: rawBody,
  });
}

describe("signed WhatsApp Web outbound pull API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("WHATSAPP_WEB_BRIDGE_ENABLED", "true");
    vi.stubEnv("WHATSAPP_WEB_DELIVERY_MODE", "pull");
    vi.stubEnv("WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET", secret);
    vi.stubEnv("WHATSAPP_WEB_BRIDGE_SESSION_ID", "primary");
  });

  it("rejects an unsigned claim before touching the database", async () => {
    const response = await claim(
      request(
        "/api/webhooks/whatsapp-web/outbound/claim",
        { version: 1, session_id: "primary" },
        false,
      ),
    );
    expect(response.status).toBe(401);
    expect(outbound.claim).not.toHaveBeenCalled();
  });

  it("returns one fenced claim without customer text", async () => {
    outbound.claim.mockResolvedValue({
      id: deliveryId,
      leaseToken,
      leaseUntil: "2026-07-15T02:00:00.000Z",
      recipient: "77001234567@s.whatsapp.net",
      typingDelayMs: 2_000,
    });
    const response = await claim(
      request("/api/webhooks/whatsapp-web/outbound/claim", {
        version: 1,
        session_id: "primary",
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.delivery).toEqual({
      delivery_id: deliveryId,
      lease_token: leaseToken,
      lease_until: "2026-07-15T02:00:00.000Z",
      recipient: "77001234567@s.whatsapp.net",
      typing_delay_ms: 2_000,
    });
    expect(JSON.stringify(body)).not.toContain("text");
  });

  it("keeps the signed consumer available during a direct-mode cutover", async () => {
    vi.stubEnv("WHATSAPP_WEB_DELIVERY_MODE", "direct");
    outbound.claim.mockResolvedValue(null);
    const response = await claim(
      request("/api/webhooks/whatsapp-web/outbound/claim", {
        version: 1,
        session_id: "primary",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, delivery: null });
  });

  it("exposes text only after the database re-authorizes the live fence", async () => {
    outbound.authorize.mockResolvedValue({
      authorized: true,
      reason: "authorized",
      recipient: "77001234567@s.whatsapp.net",
      text: "Добрый день",
      replyToExternalId: "raw-in-1",
      idempotencyKey: "omnichannel:auto:message-1",
    });
    const response = await authorize(
      request("/api/webhooks/whatsapp-web/outbound/authorize", {
        version: 1,
        session_id: "primary",
        delivery_id: deliveryId,
        lease_token: leaseToken,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authorized: true,
      delivery: { text: "Добрый день" },
    });
    expect(outbound.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId, leaseToken, sessionId: "primary" }),
    );
  });

  it("passes delivery_unknown through the fenced result RPC", async () => {
    outbound.report.mockResolvedValue({
      accepted: true,
      status: "delivery_unknown",
      externalMessageId: null,
    });
    const response = await result(
      request("/api/webhooks/whatsapp-web/outbound/result", {
        version: 1,
        session_id: "primary",
        delivery_id: deliveryId,
        lease_token: leaseToken,
        outcome: "delivery_unknown",
        error_code: "provider_send_ambiguous",
      }),
    );
    expect(response.status).toBe(200);
    expect(outbound.report).toHaveBeenCalledWith({
      deliveryId,
      leaseToken,
      sessionId: "primary",
      outcome: "delivery_unknown",
      errorCode: "provider_send_ambiguous",
    });
  });
});
