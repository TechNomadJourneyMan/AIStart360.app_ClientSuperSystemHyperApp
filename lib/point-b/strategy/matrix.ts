/**
 * lib/point-b/strategy/matrix.ts — the impact × effort matrix («с чего начать», spec §11). Pure.
 *
 *   quick_wins  impact ≥ 3 and effort ≤ 3      do first
 *   big_bets    impact ≥ 3 and effort ≥ 4      plan carefully
 *   fill_ins    impact ≤ 2 and effort ≤ 3      when there is time
 *   avoid       impact ≤ 2 and effort ≥ 4      not worth it
 *
 * Only strategies and initiatives that have BOTH numbers are plotted. An initiative without a rating is
 * counted in `unrated` (the page says «без оценки: N»), never plotted at a made-up position; a strategy
 * without a rating is simply not plotted (strategies are not required to be rated).
 */
import type { StrategyNode } from './types'

export type Quadrant = 'quick_wins' | 'big_bets' | 'fill_ins' | 'avoid'

export interface MatrixPoint {
  key: string
  title: string
  kind: 'strategy' | 'initiative'
  impact: number
  effort: number
  quadrant: Quadrant
}

export function quadrantOf(impact: number, effort: number): Quadrant {
  if (impact >= 3) return effort <= 3 ? 'quick_wins' : 'big_bets'
  return effort <= 3 ? 'fill_ins' : 'avoid'
}

const isScore = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 5

export function buildMatrix(items: StrategyNode[]): { points: MatrixPoint[]; unrated: number } {
  const points: MatrixPoint[] = []
  let unrated = 0
  for (const it of items) {
    if (it.kind !== 'strategy' && it.kind !== 'initiative') continue
    if (isScore(it.impact) && isScore(it.effort)) {
      points.push({ key: it.key, title: it.title, kind: it.kind, impact: it.impact, effort: it.effort, quadrant: quadrantOf(it.impact, it.effort) })
    } else if (it.kind === 'initiative') {
      unrated++
    }
  }
  return { points, unrated }
}
