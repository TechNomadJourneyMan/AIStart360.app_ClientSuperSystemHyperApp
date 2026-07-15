import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";
import { createServiceClient } from "@/lib/supabase-service";
import {
  omnichannelPostgresPool,
  shouldUseOmnichannelPostgres,
} from "@/lib/omnichannel/postgres-runtime";

export type OmnichannelProcessingJobStatus =
  "queued" | "leased" | "succeeded" | "dead";

export interface OmnichannelProcessingJob {
  id: string;
  messageId: string;
  conversationId: string;
  status: OmnichannelProcessingJobStatus;
  forceDraft: boolean;
  runAt: string;
  attempts: number;
  maxAttempts: number;
  leaseToken: string | null;
  leaseUntil: string | null;
}

export interface EnqueueOmnichannelProcessingJobInput {
  messageId: string;
  forceDraft?: boolean;
  runAt?: string | Date;
  maxAttempts?: number;
}

export interface ClaimOmnichannelProcessingJobInput {
  leaseSeconds?: number;
}

export interface CompleteOmnichannelProcessingJobInput {
  jobId: string;
  leaseToken: string;
}

export interface RetryOmnichannelProcessingJobInput extends CompleteOmnichannelProcessingJobInput {
  /** Stable machine code only. Never pass exception prose or message text. */
  errorCode: string;
  retryable?: boolean;
  retryAfterSeconds?: number | null;
}

export interface RetryOmnichannelProcessingJobResult {
  accepted: boolean;
  status: "queued" | "dead" | null;
  runAt: string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,119}$/;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LEASE_SECONDS = 180;
const MAX_ENQUEUE_BATCH_SIZE = 100;

type ProcessingJobRow = {
  job_id?: unknown;
  message_id?: unknown;
  conversation_id?: unknown;
  status?: unknown;
  force_draft?: unknown;
  run_at?: unknown;
  attempts?: unknown;
  max_attempts?: unknown;
  lease_token?: unknown;
  lease_until?: unknown;
};

type Queryable = Pick<Pool, "query">;

function databaseError(
  operation: string,
  error: { message?: string } | null,
): Error {
  return new Error(
    `${operation}: ${error?.message?.slice(0, 300) || "database error"}`,
  );
}

