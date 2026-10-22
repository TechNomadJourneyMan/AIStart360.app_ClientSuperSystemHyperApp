/**
 * lib/point-b/planfact/cron.ts — the schedule of the Point B recompute (spec §14, setting `pb_recompute_cron`). Pure.
 *
 * Inngest registers a cron statically, so the recompute wakes up every hour and asks `cronDue(expr, now)` whether
 * this hour is one of the scheduled ones. The expression is a classic 5-field cron in UTC
 * (`minute hour day-of-month month day-of-week`); the minute must be ONE number — the schedule never runs more often
 * than once an hour (the minute itself is not matched: the hourly wake-up runs at :00). Fields accept `*`, numbers,
 * lists, ranges and steps (`1,4`, `1-5`, `*\/2`); day of week 0..7 with 0 and 7 = Sunday. When both day fields are
 * restricted, either one matching is enough (the cron convention).
 */

export const DEFAULT_RECOMPUTE_CRON = '0 22 * * 1,4'

interface Field { min: number; max: number }
const FIELDS: Record<'minute' | 'hour' | 'dom' | 'month' | 'dow', Field> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dom: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dow: { min: 0, max: 7 },
}

/** The values of one field, or null when it is not valid. `*` → null set marker 'any'. */
function expand(raw: string, f: Field): Set<number> | 'any' | null {
  if (raw === '*') return 'any'
  const out = new Set<number>()
  for (const part of raw.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
    if (!m) return null
    const step = m[2] ? Number(m[2]) : 1
    if (!Number.isInteger(step) || step < 1) return null
    let lo = f.min
    let hi = f.max
    if (m[1] !== '*') {
      const [a, b] = m[1].split('-').map(Number)
      lo = a
      hi = b === undefined ? (m[2] ? f.max : a) : b
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < f.min || hi > f.max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out.size ? out : null
}

export interface ParsedCron {
  hour: Set<number> | 'any'
  dom: Set<number> | 'any'
  month: Set<number> | 'any'
  dow: Set<number> | 'any'
}

export function parseRecomputeCron(expr: unknown): ParsedCron | null {
  if (typeof expr !== 'string') return null
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  if (!/^\d{1,2}$/.test(parts[0]) || Number(parts[0]) > 59) return null
  const hour = expand(parts[1], FIELDS.hour)
  const dom = expand(parts[2], FIELDS.dom)
  const month = expand(parts[3], FIELDS.month)
  const dowRaw = expand(parts[4], FIELDS.dow)
  if (!hour || !dom || !month || !dowRaw) return null
  const dow = dowRaw === 'any' ? 'any' : new Set([...dowRaw].map((d) => (d === 7 ? 0 : d)))
  return { hour, dom, month, dow }
}

export const isValidRecomputeCron = (expr: unknown): boolean => parseRecomputeCron(expr) !== null

const has = (s: Set<number> | 'any', v: number): boolean => s === 'any' || s.has(v)

/** Is the UTC hour of `now` a scheduled one? An invalid expression falls back to the default schedule. */
export function cronDue(expr: unknown, now: Date): boolean {
  const c = parseRecomputeCron(expr) ?? parseRecomputeCron(DEFAULT_RECOMPUTE_CRON)!
  if (!has(c.hour, now.getUTCHours()) || !has(c.month, now.getUTCMonth() + 1)) return false
  const domOk = has(c.dom, now.getUTCDate())
  const dowOk = has(c.dow, now.getUTCDay())
  if (c.dom !== 'any' && c.dow !== 'any') return domOk || dowOk
  return domOk && dowOk
}
