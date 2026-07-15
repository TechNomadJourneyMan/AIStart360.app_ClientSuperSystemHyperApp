import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  claimOmnichannelProcessingJob,
  claimOmnichannelProcessingJobViaPostgres,
  completeOmnichannelProcessingJob,
  completeOmnichannelProcessingJobViaPostgres,
  enqueueOmnichannelProcessingJob,
  enqueueOmnichannelProcessingJobViaPostgres,
  enqueueOmnichannelProcessingJobsViaPostgres,
  retryOmnichannelProcessingJob,
  retryOmnichannelProcessingJobViaPostgres,
} from "@/lib/omnichannel/processing-jobs";

const JOB_ID = "00000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "00000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000003";
const LEASE_TOKEN = "00000000-0000-4000-8000-000000000004";
const RUN_AT = "2026-07-15T10:00:00.000Z";
const LEASE_UNTIL = "2026-07-15T10:03:00.000Z";

function processingJobRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    job_id: JOB_ID,
    message_id: MESSAGE_ID,
    conversation_id: CONVERSATION_ID,
    status: "queued",
    force_draft: false,
    run_at: RUN_AT,
    attempts: 0,
    max_attempts: 5,
    lease_token: null,
    lease_until: null,
    ...overrides,
  };
}

function rpcClient(result: {
  data: unknown;
  error: { message?: string } | null;
}) {
  const maybeSingle = vi.fn(async () => result);
  const rpc = vi.fn((_name: string, _parameters?: Record<string, unknown>) => ({
    maybeSingle,
  }));
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
    maybeSingle,
  };
}

