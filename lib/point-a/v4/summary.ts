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

export function overviewSummary(s: { overall: number | null; confidence: number | null; stage: string | null; blocks: readonly V4Block[]; assessment?: 'full' | 'preliminary' }): OverviewSummary {
  const weighted = s.blocks.filter((b) => !b.informational)
  if (s.assessment === 'preliminary') return preliminarySummary(weighted)
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

/**
 * Before the full questionnaire (PO 2026-11-02): what the answers already
 * show — findings and first steps of every block with answers, blocks with
 * no remarks — and never a score, a stage or «сильнее / слабее всего N».
 */
function preliminarySummary(weighted: readonly V4Block[]): OverviewSummary {
  const withIssues = weighted.filter((b) => b.top_issues.length).sort((a, b) => b.top_issues.length - a.top_issues.length)
  const findings = weighted.reduce((n, b) => n + b.top_issues.length, 0)
  const noData = weighted.filter((b) => b.coverage < 0.4)
  const parts = ['Это предварительный снимок: оценка и стадия бизнеса появятся после отправки полной анкеты.']
  parts.push(findings ? `По вашим ответам уже видно находок: ${findings}${withIssues.length > 1 ? ` — в ${withIssues.length} блоках` : ''}.` : 'По ответам пока нет замечаний.')
  if (noData.length) parts.push(`Мало ответов: ${noData.map((b) => `«${b.title}»`).join(', ')}.`)
  return {
    headline: parts.join(' '),
    risks: withIssues.flatMap((b) => b.top_issues.slice(0, 2).map((text) => ({ block: b.title, text }))).slice(0, 3),
    quickWins: withIssues.flatMap((b) => b.recommendations.slice(0, 2).map((text) => ({ block: b.title, text }))).slice(0, 3),
    strengths: weighted
      .filter((b) => b.score !== null && b.coverage >= 0.4 && !b.top_issues.length && b.score >= 70)
      .slice(0, 3)
      .map((b) => ({ block: b.title, text: 'замечаний нет' })),
  }
}
