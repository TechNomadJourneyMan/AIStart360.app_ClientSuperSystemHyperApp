/**
 * lib/point-b/recs/route.ts — what the recommendation routes of the expert share (GIGA / panel):
 *
 *   REC_AUDIT          the audit actions (recordAdminAction, entity pb_recommendation)
 *   recFailure         RecError → 400 (invalid, with the field) / 404 / 409; ProfanityError → 400 with the field;
 *                      migration 129 not applied → 503 «not_ready»
 *   reviewerOf         the reviewer of an expert action: the name of the actor's profile (never an email; no
 *                      profile → «Эксперт AIStart360») and the specialty (profiles.expert_title)
 *   blocksOf           the Point A blocks of the client (score, null = no data) for the rules and the AI context
 *   buildRuleDrafts    the limiting factor and the contradictions of the plan as recommendation drafts (rules)
 */
import type { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isUuid } from '@/lib/admin/client-scope'
import { PROFANITY_MESSAGE } from '@/lib/moderation/http'
import { ProfanityError } from '@/lib/moderation/profanity'
import { fail, type PlanRouteContext } from '../plan/route-guard'
import { findLimitingFactor } from '../insights/constraint'
import { findContradictions } from '../insights/contradictions'
import type { PointBInputs } from '../inputs'
import type { ModelResult } from '../model/types'
import { RecError } from './store'
import type { RecDraft } from './types'

export const REC_AUDIT = {
  generated: 'point_b.recommendations.generated',
  rulesRun: 'point_b.recommendations.rules_run',
  created: 'point_b.recommendations.created',
  verified: 'point_b.recommendation.verified',
  rejected: 'point_b.recommendation.rejected',
  edited: 'point_b.recommendation.edited',
} as const

export const REC_NOT_FOUND = 'Рекомендация не найдена'
const isMissingTable = (message: string): boolean => /\((42P01|PGRST205)\)/.test(message)

export function recFailure(err: unknown): NextResponse | null {
  if (err instanceof ProfanityError) return fail(PROFANITY_MESSAGE, 400, { code: 'profanity', field: err.field })
  if (err instanceof RecError) {
    const status = err.code === 'not_found' ? 404 : err.code === 'bad_state' ? 409 : 400
    return fail(err.message, status, { code: err.code, ...(err.field ? { field: err.field } : {}) })
  }
  if (err instanceof Error && isMissingTable(err.message)) {
    return fail('Рекомендации Точки Б ещё не включены на сервере', 503, { code: 'not_ready' })
  }
  return null
}

export async function reviewerOf(ctx: Pick<PlanRouteContext, 'sb' | 'actor' | 'actorName'>): Promise<{ id: string; name: string; specialty: string | null }> {
  let specialty: string | null = null
  if (isUuid(ctx.actor.id)) {
    try {
      const { data } = await ctx.sb.from('profiles').select('expert_title').eq('id', ctx.actor.id).maybeSingle()
      const t = (data as { expert_title?: string | null } | null)?.expert_title?.trim()
      specialty = t ? t.slice(0, 200) : null
    } catch {
      specialty = null
    }
  }
  return { id: ctx.actor.id, name: ctx.actorName?.trim() || 'Эксперт AIStart360', specialty }
}

const BLOCK_TITLE: Record<string, string> = {
  finance: 'Финансы', sales: 'Продажи', marketing: 'Маркетинг', operations: 'Операции', strategy: 'Стратегия', team: 'Команда', product: 'Продукт',
}

/** The Point A blocks of the client: a block without data has score null (never a weak 0). */
export function blocksOf(pb: Pick<PointBInputs, 'pointA' | 'blocksWithoutData'>): Array<{ key: string; title: string; score: number | null }> {
  const blocks = (pb.pointA?.blocks ?? {}) as Record<string, { score?: unknown } | undefined>
  const missing = new Set(pb.blocksWithoutData ?? [])
  return Object.entries(blocks).map(([key, b]) => ({
    key,
    title: BLOCK_TITLE[key] ?? key,
    score: !missing.has(key) && typeof b?.score === 'number' && Number.isFinite(b.score) ? b.score : null,
  }))
}

/** The rule findings of the plan as recommendation drafts (they go to the review queue like the AI's). */
export function buildRuleDrafts(input: {
  result: ModelResult; selectedScenario: string | null; blocks: Array<{ key: string; score: number | null }>; inputsHash: string
}): RecDraft[] {
  const out: RecDraft[] = []
  const limiting = findLimitingFactor(input.result, input.blocks)
  if (limiting) {
    out.push({
      kind: 'constraint',
      title: `Ограничивающий фактор роста: ${limiting.label}`,
      essence: limiting.reason,
      reason: 'Найдено правилом: из всех рычагов этот ближе всего к потолку реализуемости в сценарии плана.',
      expectedEffect: null, resources: null,
      confidence: 'medium', confidenceReason: 'Расчёт модели по данным клиента; потолки — ориентиры модели, а не факт.',
      risks: null, nextAction: null,
      sourceRefs: limiting.sourceRefs, generatedBy: 'rule', inputsHash: input.inputsHash,
    })
  }
  for (const c of findContradictions({ result: input.result, selectedScenario: input.selectedScenario, goalMonths: input.result.gap.months })) {
    out.push({
      kind: 'contradiction',
      title: c.title,
      essence: c.reason,
      reason: 'Найдено правилом противоречий плана.',
      expectedEffect: null, resources: null,
      confidence: 'high', confidenceReason: 'Следует прямо из расчёта модели и данных плана.',
      risks: null, nextAction: null,
      sourceRefs: c.sourceRefs, generatedBy: 'rule', inputsHash: input.inputsHash,
    })
  }
  return out
}

/** The newest AI recommendation of the company (the «once in 10 minutes» guard survives a lost rate store). */
export async function lastAiRunAt(sb: SupabaseClient, companyId: string): Promise<string | null> {
  const { data, error } = await sb.from('pb_recommendations').select('created_at').eq('company_id', companyId).eq('generated_by', 'ai')
    .order('created_at', { ascending: false }).limit(1)
  if (error) return null
  return ((data ?? []) as Array<{ created_at: string }>)[0]?.created_at ?? null
}
