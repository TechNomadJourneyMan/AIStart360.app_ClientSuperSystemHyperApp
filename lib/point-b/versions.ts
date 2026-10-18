/**
 * lib/point-b/versions.ts — LEGACY writer of `point_b_versions` (an expert correction as a draft,
 * `is_approved: false`).
 *
 * Since plan Phase 1 Task 6 no route calls it: expert corrections are written as PLAN VERSIONS
 * (lib/point-b/plan/flow.ts → saveNotesAndSubmit) and approved through the plan
 * (…/point-b/plan/versions/:versionId/approve). The table and this helper stay for the history
 * already in `point_b_versions` (read as a fallback by lib/point-b/compat.ts) and are not removed.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { POINT_B_VERSION_COLUMNS } from '@/lib/expert-review/point-b'

export interface ExpertVersionDraftInput {
  diagnosticId: string
  authorId: string
  /** Display name shown to the client (a person's name, never an email). */
  authorName: string
  notes: string
  roadmap?: unknown
}

export interface ExpertVersionDraft {
  id: string
  diagnostic_id: string
  authored_by: string | null
  author_name: string | null
  expert_notes: string
  roadmap: unknown
  is_approved: false
  approved_by: string | null
  approved_at: string | null
  created_at: string
}

/** Insert an unapproved expert version. Throws when the row cannot be written. */
export async function saveExpertVersionDraft(sb: SupabaseClient, input: ExpertVersionDraftInput): Promise<ExpertVersionDraft> {
  const { data, error } = await sb
    .from('point_b_versions')
    .insert({
      diagnostic_id: input.diagnosticId,
      authored_by: input.authorId,
      author_name: input.authorName,
      expert_notes: input.notes,
      roadmap: input.roadmap ?? null,
      is_approved: false,
    })
    .select(POINT_B_VERSION_COLUMNS)
    .single()
  if (error || !data) throw new Error(`point-b version: insert failed (${error?.code ?? 'no row'})`)
  return data as unknown as ExpertVersionDraft
}
