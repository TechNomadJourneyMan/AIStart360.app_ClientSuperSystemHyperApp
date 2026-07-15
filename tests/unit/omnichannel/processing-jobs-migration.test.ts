import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/064_omnichannel_processing_jobs.sql",
  ),
  "utf8",
);

function section(start: string, end: string): string {
  const from = migration.indexOf(start);
  const to = migration.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`missing SQL section: ${start}`);
  return migration.slice(from, to);
}

describe("064 durable omnichannel processing queue migration", () => {
  it("deduplicates by message without storing customer content", () => {
    const table = section(
      "CREATE TABLE IF NOT EXISTS public.omnichannel_processing_jobs",
      "-- Fast global scan",
    );

    expect(table).toContain("UNIQUE (message_id)");
    expect(table).toContain(
      "REFERENCES public.omnichannel_messages(id) ON DELETE CASCADE",
    );
    expect(table).not.toMatch(
      /^\s*(?:message_text|text|payload|body|content)\s+/im,
    );
    expect(table).toContain("last_error_code TEXT");
    expect(table).toContain("{0,119}");
  });

  it("uses partial indexes for ready jobs, lease recovery, and conversation ownership", () => {
    expect(migration).toMatch(
      /idx_omnichannel_processing_jobs_ready[\s\S]*?WHERE status = 'queued'/,
    );
    expect(migration).toMatch(
      /idx_omnichannel_processing_jobs_expired_lease[\s\S]*?WHERE status = 'leased'/,
    );
    expect(migration).toMatch(
      /idx_omnichannel_processing_jobs_conversation_fk\s+ON public\.omnichannel_processing_jobs \(conversation_id\)/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_omnichannel_processing_jobs_one_lease_per_conversation[\s\S]*?\(conversation_id\)[\s\S]*?WHERE status = 'leased'/,
    );
    expect(
      migration.match(
        /COMMENT ON INDEX public\.idx_omnichannel_processing_jobs_/g,
      ),
    ).toHaveLength(5);
  });

  it("claims atomically with SKIP LOCKED and preserves conversation order", () => {
    const claim = section(
      "CREATE OR REPLACE FUNCTION public.claim_omnichannel_processing_job",
      "CREATE OR REPLACE FUNCTION public.complete_omnichannel_processing_job",
    );

    expect(claim.match(/FOR UPDATE OF j SKIP LOCKED/g)).toHaveLength(2);
    expect(claim).toContain("attempts = j.attempts + 1");
    expect(claim).toContain("lease_token = gen_random_uuid()");
    expect(claim).toContain("earlier.conversation_id = j.conversation_id");
    expect(claim).toContain("active.status = 'leased'");
    expect(claim).toContain("j.run_at <= v_now");
  });

  it("derives the initial schedule in the database while preserving explicit overrides", () => {
    const enqueue = section(
      "CREATE OR REPLACE FUNCTION public.enqueue_omnichannel_processing_job",
      "CREATE OR REPLACE FUNCTION public.claim_omnichannel_processing_job",
    );

    expect(enqueue).toContain("p_run_at TIMESTAMPTZ DEFAULT NULL");
    expect(enqueue).toContain(
      "IF p_run_at IS NOT NULL AND NOT isfinite(p_run_at)",
    );
    expect(enqueue).toContain("IF p_run_at IS NOT NULL THEN");
    expect(enqueue).toContain("v_effective_run_at := p_run_at");
    expect(enqueue).toContain("ELSIF p_force_draft THEN");
    expect(enqueue).toContain("v_effective_run_at := v_now");
    expect(enqueue).toMatch(
      /SELECT s\.reply_delay_seconds[\s\S]*?FROM public\.omnichannel_settings AS s[\s\S]*?WHERE s\.channel = v_channel/,
    );
    expect(enqueue).toContain("v_effective_run_at := v_now + make_interval(");
    expect(enqueue).toMatch(
      /VALUES \([\s\S]*?v_effective_run_at,[\s\S]*?p_max_attempts::SMALLINT/,
    );
    expect(enqueue).toMatch(
      /WHEN NOT existing\.force_draft AND EXCLUDED\.force_draft[\s\S]*?THEN LEAST\(existing\.run_at, EXCLUDED\.run_at\)/,
    );
  });

  it("fences completion and retry by both token and live lease", () => {
    const complete = section(
      "CREATE OR REPLACE FUNCTION public.complete_omnichannel_processing_job",
      "CREATE OR REPLACE FUNCTION public.retry_omnichannel_processing_job",
    );
    const retry = section(
      "CREATE OR REPLACE FUNCTION public.retry_omnichannel_processing_job",
      "REVOKE ALL ON FUNCTION public.enqueue_omnichannel_processing_job",
    );

    for (const sql of [complete, retry]) {
      expect(sql).toContain("j.lease_token = p_lease_token");
      expect(sql).toMatch(/j\.lease_until > (?:clock_timestamp\(\)|v_now)/);
    }
    expect(retry).toContain("j.attempts >= j.max_attempts");
    expect(retry).toContain("power(");
    expect(retry).toContain("p_retryable");
    expect(retry).toContain("p_error_code");
    expect(retry).not.toMatch(/p_error_(?:message|text|body)/);
  });

  it("keeps all transitions service-only and behind SECURITY DEFINER RPCs", () => {
    expect(migration).toContain(
      "ALTER TABLE public.omnichannel_processing_jobs ENABLE ROW LEVEL SECURITY",
    );
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.omnichannel_processing_jobs\s+FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /GRANT SELECT ON TABLE public\.omnichannel_processing_jobs\s+TO service_role;/,
    );
    expect(migration).not.toMatch(
      /GRANT\s+[^;]*ON TABLE public\.omnichannel_processing_jobs\s+TO (?:anon|authenticated)/,
    );
    expect(migration.match(/\nSECURITY DEFINER\n/g)).toHaveLength(4);
    expect(migration.match(/\nSET search_path = public\n/g)).toHaveLength(4);
    expect(migration.match(/GRANT EXECUTE ON FUNCTION public\./g)).toHaveLength(
      4,
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION[^;]+TO (?:anon|authenticated)/,
    );
  });

  it("documents the table, sensitive control fields, indexes, and every RPC", () => {
    expect(migration).toContain(
      "COMMENT ON TABLE public.omnichannel_processing_jobs",
    );
    for (const column of [
      "message_id",
      "conversation_id",
      "status",
      "force_draft",
      "run_at",
      "attempts",
      "max_attempts",
      "lease_token",
      "lease_until",
      "last_error_code",
    ]) {
      expect(migration).toContain(
        `COMMENT ON COLUMN public.omnichannel_processing_jobs.${column}`,
      );
    }
    expect(migration.match(/COMMENT ON FUNCTION public\./g)).toHaveLength(4);
  });
});
