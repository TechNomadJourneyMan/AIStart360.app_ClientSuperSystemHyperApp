/**
 * lib/survey/attribution-read.ts — per-answer author for the questionnaire
 * views (client wizard, GIGA survey tab). Server side; the Supabase client is
 * passed in (tests use an in-memory one).
 *
 * One `profiles` query for all expert / admin names (no N+1). Rows read with
 * `select('*')` before migration 131 simply have no author columns: every
 * answer then shows the legacy rule (`source` in the answer → «ИИ (из
 * документов)», otherwise no author line).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnswerAttribution } from './attribution-label'
import { isAnswerAuthorRole } from './attribution'

export interface AttributionSourceRow {
  question_key: string
  answer?: unknown
  answered_at?: string | null
  updated_by?: string | null
  updated_by_role?: string | null
  updated_at?: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const hasSource = (answer: unknown): boolean =>
  !!answer && typeof answer === 'object' && !Array.isArray(answer) && 'source' in (answer as object) &&
  (answer as { source?: unknown }).source != null && (answer as { source?: unknown }).source !== ''

/** The author of one answer row (names resolved by the caller). */
export function attributionOf(row: AttributionSourceRow, names: ReadonlyMap<string, string> = new Map()): AnswerAttribution {
  const role = isAnswerAuthorRole(row.updated_by_role) ? row.updated_by_role : null
  if (role) {
    const by = row.updated_by ?? null
    return {
      updatedBy: by,
      updatedByRole: role,
      updatedAt: row.updated_at ?? row.answered_at ?? null,
      updatedByName: (role === 'expert' || role === 'admin') && by ? names.get(by) ?? null : null,
    }
  }
  if (hasSource(row.answer)) {
    return { updatedBy: null, updatedByRole: 'ai', updatedAt: row.answered_at ?? null, updatedByName: null, legacy: true }
  }
  return { updatedBy: null, updatedByRole: null, updatedAt: row.updated_at ?? row.answered_at ?? null, updatedByName: null, legacy: true }
}

/** Expert / admin authors whose names the view needs. */
export function staffAuthorIds(rows: AttributionSourceRow[]): string[] {
  const ids = new Set<string>()
  for (const r of rows) {
    if ((r.updated_by_role === 'expert' || r.updated_by_role === 'admin') && r.updated_by && UUID_RE.test(r.updated_by)) ids.add(r.updated_by)
  }
  return Array.from(ids)
}

/** The slice of the Supabase client the name lookup uses. */
export type ProfilesReader = Pick<SupabaseClient, 'from'>

/** id → «Имя Фамилия» (or email) for the given profiles; one query; errors → empty. */
export async function loadAuthorNames(client: ProfilesReader, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!ids.length) return out
  try {
    const { data, error } = await client.from('profiles').select('id, full_name, email').in('id', ids)
    if (error) return out
    for (const p of (data ?? []) as Array<{ id?: unknown; full_name?: unknown; email?: unknown }>) {
      const name = typeof p.full_name === 'string' && p.full_name.trim() ? p.full_name.trim() : typeof p.email === 'string' ? p.email : ''
      if (typeof p.id === 'string' && name) out.set(p.id, name)
    }
  } catch {
    // Names are decoration: the line still shows the role.
  }
  return out
}

/** question_key → author, for the rows a view shows. */
export async function loadAttribution(client: ProfilesReader, rows: AttributionSourceRow[]): Promise<Record<string, AnswerAttribution>> {
  const names = await loadAuthorNames(client, staffAuthorIds(rows))
  const out: Record<string, AnswerAttribution> = {}
  for (const r of rows) out[r.question_key] = attributionOf(r, names)
  return out
}
