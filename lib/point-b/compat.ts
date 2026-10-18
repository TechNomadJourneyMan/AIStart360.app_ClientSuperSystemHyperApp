/**
 * lib/point-b/compat.ts — the «expert version» of Point B for the consumers that predate the plan
 * (spec §18): the client route /api/v1/diagnostics/point-b (`expert_version`), the AI draft of the
 * expert review. They get it from the PLAN: the approved (published) version; the latest approved
 * row of the legacy `point_b_versions` is the fallback for a client who has no published plan.
 *
 * Read-only. Tolerant of a plan that cannot be read (e.g. the tables are not there yet): that is
 * logged and the legacy version is used, so a consumer never fails because of the new tables.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { expertDisplayName } from '@/lib/expert-review/blocks'
import { loadPlanBundle } from './plan/store'

/** What the client route returns as `expert_version`. */
export interface ExpertVersionForClient {
  expert_notes: string
  /** A person's name — never an email. */
  author_name: string
  created_at: string
}

export interface ExpertVersionKey {
  companyId: string | null
  diagnosticId: string | null
}

function warn(what: string, err: unknown): void {
  console.error(`[point-b/compat] ${what}`, err instanceof Error ? err.message : err)
}

async function legacyVersion(
  sb: SupabaseClient, diagnosticId: string | null, opts: { approvedOnly: boolean },
): Promise<{ expert_notes: string; author_name: string | null; created_at: string } | null> {
  if (!diagnosticId) return null
  let q = sb.from('point_b_versions').select('expert_notes, author_name, created_at').eq('diagnostic_id', diagnosticId)
  if (opts.approvedOnly) q = q.eq('is_approved', true)
  const { data } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle()
  const row = data as { expert_notes?: string | null; author_name?: string | null; created_at?: string } | null
  return row?.expert_notes ? { expert_notes: row.expert_notes, author_name: row.author_name ?? null, created_at: row.created_at ?? '' } : null
}

/**
 * The expert version the CLIENT may see: the published plan version (its notes; none → null: the
 * expert's plan has no text), otherwise the latest approved legacy version. Drafts and versions
 * in review are never returned.
 */
export async function loadExpertVersionForClient(sb: SupabaseClient, key: ExpertVersionKey): Promise<ExpertVersionForClient | null> {
  if (key.companyId) {
    try {
      const published = (await loadPlanBundle(sb, key.companyId)).published
      if (published) {
        const notes = published.expert_notes?.trim()
        return notes
          ? { expert_notes: published.expert_notes!, author_name: expertDisplayName(published.author_name), created_at: published.approved_at ?? published.created_at }
          : null
      }
    } catch (err) {
      warn('plan not read, using the legacy version', err)
    }
  }
  const legacy = await legacyVersion(sb, key.diagnosticId, { approvedOnly: true })
  // Old rows stored the expert's email as author_name — never show it to the client.
  return legacy ? { expert_notes: legacy.expert_notes, author_name: expertDisplayName(legacy.author_name), created_at: legacy.created_at } : null
}

/**
 * The newest expert notes in ANY status (staff-side: the AI draft of the expert review builds on
 * what the expert wrote last, approved or not): the newest plan version that has notes, otherwise
 * the newest legacy row.
 */
export async function loadLatestExpertNotes(sb: SupabaseClient, key: ExpertVersionKey): Promise<{ expert_notes: string } | null> {
  if (key.companyId) {
    try {
      const withNotes = (await loadPlanBundle(sb, key.companyId)).versions.find((v) => !!v.expert_notes?.trim())
      if (withNotes) return { expert_notes: withNotes.expert_notes! }
    } catch (err) {
      warn('plan not read, using the legacy notes', err)
    }
  }
  const legacy = await legacyVersion(sb, key.diagnosticId, { approvedOnly: false })
  return legacy ? { expert_notes: legacy.expert_notes } : null
}
