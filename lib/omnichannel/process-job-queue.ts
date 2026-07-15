import { processOmnichannelMessageDirect } from "@/lib/functions/process-omnichannel-message";
import {
  claimOmnichannelProcessingJob,
  completeOmnichannelProcessingJob,
  retryOmnichannelProcessingJob,
  type OmnichannelProcessingJob,
} from "@/lib/omnichannel/processing-jobs";

const DEFAULT_DRAIN_LIMIT = 1;
const MAX_DRAIN_LIMIT = 20;
const DEFAULT_LEASE_SECONDS = 300;
const MIN_LEASE_SECONDS = 15;
const MAX_LEASE_SECONDS = 900;
const PROCESSING_FAILURE_CODE = "worker.processing_failed";
const SEND_STATE_UNRESOLVED_CODE = "worker.send_state_unresolved";

export interface DrainOmnichannelProcessingJobsInput {
  limit?: number;
  leaseSeconds?: number;
}

export type OmnichannelProcessingJobOutcome =
  | "completed"
  | "requeued"
  | "dead"
  | "lease_lost"
  | "transition_failed"
  | "claim_failed";

export interface OmnichannelProcessingJobDrainItem {
  /** Queue identifier only. Customer and exception text are never returned. */
  jobId: string | null;
  outcome: OmnichannelProcessingJobOutcome;
}

export interface DrainOmnichannelProcessingJobsResult {
  limit: number;
  claimed: number;
  completed: number;
  requeued: number;
  dead: number;
  processingFailed: number;
  leaseLost: number;
  transitionFailed: number;
  claimFailed: number;
  queueEmpty: boolean;
  results: OmnichannelProcessingJobDrainItem[];
}

function boundedInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function initialResult(limit: number): DrainOmnichannelProcessingJobsResult {
  return {
    limit,
    claimed: 0,
    completed: 0,
    requeued: 0,
    dead: 0,
    processingFailed: 0,
    leaseLost: 0,
    transitionFailed: 0,
    claimFailed: 0,
    queueEmpty: false,
    results: [],
  };
}

function isUnresolvedSendState(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const outcome = value as { skipped?: unknown; reason?: unknown };
  return outcome.skipped === true && outcome.reason === "already_sending";
}

/**
 * Drains due jobs sequentially. Database leases are the concurrency boundary;
 * the worker never starts a second job before the first one has reached a
 * fenced terminal/retry transition.
 *
 * Returned diagnostics deliberately contain only counters, queue identifiers,
 * and fixed machine outcomes. Processor results and exception prose are never
 * retained, returned, or forwarded to the retry RPC.
 */
export async function drainOmnichannelProcessingJobs(
  input: DrainOmnichannelProcessingJobsInput = {},
): Promise<DrainOmnichannelProcessingJobsResult> {
  const limit = boundedInteger(
    input.limit ?? DEFAULT_DRAIN_LIMIT,
    "limit",
    1,
    MAX_DRAIN_LIMIT,
  );
  const leaseSeconds = boundedInteger(
    input.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
    "leaseSeconds",
    MIN_LEASE_SECONDS,
    MAX_LEASE_SECONDS,
  );
  const result = initialResult(limit);

  for (let index = 0; index < limit; index += 1) {
    let job: OmnichannelProcessingJob | null;
    try {
      job = await claimOmnichannelProcessingJob({ leaseSeconds });
    } catch {
      result.claimFailed += 1;
      result.results.push({ jobId: null, outcome: "claim_failed" });
      break;
    }

    if (!job) {
      result.queueEmpty = true;
      break;
    }

    result.claimed += 1;
    const jobId = job.id;
    const leaseToken = job.leaseToken;
    if (!leaseToken) {
      result.leaseLost += 1;
      result.results.push({ jobId, outcome: "lease_lost" });
      break;
    }

    let processingFailureCode = PROCESSING_FAILURE_CODE;
    try {
      const processorOutcome = await processOmnichannelMessageDirect({
        message_id: job.messageId,
        conversation_id: job.conversationId,
        force_draft: job.forceDraft,
        delay_already_applied: true,
      });
      if (isUnresolvedSendState(processorOutcome)) {
        // A rolling/older processor can surface this as a normal-looking skip.
        // It is not terminal: completing the durable job would strand the
        // inbound row in `sending` until maintenance. Requeue it so a current
        // processor can escalate the delivery-unknown state without resending.
        processingFailureCode = SEND_STATE_UNRESOLVED_CODE;
        throw new Error(SEND_STATE_UNRESOLVED_CODE);
      }
    } catch {
      result.processingFailed += 1;

      try {
        const retry = await retryOmnichannelProcessingJob({
          jobId,
          leaseToken,
          errorCode: processingFailureCode,
          retryable: true,
        });
        if (!retry.accepted) {
          result.leaseLost += 1;
          result.results.push({ jobId, outcome: "lease_lost" });
          break;
        }
        if (retry.status === "dead") {
          result.dead += 1;
          result.results.push({ jobId, outcome: "dead" });
        } else {
          result.requeued += 1;
          result.results.push({ jobId, outcome: "requeued" });
        }
      } catch {
        result.transitionFailed += 1;
        result.results.push({ jobId, outcome: "transition_failed" });
        break;
      }
      continue;
    }

    try {
      const completed = await completeOmnichannelProcessingJob({
        jobId,
        leaseToken,
      });
      if (!completed) {
        result.leaseLost += 1;
        result.results.push({ jobId, outcome: "lease_lost" });
        break;
      }
      result.completed += 1;
      result.results.push({ jobId, outcome: "completed" });
    } catch {
      // Completion is ambiguous. Do not retry the processor or mutate the job
      // with a possibly stale token; the lease can expire and be reclaimed.
      result.transitionFailed += 1;
      result.results.push({ jobId, outcome: "transition_failed" });
      break;
    }
  }

  return result;
}
