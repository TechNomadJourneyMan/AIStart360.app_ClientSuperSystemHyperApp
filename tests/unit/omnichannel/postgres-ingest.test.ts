import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  claimWebhookEventForProcessing,
  ingestNormalizedMessage,
  recordWebhookEvent,
  transitionWebhookEvent,
} from "@/lib/omnichannel/postgres-ingest";
import type { NormalizedOmnichannelMessage } from "@/lib/omnichannel/types";

type QueryResult = { rows: unknown[]; rowCount?: number | null };

function poolWith(results: Array<QueryResult | Error>) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [], rowCount: null };
    }
    const next = results.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error(`Unexpected query: ${sql}`);
    return next;
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return {
    pool: { connect } as unknown as Pick<Pool, "connect">,
    query,
    release,
  };
}

function message(
  overrides: Partial<NormalizedOmnichannelMessage> = {},
): NormalizedOmnichannelMessage {
  return {
    eventType: "message",
    channel: "whatsapp",
    accountExternalId: "waweb:primary",
    conversationExternalId: "77011234567@s.whatsapp.net",
    contactExternalId: "77011234567",
    contactName: "Марина",
    contactPhone: "+77011234567",
    externalMessageId: "waweb:primary:MESSAGE123",
    direction: "in",
    messageType: "text",
    text: "private customer text",
    status: "received",
    replyToExternalId: null,
    occurredAt: "2026-07-14T18:00:00.000Z",
    metadata: { transport: "whatsapp_web", live: true },
    ...overrides,
  };
}

describe("direct Postgres omnichannel ingestion", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("records a webhook transactionally with parameterized values", async () => {
    const fake = poolWith([{ rows: [{ id: "audit-1", status: "received" }] }]);

    const result = await recordWebhookEvent(
      {
        channel: "whatsapp",
        eventHash: "secret-event-hash",
        metadata: { transport: "whatsapp_web" },
      },
      fake.pool,
    );

    expect(result).toEqual({
      id: "audit-1",
      status: "received",
      duplicate: false,
    });
    expect(fake.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("INSERT INTO public.omnichannel_webhook_events"),
      "COMMIT",
    ]);
    const insert = fake.query.mock.calls[1];
    expect(insert[0]).not.toContain("secret-event-hash");
    expect(insert[1]).toContain("secret-event-hash");
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("returns the existing webhook deterministically on conflict", async () => {
    const fake = poolWith([
      { rows: [] },
      { rows: [{ id: "audit-existing", status: "processed" }] },
    ]);

    await expect(
      recordWebhookEvent(
        {
          channel: "whatsapp",
          eventHash: "same-event",
        },
        fake.pool,
      ),
    ).resolves.toEqual({
      id: "audit-existing",
      status: "processed",
      duplicate: true,
    });
  });

  it("atomically claims only a recoverable webhook audit", async () => {
    const fake = poolWith([{ rows: [{ claimed: true }] }]);

    await expect(
      claimWebhookEventForProcessing("audit-1", fake.pool),
    ).resolves.toBe(true);

    const claim = fake.query.mock.calls[1];
    expect(claim?.[0]).toContain(
      "public.claim_omnichannel_webhook_event($1::uuid)",
    );
    expect(claim?.[0]).not.toContain("audit-1");
    expect(claim?.[1]).toEqual(["audit-1"]);
  });

  it("does not acquire an in-flight or terminal webhook audit", async () => {
    const fake = poolWith([{ rows: [{ claimed: false }] }]);

    await expect(
      claimWebhookEventForProcessing("audit-owned", fake.pool),
    ).resolves.toBe(false);
  });

  it("fails closed when the leased claim function returns no row", async () => {
    const fake = poolWith([{ rows: [] }]);

    await expect(
      claimWebhookEventForProcessing("audit-missing", fake.pool),
    ).resolves.toBe(false);
  });

  it("stores offline history as imported without queueing per-message AI", async () => {
    const fake = poolWith([
      { rows: [{ id: "contact-1" }] },
      { rows: [{ id: "conversation-1" }] },
      {
        rows: [
          {
            id: "message-1",
            conversation_id: "conversation-1",
            direction: "in",
            status: "imported",
          },
        ],
      },
    ]);

    const result = await ingestNormalizedMessage(
      message({
        metadata: {
          transport: "whatsapp_web",
          live: false,
          catchUp: true,
          offline: true,
        },
      }),
      fake.pool,
    );

    expect(result).toEqual({
      duplicate: false,
      messageId: "message-1",
      conversationId: "conversation-1",
      shouldQueue: false,
    });
    const insert = fake.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO public.omnichannel_messages"),
    );
    expect(insert?.[0]).not.toContain("private customer text");
    expect(insert?.[1]).toContain("private customer text");
    expect(insert?.[1]?.[6]).toBe("imported");
  });

  it("never queues an offline retry even when the existing row is recoverable", async () => {
    const fake = poolWith([
      { rows: [{ id: "contact-1" }] },
      { rows: [{ id: "conversation-1" }] },
      { rows: [] },
      {
        rows: [
          {
            id: "message-existing",
            conversation_id: "conversation-1",
            direction: "in",
            status: "received",
          },
        ],
      },
    ]);

    const result = await ingestNormalizedMessage(
      message({
        metadata: { transport: "whatsapp_web", live: false, catchUp: true },
      }),
      fake.pool,
    );

    expect(result).toEqual(
      expect.objectContaining({
        duplicate: true,
        shouldQueue: false,
      }),
    );
  });

  it("rolls back, releases the client, and truncates transition errors", async () => {
    const fake = poolWith([new Error("write failed")]);

    await expect(
      transitionWebhookEvent("audit-1", "failed", "x".repeat(700), fake.pool),
    ).rejects.toThrow("transition webhook event: write failed");

    expect(fake.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it.each(["production", "test"])(
    "refuses unconfigured direct database writes in %s even with an injected pool",
    async (nodeEnv) => {
      const fake = poolWith([]);
      vi.stubEnv("NODE_ENV", nodeEnv);

      await expect(
        recordWebhookEvent(
          {
            channel: "whatsapp",
            eventHash: "event-1",
          },
          fake.pool,
        ),
      ).rejects.toThrow("ingestion is disabled");
      expect(fake.pool.connect).not.toHaveBeenCalled();
    },
  );

  it("allows an explicitly configured production adapter even when the shared app has a service key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OMNICHANNEL_PERSISTENCE", "postgres");
    vi.stubEnv("OMNICHANNEL_DATABASE_URL", "postgres://restricted/runtime");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "shared-app-service-key");
    const fake = poolWith([{ rows: [{ id: "audit-1", status: "received" }] }]);

    await expect(
      recordWebhookEvent(
        { channel: "whatsapp", eventHash: "event-production" },
        fake.pool,
      ),
    ).resolves.toEqual({ id: "audit-1", status: "received", duplicate: false });
  });
});
