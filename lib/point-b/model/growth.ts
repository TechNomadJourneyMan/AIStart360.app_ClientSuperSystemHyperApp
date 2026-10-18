/**
 * lib/point-b/model/growth.ts — the simplified growth model (spec §9.4 (2)): for a client without a
 * funnel the annual revenue run-rate grows by a constant yearly rate, base · (1 + g)^(t/12).
 * Pure, no IO, no clock.
 */
import { ModelInputError } from './types'

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Annual run-rate by month 1..months. */
export function projectGrowth(input: { baseAnnual: number; annualGrowth: number; months: number }): number[] {
  const { baseAnnual, annualGrowth, months } = input
  if (!finite(baseAnnual) || baseAnnual <= 0) throw new ModelInputError('Базовая выручка должна быть больше нуля')
  if (!finite(annualGrowth) || annualGrowth <= -1) throw new ModelInputError('Годовой рост должен быть больше −100%')
  if (!Number.isInteger(months) || months < 0) throw new ModelInputError('Горизонт расчёта — целое число месяцев, не меньше нуля')
  const out: number[] = []
  for (let t = 1; t <= months; t++) {
    const v = baseAnnual * (1 + annualGrowth) ** (t / 12)
    if (!finite(v)) throw new ModelInputError('Рост слишком велик для расчёта')
    out.push(v)
  }
  return out
}

/** Months (fractional) until the run-rate reaches the target: 0 when it is already there, null when it never will. */
export function timeToTarget(input: { baseAnnual: number; targetAnnual: number; annualGrowth: number }): number | null {
  const { baseAnnual, targetAnnual, annualGrowth } = input
  if (!finite(baseAnnual) || baseAnnual <= 0 || !finite(targetAnnual) || targetAnnual <= 0) return null
  if (targetAnnual <= baseAnnual) return 0
  if (!finite(annualGrowth) || annualGrowth <= 0) return null
  const months = (12 * Math.log(targetAnnual / baseAnnual)) / Math.log(1 + annualGrowth)
  // 12·ln2/ln2 must be exactly 12, not 12.000000000000002.
  return finite(months) ? Math.round(months * 1e9) / 1e9 : null
}

/** The yearly growth that takes `base` to `target` in `months` (negative for a target below the base). */
export function requiredAnnualGrowth(base: number, target: number, months: number): number | null {
  if (!finite(months) || months <= 0) return null
  if (!finite(base) || base <= 0 || !finite(target) || target <= 0) return null
  const g = (target / base) ** (12 / months) - 1
  return finite(g) ? g : null
}
