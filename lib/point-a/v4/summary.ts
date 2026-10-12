/**
 * lib/point-a/v4/summary.ts — the Executive Overview of a Point A snapshot
 * (spec §4.3): a 2–3 sentence conclusion, top risks, quick wins and
 * strengths, from the blocks only — deterministic, no AI, nothing invented.
 */
import type { V4Block } from './engine'

const STAGE_RU: Record<string, string> = { seed: 'старт', early: 'ранний рост', growth: 'рост', scale: 'масштаб', mature: 'зрелость' }

export interface OverviewSummary {
  headline: string
  risks: Array<{ block: string; text: string }>
  quickWins: Array<{ block: string; text: string }>
  strengths: Array<{ block: string; text: string }>
}

export function overviewSummary(s: { overall: number | null; confidence: number | null; stage: string | null; blocks: readonly V4Block[] }): OverviewSummary {
  const weighted = s.blocks.filter((b) => !b.informational)
  const scored = weighted.filter((b) => b.score !== null).sort((a, b) => (b.score as number) - (a.score as number))
  const missing = weighted.filter((b) => b.score === null)

  let headline: string
  if (s.overall === null || !scored.length) {
    headline = 'Данных пока недостаточно для общей оценки. Заполните анкету или загрузите отчётность — Точка А посчитается автоматически.'
  } else {
    const parts = [
      `Общий балл ${Math.round(s.overall)} из 100${s.stage ? `, стадия «${STAGE_RU[s.stage] ?? s.stage}»` : ''}; достоверность ${Math.round((s.confidence ?? 0) * 100)}%.`,
    ]
    const best = scored[0]
    const worst = scored[scored.length - 1]
    if (scored.length > 1 && (best.score as number) - (worst.score as number) >= 10) {
      parts.push(`Сильнее всего — «${best.title}» (${best.score}), слабее всего — «${worst.title}» (${worst.score}).`)
    }
    if (missing.length) parts.push(`Без оценки из-за нехватки данных: ${missing.map((b) => `«${b.title}»`).join(', ')}.`)
    headline = parts.join(' ')
  }

  const weak = scored.slice().reverse().filter((b) => (b.score as number) < 60)
  const risks = weak.flatMap((b) => b.top_issues.slice(0, 2).map((text) => ({ block: b.title, text }))).slice(0, 3)
  const quickWins = weak.flatMap((b) => b.recommendations.slice(0, 2).map((text) => ({ block: b.title, text }))).slice(0, 3)
  const strengths = scored
    .filter((b) => (b.score as number) >= 70 && b.confidence >= 0.5)
    .slice(0, 3)
    .map((b) => ({ block: b.title, text: `${b.score} из 100${b.confidence < 0.7 ? " (данных пока мало)" : ""}` }))
  return { headline, risks, quickWins, strengths }
}
