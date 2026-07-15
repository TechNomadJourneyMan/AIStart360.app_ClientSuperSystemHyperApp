import { describe, expect, it, vi } from "vitest";
import {
  parsePortalOutboundUrls,
  PortalOutboundPuller,
} from "../../../services/whatsapp-web-bridge/portal-outbound-puller.mjs";

const secret = "portal-outbound-secret-with-at-least-32-bytes";
const deliveryId = "00000000-0000-4000-8000-000000000001";
const leaseToken = "00000000-0000-4000-8000-000000000002";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function claimResponse(delay = 0) {
  return {
    ok: true,
    delivery: {
      delivery_id: deliveryId,
      lease_token: leaseToken,
      lease_until: "2026-07-15T02:00:00.000Z",
      recipient: "77001234567@s.whatsapp.net",
      typing_delay_ms: delay,
    },
  };
}

function authorizeResponse() {
  return {
    ok: true,
    authorized: true,
    delivery: {
      recipient: "77001234567@s.whatsapp.net",
      text: "Добрый день",
      reply_to_external_id: "raw-in-1",
      idempotency_key: "omnichannel:auto:message-1",
    },
  };
}

describe("WhatsApp Web portal outbound puller", () => {
  it("derives three same-origin portal endpoints", () => {
    const urls = parsePortalOutboundUrls(
      new URL("https://portal.example.kz/api/webhooks/whatsapp-web"),
    );
    expect(urls.claim.href).toBe(
      "https://portal.example.kz/api/webhooks/whatsapp-web/outbound/claim",
    );
    expect(new Set(Object.values(urls).map((url) => url.origin)).size).toBe(1);
    expect(() =>
      parsePortalOutboundUrls(
        "https://portal.example.kz/private/api/webhooks/whatsapp-web",
      ),
    ).toThrow(/canonical WhatsApp Web route/);
  });

  it("claims, composes, re-authorizes, executes through the callback and reports sent", async () => {
    const requests: Array<{ path: string; body: Record<string, unknown>; headers: Headers }> = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ path: url.pathname, body, headers: new Headers(init?.headers) });
      if (url.pathname.endsWith("/claim")) return json(claimResponse());
      if (url.pathname.endsWith("/authorize")) return json(authorizeResponse());
      return json({ ok: true, accepted: true, status: "sent" });
    });
    const execute = vi.fn().mockResolvedValue({ message_id: "provider-out-1" });
    const presence = vi.fn().mockResolvedValue(undefined);
    const puller = new PortalOutboundPuller({
      urls: parsePortalOutboundUrls(
        "https://portal.example.kz/api/webhooks/whatsapp-web",
      ),
      sessionId: "primary",
      secret,
      fetchImpl,
      isReady: () => true,
      execute,
      sendPresence: presence,
    });
    try {
      await expect(puller.trigger()).resolves.toEqual({ kind: "sent" });
    } finally {
      puller.stop();
    }

    expect(presence.mock.calls).toEqual([
      ["77001234567@s.whatsapp.net", "composing"],
      ["77001234567@s.whatsapp.net", "paused"],
    ]);
    expect(execute).toHaveBeenCalledWith({
      recipient: "77001234567@s.whatsapp.net",
      text: "Добрый день",
      replyToExternalId: "raw-in-1",
      idempotencyKey: "omnichannel:auto:message-1",
    });
    expect(requests.map((item) => item.path)).toEqual([
      "/api/webhooks/whatsapp-web/outbound/claim",
      "/api/webhooks/whatsapp-web/outbound/authorize",
      "/api/webhooks/whatsapp-web/outbound/result",
    ]);
    expect(requests[2].body).toMatchObject({
      outcome: "sent",
      provider_message_id: "provider-out-1",
    });
    for (const request of requests) {
      expect(request.headers.get("x-wa-bridge-signature")).toMatch(/^sha256=[a-f0-9]{64}$/);
      expect(request.headers.get("x-wa-bridge-audience")).toBe("aistart360-portal");
    }
  });

  it("reports an ambiguous provider outcome as terminally unknown", async () => {
    let resultBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname.endsWith("/claim")) return json(claimResponse());
      if (url.pathname.endsWith("/authorize")) return json(authorizeResponse());
      resultBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json({ ok: true, accepted: true, status: "delivery_unknown" });
    });
    const execute = vi.fn().mockRejectedValue(
      Object.assign(new Error("provider state unknown"), {
        code: "provider_send_ambiguous",
      }),
    );
    const puller = new PortalOutboundPuller({
      urls: parsePortalOutboundUrls(
        "https://portal.example.kz/api/webhooks/whatsapp-web",
      ),
      sessionId: "primary",
      secret,
      fetchImpl,
      isReady: () => true,
      execute,
    });
    try {
      await expect(puller.trigger()).resolves.toEqual({
        kind: "delivery_unknown",
      });
    } finally {
      puller.stop();
    }
    expect(resultBody).toMatchObject({
      outcome: "delivery_unknown",
      error_code: "provider_send_ambiguous",
    });
  });

  it("requeues only a known pre-provider failure", async () => {
    let resultBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname.endsWith("/claim")) return json(claimResponse());
      if (url.pathname.endsWith("/authorize")) return json(authorizeResponse());
      resultBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json({ ok: true, accepted: true, status: "queued" });
    });
    const execute = vi.fn().mockRejectedValue(
      Object.assign(new Error("offline"), { code: "session_disconnected" }),
    );
    const puller = new PortalOutboundPuller({
      urls: parsePortalOutboundUrls(
        "https://portal.example.kz/api/webhooks/whatsapp-web",
      ),
      sessionId: "primary",
      secret,
      fetchImpl,
      isReady: () => true,
      execute,
    });
    try {
      await expect(puller.trigger()).resolves.toEqual({
        kind: "retryable_failure",
      });
    } finally {
      puller.stop();
    }
    expect(resultBody).toMatchObject({
      outcome: "retryable_failure",
      error_code: "session_disconnected",
    });
  });

  it("does not execute when the second authorization denies the send", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname.endsWith("/claim")) return json(claimResponse());
      return json({ ok: true, authorized: false, reason: "conversation_not_open" });
    });
    const execute = vi.fn();
    const puller = new PortalOutboundPuller({
      urls: parsePortalOutboundUrls(
        "https://portal.example.kz/api/webhooks/whatsapp-web",
      ),
      sessionId: "primary",
      secret,
      fetchImpl,
      isReady: () => true,
      execute,
    });
    try {
      await expect(puller.trigger()).resolves.toEqual({ kind: "cancelled" });
    } finally {
      puller.stop();
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("marks repeated portal failures and a pending result as not ready", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(claimResponse()))
      .mockResolvedValueOnce(json(authorizeResponse()))
      .mockRejectedValue(new Error("portal offline"));
    const puller = new PortalOutboundPuller({
      urls: parsePortalOutboundUrls(
        "https://portal.example.kz/api/webhooks/whatsapp-web",
      ),
      sessionId: "primary",
      secret,
      fetchImpl,
      isReady: () => true,
      execute: vi.fn().mockResolvedValue({ message_id: "provider-out-1" }),
    });
    try {
      await expect(puller.trigger()).resolves.toEqual({
        kind: "retry_later",
        reason: "result_pending",
      });
      expect(puller.snapshot()).toMatchObject({
        ready: false,
        report_pending: true,
        consecutive_failures: 1,
      });
    } finally {
      puller.stop();
    }
  });
});
