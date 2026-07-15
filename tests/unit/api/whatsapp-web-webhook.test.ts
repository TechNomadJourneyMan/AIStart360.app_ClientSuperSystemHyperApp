import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import {
  createSignedBridgeHeaders,
  WHATSAPP_WEB_PORTAL_AUDIENCE,
} from "@/lib/omnichannel/whatsapp-web-signature";

const repository = vi.hoisted(() => ({
  claimWebhookEventForProcessing: vi.fn(),
  ingestNormalizedMessage: vi.fn(),
  recordWebhookEvent: vi.fn(),
  transitionWebhookEvent: vi.fn(),
}));
const postgres = vi.hoisted(() => ({
  claimWebhookEventForProcessing: vi.fn(),
  ingestNormalizedMessage: vi.fn(),
  recordWebhookEvent: vi.fn(),
  transitionWebhookEvent: vi.fn(),
}));
const queue = vi.hoisted(() => ({ send: vi.fn() }));
const directProcessor = vi.hoisted(() => ({ process: vi.fn() }));
const processingJobs = vi.hoisted(() => ({ enqueue: vi.fn() }));
const jobDrain = vi.hoisted(() => ({ drain: vi.fn() }));

vi.mock("@/lib/omnichannel/repository", () => repository);
vi.mock("@/lib/omnichannel/postgres-ingest", () => postgres);
vi.mock("@/lib/inngest", () => ({ inngest: queue }));
vi.mock("@/lib/functions/process-omnichannel-message", () => ({
  processOmnichannelMessageDirect: directProcessor.process,
}));
vi.mock("@/lib/omnichannel/processing-jobs", () => ({
  enqueueOmnichannelProcessingJob: processingJobs.enqueue,
}));
vi.mock("@/lib/omnichannel/process-job-queue", () => ({
  drainOmnichannelProcessingJobs: jobDrain.drain,
}));

import { POST } from "@/app/api/webhooks/whatsapp-web/route";

const managedEnv = [
  "WHATSAPP_WEB_BRIDGE_ENABLED",
  "WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET",
  "WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET_PREVIOUS",
  "WHATSAPP_WEB_BRIDGE_SESSION_ID",
  "OMNICHANNEL_INLINE_PROCESSING",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "OMNICHANNEL_PROCESSING_BACKEND",
  "OMNICHANNEL_PERSISTENCE",
  "OMNICHANNEL_DATABASE_URL",
  "VERCEL",
] as const;
const originalEnv = Object.fromEntries(
  managedEnv.map((key) => [key, process.env[key]]),
);

function payload(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    event_id: "event-12345678",
    event_type: "message",
    session_id: "primary",
    message: {
      id: "MESSAGE123",
      remote_jid: "77011234567@s.whatsapp.net",
      timestamp_ms: Date.now() - 1_000,
      text: "Нужна экипировка на лето",
      message_type: "text",
      live: true,
      from_me: false,
      ...overrides,
    },
  };
}

function request(
  value: unknown,
  signingSecret = "portal-webhook-secret-0123456789abcdef",
): NextRequest {
  const body = JSON.stringify(value);
  return new Request("http://localhost/api/webhooks/whatsapp-web", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...createSignedBridgeHeaders({
        method: "POST",
        path: "/api/webhooks/whatsapp-web",
        body,
        secret: signingSecret,
        audience: WHATSAPP_WEB_PORTAL_AUDIENCE,
      }),
    },
    body,
  }) as unknown as NextRequest;
}

