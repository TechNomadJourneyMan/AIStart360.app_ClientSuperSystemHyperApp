/**
 * lib/survey/attribution.ts — who wrote a questionnaire answer (plan
 * 2026-10-22, W5; PO item 4.2). Server side, but pure: no Supabase import.
 *
 * Every writer of public.survey_answers stamps the row with
 *   updated_by       — the person (auth user / profile id), or null;
 *   updated_by_role  — 'user' | 'expert' | 'admin' | 'ai' | 'system';
 *   updated_at       — when.
 * (migration 131). Role mapping:
 *   the owner of the answers                 → 'user'
 *   the owner accepting a value from a file  → 'ai'   («ИИ (из документов)»)
 *   staff expert / super_expert              → 'expert'
 *   admin / super_admin / other staff        → 'admin'
 *   the AI / document pipeline               → 'ai'
 *   migrations, cron, scripts                → 'system'
 *
 * Deploy before migration 131: PostgREST answers PGRST204 (unknown column in
 * the schema cache) / Postgres 42703. `writeWithAttribution` then retries the
 * same write once without the author columns and logs a warning, so saving
 * answers never breaks on the missing columns.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const ANSWER_AUTHOR_ROLES = ['user', 'expert', 'admin', 'ai', 'system'] as const
export type AnswerAuthorRole = (typeof ANSWER_AUTHOR_ROLES)[number]

export interface AnswerAuthor {
  /** auth user / profile id; anything that is not a uuid is stored as null. */
  id: string | null
  role: AnswerAuthorRole
}

export type AttributionColumns = {
  updated_by: string | null
  updated_by_role: AnswerAuthorRole
  updated_at: string
}

export const ATTRIBUTION_COLUMNS = ['updated_by', 'updated_by_role', 'updated_at'] as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isAnswerAuthorRole(v: unknown): v is AnswerAuthorRole {
  return typeof v === 'string' && (ANSWER_AUTHOR_ROLES as readonly string[]).includes(v)
}

/**
 * A staff member's author role from their role names (profiles.role and / or
 * staff_roles.role): experts are 'expert', every other staff role is 'admin'.
 */
export function staffAuthorRole(...roles: Array<string | null | undefined>): 'expert' | 'admin' {
  const set = new Set(roles.filter((r): r is string => typeof r === 'string'))
  if (set.has('super_admin') || set.has('admin')) return 'admin'
  if (set.has('expert') || set.has('super_expert')) return 'expert'
  return set.size ? 'admin' : 'expert'
}

/**
 * The author of a write made by `actorId` on the answers of `ownerId`.
 * `staffRoles` — the actor's role names when the actor is not the owner.
 * `origin: 'document'` — the owner accepted a value found in a document.
 */
export function authorFor(input: {
  actorId: string | null | undefined
  ownerId: string
  staffRoles?: Array<string | null | undefined>
  origin?: 'document' | null
}): AnswerAuthor {
  const actor = input.actorId ?? null
  if (!actor || actor === input.ownerId) {
    return { id: input.ownerId, role: input.origin === 'document' ? 'ai' : 'user' }
  }
  return { id: actor, role: staffAuthorRole(...(input.staffRoles ?? [])) }
}

/**
 * The role names of a person: profiles.role and staff_roles.role (one query
 * each, in parallel). A failed read yields no role (→ 'expert' by default in
 * staffAuthorRole): the author line is informative, never an access check.
 */
export async function loadStaffRoles(client: Pick<SupabaseClient, 'from'>, userId: string): Promise<string[]> {
  const read = async (table: string, col: string): Promise<string | null> => {
    try {
      const { data, error } = await client.from(table).select('role').eq(col, userId).maybeSingle()
      if (error) return null
      const role = (data as { role?: unknown } | null)?.role
      return typeof role === 'string' ? role : null
    } catch {
      return null
    }
  }
  const [profile, staff] = await Promise.all([read('profiles', 'id'), read('staff_roles', 'user_id')])
  return [profile, staff].filter((r): r is string => !!r)
}

/** W1's goal actor (lib/goals/survey-sync.ts GoalActor) → the answer author. */
export function authorFromGoalActor(actor: { id: string; role: 'owner' | 'expert' | 'admin' }): AnswerAuthor {
  return { id: actor.id, role: actor.role === 'owner' ? 'user' : actor.role }
}

export function attributionColumns(author: AnswerAuthor, at: Date = new Date()): AttributionColumns {
  return {
    updated_by: author.id && UUID_RE.test(author.id) ? author.id : null,
    updated_by_role: author.role,
    updated_at: at.toISOString(),
  }
}

/** Rows with the author columns added (the input is not mutated). */
export function stampRows<T extends Record<string, unknown>>(rows: T[], author: AnswerAuthor, at: Date = new Date()): Array<T & AttributionColumns> {
  const cols = attributionColumns(author, at)
  return rows.map((r) => ({ ...r, ...cols }))
}

/** Rows without the author columns (for the retry before migration 131). */
export function unstampRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => {
    const out = { ...r }
    for (const c of ATTRIBUTION_COLUMNS) delete (out as Record<string, unknown>)[c]
    return out
  })
}

/** Rows split by author (one write per author; order of first appearance). */
export function groupByAuthor<T>(rows: T[], authorOf: (row: T) => AnswerAuthor): Array<{ author: AnswerAuthor; rows: T[] }> {
  const groups = new Map<string, { author: AnswerAuthor; rows: T[] }>()
  for (const row of rows) {
    const author = authorOf(row)
    const k = `${author.id ?? ''}|${author.role}`
    const g = groups.get(k)
    if (g) g.rows.push(row)
    else groups.set(k, { author, rows: [row] })
  }
  return Array.from(groups.values())
}

interface DbError { code?: string | null; message?: string | null }

/** PostgREST / Postgres «this column does not exist» (migration 131 not applied yet). */
export function isMissingColumnError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as DbError
  if (e.code === 'PGRST204' || e.code === '42703') return true
  return /column .* does not exist|could not find the '.*' column/i.test(String(e.message ?? ''))
}

/**
 * Run a write (`upsert` / `insert` / `update`) with the author columns; on a
 * missing-column error retry once with the plain rows. Returns the result of
 * the last attempt.
 */
export async function writeWithAttribution<T extends Record<string, unknown>, R extends { error: unknown }>(
  rows: T[],
  author: AnswerAuthor,
  write: (rows: Array<Record<string, unknown>>) => PromiseLike<R>,
  opts: { at?: Date; label?: string } = {},
): Promise<R> {
  const first = await write(stampRows(rows, author, opts.at))
  if (!first.error || !isMissingColumnError(first.error)) return first
  console.warn(`[survey/attribution] ${opts.label ?? 'survey_answers'}: author columns missing (migration 131 not applied?) — saved without the author`)
  return write(unstampRows(rows))
}
