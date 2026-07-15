import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/067_omnichannel_reply_quiet_window.sql",
  ),
  "utf8",
);

describe("067 omnichannel reply quiet window migration", () => {
  it("uses 20 seconds only as the default and does not overwrite current settings", () => {
    expect(migration).toContain(
      "ALTER COLUMN reply_delay_seconds SET DEFAULT 20",
    );
    expect(migration).not.toMatch(
      /UPDATE public\.omnichannel_settings[\s\S]*?reply_delay_seconds/,
    );
  });

  it("serializes enqueue decisions per conversation", () => {
    expect(migration).toMatch(
      /FROM public\.omnichannel_conversations AS c[\s\S]*?WHERE c\.id = v_conversation_id[\s\S]*?FOR UPDATE/,
    );
  });

  it("treats only a truly newer inbound row as superseding", () => {
    expect(migration).toMatch(
      /newer\.occurred_at > v_occurred_at[\s\S]*?newer\.created_at > v_created_at[\s\S]*?newer\.id > p_message_id/,
    );
    expect(migration).toContain("newer.direction = 'in'");
    expect(migration).toContain("v_has_newer_inbound");
  });

  it("atomically retires older queued live jobs without touching catch-up drafts", () => {
    expect(migration).toContain("j.status = 'queued'");
    expect(migration).toContain("NOT j.force_draft");
    expect(migration).toContain("j.message_id <> p_message_id");
    expect(migration).toContain(
      "last_error_code = 'superseded_by_newer_inbound'",
    );
    expect(migration).toContain("completed_at = v_now");
    expect(migration).toMatch(
      /UPDATE public\.omnichannel_messages AS m[\s\S]*?SET status = 'superseded'[\s\S]*?FROM superseded_jobs AS retired[\s\S]*?m\.id = retired\.message_id/,
    );
    expect(migration).toContain(
      "IF NOT v_force_draft AND NOT v_has_newer_inbound THEN",
    );
  });

  it("records an out-of-order live job as terminal and never makes it claimable", () => {
    expect(migration).toMatch(
      /CASE[\s\S]*?WHEN NOT v_force_draft AND v_has_newer_inbound[\s\S]*?THEN 'succeeded'[\s\S]*?ELSE 'queued'/,
    );
    expect(migration).toMatch(
      /WHEN NOT v_force_draft AND v_has_newer_inbound[\s\S]*?THEN 'superseded_by_newer_inbound'/,
    );
  });

  it("keeps explicit schedules, force-draft immediacy, and database-derived delay", () => {
    expect(migration).toContain("IF p_run_at IS NOT NULL THEN");
    expect(migration).toContain("v_effective_run_at := p_run_at");
    expect(migration).toContain("ELSIF v_force_draft THEN");
    expect(migration).toContain("v_effective_run_at := v_now");
    expect(migration).toContain("SELECT s.reply_delay_seconds");
    expect(migration).toContain("v_now + make_interval(");
  });

  it("prioritizes live work over queued history without preempting a lease", () => {
    expect(migration).toContain(
      "idx_omnichannel_processing_jobs_ready_priority",
    );
    expect(migration).toContain("(force_draft, run_at, created_at, id)");
    expect(migration).toContain("(NOT earlier.force_draft AND j.force_draft)");
    expect(migration).toContain("earlier.force_draft = j.force_draft");
    expect(migration).toContain(
      "ORDER BY j.force_draft ASC, j.run_at, j.created_at, j.id",
    );
    expect(migration).toMatch(
      /active\.conversation_id = j\.conversation_id[\s\S]*?active\.status = 'leased'/,
    );
  });

  it("preserves the restricted RPC boundary and stores no customer content", () => {
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = public");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.enqueue_omnichannel_processing_job\([\s\S]*?FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.claim_omnichannel_processing_job\(INTEGER\)[\s\S]*?FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).not.toMatch(
      /(?:message_text|customer_text|payload|body|content)\s+(?:TEXT|JSONB)/i,
    );
  });
});
