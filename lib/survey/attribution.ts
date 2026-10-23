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
 * answers never breaks on the missing columns. Before migration 134 only the
 * path column (updated_via) is missing: the retry keeps the author.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const ANSWER_AUTHOR_ROLES = ['user', 'expert', 'admin', 'ai', 'system'] as const
export type AnswerAuthorRole = (typeof ANSWER_AUTHOR_ROLES)[number]

/**
 * HOW the answer was given (survey_answers.updated_via, migration 134; spec
 * 2026-10-23 §5.4): the full questionnaire / «Мои ответы», the express flow and
 * blocks, the AI chat, the field «Помощник», a document, a staff edit, the system.
 */
export const ANSWER_VIA = ['full', 'express', 'chat', 'helper', 'document', 'staff', 'system'] as const
export type AnswerVia = (typeof ANSWER_VIA)[number]
/** Paths a client may write with its own JWT (the trigger of 134 enforces the same). */
export const CLIENT_ANSWER_VIA = ['full', 'express', 'helper', 'document'] as const
/** Paths the client save route accepts in its body (`document` comes from `origins`). */
export const BODY_ANSWER_VIA = ['full', 'express', 'helper'] as const
export type BodyAnswerVia = (typeof BODY_ANSWER_VIA)[number]

export function isAnswerVia(v: unknown): v is AnswerVia {
  return typeof v === 'string' && (ANSWER_VIA as readonly string[]).includes(v)
}

export interface AnswerAuthor {
  /** auth user / profile id; anything that is not a uuid is stored as null. */
  id: string | null
  role: AnswerAuthorRole
  /** The path; when present it is written to updated_via (null clears it). */
  via?: AnswerVia | null
}

export type AttributionColumns = {
  updated_by: string | null
  updated_by_role: AnswerAuthorRole
  updated_at: string
  updated_via?: AnswerVia | null
}

export const ATTRIBUTION_COLUMNS = ['updated_by', 'updated_by_role', 'updated_at', 'updated_via'] as const

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
  /** 'document' — accepted from a file; 'chat' — confirmed in the field «Помощник». */
  origin?: 'document' | 'chat' | null
  /**
   * The path the owner saved from (body `via`). When given, the author also
   * carries the path: the owner → full / express / helper / document, staff → staff.
   */
  via?: BodyAnswerVia | null
}): AnswerAuthor {
  const actor = input.actorId ?? null
  const withVia = input.via !== undefined
  if (!actor || actor === input.ownerId) {
    const role: AnswerAuthorRole = input.origin === 'document' ? 'ai' : 'user'
    if (!withVia) return { id: input.ownerId, role }
    const via: AnswerVia = input.origin === 'document' ? 'document' : input.origin === 'chat' ? 'helper' : input.via ?? 'full'
    return { id: input.ownerId, role, via }
  }
  const role = staffAuthorRole(...(input.staffRoles ?? []))
  return withVia ? { id: actor, role, via: 'staff' } : { id: actor, role }
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
  const cols: AttributionColumns = {
    updated_by: author.id && UUID_RE.test(author.id) ? author.id : null,
    updated_by_role: author.role,
    updated_at: at.toISOString(),
  }
  if (author.via !== undefined) cols.updated_via = isAnswerVia(author.via) ? author.via : null
  return cols
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

/** Rows without the path column only (131 applied, 134 not yet). */
export function withoutViaColumn<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => {
    const out = { ...r }
    delete (out as Record<string, unknown>).updated_via
    return out
  })
}

/** Rows split by author (one write per author; order of first appearance). */
export function groupByAuthor<T>(rows: T[], authorOf: (row: T) => AnswerAuthor): Array<{ author: AnswerAuthor; rows: T[] }> {
  const groups = new Map<string, { author: AnswerAuthor; rows: T[] }>()
  for (const row of rows) {
    const author = authorOf(row)
    const k = `${author.id ?? ''}|${author.role}|${author.via ?? ''}`
    const g = groups.get(k)
    if (g) g.rows.push(row)
    else groups.set(k, { author, rows: [row] })
  }
  return Array.from(groups.values())
}

interface DbError { code?: string | null; message?: string | null }

/** The missing column is the path of migration 134 (the author columns of 131 exist). */
export function isMissingViaColumnError(err: unknown): boolean {
  if (!isMissingColumnError(err)) return false
  return /updated_via/.test(String((err as DbError).message ?? ''))
}

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
  const stamped = stampRows(rows, author, opts.at)
  const first = await write(stamped)
  if (!first.error || !isMissingColumnError(first.error)) return first
  if (isMissingViaColumnError(first.error)) {
    // 131 is there, 134 is not: keep the author, drop the path.
    console.warn(`[survey/attribution] ${opts.label ?? 'survey_answers'}: updated_via missing (migration 134 not applied?) — saved without the path`)
    const second = await write(withoutViaColumn(stamped))
    if (!second.error || !isMissingColumnError(second.error)) return second
  }
  console.warn(`[survey/attribution] ${opts.label ?? 'survey_answers'}: author columns missing (migration 131 not applied?) — saved without the author`)
  return write(unstampRows(rows))
}