describe("durable omnichannel processing job RPC client", () => {
  it("enqueues only identifiers and bounded control metadata", async () => {
    const fake = rpcClient({
      data: processingJobRow({ force_draft: true }),
      error: null,
    });

    await expect(
      enqueueOmnichannelProcessingJob(
        {
          messageId: MESSAGE_ID,
          forceDraft: true,
          runAt: RUN_AT,
          maxAttempts: 7,
        },
        fake.client,
      ),
    ).resolves.toEqual({
      id: JOB_ID,
      messageId: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      status: "queued",
      forceDraft: true,
      runAt: RUN_AT,
      attempts: 0,
      maxAttempts: 5,
      leaseToken: null,
      leaseUntil: null,
    });

    expect(fake.rpc).toHaveBeenCalledWith(
      "enqueue_omnichannel_processing_job",
      {
        p_message_id: MESSAGE_ID,
        p_force_draft: true,
        p_run_at: RUN_AT,
        p_max_attempts: 7,
      },
    );
    const parameters = fake.rpc.mock.calls[0]?.[1] ?? {};
    expect(Object.keys(parameters)).toEqual([
      "p_message_id",
      "p_force_draft",
      "p_run_at",
      "p_max_attempts",
    ]);
  });

  it("delegates an omitted run time to the database scheduler", async () => {
    const fake = rpcClient({
      data: processingJobRow(),
      error: null,
    });

    await enqueueOmnichannelProcessingJob(
      { messageId: MESSAGE_ID },
      fake.client,
    );

    expect(fake.rpc).toHaveBeenCalledWith(
      "enqueue_omnichannel_processing_job",
      expect.objectContaining({ p_run_at: null }),
    );
  });

  it("returns null when no due job can be claimed", async () => {
    const fake = rpcClient({ data: null, error: null });

    await expect(
      claimOmnichannelProcessingJob({}, fake.client),
    ).resolves.toBeNull();
    expect(fake.rpc).toHaveBeenCalledWith("claim_omnichannel_processing_job", {
      p_lease_seconds: 180,
    });
  });

  it("maps a claimed job only when the database returns a fenced lease", async () => {
    const fake = rpcClient({
      data: processingJobRow({
        status: "leased",
        attempts: 1,
        lease_token: LEASE_TOKEN,
        lease_until: LEASE_UNTIL,
      }),
      error: null,
    });

    await expect(
      claimOmnichannelProcessingJob({ leaseSeconds: 90 }, fake.client),
    ).resolves.toEqual(
      expect.objectContaining({
        id: JOB_ID,
        status: "leased",
        attempts: 1,
        leaseToken: LEASE_TOKEN,
        leaseUntil: LEASE_UNTIL,
      }),
    );
    expect(fake.rpc).toHaveBeenCalledWith("claim_omnichannel_processing_job", {
      p_lease_seconds: 90,
    });
  });

  it("fails closed when a claimed row has no fencing token", async () => {
    const fake = rpcClient({
      data: processingJobRow({
        status: "leased",
        attempts: 1,
        lease_until: LEASE_UNTIL,
      }),
      error: null,
    });

    await expect(
      claimOmnichannelProcessingJob({}, fake.client),
    ).rejects.toThrow("unfenced lease");
  });

  it("returns false when an expired or replaced lease cannot complete", async () => {
    const fake = rpcClient({ data: { completed: false }, error: null });

    await expect(
      completeOmnichannelProcessingJob(
        { jobId: JOB_ID, leaseToken: LEASE_TOKEN },
        fake.client,
      ),
    ).resolves.toBe(false);
    expect(fake.rpc).toHaveBeenCalledWith(
      "complete_omnichannel_processing_job",
      { p_job_id: JOB_ID, p_lease_token: LEASE_TOKEN },
    );
  });

  it("retries with a machine code and an explicit bounded delay", async () => {
    const fake = rpcClient({
      data: {
        accepted: true,
        next_status: "queued",
        next_run_at: RUN_AT,
      },
      error: null,
    });

    await expect(
      retryOmnichannelProcessingJob(
        {
          jobId: JOB_ID,
          leaseToken: LEASE_TOKEN,
          errorCode: "provider.timeout",
          retryAfterSeconds: 45,
        },
        fake.client,
      ),
    ).resolves.toEqual({
      accepted: true,
      status: "queued",
      runAt: RUN_AT,
    });
    expect(fake.rpc).toHaveBeenCalledWith("retry_omnichannel_processing_job", {
      p_job_id: JOB_ID,
      p_lease_token: LEASE_TOKEN,
      p_error_code: "provider.timeout",
      p_retryable: true,
      p_retry_after_seconds: 45,
    });
  });

  it("never forwards exception prose as a persisted queue error", async () => {
    const fake = rpcClient({ data: null, error: null });

    await expect(
      retryOmnichannelProcessingJob(
        {
          jobId: JOB_ID,
          leaseToken: LEASE_TOKEN,
          errorCode: "Customer said: send me the red jacket",
        },
        fake.client,
      ),
    ).rejects.toThrow("lowercase machine code");
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("validates lease and retry bounds before making an RPC", async () => {
    const fake = rpcClient({ data: null, error: null });

    await expect(
      claimOmnichannelProcessingJob({ leaseSeconds: 10 }, fake.client),
    ).rejects.toThrow("leaseSeconds");
    await expect(
      enqueueOmnichannelProcessingJob(
        { messageId: MESSAGE_ID, maxAttempts: 21 },
        fake.client,
      ),
    ).rejects.toThrow("maxAttempts");
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("surfaces bounded database failures", async () => {
    const fake = rpcClient({
      data: null,
      error: { message: `claim failed ${"x".repeat(500)}` },
    });

    await expect(
      claimOmnichannelProcessingJob({}, fake.client),
    ).rejects.toThrow("claim omnichannel processing job: claim failed");
    await expect(
      claimOmnichannelProcessingJob({}, fake.client),
    ).rejects.toThrow(/^[\s\S]{1,340}$/);
  });

  it("enqueues a bounded direct-Postgres batch through the idempotent RPC", async () => {
    const secondMessageId = "00000000-0000-4000-8000-000000000005";
    const query = vi.fn().mockResolvedValue({
      rows: [
        processingJobRow({ force_draft: true }),
        processingJobRow({
          job_id: "00000000-0000-4000-8000-000000000006",
          message_id: secondMessageId,
          force_draft: true,
          status: "succeeded",
        }),
      ],
    });

    await expect(
      enqueueOmnichannelProcessingJobsViaPostgres(
        [
          { messageId: MESSAGE_ID, forceDraft: true },
          {
            messageId: secondMessageId,
            forceDraft: true,
            runAt: RUN_AT,
            maxAttempts: 7,
          },
        ],
        { query } as never,
      ),
    ).resolves.toEqual([
      expect.objectContaining({ messageId: MESSAGE_ID, status: "queued" }),
      expect.objectContaining({
        messageId: secondMessageId,
        status: "succeeded",
      }),
    ]);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] ?? [];
    expect(sql).toContain("unnest(");
    expect(sql).toContain("public.enqueue_omnichannel_processing_job(");
    expect(sql).not.toContain(MESSAGE_ID);
    expect(values).toEqual([
      [MESSAGE_ID, secondMessageId],
      [true, true],
      [null, RUN_AT],
      [5, 7],
    ]);
  });

  it("rejects an oversized enqueue batch before querying Postgres", async () => {
    const query = vi.fn();
    const inputs = Array.from({ length: 101 }, () => ({
      messageId: MESSAGE_ID,
      forceDraft: true,
    }));

    await expect(
      enqueueOmnichannelProcessingJobsViaPostgres(inputs, { query } as never),
    ).rejects.toThrow("at most 100");
    expect(query).not.toHaveBeenCalled();
  });

  it("uses parameterized direct-Postgres RPC calls with the same mapped contract", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          processingJobRow({
            run_at: new Date(RUN_AT),
            force_draft: true,
          }),
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          processingJobRow({
            status: "leased",
            attempts: 1,
            run_at: new Date(RUN_AT),
            lease_token: LEASE_TOKEN,
            lease_until: new Date(LEASE_UNTIL),
          }),
        ],
      })
      .mockResolvedValueOnce({ rows: [{ completed: true }] })
      .mockResolvedValueOnce({
        rows: [
          {
            accepted: true,
            next_status: "queued",
            next_run_at: new Date(RUN_AT),
          },
        ],
      });
    const db = { query } as never;

    await expect(
      enqueueOmnichannelProcessingJobViaPostgres(
        { messageId: MESSAGE_ID, forceDraft: true, runAt: RUN_AT },
        db,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ runAt: RUN_AT, forceDraft: true }),
    );
    await expect(
      claimOmnichannelProcessingJobViaPostgres({ leaseSeconds: 60 }, db),
    ).resolves.toEqual(
      expect.objectContaining({
        leaseToken: LEASE_TOKEN,
        leaseUntil: LEASE_UNTIL,
      }),
    );
    await expect(
      completeOmnichannelProcessingJobViaPostgres(
        { jobId: JOB_ID, leaseToken: LEASE_TOKEN },
        db,
      ),
    ).resolves.toBe(true);
    await expect(
      retryOmnichannelProcessingJobViaPostgres(
        {
          jobId: JOB_ID,
          leaseToken: LEASE_TOKEN,
          errorCode: "worker.transient",
          retryAfterSeconds: 10,
        },
        db,
      ),
    ).resolves.toEqual({ accepted: true, status: "queued", runAt: RUN_AT });

    for (const [sql, values] of query.mock.calls) {
      expect(sql).toContain("public.");
      expect(sql).not.toContain(MESSAGE_ID);
      expect(sql).not.toContain(LEASE_TOKEN);
      expect(Array.isArray(values)).toBe(true);
    }
  });
});
