import { beforeEach, describe, expect, it, vi } from "vitest";

const jobs = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  retry: vi.fn(),
}));
const processor = vi.hoisted(() => ({ process: vi.fn() }));

vi.mock("@/lib/omnichannel/processing-jobs", () => ({
  claimOmnichannelProcessingJob: jobs.claim,
  completeOmnichannelProcessingJob: jobs.complete,
  retryOmnichannelProcessingJob: jobs.retry,
}));
vi.mock("@/lib/functions/process-omnichannel-message", () => ({
  processOmnichannelMessageDirect: processor.process,
}));

import { drainOmnichannelProcessingJobs } from "@/lib/omnichannel/process-job-queue";

const JOB_ID = "00000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "00000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000003";
const LEASE_TOKEN = "00000000-0000-4000-8000-000000000004";

function leasedJob(index = 1, overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID.slice(0, -1) + index,
    messageId: MESSAGE_ID.slice(0, -1) + index,
    conversationId: CONVERSATION_ID,
    status: "leased" as const,
    forceDraft: false,
    runAt: "2026-07-15T10:00:00.000Z",
    attempts: 1,
    maxAttempts: 5,
    leaseToken: LEASE_TOKEN.slice(0, -1) + index,
    leaseUntil: "2026-07-15T10:05:00.000Z",
    ...overrides,
  };
}

