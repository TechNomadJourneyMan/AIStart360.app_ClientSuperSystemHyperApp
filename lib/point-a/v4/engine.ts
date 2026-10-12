/**
 * lib/point-a/v4/engine.ts — Point A v4 (spec 2026-10-12 §2.3).
 *
 * Same checks as v1 (lib/point-a-engine.ts pointAChecks) plus «Команда» and
 * «Продукт», scored differently:
 *   • block score = earned ÷ possible over ANSWERED checks only — an
 *     unanswered question is «данных не хватает», never a silent 0;
 *   • coverage = possible of answered checks ÷ possible of all checks;
 *     coverage < 40 % → status insufficient_data, no score;
 *   • confidence = coverage × source confidence (lower while a metric of the
 *     block has an open data discrepancy);
 *   • overall = weighted mean over blocks WITH a score, weights from the block
 *     configuration (lib/point-a/v4/config.ts), normalised over them.
 * Pure — no I/O.
 */
import {
  pointAChecks,
  toBlock,
  withCurrentAliases,
  type PointACheck,
  type PointAResolvedInputs,
} from '@/lib/point-a-engine'
import type { BlockScore, DiagnosticStage, PointA } from '@/types/onboarding'
import { BLOCK_LIBRARY, type BlockKey, type EffectiveBlock } from './config'
import { answeredSteps, isAnswered } from './check-inputs'
import { CHECK_LABELS } from './check-labels'
import { productChecks, teamChecks } from './extra-blocks'
import { hashOf } from '../snapshot-diff'

export const POINT_A_V4_ENGINE = 'engine:point_a_v4'

/** Below this coverage a block has no score. */
export const MIN_COVERAGE = 0.4
const BASE_CONFIDENCE = 0.9
const CONFLICT_PENALTY = 0.3

export interface V4Check extends PointACheck {
  answered: boolean
}

export interface V4Hypothesis {
  score: number
  confidence: number
  rationale: string
  generatedAt: string
}

export interface V4Block {
  key: BlockKey
  title: string
  weight: number
  hiddenForClient: boolean
  informational: boolean
  order: number
  status: 'ok' | 'insufficient_data'
  /** null when the data is insufficient. */
  score: number | null
  /** 0..1 */
  coverage: number
  /** 0..1 */
  confidence: number
  earned: number
  possible: number
  checks: V4Check[]
  top_issues: string[]
  recommendations: string[]
  /** What to answer / upload to score the block (unanswered checks). */
  needs: string[]
  /** Open data discrepancies of the block's metrics. */
  conflicts: string[]
  /** Hash of what the block's checks found — an AI hypothesis is reused while it stays the same. */
  inputsHash: string
  /** AI estimate of a block without data — never a FACT. */
  hypothesis?: V4Hypothesis
}

export interface UploadItem {
  block: BlockKey
  title: string
  what: string
  /** Expected rise of the overall coverage, percentage points. */
  gain: number
}

export interface PointAV4 {
  engine: typeof POINT_A_V4_ENGINE
  overall: number | null
  confidence: number
  coverage: number
  health_index: number | null
  stage: DiagnosticStage | null
  blocks: V4Block[]
  blocks_without_data: BlockKey[]
  strengths: Array<{ block: BlockKey; title: string; score: number; checks: string[] }>
  upload_checklist: UploadItem[]
}

export interface V4Input {
  answers: Record<string, unknown>
  resolved?: PointAResolvedInputs
  blocks: readonly EffectiveBlock[]
  /** Metric ids with an open data discrepancy. */
  conflictMetrics?: ReadonlySet<string>
}

function round(n: number, digits = 0): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

function stageOf(score: number): DiagnosticStage {
  if (score >= 80) return 'scale'
  if (score >= 65) return 'growth'
  if (score >= 45) return 'early'
  return 'seed'
}

export function allChecks(answers: Record<string, unknown>, resolved: PointAResolvedInputs = {}): Record<BlockKey, PointACheck[]> {
  const aliased = withCurrentAliases(answers)
  return { ...pointAChecks(answers, resolved), team: teamChecks(aliased), product: productChecks(aliased, resolved) }
}

function scoreBlock(eb: EffectiveBlock, raw: PointACheck[], ctx: { aliased: Record<string, unknown>; steps: Set<number>; resolved: PointAResolvedInputs; conflicts: ReadonlySet<string> }): V4Block {
  const checks: V4Check[] = raw.map((c) => ({ ...c, answered: isAnswered(eb.key, c, ctx.aliased, ctx.steps, ctx.resolved) }))
  const included = checks.filter((c) => !c.excluded)
  const answered = included.filter((c) => c.answered)
  const totalMax = included.reduce((s, c) => s + c.max, 0)
  const possible = answered.reduce((s, c) => s + c.max, 0)
  const earned = answered.reduce((s, c) => s + c.earned, 0)
  const coverage = totalMax > 0 ? possible / totalMax : 0
  const conflicts = BLOCK_LIBRARY[eb.key].metrics.filter((m) => ctx.conflicts.has(m))
  const base = conflicts.length ? BASE_CONFIDENCE - CONFLICT_PENALTY : BASE_CONFIDENCE
  const enough = coverage >= MIN_COVERAGE && possible > 0
  return {
    key: eb.key,
    title: eb.title,
    weight: eb.weight,
    hiddenForClient: eb.hiddenForClient,
    informational: eb.informational,
    order: eb.order,
    status: enough ? 'ok' : 'insufficient_data',
    score: enough ? round((earned / possible) * 100) : null,
    coverage: round(coverage, 3),
    confidence: round(coverage * base, 3),
    earned,
    possible,
    checks,
    top_issues: answered.filter((c) => c.issue).map((c) => c.issue as string).slice(0, 3),
    recommendations: answered.filter((c) => c.rec).map((c) => c.rec as string).slice(0, 3),
    needs: included.filter((c) => !c.answered).map((c) => c.missing ?? `Не заполнено: ${CHECK_LABELS[c.id] ?? c.id}`).slice(0, 5),
    conflicts,
    inputsHash: hashOf(checks.map((c) => [c.id, c.answered, c.earned, c.issue ?? null])),
  }
}

