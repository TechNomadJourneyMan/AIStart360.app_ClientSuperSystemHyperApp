/**
 * R-060 (R4-A2) — the seven pull / control endpoints of the WhatsApp bridge answered 401 / 403 /
 * 404 / 409 / 503 without a word: a rotated secret, a bridge switched off or a broken store looked
 * the same from outside. Each refusal now leaves the one structured line of
 * lib/runtime/webhook-log.ts (route, status, fixed reason, request id) — never the body, a header
 * value or an error message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  createSignedBridgeHeaders,
  WHATSAPP_WEB_PORTAL_AUDIENCE,
} from "@/lib/omnichannel/whatsapp-web-signature";

vi.mock("@/lib/omnichannel/postgres-runtime", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  shouldUseOmnichannelPostgres: () => true,
}));
vi.mock("@/lib/omnichannel/whatsapp-bridge-control", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createSupabaseBridgeControlStore: () => ({}),
  ackBridgeCommand: async () => { throw new Error("store down"); },
  claimBridgeCommand: async () => { throw new Error("store down"); },
  recordBridgeStatus: async () => { throw new Error("store down"); },
}));
vi.mock("@/lib/omnichannel/outbound-deliveries", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  claimOutboundDeliveryViaPostgres: async () => { throw new Error("store down"); },
  authorizeOutboundDeliveryViaPostgres: async () => { throw new Error("store down"); },
  reportOutboundDeliveryViaPostgres: async () => ({ accepted: false, status: "sent", externalMessageId: null }),
}));

const SECRET = "bridge-webhook-secret-0123456789abcdef";
const ID = "33333333-3333-4333-8333-333333333333";

interface Case {
  sub: string;
  load: () => Promise<{ POST: (req: NextRequest) => Promise<Response> }>;
  control: boolean;
  valid: Record<string, unknown>;
}

const CASES: Case[] = [
  { sub: "commands/ack", control: true, load: () => import("@/app/api/webhooks/whatsapp-web/commands/ack/route"), valid: { version: 1, session_id: "primary", command_id: ID, lease_token: ID, outcome: "succeeded" } },
  { sub: "commands/claim", control: true, load: () => import("@/app/api/webhooks/whatsapp-web/commands/claim/route"), valid: { version: 1, session_id: "primary" } },
  { sub: "session", control: true, load: () => import("@/app/api/webhooks/whatsapp-web/session/route"), valid: { version: 1, session_id: "primary", state: "connected", connected: true, updated_at: new Date().toISOString(), qr: null, qr_expires_at: null, error_code: null } },
  { sub: "outbound/claim", control: false, load: () => import("@/app/api/webhooks/whatsapp-web/outbound/claim/route"), valid: { version: 1, session_id: "primary" } },
  { sub: "outbound/authorize", control: false, load: () => import("@/app/api/webhooks/whatsapp-web/outbound/authorize/route"), valid: { version: 1, session_id: "primary", delivery_id: ID, lease_token: ID } },
  { sub: "outbound/result", control: false, load: () => import("@/app/api/webhooks/whatsapp-web/outbound/result/route"), valid: { version: 1, session_id: "primary", delivery_id: ID, lease_token: ID, outcome: "sent", provider_message_id: "wamid.1" } },
  { sub: "drain", control: false, load: () => import("@/app/api/webhooks/whatsapp-web/drain/route"), valid: { version: 1, session_id: "primary" } },
];

function signed(sub: string, value: unknown, secret = SECRET): NextRequest {
  const path = `/api/webhooks/whatsapp-web/${sub}`;
  const body = JSON.stringify(value);
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-railway-request-id": "req-r060",
      ...createSignedBridgeHeaders({ method: "POST", path, body, secret, audience: WHATSAPP_WEB_PORTAL_AUDIENCE }),
    },
    body,
  });
}

let lines: string[] = [];

function refusals(): Array<Record<string, unknown>> {
  return lines
    .map((line) => { try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; } })
    .filter((entry): entry is Record<string, unknown> => entry?.event === "webhook_rejected");
}

beforeEach(() => {
  lines = [];
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.stubEnv("WHATSAPP_WEB_BRIDGE_ENABLED", "true");
  vi.stubEnv("WHATSAPP_WEB_BRIDGE_CONTROL", "pull");
  vi.stubEnv("WHATSAPP_WEB_DELIVERY_MODE", "pull");
  vi.stubEnv("OMNICHANNEL_PROCESSING_BACKEND", "database");
  vi.stubEnv("WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("WHATSAPP_WEB_BRIDGE_SESSION_ID", "primary");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("R-060: every refusal of a bridge endpoint leaves one structured line", () => {
  for (const c of CASES) {
    describe(`/api/webhooks/whatsapp-web/${c.sub}`, () => {
      it("bridge switched off → 503 bridge_disabled", async () => {
        vi.stubEnv("WHATSAPP_WEB_BRIDGE_ENABLED", "false");
        const { POST } = await c.load();
        const res = await POST(signed(c.sub, c.valid));
        expect(res.status).toBe(503);
        expect(refusals()).toEqual([
          { event: "webhook_rejected", route: `webhooks/whatsapp-web/${c.sub}`, status: 503, reason: "bridge_disabled", request_id: "req-r060" },
        ]);
      });

      it("a wrong signature → 401 bad_signature", async () => {
        const { POST } = await c.load();
        const res = await POST(signed(c.sub, c.valid, "another-secret-of-the-same-length-000"));
        expect(res.status).toBe(401);
        expect(refusals()).toMatchObject([{ route: `webhooks/whatsapp-web/${c.sub}`, status: 401, reason: "bad_signature" }]);
      });

      it("another session → 403 session_mismatch", async () => {
        const { POST } = await c.load();
        const res = await POST(signed(c.sub, { ...c.valid, session_id: "other" }));
        expect(res.status).toBe(403);
        expect(refusals()).toMatchObject([{ route: `webhooks/whatsapp-web/${c.sub}`, status: 403, reason: "session_mismatch" }]);
      });
    });
  }

  it("control endpoints outside the pull mode → 404 control_not_pull", async () => {
    vi.stubEnv("WHATSAPP_WEB_BRIDGE_CONTROL", "direct");
    for (const c of CASES.filter((x) => x.control)) {
      lines = [];
      const { POST } = await c.load();
      expect((await POST(signed(c.sub, c.valid))).status).toBe(404);
      expect(refusals()).toMatchObject([{ route: `webhooks/whatsapp-web/${c.sub}`, status: 404, reason: "control_not_pull" }]);
    }
  });

  it("a store that fails keeps its one line (logBridgeFailure), not a second one", async () => {
    for (const c of CASES.filter((x) => ["commands/ack", "commands/claim", "session", "outbound/claim", "outbound/authorize"].includes(x.sub))) {
      lines = [];
      const { POST } = await c.load();
      expect((await POST(signed(c.sub, c.valid))).status).toBe(503);
      expect(refusals()).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(new RegExp(`^\\[whatsapp-web/${c.sub}\\] store down`));
    }
  });

  it("a result the lease no longer allows → 409 result_not_accepted, the answer body as before", async () => {
    const c = CASES.find((x) => x.sub === "outbound/result")!;
    const { POST } = await c.load();
    const res = await POST(signed(c.sub, c.valid));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, accepted: false, status: "sent", external_message_id: null });
    expect(refusals()).toMatchObject([{ route: "webhooks/whatsapp-web/outbound/result", status: 409, reason: "result_not_accepted" }]);
  });
});