describe("durable omnichannel processing queue drain", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    processor.process.mockResolvedValue({ action: "send" });
    jobs.complete.mockResolvedValue(true);
    jobs.retry.mockResolvedValue({
      accepted: true,
      status: "queued",
      runAt: "2026-07-15T10:01:00.000Z",
    });
  });

  it("returns a sanitized empty result when no due job can be claimed", async () => {
    jobs.claim.mockResolvedValue(null);

    await expect(drainOmnichannelProcessingJobs()).resolves.toEqual({
      limit: 1,
      claimed: 0,
      completed: 0,
      requeued: 0,
      dead: 0,
      processingFailed: 0,
      leaseLost: 0,
      transitionFailed: 0,
      claimFailed: 0,
      queueEmpty: true,
      results: [],
    });
    expect(jobs.claim).toHaveBeenCalledWith({ leaseSeconds: 300 });
    expect(processor.process).not.toHaveBeenCalled();
  });

  it("processes sequentially, marks the configured delay as applied, and completes by lease token", async () => {
    const job = leasedJob(1, { forceDraft: true });
    jobs.claim.mockResolvedValueOnce(job).mockResolvedValueOnce(null);
    processor.process.mockResolvedValue({
      action: "send",
      unsafeCustomerText: "не должно попасть в результат",
    });

    const result = await drainOmnichannelProcessingJobs({
      limit: 2,
      leaseSeconds: 120,
    });

    expect(processor.process).toHaveBeenCalledWith({
      message_id: job.messageId,
      conversation_id: job.conversationId,
      force_draft: true,
      delay_already_applied: true,
      processing_owner: `database-job:${job.id}`,
    });
    expect(jobs.complete).toHaveBeenCalledWith({
      jobId: job.id,
      leaseToken: job.leaseToken,
    });
    expect(jobs.retry).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      claimed: 1,
      completed: 1,
      queueEmpty: true,
      results: [{ jobId: job.id, outcome: "completed" }],
    });
    expect(JSON.stringify(result)).not.toContain("не должно");
  });

  it("requeues a processor failure with a fixed machine code and no exception prose", async () => {
    const privateText = "Customer said: send the red jacket to Marina";
    const job = leasedJob();
    jobs.claim.mockResolvedValueOnce(job).mockResolvedValueOnce(null);
    processor.process.mockRejectedValue(new Error(privateText));

    const result = await drainOmnichannelProcessingJobs({ limit: 2 });

    expect(jobs.retry).toHaveBeenCalledWith({
      jobId: job.id,
      leaseToken: job.leaseToken,
      errorCode: "worker.processing_failed",
      retryable: true,
    });
    expect(result).toMatchObject({
      claimed: 1,
      processingFailed: 1,
      requeued: 1,
      queueEmpty: true,
      results: [{ jobId: job.id, outcome: "requeued" }],
    });
    expect(JSON.stringify(jobs.retry.mock.calls)).not.toContain(privateText);
    expect(JSON.stringify(result)).not.toContain(privateText);
  });

  it.each(["already_sending", "send_owned_by_other_worker"])(
    "does not complete the non-terminal %s processor outcome",
    async (reason) => {
      const job = leasedJob();
      jobs.claim.mockResolvedValueOnce(job).mockResolvedValueOnce(null);
      processor.process.mockResolvedValue({
        skipped: true,
        reason,
      });

      const result = await drainOmnichannelProcessingJobs({ limit: 2 });

      expect(jobs.complete).not.toHaveBeenCalled();
      expect(jobs.retry).toHaveBeenCalledWith({
        jobId: job.id,
        leaseToken: job.leaseToken,
        errorCode: "worker.send_state_unresolved",
        retryable: true,
      });
      expect(result).toMatchObject({
        claimed: 1,
        processingFailed: 1,
        requeued: 1,
        queueEmpty: true,
        results: [{ jobId: job.id, outcome: "requeued" }],
      });
    },
  );

  it("reports a dead job using only a fixed outcome", async () => {
    const job = leasedJob();
    jobs.claim.mockResolvedValueOnce(job).mockResolvedValueOnce(null);
    processor.process.mockRejectedValue(
      new Error("sensitive customer content"),
    );
    jobs.retry.mockResolvedValue({
      accepted: true,
      status: "dead",
      runAt: null,
    });

    await expect(
      drainOmnichannelProcessingJobs({ limit: 2 }),
    ).resolves.toMatchObject({
      processingFailed: 1,
      dead: 1,
      results: [{ jobId: job.id, outcome: "dead" }],
    });
  });

  it("stops safely when completion loses its fenced lease", async () => {
    const job = leasedJob();
    jobs.claim.mockResolvedValue(job);
    jobs.complete.mockResolvedValue(false);

    const result = await drainOmnichannelProcessingJobs({ limit: 5 });

    expect(jobs.claim).toHaveBeenCalledTimes(1);
    expect(jobs.retry).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      claimed: 1,
      completed: 0,
      leaseLost: 1,
      results: [{ jobId: job.id, outcome: "lease_lost" }],
    });
  });

  it("does not retry an ambiguously failed completion or expose its error text", async () => {
    const job = leasedJob();
    const privateText =
      "completion failed after reply to private customer text";
    jobs.claim.mockResolvedValue(job);
    jobs.complete.mockRejectedValue(new Error(privateText));

    const result = await drainOmnichannelProcessingJobs({ limit: 5 });

    expect(jobs.claim).toHaveBeenCalledTimes(1);
    expect(jobs.retry).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      claimed: 1,
      completed: 0,
      transitionFailed: 1,
      results: [{ jobId: job.id, outcome: "transition_failed" }],
    });
    expect(JSON.stringify(result)).not.toContain(privateText);
  });

  it("treats a rejected retry transition as a lost lease and does not keep draining", async () => {
    const job = leasedJob();
    jobs.claim.mockResolvedValue(job);
    processor.process.mockRejectedValue(new Error("private failure"));
    jobs.retry.mockResolvedValue({
      accepted: false,
      status: null,
      runAt: null,
    });

    const result = await drainOmnichannelProcessingJobs({ limit: 5 });

    expect(jobs.claim).toHaveBeenCalledTimes(1);
    expect(jobs.complete).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      processingFailed: 1,
      leaseLost: 1,
      results: [{ jobId: job.id, outcome: "lease_lost" }],
    });
  });

  it("sanitizes claim and transition failures instead of returning thrown prose", async () => {
    const claimSecret = "database error containing a phone number";
    jobs.claim.mockRejectedValueOnce(new Error(claimSecret));

    const claimResult = await drainOmnichannelProcessingJobs({ limit: 3 });
    expect(claimResult).toMatchObject({
      claimFailed: 1,
      results: [{ jobId: null, outcome: "claim_failed" }],
    });
    expect(JSON.stringify(claimResult)).not.toContain(claimSecret);

    vi.resetAllMocks();
    const job = leasedJob();
    const transitionSecret = "retry failed after customer wrote hello";
    jobs.claim.mockResolvedValue(job);
    processor.process.mockRejectedValue(new Error("customer wrote hello"));
    jobs.retry.mockRejectedValue(new Error(transitionSecret));

    const transitionResult = await drainOmnichannelProcessingJobs({ limit: 3 });
    expect(jobs.claim).toHaveBeenCalledTimes(1);
    expect(transitionResult).toMatchObject({
      processingFailed: 1,
      transitionFailed: 1,
      results: [{ jobId: job.id, outcome: "transition_failed" }],
    });
    expect(JSON.stringify(transitionResult)).not.toContain(
      "customer wrote hello",
    );
    expect(JSON.stringify(transitionResult)).not.toContain(transitionSecret);
  });

  it("never claims more than the explicit bounded limit", async () => {
    jobs.claim
      .mockResolvedValueOnce(leasedJob(1))
      .mockResolvedValueOnce(leasedJob(2))
      .mockResolvedValueOnce(leasedJob(3));

    const result = await drainOmnichannelProcessingJobs({ limit: 2 });

    expect(jobs.claim).toHaveBeenCalledTimes(2);
    expect(processor.process).toHaveBeenCalledTimes(2);
    expect(jobs.complete).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      claimed: 2,
      completed: 2,
      queueEmpty: false,
    });
    expect(result.results).toHaveLength(2);
  });

  it("rejects unsafe bounds before claiming a job", async () => {
    await expect(drainOmnichannelProcessingJobs({ limit: 0 })).rejects.toThrow(
      "limit",
    );
    await expect(drainOmnichannelProcessingJobs({ limit: 21 })).rejects.toThrow(
      "limit",
    );
    await expect(
      drainOmnichannelProcessingJobs({ leaseSeconds: 901 }),
    ).rejects.toThrow("leaseSeconds");
    expect(jobs.claim).not.toHaveBeenCalled();
  });
});
