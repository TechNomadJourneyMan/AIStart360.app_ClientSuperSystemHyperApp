/**
 * lib/assistant/context.ts — buildAssistantContext().
 *
 * Assembles the curated {@link AssistantContext} snapshot from the EXISTING data
 * layer, reusing the exact reads already proven in
 * app/api/v1/diagnostics/point-b/route.ts:
 *   - diagnostics (current row)            → Point A (via diagToPointA shape)
 *   - survey_answers flat-map (answer.value unwrap)
 *   - gri_assessments.top_5_limits / gri_index
 *   - companies.target_revenue_12m/3y_kzt
 *   - metrics biz.finansy.vyruchka_god     → current revenue (REVENUE_METRIC_IDS)
 *   - lib/point-b/report.ts (R3-PB review M3) → gap / realism / data_sufficiency from the SAME
 *     calculation as «Обзор» (the model + the approved plan), not the V2 engine
 *
 * CRITICAL ANTI-HALLUCINATION BOUNDARY: the object returned here is the ONLY
 * thing later serialized into an LLM prompt. Never hand raw DB rows to the LLM —
 * always go through this snapshot. It honestly carries nulls when data is
 * missing; downstream code must surface "insufficient_data", never invent.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PointA, BlockScore } from '@/types/onboarding'
import type { PointBReport } from '@/lib/point-b/report'
import { assistantPointBFrom, EMPTY_ASSISTANT_POINT_B } from './point-b'
import type {
  AssistantContext,
  AssistantBlock,
  AssistantPointA,
  AssistantPointB,
  AssistantGri,
} from './types'
import { REVENUE_METRIC_IDS } from '@/lib/metrics/catalog-helpers'
import { getOfficialPointA, officialDiagnosticRow, type OfficialPointA } from '@/lib/point-a/official'
import { resolveAccess } from '@/lib/access/decision'
import { ALL_SECTIONS_CLOSED, scrubAssistantContext, type SectionAccess } from './paid-context'

/**
 * R2-A (ревью H-2): which paid sections the snapshot may carry. Default — the
 * decision for `userId` (lib/access/decision.ts: switch, tariff, override, staff
 * of the session); a failure → all closed (the snapshot feeds LLM prompts and
 * answers — fail closed). Staff-facing callers that look at a client
 * (GIGA quality, escalation to an expert) pass ALL_SECTIONS_OPEN.
 */
async function sectionsFor(userId: string, sb: SupabaseClient, given?: SectionAccess): Promise<SectionAccess> {
  if (given) return given
  try {
    return (await resolveAccess(sb, userId)).sections
  } catch (err) {
    console.error('[assistant/context] access decision failed — paid sections left out:', err instanceof Error ? err.message : err)
    return ALL_SECTIONS_CLOSED
  }
}

// ─── Point A reconstruction (mirrors point-b/route.ts diagToPointA) ─────────

const EMPTY_BLOCK: BlockScore = { score: 0, status: 'critical', top_issues: [], recommendations: [] }

const BLOCK_LABELS: Record<string, string> = {
  finance: 'Финансы',
  sales: 'Продажи',
  operations: 'Операции',
  marketing: 'Маркетинг',
  strategy: 'Стратегия',
}

function diagToPointA(diag: Record<string, unknown>): PointA {
  const block = (k: string): BlockScore => {
    const v = diag[k] as BlockScore | null
    return v && typeof v === 'object' ? v : EMPTY_BLOCK
  }
  return {
    overall_score: (diag.overall_score as number) ?? 0,
    health_index: (diag.health_index as number) ?? 0,
    stage: (diag.stage as PointA['stage']) ?? 'seed',
    blocks: {
      finance: block('finance_score'),
      marketing: block('marketing_score'),
      operations: block('operations_score'),
      strategy: block('strategy_score'),
      sales: block('sales_score'),
    },
    risks: (diag.risks as PointA['risks']) ?? [],
    insights: (diag.insights as PointA['insights']) ?? [],
    quick_wins: (diag.quick_wins as PointA['quick_wins']) ?? [],
    data_gaps: (diag.data_gaps as PointA['data_gaps']) ?? [],
  }
}

/** Normalize gri_assessments.top_5_limits into a stable shape (tolerant of
 *  the {criterionText, blockName, score} GRI calculator shape AND the
 *  {title, block, severity} shape used elsewhere — same tolerance as the
 *  point-b route's mapGriTop5). */
