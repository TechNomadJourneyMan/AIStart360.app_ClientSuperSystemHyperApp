/**
 * lib/portfolio-gri.ts — portfolio-level GRI built from real GRI assessments.
 *
 * Source: public.gri_assessments (migration 021), written by
 * POST /api/v1/gri/assessment. For every user the current assessment is taken
 * (is_current = true: the insert trigger keeps exactly one per user — the
 * newest, unless staff pinned an earlier one in GIGA). Then:
 *   • each of the seven GRI sections = mean of those users' section_avgs for
 *     that section (section ids: lib/gri-assessment/sections.ts);
 *   • overall = mean of their gri_index.
 * A section average of 0 means "not answered" (lib/gri-assessment/score.ts),
 * so it is left out of the mean; a section nobody answered is `null` — never
 * 0 and never borrowed from another instrument. Point A (diagnostics) is a
 * different instrument and is not used here.
 *
 * Reads go through the caller's session client, as before: RLS on
 * gri_assessments decides what the viewer may aggregate (staff — all rows,
 * a tenant — its own / its companies' rows). DB errors are thrown, not turned
 * into "no data", so the page can show that loading failed.
 */
import { createServerClient } from '@/lib/supabase-server'
import type { SectionId } from '@/lib/gri-assessment/sections'

export type PortfolioGriDomainKey = 'product' | 'trust' | 'bizmodel' | 'cash' | 'ops' | 'team' | 'founder'

/** The seven GRI sections in radar order, with the assessment section id each one reads. */
export const PORTFOLIO_GRI_DOMAINS: ReadonlyArray<{
  key: PortfolioGriDomainKey
  sectionId: SectionId
  label: string
  short: string
}> = [
  { key: 'product',  sectionId: 'product-demand',    label: 'Продукт и спрос',            short: 'Продукт'  },
  { key: 'trust',    sectionId: 'trust-positioning', label: 'Доверие и позиционирование', short: 'Доверие'  },
  { key: 'bizmodel', sectionId: 'business-model',    label: 'Бизнес-модель',              short: 'Бизнес'   },
  { key: 'cash',     sectionId: 'cash-stability',    label: 'Финансовая устойчивость',    short: 'Финансы'  },
  { key: 'ops',      sectionId: 'operations',        label: 'Операции',                   short: 'Операции' },
  { key: 'team',     sectionId: 'team',              label: 'Команда',                    short: 'Команда'  },
  { key: 'founder',  sectionId: 'owner-readiness',   label: 'Готовность собственника',    short: 'Собств.'  },
]

export interface PortfolioGRI {
  /** Mean gri_index (0–10, 2 decimals); null when no assessment has an index. */
  overall:     number | null
  product:     number | null
  trust:       number | null
  bizmodel:    number | null
  cash:        number | null
  ops:         number | null
  team:        number | null
  founder:     number | null
  /** Number of assessments in the averages — one (the current) per user. */
  reportCount: number
}

export interface GriAssessmentRow {
  id?: string
  user_id: string
  gri_index: number | string | null
  section_avgs: unknown
  created_at: string | null
}

/** gri_index band counts (same bands as /api/admin/overview: 8–10 / 6–8 / 4–6 / 0–4). */
export interface GriIndexDistribution {
  excellent:  number
  strong:     number
  developing: number
  critical:   number
  total:      number
}

/** A GRI value on the 0–10 scale; 0, negatives, >10 and non-numbers are "no data". */
function griValue(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : null
}

function sectionValue(row: GriAssessmentRow, sectionId: string): number | null {
  const avgs = row.section_avgs
  if (!avgs || typeof avgs !== 'object' || Array.isArray(avgs)) return null
  return griValue((avgs as Record<string, unknown>)[sectionId])
}

const round2 = (n: number) => Math.round(n * 100) / 100

function mean(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => v !== null)
  return xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null
}

const ts = (iso: string | null): number => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : -Infinity
}

/** One row per user — the newest by created_at (defensive: is_current already implies one). */
export function latestPerUser(rows: GriAssessmentRow[]): GriAssessmentRow[] {
  const byUser = new Map<string, GriAssessmentRow>()
  for (const r of rows) {
    if (!r || !r.user_id) continue
    const prev = byUser.get(r.user_id)
    if (!prev || ts(r.created_at) > ts(prev.created_at)) byUser.set(r.user_id, r)
  }
  return Array.from(byUser.values())
}

function hasData(r: GriAssessmentRow): boolean {
  return griValue(r.gri_index) !== null || PORTFOLIO_GRI_DOMAINS.some((d) => sectionValue(r, d.sectionId) !== null)
}

/** Portfolio averages, or null when no assessment carries any GRI data. */
export function aggregatePortfolioGri(rows: GriAssessmentRow[]): PortfolioGRI | null {
  const usable = latestPerUser(rows).filter(hasData)
  if (usable.length === 0) return null
  const domain = (sectionId: string) => mean(usable.map((r) => sectionValue(r, sectionId)))
  const byKey = Object.fromEntries(PORTFOLIO_GRI_DOMAINS.map((d) => [d.key, domain(d.sectionId)])) as Record<PortfolioGriDomainKey, number | null>
  return {
    overall: mean(usable.map((r) => griValue(r.gri_index))),
    ...byKey,
    reportCount: usable.length,
  }
}

export function griIndexDistribution(rows: GriAssessmentRow[]): GriIndexDistribution {
  const values = latestPerUser(rows).map((r) => griValue(r.gri_index)).filter((v): v is number => v !== null)
  return {
    excellent:  values.filter((v) => v >= 8).length,
    strong:     values.filter((v) => v >= 6 && v < 8).length,
    developing: values.filter((v) => v >= 4 && v < 6).length,
    critical:   values.filter((v) => v < 4).length,
    total:      values.length,
  }
}

const PAGE_SIZE = 1000
const MAX_PAGES = 50

/**
 * Current GRI assessments visible to the caller (RLS), paged past PostgREST's
 * row cap. Throws on a database error.
 *
 * @param companyId Optional. Only assessments of that company.
 */
export async function loadCurrentGriAssessments(companyId?: string | null): Promise<GriAssessmentRow[]> {
  const sb = createServerClient()
  const rows: GriAssessmentRow[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    let query = sb
      .from('gri_assessments')
      .select('id, user_id, gri_index, section_avgs, created_at')
      .eq('is_current', true)
    if (companyId) query = query.eq('company_id', companyId)
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) {
      throw new Error(`gri_assessments read failed: ${error.message ?? 'unknown error'}`)
    }
    const batch = (data ?? []) as GriAssessmentRow[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return rows
  }
  console.warn(`[portfolio-gri] stopped after ${MAX_PAGES * PAGE_SIZE} current assessments`)
  return rows
}

/**
 * Portfolio GRI for the viewer. Null when there are no assessments with data;
 * throws when the database read fails.
 *
 * @param companyId Optional. When provided, only that company's assessments
 *   are aggregated; omitted — everything the viewer's RLS allows.
 */
export async function getPortfolioGRI(companyId?: string | null): Promise<PortfolioGRI | null> {
  return aggregatePortfolioGri(await loadCurrentGriAssessments(companyId))
}