describe("/api/webhooks/whatsapp-web", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    process.env.WHATSAPP_WEB_BRIDGE_ENABLED = "true";
    process.env.WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET =
      "portal-webhook-secret-0123456789abcdef";
    process.env.WHATSAPP_WEB_BRIDGE_SESSION_ID = "primary";
    // Keep existing route tests on the production Supabase persistence path.
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    repository.recordWebhookEvent.mockResolvedValue({
      id: "audit-1",
      duplicate: false,
      status: "received",
    });
    repository.claimWebhookEventForProcessing.mockResolvedValue(true);
    repository.ingestNormalizedMessage.mockResolvedValue({
      duplicate: false,
      messageId: "message-1",
      conversationId: "conversation-1",
      shouldQueue: true,
    });
    repository.transitionWebhookEvent.mockResolvedValue(undefined);
    postgres.recordWebhookEvent.mockResolvedValue({
      id: "pg-audit-1",
      duplicate: false,
      status: "received",
    });
    postgres.claimWebhookEventForProcessing.mockResolvedValue(true);
    postgres.ingestNormalizedMessage.mockResolvedValue({
      duplicate: false,
      messageId: "pg-message-1",
      conversationId: "pg-conversation-1",
      shouldQueue: true,
    });
    postgres.transitionWebhookEvent.mockResolvedValue(undefined);
    queue.send.mockResolvedValue({ ids: ["event-1"] });
    directProcessor.process.mockResolvedValue({ action: "draft" });
    processingJobs.enqueue.mockResolvedValue({
      id: "job-1",
      runAt: new Date().toISOString(),
    });
    jobDrain.drain.mockResolvedValue({ completed: 1 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const key of managedEnv) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("fails closed when disabled or unconfigured", async () => {
    process.env.WHATSAPP_WEB_BRIDGE_ENABLED = "false";
    expect((await POST(request(payload()))).status).toBe(503);
    process.env.WHATSAPP_WEB_BRIDGE_ENABLED = "true";
    delete process.env.WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET;
    expect((await POST(request(payload()))).status).toBe(503);
    expect(repository.ingestNormalizedMessage).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature before persistence", async () => {
    const response = await POST(request(payload(), "wrong-secret"));
    expect(response.status).toBe(401);
    expect(repository.recordWebhookEvent).not.toHaveBeenCalled();
  });

  it("ingests and queues one signed live inbound message", async () => {
    const response = await POST(request(payload()));
    expect(response.status).toBe(200);
    expect(repository.ingestNormalizedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        accountExternalId: "waweb:primary",
        externalMessageId: "waweb:primary:MESSAGE123",
        direction: "in",
        text: "Нужна экипировка на лето",
        metadata: expect.objectContaining({ transport: "whatsapp_web" }),
      }),
    );
    expect(queue.send).toHaveBeenCalledWith({
      id: "omnichannel-message-message-1",
      name: "omnichannel/message.received",
      data: {
        message_id: "message-1",
        conversation_id: "conversation-1",
        force_draft: false,
      },
    });
    expect(repository.claimWebhookEventForProcessing).toHaveBeenCalledWith(
      "audit-1",
    );
    expect(repository.transitionWebhookEvent).toHaveBeenCalledWith(
      "audit-1",
      "processed",
    );
  });

  it.each(["processed", "queued", "ignored"] as const)(
    "acknowledges a duplicate %s audit without ingesting or enqueueing it",
    async (status) => {
      repository.recordWebhookEvent.mockResolvedValue({
        id: "audit-existing",
        duplicate: true,
        status,
      });

      const result = await POST(request(payload()));

      expect(result.status).toBe(200);
      expect(repository.claimWebhookEventForProcessing).not.toHaveBeenCalled();
      expect(repository.ingestNormalizedMessage).not.toHaveBeenCalled();
      expect(queue.send).not.toHaveBeenCalled();
      expect(directProcessor.process).not.toHaveBeenCalled();
      expect(repository.transitionWebhookEvent).not.toHaveBeenCalled();
    },
  );

  it("keeps a recent processing duplicate retryable until its lease is available", async () => {
    repository.recordWebhookEvent.mockResolvedValue({
      id: "audit-processing",
      duplicate: true,
      status: "processing",
    });
    repository.claimWebhookEventForProcessing.mockResolvedValue(false);

    const result = await POST(request(payload()));

    expect(result.status).toBe(503);
    expect(repository.ingestNormalizedMessage).toHaveBeenCalledOnce();
    expect(repository.claimWebhookEventForProcessing).toHaveBeenCalledWith(
      "audit-processing",
    );
    expect(queue.send).not.toHaveBeenCalled();
    expect(directProcessor.process).not.toHaveBeenCalled();
    expect(repository.transitionWebhookEvent).not.toHaveBeenCalled();
  });

  it("reclaims a stale processing duplicate and enqueues it exactly once", async () => {
    repository.recordWebhookEvent.mockResolvedValue({
      id: "audit-stale",
      duplicate: true,
      status: "processing",
    });

    const result = await POST(request(payload()));

    expect(result.status).toBe(200);
    expect(repository.ingestNormalizedMessage).toHaveBeenCalledOnce();
    expect(repository.claimWebhookEventForProcessing).toHaveBeenCalledWith(
      "audit-stale",
    );
    expect(queue.send).toHaveBeenCalledOnce();
    expect(repository.transitionWebhookEvent).toHaveBeenCalledWith(
      "audit-stale",
      "processed",
    );
  });

  it.each(["received", "failed"] as const)(
    "atomically resumes a duplicate %s audit",
    async (status) => {
      repository.recordWebhookEvent.mockResolvedValue({
        id: "audit-retry",
        duplicate: true,
        status,
      });

      const result = await POST(request(payload()));

      expect(result.status).toBe(200);
      expect(repository.claimWebhookEventForProcessing).toHaveBeenCalledWith(
        "audit-retry",
      );
      expect(repository.ingestNormalizedMessage).toHaveBeenCalledOnce();
      expect(queue.send).toHaveBeenCalledOnce();
      expect(repository.transitionWebhookEvent).toHaveBeenCalledWith(
        "audit-retry",
        "processed",
      );
    },
  );

  it("keeps a concurrent retry that loses the atomic audit claim in the bridge outbox", async () => {
    repository.recordWebhookEvent.mockResolvedValue({
      id: "audit-racing",
      duplicate: true,
      status: "received",
    });
    repository.claimWebhookEventForProcessing.mockResolvedValue(false);

    const result = await POST(request(payload()));

    expect(result.status).toBe(503);
    // Recoverable audits persist the message first so a crash cannot leave a
    // processing audit with no durable message. The provider id upsert is safe.
    expect(repository.ingestNormalizedMessage).toHaveBeenCalledOnce();
    expect(queue.send).not.toHaveBeenCalled();
    expect(repository.transitionWebhookEvent).not.toHaveBeenCalled();
  });

  it("leaves an unclaimed ingest failure recoverable without overwriting a concurrent owner", async () => {
    repository.ingestNormalizedMessage.mockRejectedValue(
      new Error("database unavailable"),
    );

    const result = await POST(request(payload()));

    expect(result.status).toBe(500);
    expect(repository.claimWebhookEventForProcessing).not.toHaveBeenCalled();
    expect(repository.transitionWebhookEvent).not.toHaveBeenCalled();
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("marks an owned audit failed when durable enqueueing fails", async () => {
    queue.send.mockRejectedValue(new Error("queue unavailable"));

    const result = await POST(request(payload()));

    expect(result.status).toBe(500);
    expect(repository.claimWebhookEventForProcessing).toHaveBeenCalledWith(
      "audit-1",
    );
    expect(repository.transitionWebhookEvent).toHaveBeenCalledTimes(1);
    expect(repository.transitionWebhookEvent).toHaveBeenCalledWith(
      "audit-1",
      "failed",
      "inngest_enqueue_failed",
    );
  });

  it("uses the bridge event id as the stable durable replay identity", async () => {
    await POST(request(payload({ text: "Первая сериализация" })));
    const firstHash =
      repository.recordWebhookEvent.mock.calls[0]?.[0]?.eventHash;

    vi.resetAllMocks();
    repository.recordWebhookEvent.mockResolvedValue({
      id: "audit-existing",
      duplicate: true,
      status: "processed",
    });

    await POST(request(payload({ text: "Другая сериализация" })));
    const secondHash =
      repository.recordWebhookEvent.mock.calls[0]?.[0]?.eventHash;

    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
    expect(secondHash).toBe(firstHash);
  });

  it("can process inline without an Inngest account", async () => {
    process.env.OMNICHANNEL_INLINE_PROCESSING = "true";

    const response = await POST(request(payload()));

    expect(response.status).toBe(200);
    expect(directProcessor.process).toHaveBeenCalledWith({
      message_id: "message-1",
      conversation_id: "conversation-1",
      force_draft: false,
    });
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("durably enqueues database processing before acknowledging the bridge", async () => {
    process.env.OMNICHANNEL_PROCESSING_BACKEND = "database";
    process.env.OMNICHANNEL_PERSISTENCE = "postgres";
    process.env.OMNICHANNEL_DATABASE_URL =
      "postgresql://restricted.invalid/omnichannel";

    const response = await POST(request(payload()));

    expect(response.status).toBe(200);
    expect(postgres.ingestNormalizedMessage).toHaveBeenCalledOnce();
    expect(processingJobs.enqueue).toHaveBeenCalledWith({
      messageId: "pg-message-1",
      forceDraft: false,
    });
    expect(queue.send).not.toHaveBeenCalled();
    expect(directProcessor.process).not.toHaveBeenCalled();
    expect(postgres.transitionWebhookEvent).toHaveBeenCalledWith(
      "pg-audit-1",
      "processed",
    );
  });

  it("fails closed before persistence when database processing lacks its dedicated DSN", async () => {
    process.env.OMNICHANNEL_PROCESSING_BACKEND = "database";
    process.env.OMNICHANNEL_PERSISTENCE = "postgres";
    delete process.env.OMNICHANNEL_DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://broad-owner.invalid/postgres";

    const response = await POST(request(payload()));

    expect(response.status).toBe(503);
    expect(repository.recordWebhookEvent).not.toHaveBeenCalled();
    expect(postgres.recordWebhookEvent).not.toHaveBeenCalled();
    expect(processingJobs.enqueue).not.toHaveBeenCalled();
  });

  it("keeps the bridge event retryable when durable database enqueueing fails", async () => {
    process.env.OMNICHANNEL_PROCESSING_BACKEND = "database";
    process.env.OMNICHANNEL_PERSISTENCE = "postgres";
    process.env.OMNICHANNEL_DATABASE_URL =
      "postgresql://restricted.invalid/omnichannel";
    processingJobs.enqueue.mockRejectedValue(new Error("queue unavailable"));

    const response = await POST(request(payload()));

    expect(response.status).toBe(500);
    expect(postgres.transitionWebhookEvent).toHaveBeenCalledWith(
      "pg-audit-1",
      "failed",
      "database_queue_enqueue_failed",
    );
  });

  it("imports signed offline catch-up as an AI draft only", async () => {
    const response = await POST(request(payload({ live: false })));

    expect(response.status).toBe(200);
    expect(repository.recordWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ catchUp: true, offline: true }),
      }),
    );
    expect(repository.ingestNormalizedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          live: false,
          catchUp: true,
          offline: true,
          bridgeUpsertType: "append",
        }),
      }),
    );
    expect(queue.send).toHaveBeenCalledWith({
      id: "omnichannel-message-message-1",
      name: "omnichannel/message.received",
      data: {
        message_id: "message-1",
        conversation_id: "conversation-1",
        force_draft: true,
      },
    });
  });

  it("also forces catch-up to draft during inline processing", async () => {
    process.env.OMNICHANNEL_INLINE_PROCESSING = "true";

    const response = await POST(request(payload({ live: false })));

    expect(response.status).toBe(200);
    expect(directProcessor.process).toHaveBeenCalledWith({
      message_id: "message-1",
      conversation_id: "conversation-1",
      force_draft: true,
    });
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("rejects self/group payloads instead of triggering AI", async () => {
    for (const override of [{ from_me: true }, { remote_jid: "123@g.us" }]) {
      expect((await POST(request(payload(override)))).status).toBe(400);
    }
    expect(repository.ingestNormalizedMessage).not.toHaveBeenCalled();
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("does not queue a terminal duplicate", async () => {
    repository.ingestNormalizedMessage.mockResolvedValue({
      duplicate: true,
      messageId: "message-1",
      conversationId: "conversation-1",
      shouldQueue: false,
    });
    expect((await POST(request(payload()))).status).toBe(200);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("uses the direct Postgres fallback only when the development service key is absent", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.DATABASE_URL = "postgresql://development.invalid/aistart360";

    const response = await POST(request(payload()));

    expect(response.status).toBe(200);
    expect(repository.recordWebhookEvent).not.toHaveBeenCalled();
    expect(postgres.recordWebhookEvent).toHaveBeenCalledOnce();
    expect(postgres.ingestNormalizedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        externalMessageId: "waweb:primary:MESSAGE123",
      }),
    );
    expect(postgres.transitionWebhookEvent).toHaveBeenCalledWith(
      "pg-audit-1",
      "processed",
    );
    expect(queue.send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "omnichannel-message-pg-message-1",
      }),
    );
  });

  it("does not enqueue persistence-only catch-up from the Postgres fallback", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.DATABASE_URL = "postgresql://development.invalid/aistart360";
    postgres.ingestNormalizedMessage.mockResolvedValue({
      duplicate: false,
      messageId: "pg-import-1",
      conversationId: "pg-conversation-1",
      shouldQueue: false,
    });

    const response = await POST(request(payload({ live: false })));

    expect(response.status).toBe(200);
    expect(postgres.ingestNormalizedMessage).toHaveBeenCalledOnce();
    expect(queue.send).not.toHaveBeenCalled();
    expect(directProcessor.process).not.toHaveBeenCalled();
    expect(postgres.transitionWebhookEvent).toHaveBeenCalledWith(
      "pg-audit-1",
      "processed",
    );
  });

  it("never selects the direct Postgres fallback in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.OMNICHANNEL_INLINE_PROCESSING = "true";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.DATABASE_URL = "postgresql://production.invalid/aistart360";

    const response = await POST(request(payload()));

    expect(response.status).toBe(200);
    expect(repository.recordWebhookEvent).toHaveBeenCalledOnce();
    expect(postgres.recordWebhookEvent).not.toHaveBeenCalled();
    expect(queue.send).toHaveBeenCalledOnce();
    expect(directProcessor.process).not.toHaveBeenCalled();
  });

  it("never selects the direct Postgres fallback in test-like environments", async () => {
    vi.stubEnv("NODE_ENV", "test");
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.DATABASE_URL = "postgresql://test.invalid/aistart360";

    const response = await POST(request(payload()));

    expect(response.status).toBe(200);
    expect(repository.recordWebhookEvent).toHaveBeenCalledOnce();
    expect(postgres.recordWebhookEvent).not.toHaveBeenCalled();
  });
});