function mapGriTop5(raw: unknown): AssistantGri['top_5_limits'] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item, i) => {
      if (!item || typeof item !== 'object') return null
      const o = item as Record<string, unknown>
      const title = String(o.title ?? o.criterionText ?? o.label ?? o.name ?? o.criterion ?? '').trim()
      if (!title) return null
      const scoreRaw = o.score
      const score =
        scoreRaw != null && Number.isFinite(Number(scoreRaw)) ? Number(scoreRaw) : null
      return {
        rank: typeof o.rank === 'number' ? o.rank : i + 1,
        title,
        block: String(o.block ?? o.blockName ?? o.blockId ?? o.section ?? ''),
        score,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

const companyIdOf = (diag: unknown): string | null => {
  const id = (diag as { company_id?: unknown } | null)?.company_id
  return typeof id === 'string' && id ? id : null
}

/**
 * The client's Point B report (the state of /client/point-b) — service role: the plan tables are read the way the page
 * reads them; `userId` is the one the caller already authorised (the session user, or a client of the staff member).
 */
async function defaultPointBReport(userId: string, companyId: string | null): Promise<PointBReport> {
  const [{ createServiceClient }, { loadPointBReport }] = await Promise.all([import('@/lib/supabase-service'), import('@/lib/point-b/report')])
  return loadPointBReport(createServiceClient(), userId, { companyId })
}

/** Blocks WITH official data only — a block without data is listed apart, never as a 0. */
function toAssistantBlocks(pointA: PointA, noData: ReadonlySet<string>): AssistantBlock[] {
  const order = ['finance', 'sales', 'operations', 'marketing', 'strategy'] as const
  return order.filter((key) => !noData.has(key)).map((key) => {
    const b = pointA.blocks[key] ?? EMPTY_BLOCK
    return { key, label: BLOCK_LABELS[key] ?? key, score: b.score, status: b.status }
  })
}

// ─── buildAssistantContext ──────────────────────────────────────────────────

/**
 * Build the curated snapshot for `userId`. `sb` must be a session-scoped client
 * (createServerClient()) so RLS keeps the read to the caller's own rows — never
 * accept a user_id from a client request param (IDOR-safe, per point-b/route.ts).
 */
export async function buildAssistantContext(
  userId: string,
  sb: SupabaseClient,
  opts: {
    sections?: SectionAccess
    /** Test seam: the Point B report of the client (default: lib/point-b/report.ts with the service role). */
    pointBReport?: (userId: string, companyId: string | null) => Promise<PointBReport | null>
  } = {},
): Promise<AssistantContext> {
  const sectionsP = sectionsFor(userId, sb, opts.sections)
  // 1. Latest diagnostic (Point A). RLS scopes the row; we also filter by user.
  const { data: diag } = await sb
    .from('diagnostics')
    .select('*')
    .eq('user_id', userId)
    .eq('is_current', true)
    .maybeSingle()

  const hasDiagnostic = !!diag
  // The OFFICIAL Point A (lib/point-a/official.ts, R-033/R-032): no overall /
  // stage / health without an official score, a block without data is «нет
  // данных» — never `?? 0`. A failed read degrades to «no Point A».
  const official: OfficialPointA | null = diag ? await getOfficialPointA(sb, userId).catch(() => null) : null
  const officialRow = diag && official ? officialDiagnosticRow(diag as Record<string, unknown>, official) : null
  const pointA = officialRow ? diagToPointA(officialRow) : diagToPointA({})
  const scored = official?.state === 'scored'
  const noData = new Set<string>(official ? official.blocks.filter((b) => b.score === null || !['scored', 'no_score'].includes(official.state)).map((b) => b.key) : ['finance', 'sales', 'operations', 'marketing', 'strategy'])
  const diagnosticId = (diag?.id as string | undefined) ?? null

  // 2. Survey answers → flat { question_key: value } map (answer.value unwrap —
  //    identical to point-b/route.ts).
  const { data: surveyRows } = await sb
    .from('survey_answers')
    .select('question_key, answer')
    .eq('user_id', userId)

  const answers: Record<string, unknown> = {}
  for (const row of surveyRows ?? []) {
    const a = (row as { answer?: unknown }).answer as { value?: unknown } | unknown
    answers[(row as { question_key: string }).question_key] =
      a && typeof a === 'object' && 'value' in a ? (a as { value?: unknown }).value : a
  }

  // 3. GRI TOP-5 limits + index (gri_index is 0–10).
  const { data: gri } = await sb
    .from('gri_assessments')
    .select('top_5_limits, gri_index')
    .eq('user_id', userId)
    .eq('is_current', true)
    .maybeSingle()

  const griTop5 = mapGriTop5((gri as { top_5_limits?: unknown } | null)?.top_5_limits)
  const griIndexRaw = (gri as { gri_index?: unknown } | null)?.gri_index
  const griIndex =
    griIndexRaw != null && Number.isFinite(Number(griIndexRaw)) ? Number(griIndexRaw) : null

  // 4. Company targets/identity (companies.id is TEXT — Prisma-owned).
  const { data: comp } = await sb
    .from('companies')
    .select(
      'id, name, industry, stage, employee_count, target_revenue_12m_kzt, target_revenue_3y_kzt',
    )
    .eq('user_id', userId)
    .maybeSingle()

  const company = comp as Record<string, unknown> | null
  const num = (v: unknown): number | null =>
    v != null && Number.isFinite(Number(v)) ? Number(v) : null

  const target12m = num(company?.target_revenue_12m_kzt)
  const target3y = num(company?.target_revenue_3y_kzt)

  // 5. Current revenue from the metrics layer (newer s1_* survey captures only
  //    goals). Best-effort — needs a linked company. Same read as point-b route.
  let currentRevenueYear: number | null = null
  let revenueYear: number | null = null
  const companyId =
    ((diag?.company_id as string | null) ?? (company?.id as string | null)) ?? null
  if (companyId) {
    const { data: revRows } = await sb
      .from('metrics')
      .select('metric_value, period_year')
      .eq('company_id', companyId)
      .in('metric_key', [...REVENUE_METRIC_IDS])
      .gt('metric_value', 0)
      .order('period_year', { ascending: false })
      .limit(1)
    const r = (revRows as Array<{ metric_value?: unknown; period_year?: unknown }> | null)?.[0]
    const v = r?.metric_value
    if (v != null && Number.isFinite(Number(v))) {
      currentRevenueYear = Number(v)
      revenueYear = num(r?.period_year)
    }
  }

  // 6. Point B — R3-PB review M3: the SAME calculation as «Обзор» (the model + the approved plan version,
  //    lib/point-b/report.ts), only when Точка Б is open for this snapshot (a closed section is scrubbed anyway).
  const sections = await sectionsP
  const report = sections.point_b
    ? await (opts.pointBReport ?? defaultPointBReport)(userId, (company?.id as string | null | undefined) ?? companyIdOf(diag)).catch((err: unknown) => {
        console.error('[assistant/context] Point B not calculated — left empty', err instanceof Error ? err.message : err)
        return null
      })
    : null

  // ── Assemble the curated snapshot ──────────────────────────────────────────

  const blocks = toAssistantBlocks(pointA, noData)
  const weakest = [...blocks].sort((a, b) => a.score - b.score)

  const assistantPointA: AssistantPointA = {
    has_diagnostic: hasDiagnostic,
    overall_score: scored ? official!.overall : null,
    health_index: scored ? official!.health_index : null,
    stage: scored ? official!.stage : null,
    blocks,
    weakest_blocks: weakest.slice(0, 3),
    blocks_without_data: hasDiagnostic ? [...noData].filter((k) => BLOCK_LABELS[k]).map((k) => BLOCK_LABELS[k]) : [],
    assessment: official?.state ?? 'none',
    risks: pointA.risks.map((r) => ({ level: r.level, area: r.area, text: r.text })),
    data_gaps: pointA.data_gaps.map((g) => ({ field: g.field, step: g.step, impact: g.impact })),
    quick_wins: pointA.quick_wins.map((q) => ({
      action: q.action,
      timeline: q.timeline,
      area: q.area,
    })),
  }

  const assistantPointB: AssistantPointB = report
    ? assistantPointBFrom(report, { goal12m: target12m, goal3y: target3y, griTop5, blocks: blocks.map((b) => ({ label: b.label, score: b.score })) })
    : { ...EMPTY_ASSISTANT_POINT_B, has_goal: target12m !== null || target3y !== null, goal_12m_revenue_year: target12m, goal_3y_revenue_year: target3y }

  const assistantGri: AssistantGri = {
    has_assessment: !!gri,
    gri_index: griIndex,
    top_5_limits: griTop5.slice(0, 5),
  }

  const full: AssistantContext = {
    userId,
    diagnosticId,
    generatedAt: new Date().toISOString(),
    company: {
      id: (company?.id as string | null) ?? companyId,
      name: (company?.name as string | null) ?? null,
      stage: (company?.stage as string | null) ?? null,
      industry: (company?.industry as string | null) ?? null,
      employee_count: num(company?.employee_count),
      target_revenue_12m_kzt: target12m,
      target_revenue_3y_kzt: target3y,
    },
    answers,
    pointA: assistantPointA,
    pointB: assistantPointB,
    gri: assistantGri,
    metrics: { revenue: currentRevenueYear, revenue_year: revenueYear },
    llm_analysis: null,
  }
  // R2-A: the data of closed paid sections never leaves this function.
  return scrubAssistantContext(full, sections)
}
