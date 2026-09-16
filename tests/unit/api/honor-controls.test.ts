import { beforeEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  rpc: vi.fn(),
  rate: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/admin/giga-actor", () => ({ getGigaActor: mocks.actor }));
vi.mock("@/lib/supabase-service", () => ({
  createServiceClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimitedKey: mocks.rate }));
vi.mock("@/lib/omnichannel/honor-catalog", () => ({
  selectHonorProducts: vi.fn(),
  buildHonorReply: vi.fn(),
}));
import { GET, POST } from "@/app/api/giga-admin/omnichannel/honor/route";
const origin = "https://portal.example";
const request = (body: unknown, source = origin) =>
  new NextRequest(origin + "/api/giga-admin/omnichannel/honor", {
    method: "POST",
    headers: { origin: source, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ id: "manager", kind: "session" });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.rate.mockResolvedValue(false);
});
describe("Honor administration boundary", () => {
  it("rejects anonymous controls and statistics", async () => {
    mocks.actor.mockResolvedValue(null);
    expect((await POST(request({ action: "stop" }))).status).toBe(403);
    expect((await GET(new NextRequest(origin))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes", async () => {
    expect(
      (await POST(request({ action: "stop" }, "https://evil.example"))).status,
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not rate-limit an authorized emergency stop behind sandbox requests", async () => {
    mocks.rate.mockResolvedValue(true);
    expect((await POST(request({ action: "stop" }))).status).toBe(200);
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("honor_ai_control", {
      p_action: "stop",
      p_channel: "whatsapp",
      p_config: null,
    });
  });
  it("rejects forged verification config and oversized time ranges", async () => {
    expect(
      (await POST(request({ action: "stop", honor_verified_account: "fake" })))
        .status,
    ).toBe(400);
    expect(
      (
        await GET(
          new NextRequest(
            origin + "?from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z",
          ),
        )
      ).status,
    ).toBe(400);
  });
  it("requires personal attribution for the live canary", async () => {
    mocks.actor.mockResolvedValue({
      id: "giga:super_admin",
      kind: "break_glass",
    });
    expect(
      (
        await POST(
          request({
            action: "verify",
            message_id: "11111111-1111-4111-8111-111111111111",
          }),
        )
      ).status,
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not claim a failed DB write succeeded", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "unavailable" } });
    expect((await POST(request({ action: "stop" }))).status).toBe(409);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
