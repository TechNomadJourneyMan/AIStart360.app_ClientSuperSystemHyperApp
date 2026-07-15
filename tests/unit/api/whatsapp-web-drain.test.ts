import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import {
  createSignedBridgeHeaders,
  WHATSAPP_WEB_PORTAL_AUDIENCE,
} from "@/lib/omnichannel/whatsapp-web-signature";

const worker = vi.hoisted(() => ({ drain: vi.fn() }));
const vercel = vi.hoisted(() => ({ waitUntil: vi.fn() }));

vi.mock("@/lib/omnichannel/process-job-queue", () => ({
  drainOmnichannelProcessingJobs: worker.drain,
}));
vi.mock("@vercel/functions", () => ({
  attachDatabasePool: vi.fn(),
  waitUntil: vercel.waitUntil,
}));

import { POST } from "@/app/api/webhooks/whatsapp-web/drain/route";

const SECRET = "portal-webhook-secret-0123456789abcdef";
const PATH = "/api/webhooks/whatsapp-web/drain";
let nonceSequence = 0;

function request(
  value: unknown,
  options: { secret?: string; nonce?: string } = {},
): NextRequest {
  const body = JSON.stringify(value);
  nonceSequence += 1;
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...createSignedBridgeHeaders({
        method: "POST",
        path: PATH,
        body,
        secret: options.secret ?? SECRET,
        audience: WHATSAPP_WEB_PORTAL_AUDIENCE,
        nonce: options.nonce ?? `drain-test-nonce-${nonceSequence}`,
      }),
    },
    body,
  }) as unknown as NextRequest;
}

describe("/api/webhooks/whatsapp-web/drain", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WHATSAPP_WEB_BRIDGE_ENABLED", "true");
    vi.stubEnv("WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_WEB_BRIDGE_SESSION_ID", "primary");
    vi.stubEnv("OMNICHANNEL_PROCESSING_BACKEND", "database");
    vi.stubEnv("OMNICHANNEL_PERSISTENCE", "postgres");
    vi.stubEnv(
      "OMNICHANNEL_DATABASE_URL",
      "postgresql://restricted.invalid/omnichannel",
    );
    worker.drain.mockResolvedValue({ completed: 0, queueEmpty: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the bridge's exact signed kick and schedules a bounded drain", async () => {
    const result = await POST(request({ version: 1, session_id: "primary" }));

    expect(result.status).toBe(202);
    expect(worker.drain).toHaveBeenCalledWith({ limit: 1 });
    expect(vercel.waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it("rejects an invalid signature before running the worker", async () => {
    const result = await POST(
      request(
        { version: 1, session_id: "primary" },
        { secret: "wrong-secret-0123456789abcdef000000" },
      ),
    );

    expect(result.status).toBe(401);
    expect(worker.drain).not.toHaveBeenCalled();
  });

  it("requires the exact two-field payload and configured session", async () => {
    expect(
      (await POST(request({ version: 1, session_id: "primary", extra: true })))
        .status,
    ).toBe(400);
    expect(
      (await POST(request({ version: 1, session_id: "secondary" }))).status,
    ).toBe(403);
    expect(worker.drain).not.toHaveBeenCalled();
  });

  it("rejects a replayed nonce on the same warm instance", async () => {
    const nonce = `drain-replay-${Date.now()}`;
    const first = await POST(
      request({ version: 1, session_id: "primary" }, { nonce }),
    );
    const replay = await POST(
      request({ version: 1, session_id: "primary" }, { nonce }),
    );

    expect(first.status).toBe(202);
    expect(replay.status).toBe(409);
    expect(worker.drain).toHaveBeenCalledOnce();
  });

  it("fails closed unless database processing and the dedicated DSN are configured", async () => {
    vi.stubEnv("OMNICHANNEL_DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL", "postgresql://broad-owner.invalid/postgres");
    expect(
      (await POST(request({ version: 1, session_id: "primary" }))).status,
    ).toBe(503);

    vi.stubEnv("OMNICHANNEL_DATABASE_URL", "postgresql://restricted/db");
    vi.stubEnv("OMNICHANNEL_PROCESSING_BACKEND", "inngest");
    expect(
      (await POST(request({ version: 1, session_id: "primary" }))).status,
    ).toBe(503);
    expect(worker.drain).not.toHaveBeenCalled();
  });
});
