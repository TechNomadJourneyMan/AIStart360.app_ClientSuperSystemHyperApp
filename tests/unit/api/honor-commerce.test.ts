import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase-service", () => ({
  createServiceClient: () => ({ rpc }),
}));
import { POST } from "@/app/api/webhooks/honor-commerce/route";
const secret = "sandbox-secret-".repeat(4);
const event = () => ({
  source_event_id: "event1",
  message_id: "11111111-1111-4111-8111-111111111111",
  event_type: "paid",
  order_external_id: "order1",
  occurred_at: new Date().toISOString(),
});
const req = (raw: string, signed = true) =>
  new NextRequest("https://portal.example/api/webhooks/honor-commerce", {
    method: "POST",
    headers: {
      "x-hub-signature-256": signed
        ? "sha256=" + createHmac("sha256", secret).update(raw).digest("hex")
        : "sha256=bad",
    },
    body: raw,
  });
beforeEach(() => {
  vi.stubEnv("HONOR_COMMERCE_WEBHOOK_SECRET", secret);
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("signed commerce evidence", () => {
  it("fails closed when the source is not connected", async () => {
    vi.stubEnv("HONOR_COMMERCE_WEBHOOK_SECRET", "");
    expect((await POST(req(JSON.stringify(event())))).status).toBe(503);
  });
  it("checks exact body signature before persistence", async () => {
    expect((await POST(req(JSON.stringify(event()), false))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects invented revenue and malformed JSON", async () => {
    expect(
      (await POST(req(JSON.stringify({ ...event(), revenue: 999999 })))).status,
    ).toBe(400);
    expect((await POST(req("{"))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not count an unconfirmed order as paid", async () => {
    rpc.mockResolvedValue({ error: { code: "order_not_confirmed" } });
    expect((await POST(req(JSON.stringify(event())))).status).toBe(409);
  });
  it("passes only signed evidence to the atomic database ledger", async () => {
    const e = event();
    expect((await POST(req(JSON.stringify(e)))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("honor_record_commerce_evidence", {
      p_event: e,
    });
  });
});