function requiredUuid(value: string, name: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${name} must be a UUID`);
  }
  return value;
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

function normalizedRunAt(value: string | Date | undefined): string | null {
  // NULL delegates the normal reply-delay schedule to the database. This
  // keeps the delay durable across serverless invocations and retries.
  if (value === undefined) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("runAt must be a valid timestamp");
  }
  return date.toISOString();
}

function processingJobStatus(value: unknown): OmnichannelProcessingJobStatus {
  if (
    value === "queued" ||
    value === "leased" ||
    value === "succeeded" ||
    value === "dead"
  ) {
    return value;
  }
  throw new Error("processing job database returned an invalid status");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`processing job database returned an invalid ${field}`);
  }
  return value;
}

function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`processing job database returned an invalid ${field}`);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value, field);
}

function requiredTimestamp(value: unknown, field: string): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  const raw = requiredString(value, field);
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`processing job database returned an invalid ${field}`);
  }
  return date.toISOString();
}

function nullableTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return requiredTimestamp(value, field);
}

function mapProcessingJob(value: unknown): OmnichannelProcessingJob {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("processing job database returned an invalid row");
  }
  const row = value as ProcessingJobRow;
  const status = processingJobStatus(row.status);
  const forceDraft = row.force_draft;
  if (typeof forceDraft !== "boolean") {
    throw new Error("processing job database returned an invalid force_draft");
  }

  const job: OmnichannelProcessingJob = {
    id: requiredString(row.job_id, "job_id"),
    messageId: requiredString(row.message_id, "message_id"),
    conversationId: requiredString(row.conversation_id, "conversation_id"),
    status,
    forceDraft,
    runAt: requiredTimestamp(row.run_at, "run_at"),
    attempts: requiredInteger(row.attempts, "attempts"),
    maxAttempts: requiredInteger(row.max_attempts, "max_attempts"),
    leaseToken: nullableString(row.lease_token, "lease_token"),
    leaseUntil: nullableTimestamp(row.lease_until, "lease_until"),
  };

  if (status === "leased" && (!job.leaseToken || !job.leaseUntil)) {
    throw new Error("processing job database returned an unfenced lease");
  }
  return job;
}

/**
 * Service-role RPC path only. The queue table itself is read-only to the
 * service role; enqueue/claim/complete/retry are database-owned transitions.
 */
export function createProcessingJobsAdminClient(): SupabaseClient {
  return createServiceClient();
}

export async function enqueueOmnichannelProcessingJobViaPostgres(
  input: EnqueueOmnichannelProcessingJobInput,
  db: Queryable = omnichannelPostgresPool(),
): Promise<OmnichannelProcessingJob> {
  const messageId = requiredUuid(input.messageId, "messageId");
  const maxAttempts = boundedInteger(
    input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    "maxAttempts",
    1,
    20,
  );
  const result = await db.query(
    `SELECT *
       FROM public.enqueue_omnichannel_processing_job(
         $1::uuid, $2::boolean, $3::timestamptz, $4::integer
       )`,
    [
      messageId,
      input.forceDraft ?? false,
      normalizedRunAt(input.runAt),
      maxAttempts,
    ],
  );
  if (!result.rows[0]) {
    throw new Error(
      "enqueue omnichannel processing job: database returned no row",
    );
  }
  return mapProcessingJob(result.rows[0]);
}

/**
 * Enqueue a bounded set in one Postgres statement while retaining the single-
 * message RPC as the only queue state transition. The RPC's unique message
 * constraint makes a repeated admin request idempotent, and its SECURITY
 * DEFINER boundary means the runtime role still needs no direct table writes.
 */
export async function enqueueOmnichannelProcessingJobsViaPostgres(
  inputs: readonly EnqueueOmnichannelProcessingJobInput[],
  db: Queryable = omnichannelPostgresPool(),
): Promise<OmnichannelProcessingJob[]> {
  if (inputs.length === 0) return [];
  if (inputs.length > MAX_ENQUEUE_BATCH_SIZE) {
    throw new Error(
      `processing job batch must contain at most ${MAX_ENQUEUE_BATCH_SIZE} items`,
    );
  }

  const normalized = inputs.map((input) => ({
    messageId: requiredUuid(input.messageId, "messageId"),
    forceDraft: input.forceDraft ?? false,
    runAt: normalizedRunAt(input.runAt),
    maxAttempts: boundedInteger(
      input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      "maxAttempts",
      1,
      20,
    ),
  }));
  const result = await db.query(
    `SELECT queued.*
       FROM unnest(
         $1::uuid[], $2::boolean[], $3::timestamptz[], $4::integer[]
       ) WITH ORDINALITY AS input(
         message_id, force_draft, run_at, max_attempts, input_order
       )
       CROSS JOIN LATERAL public.enqueue_omnichannel_processing_job(
         input.message_id,
         input.force_draft,
         input.run_at,
         input.max_attempts
       ) AS queued
      ORDER BY input.input_order`,
    [
      normalized.map((input) => input.messageId),
      normalized.map((input) => input.forceDraft),
      normalized.map((input) => input.runAt),
      normalized.map((input) => input.maxAttempts),
    ],
  );
  if (result.rows.length !== normalized.length) {
    throw new Error(
      "enqueue omnichannel processing jobs: database returned an incomplete batch",
    );
  }
  return result.rows.map(mapProcessingJob);
}

export async function enqueueOmnichannelProcessingJob(
  input: EnqueueOmnichannelProcessingJobInput,
  client?: SupabaseClient,
): Promise<OmnichannelProcessingJob> {
  if (!client && shouldUseOmnichannelPostgres()) {
    return enqueueOmnichannelProcessingJobViaPostgres(input);
  }
  client ??= createProcessingJobsAdminClient();
  const messageId = requiredUuid(input.messageId, "messageId");
  const maxAttempts = boundedInteger(
    input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    "maxAttempts",
    1,
    20,
  );
  const { data, error } = await client
    .rpc("enqueue_omnichannel_processing_job", {
      p_message_id: messageId,
      p_force_draft: input.forceDraft ?? false,
      p_run_at: normalizedRunAt(input.runAt),
      p_max_attempts: maxAttempts,
    })
    .maybeSingle();

  if (error) throw databaseError("enqueue omnichannel processing job", error);
  if (!data) {
    throw new Error(
      "enqueue omnichannel processing job: database returned no row",
    );
  }
  return mapProcessingJob(data);
}

export async function claimOmnichannelProcessingJobViaPostgres(
  input: ClaimOmnichannelProcessingJobInput = {},
  db: Queryable = omnichannelPostgresPool(),
): Promise<OmnichannelProcessingJob | null> {
  const leaseSeconds = boundedInteger(
    input.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
    "leaseSeconds",
    15,
    900,
  );
  const result = await db.query(
    `SELECT *
       FROM public.claim_omnichannel_processing_job($1::integer)`,
    [leaseSeconds],
  );
  if (!result.rows[0]) return null;
  const job = mapProcessingJob(result.rows[0]);
  if (job.status !== "leased") {
    throw new Error(
      "claim omnichannel processing job: database did not lease job",
    );
  }
  return job;
}

export async function claimOmnichannelProcessingJob(
  input: ClaimOmnichannelProcessingJobInput = {},
  client?: SupabaseClient,
): Promise<OmnichannelProcessingJob | null> {
  if (!client && shouldUseOmnichannelPostgres()) {
    return claimOmnichannelProcessingJobViaPostgres(input);
  }
  client ??= createProcessingJobsAdminClient();
  const leaseSeconds = boundedInteger(
    input.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
    "leaseSeconds",
    15,
    900,
  );
  const { data, error } = await client
    .rpc("claim_omnichannel_processing_job", {
      p_lease_seconds: leaseSeconds,
    })
    .maybeSingle();

  if (error) throw databaseError("claim omnichannel processing job", error);
  if (!data) return null;
  const job = mapProcessingJob(data);
  if (job.status !== "leased") {
    throw new Error(
      "claim omnichannel processing job: database did not lease job",
    );
  }
  return job;
}

export async function completeOmnichannelProcessingJobViaPostgres(
  input: CompleteOmnichannelProcessingJobInput,
  db: Queryable = omnichannelPostgresPool(),
): Promise<boolean> {
  const result = await db.query(
    `SELECT completed
       FROM public.complete_omnichannel_processing_job($1::uuid, $2::uuid)`,
    [
      requiredUuid(input.jobId, "jobId"),
      requiredUuid(input.leaseToken, "leaseToken"),
    ],
  );
  return result.rows[0]?.completed === true;
}

export async function completeOmnichannelProcessingJob(
  input: CompleteOmnichannelProcessingJobInput,
  client?: SupabaseClient,
): Promise<boolean> {
  if (!client && shouldUseOmnichannelPostgres()) {
    return completeOmnichannelProcessingJobViaPostgres(input);
  }
  client ??= createProcessingJobsAdminClient();
  const { data, error } = await client
    .rpc("complete_omnichannel_processing_job", {
      p_job_id: requiredUuid(input.jobId, "jobId"),
      p_lease_token: requiredUuid(input.leaseToken, "leaseToken"),
    })
    .maybeSingle();

  if (error) throw databaseError("complete omnichannel processing job", error);
  const row = data as { completed?: unknown } | null;
  return row?.completed === true;
}

export async function retryOmnichannelProcessingJobViaPostgres(
  input: RetryOmnichannelProcessingJobInput,
  db: Queryable = omnichannelPostgresPool(),
): Promise<RetryOmnichannelProcessingJobResult> {
  if (!ERROR_CODE_PATTERN.test(input.errorCode)) {
    throw new Error(
      "errorCode must be a lowercase machine code of at most 120 characters",
    );
  }
  const retryAfterSeconds =
    input.retryAfterSeconds === null || input.retryAfterSeconds === undefined
      ? null
      : boundedInteger(input.retryAfterSeconds, "retryAfterSeconds", 0, 86_400);
  const result = await db.query(
    `SELECT accepted, next_status, next_run_at
       FROM public.retry_omnichannel_processing_job(
         $1::uuid, $2::uuid, $3::text, $4::boolean, $5::integer
       )`,
    [
      requiredUuid(input.jobId, "jobId"),
      requiredUuid(input.leaseToken, "leaseToken"),
      input.errorCode,
      input.retryable ?? true,
      retryAfterSeconds,
    ],
  );
  const row = result.rows[0] as {
    accepted?: unknown;
    next_status?: unknown;
    next_run_at?: unknown;
  } | null;
  if (!row || typeof row.accepted !== "boolean") {
    throw new Error(
      "retry omnichannel processing job: database returned no result",
    );
  }
  if (!row.accepted) return { accepted: false, status: null, runAt: null };
  if (row.next_status !== "queued" && row.next_status !== "dead") {
    throw new Error("retry omnichannel processing job: invalid next status");
  }
  return {
    accepted: true,
    status: row.next_status,
    runAt: nullableTimestamp(row.next_run_at, "next_run_at"),
  };
}

export async function retryOmnichannelProcessingJob(
  input: RetryOmnichannelProcessingJobInput,
  client?: SupabaseClient,
): Promise<RetryOmnichannelProcessingJobResult> {
  if (!client && shouldUseOmnichannelPostgres()) {
    return retryOmnichannelProcessingJobViaPostgres(input);
  }
  client ??= createProcessingJobsAdminClient();
  if (!ERROR_CODE_PATTERN.test(input.errorCode)) {
    throw new Error(
      "errorCode must be a lowercase machine code of at most 120 characters",
    );
  }
  const retryAfterSeconds =
    input.retryAfterSeconds === null || input.retryAfterSeconds === undefined
      ? null
      : boundedInteger(input.retryAfterSeconds, "retryAfterSeconds", 0, 86_400);
  const { data, error } = await client
    .rpc("retry_omnichannel_processing_job", {
      p_job_id: requiredUuid(input.jobId, "jobId"),
      p_lease_token: requiredUuid(input.leaseToken, "leaseToken"),
      p_error_code: input.errorCode,
      p_retryable: input.retryable ?? true,
      p_retry_after_seconds: retryAfterSeconds,
    })
    .maybeSingle();

  if (error) throw databaseError("retry omnichannel processing job", error);
  const row = data as {
    accepted?: unknown;
    next_status?: unknown;
    next_run_at?: unknown;
  } | null;
  if (!row || typeof row.accepted !== "boolean") {
    throw new Error(
      "retry omnichannel processing job: database returned no result",
    );
  }
  if (!row.accepted) {
    return { accepted: false, status: null, runAt: null };
  }
  if (row.next_status !== "queued" && row.next_status !== "dead") {
    throw new Error("retry omnichannel processing job: invalid next status");
  }
  return {
    accepted: true,
    status: row.next_status,
    runAt: nullableTimestamp(row.next_run_at, "next_run_at"),
  };
}