export function calculatePointAV4(input: V4Input): PointAV4 {
  const resolved = input.resolved ?? {}
  const aliased = withCurrentAliases(input.answers)
  const ctx = { aliased, steps: answeredSteps(input.answers), resolved, conflicts: input.conflictMetrics ?? new Set<string>() }
  const raw = allChecks(input.answers, resolved)
  const blocks = input.blocks.map((eb) => scoreBlock(eb, raw[eb.key], ctx))

  const weighted = blocks.filter((b) => !b.informational)
  const scored = weighted.filter((b) => b.score !== null)
  const wScored = scored.reduce((s, b) => s + b.weight, 0)
  const wAll = weighted.reduce((s, b) => s + b.weight, 0)
  const overall = wScored > 0 ? round(scored.reduce((s, b) => s + b.weight * (b.score as number), 0) / wScored) : null
  const confidence = wAll > 0 ? round(weighted.reduce((s, b) => s + b.weight * b.confidence, 0) / wAll, 3) : 0
  const coverage = wAll > 0 ? round(weighted.reduce((s, b) => s + b.weight * b.coverage, 0) / wAll, 3) : 0

  const byKey = new Map(blocks.map((b) => [b.key, b]))
  const over50 = (k: BlockKey) => ((byKey.get(k)?.score ?? 0) > 50 ? 1 : 0)
  const health_index = overall === null ? null : round(Math.min(100, overall * 0.6 + over50('finance') * 20 + over50('sales') * 10 + over50('operations') * 10))

  const strengths = weighted
    .filter((b) => b.score !== null && b.confidence >= 0.6 && (b.score as number) >= 70)
    .sort((a, b) => (b.score as number) - (a.score as number))
    .slice(0, 3)
    .map((b) => ({ block: b.key, title: b.title, score: b.score as number, checks: b.checks.filter((c) => c.answered && c.earned === c.max).map((c) => c.id) }))

  const upload_checklist: UploadItem[] = weighted
    .flatMap((b) => {
      const totalMax = b.checks.filter((c) => !c.excluded).reduce((s, c) => s + c.max, 0) || 1
      return b.checks
        .filter((c) => !c.excluded && !c.answered)
        .map((c) => ({ block: b.key, title: b.title, what: c.missing ?? `Заполнить: ${CHECK_LABELS[c.id] ?? c.id}`, gain: round((c.max / totalMax) * b.weight * 100, 1) }))
    })
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 8)

  return {
    engine: POINT_A_V4_ENGINE,
    overall,
    confidence,
    coverage,
    health_index,
    stage: overall === null ? null : stageOf(overall),
    blocks,
    blocks_without_data: blocks.filter((b) => b.score === null).map((b) => b.key),
    strengths,
    upload_checklist,
  }
}

/**
 * A v4 block as the v1 BlockScore columns of public.diagnostics store it. A
 * block without a v4 score keeps its v1 block (the columns have no «нет
 * данных»; a 0 / critical would be the silent zero v4 removes).
 */
function blockScoreOf(b: V4Block | undefined, fallback: BlockScore): BlockScore {
  if (!b || b.score === null) return fallback
  return {
    score: b.score,
    status: b.score >= 85 ? 'excellent' : b.score >= 70 ? 'strong' : b.score >= 50 ? 'average' : b.score >= 30 ? 'weak' : 'critical',
    top_issues: b.top_issues,
    recommendations: b.recommendations,
    earned: b.earned,
    possible: b.possible,
  }
}

/**
 * The public.diagnostics row of a v4 result: the five v1 block columns from
 * the v4 blocks, risks / insights / quick wins / data gaps of v1 (same rules).
 */
export function toCompatPointA(v4: PointAV4, v1: PointA): PointA {
  // No v4 score at all: the row stays v1 (the snapshot records engine 'v1').
  if (v4.overall === null) return v1
  const get = (k: BlockKey) => v4.blocks.find((b) => b.key === k)
  return {
    ...v1,
    overall_score: v4.overall ?? 0,
    health_index: v4.health_index ?? 0,
    stage: v4.stage ?? 'seed',
    blocks: {
      finance: blockScoreOf(get('finance'), v1.blocks.finance),
      sales: blockScoreOf(get('sales'), v1.blocks.sales),
      operations: blockScoreOf(get('operations'), v1.blocks.operations),
      marketing: blockScoreOf(get('marketing'), v1.blocks.marketing),
      strategy: blockScoreOf(get('strategy'), v1.blocks.strategy),
    },
  }
}

/** v1 block of the same checks (for shadow comparison). */
export function v1Block(checks: PointACheck[]): BlockScore {
  return toBlock(checks)
}
