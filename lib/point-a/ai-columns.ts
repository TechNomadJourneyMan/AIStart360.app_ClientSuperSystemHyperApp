/**
 * lib/point-a/ai-columns.ts — write the AI analysis status of a diagnostics row
 * together with its diagnosis (migration 150: ai_error, ai_model,
 * ai_generated_at, and the expert's review carried with a cached analysis).
 *
 * Before migration 150 the extra columns do not exist: PostgREST answers
 * PGRST204 («Could not find the … column») / Postgres 42703. Then — and on any
 * other failure of the extra columns — the row is written without them: the
 * status is never lost because a diagnosis column could not be written. `db` must be the service role (diagnostics has no UPDATE policy
 * for API roles); the write is scoped to the verified diagnostic of the user.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export function isMissingColumn(e: { code?: string | null } | null | undefined): boolean {
  return !!e && (e.code === 'PGRST204' || e.code === '42703')
}

export async function updateDiagnosticAi(
  db: SupabaseClient,
  target: { diagnosticId: string; userId: string },
  base: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<{ ok: true; withDiagnosis: boolean } | { ok: false; code: string | null }> {
  const write = (payload: Record<string, unknown>) =>
    db.from('diagnostics').update(payload).eq('id', target.diagnosticId).eq('user_id', target.userId)
  const hasExtra = Object.keys(extra).length > 0
  const first = await write(hasExtra ? { ...base, ...extra } : base)
  if (!first.error) return { ok: true, withDiagnosis: hasExtra }
  if (!hasExtra) return { ok: false, code: first.error.code ?? null }
  // Ревью R3-PA L1: ANY failure of the diagnosis part (a missing column before 150, a
  // hand-made VARCHAR(50) ai_error → 22001, a check) must not cost the status itself:
  // without it the row would stay «готовится».
  if (!isMissingColumn(first.error)) console.error('[point-a/ai] diagnosis columns not written', first.error.code ?? '')
  const second = await write(base)
  return second.error ? { ok: false, code: second.error.code ?? null } : { ok: true, withDiagnosis: false }
}
