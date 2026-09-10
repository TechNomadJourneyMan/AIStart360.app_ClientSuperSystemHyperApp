/**
 * lib/survey/targets.ts — derive annual revenue goals from step-1 answers so
 * `companies.target_revenue_*` (what the dashboard «Снимок Точки А» reads) stays
 * in sync with what the owner typed in the survey (what Point B reads).
 */

export function positiveNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.,-]/g, '').replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  if (v && typeof v === 'object' && 'value' in (v as object)) return positiveNumber((v as { value: unknown }).value)
  return null
}

/** Annual goal from step 1: `*_year` wins, else `*_month` × months. */
export function annualGoalFromAnswers(
  answers: Record<string, unknown>,
  yearKey: string,
  monthKey: string,
  months: number,
): number | null {
  const year = positiveNumber(answers[yearKey])
  if (year) return Math.round(year)
  const month = positiveNumber(answers[monthKey])
  return month ? Math.round(month * months) : null
}
