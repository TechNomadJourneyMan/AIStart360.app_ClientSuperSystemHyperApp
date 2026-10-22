/**
 * lib/point-b/insights/constraint.ts — the limiting factor of growth (spec §12: determined by RULES, the AI
 * only explains it). Pure.
 *
 * Scenario: «Умеренный», else the first feasible one, else the first. For every lever of the funnel that has
 * to grow, the share of its realisable headroom the goal uses:
 *
 *     ratio = (target − current) / (cap − current)
 *
 * with the ceilings of realisability of the model (LEVER_CAPS, scenarios.ts): leads ×3, conversion ×2 but
 * at most 60% (never below today's), check ×2, repeat at most 90%. The lever with the HIGHEST ratio is the
 * limiting factor; within 1e-6 of each other the lever whose Point A block is the weakest wins
 * (leads → marketing; conversion, check, repeat → sales); then the order leads, conversion, check, repeat.
 *
 * null when there is nothing to say honestly: level 0, no scenarios, the growth model (no levers), or no
 * lever has to grow.
 */
import { fmtMoney, fmtNum, fmtPct } from '../model/format'
import { LEVER_CAPS } from '../model/scenarios'
import type { ModelResult, ScenarioResult } from '../model/types'
import type { RecSourceRef } from '../recs/types'
import { LEVER_METRIC, scenarioRef } from './scenario'

type Lever = 'leads' | 'conversion' | 'avgCheck' | 'repeat'
const LEVERS: readonly Lever[] = ['leads', 'conversion', 'avgCheck', 'repeat']

/** The Point A block a lever belongs to. */
export const LEVER_BLOCK: Record<Lever, string> = { leads: 'marketing', conversion: 'sales', avgCheck: 'sales', repeat: 'sales' }
const BLOCK_LABEL: Record<string, string> = { marketing: 'Маркетинг', sales: 'Продажи' }

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const EPS = 1e-6

function capOf(lever: Lever, current: number): number {
  switch (lever) {
    case 'leads': return current * LEVER_CAPS.leadsTimes
    case 'conversion': return Math.max(current, Math.min(1, current * LEVER_CAPS.conversionTimes, LEVER_CAPS.conversionMax))
    case 'avgCheck': return current * LEVER_CAPS.avgCheckTimes
    case 'repeat': return Math.max(current, LEVER_CAPS.repeatMax)
  }
}

function scenarioOf(result: ModelResult): ScenarioResult | null {
  const list = result.scenarios ?? []
  return list.find((s) => s.key === 'moderate') ?? list.find((s) => s.feasible) ?? list[0] ?? null
}

const valueText = (lever: Lever, v: number): string =>
  lever === 'leads' ? `${fmtNum(v)} в месяц` : lever === 'avgCheck' ? fmtMoney(v) : fmtPct(v, 1)

export interface LimitingFactor {
  lever: string
  label: string
  reason: string
  sourceRefs: RecSourceRef[]
}

export function findLimitingFactor(result: ModelResult, blocks: Array<{ key: string; score: number | null }>): LimitingFactor | null {
  if (!result || result.level < 1 || result.kind !== 'funnel') return null
  const sc = scenarioOf(result)
  if (!sc) return null

  const scores = new Map(blocks.filter((b) => finite(b.score)).map((b) => [b.key, b.score as number]))
  const candidates = sc.requiredUplift.flatMap((u) => {
    const lever = u.lever as Lever
    if (!LEVERS.includes(lever) || !finite(u.current) || !finite(u.target) || u.current <= 0 || u.target <= u.current * (1 + EPS)) return []
    const headroom = capOf(lever, u.current) - u.current
    const ratio = headroom > EPS ? (u.target - u.current) / headroom : Number.MAX_VALUE
    return [{ u, lever, ratio, blockScore: scores.get(LEVER_BLOCK[lever]) ?? Number.POSITIVE_INFINITY }]
  })
  if (!candidates.length) return null

  candidates.sort((a, b) => {
    if (Math.abs(a.ratio - b.ratio) > EPS * Math.max(1, Math.abs(a.ratio), Math.abs(b.ratio))) return b.ratio - a.ratio
    if (a.blockScore !== b.blockScore) return a.blockScore - b.blockScore
    return LEVERS.indexOf(a.lever) - LEVERS.indexOf(b.lever)
  })
  const top = candidates[0]
  const blockKey = LEVER_BLOCK[top.lever]
  const weakest = scores.size > 0 && [...scores.entries()].every(([k, s]) => k === blockKey || s >= (scores.get(blockKey) ?? Number.POSITIVE_INFINITY))
    && scores.has(blockKey)
  const pct = finite(top.u.upliftPct) ? `+${fmtNum(top.u.upliftPct, 1)}%` : null

  const reason = [
    `В сценарии «${sc.label}» показатель «${top.u.label}» нужно поднять с ${valueText(top.lever, top.u.current as number)} до ${valueText(top.lever, top.u.target as number)}${pct ? ` (${pct})` : ''}.`,
    'Из всех рычагов он ближе всего к потолку реализуемости — рост остальных рычагов упрётся в него.',
    ...(weakest ? [`Связанный блок Точки А «${BLOCK_LABEL[blockKey] ?? blockKey}» — самый слабый.`] : []),
  ].join(' ')

  const sourceRefs: RecSourceRef[] = [
    scenarioRef(sc),
    { type: 'metric', ref: LEVER_METRIC[top.lever], label: top.u.label },
    ...(scores.has(blockKey) ? [{ type: 'snapshot' as const, ref: `block:${blockKey}`, label: `Блок Точки А «${BLOCK_LABEL[blockKey] ?? blockKey}»` }] : []),
  ]
  return { lever: top.lever, label: top.u.label, reason, sourceRefs }
}
