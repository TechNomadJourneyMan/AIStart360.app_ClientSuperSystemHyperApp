/**
 * lib/gri/official.ts — THE official GRI of a client (R-036).
 *
 * One reader for every screen, bot, report and AI prompt that needs «the GRI
 * of user X». Source: public.gri_assessments (migration 021), written by
 * POST /api/v1/gri/assessment with the canonical formula
 * (lib/gri-assessment/score.ts) — 0–10, mean of the 7 section means.
 *
 * Rules:
 *   • the official row is the one with is_current = true (the insert trigger
 *     keeps one per user; staff may pin an earlier one in GIGA); without a
 *     current row — the newest one;
 *   • gri_index 0 / null / out of 0–10 → index null («нет данных», never 0);
 *   • a section average of 0 → null (not answered);
 *   • Point A (diagnostics.overall_score, 0–100) is a different instrument and
 *     is never used here.
 *
 * Display goes through lib/format/gri.ts (formatGri, GRI_ZONES).
 * The pure part (officialGriFromRows) is client-safe; the readers take the
 * caller's Supabase client, so RLS (session) or the service role decides what
 * is visible — exactly as before at each call site.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { toGri } from '@/lib/format/gri'

export interface OfficialGri {
  assessmentId: string | null
  userId: string
  /** 0–10, full stored precision; null = «нет данных». */
  index: number | null
  /** Section id → 0–10 or null (not answered). */
  sectionAvgs: Record<string, number | null>
  assessedAt: string | null
  /** false when no row is marked current and the newest one was taken. */
  isCurrent: boolean
}

export interface GriRowLike {
  id?: string | null
  user_id: string
  gri_index: number | string | null
  section_avgs?: unknown
  is_current?: boolean | null
  created_at: string | null
}

const ts = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : -Infinity
}

function sectionAvgsOf(raw: unknown): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = toGri(v)
  return out
}

/** The official row of ONE user among their rows: current, else the newest. */
export function pickOfficialRow<T extends GriRowLike>(rows: readonly T[]): T | null {
  let current: T | null = null
  let newest: T | null = null
  for (const r of rows) {
    if (!r) continue
    if (r.is_current && (!current || ts(r.created_at) > ts(current.created_at))) current = r
    if (!newest || ts(r.created_at) > ts(newest.created_at)) newest = r
  }
  return current ?? newest
}

export function officialGriFromRow(row: GriRowLike | null | undefined): OfficialGri | null {
  if (!row || !row.user_id) return null
  return {
    assessmentId: row.id ?? null,
    userId: row.user_id,
    index: toGri(row.gri_index),
    sectionAvgs: sectionAvgsOf(row.section_avgs),
    assessedAt: row.created_at ?? null,
    isCurrent: row.is_current === true,
  }
}

/** Pure: rows of any users → official GRI per user. */
export function officialGriFromRows(rows: readonly GriRowLike[]): Map<string, OfficialGri> {
  const byUser = new Map<string, GriRowLike[]>()
  for (const r of rows) {
    if (!r || !r.user_id) continue
    const list = byUser.get(r.user_id)
    if (list) list.push(r)
    else byUser.set(r.user_id, [r])
  }
  const out = new Map<string, OfficialGri>()
  byUser.forEach((list, userId) => {
    const g = officialGriFromRow(pickOfficialRow(list))
    if (g) out.set(userId, g)
  })
  return out
}

const SELECT = 'id, user_id, gri_index, section_avgs, is_current, created_at'
const CHUNK = 200

/**
 * Official GRI of one user, or null when the user has no assessment.
 * Throws on a database error (callers decide whether that is «не удалось
 * загрузить» or a soft fallback) — a failed read is never «нет данных».
 */
export async function getOfficialGri(sb: SupabaseClient, userId: string): Promise<OfficialGri | null> {
  const { data, error } = await sb
    .from('gri_assessments')
    .select(SELECT)
    .eq('user_id', userId)
    .order('is_current', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`gri_assessments read failed: ${error.message ?? 'unknown error'}`)
  return officialGriFromRow(((data ?? []) as GriRowLike[])[0] ?? null)
}

/**
 * Official GRI of many users (expert lists, staff tables). Users without an
 * assessment are absent from the map. Throws on a database error.
 */
export async function getOfficialGriMany(
  sb: SupabaseClient,
  userIds: readonly string[],
): Promise<Map<string, OfficialGri>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  const rows: GriRowLike[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await sb
      .from('gri_assessments')
      .select(SELECT)
      .in('user_id', ids.slice(i, i + CHUNK))
      .eq('is_current', true)
    if (error) throw new Error(`gri_assessments read failed: ${error.message ?? 'unknown error'}`)
    rows.push(...((data ?? []) as GriRowLike[]))
  }
  // Users whose rows are all non-current (legacy / unpinned) fall back to the newest.
  const missing = ids.filter((id) => !rows.some((r) => r.user_id === id))
  for (let i = 0; i < missing.length; i += CHUNK) {
    const { data, error } = await sb
      .from('gri_assessments')
      .select(SELECT)
      .in('user_id', missing.slice(i, i + CHUNK))
      .order('created_at', { ascending: false })
      .limit(5000)
    if (error) throw new Error(`gri_assessments read failed: ${error.message ?? 'unknown error'}`)
    rows.push(...((data ?? []) as GriRowLike[]))
  }
  return officialGriFromRows(rows)
}
