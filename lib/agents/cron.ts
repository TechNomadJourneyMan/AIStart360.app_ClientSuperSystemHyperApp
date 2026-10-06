/**
 * Minimal 5-field cron matcher (UTC) for agent schedules:
 * minute hour day-of-month month day-of-week, with *, lists (1,2), ranges (1-5)
 * and steps (*\/15, 0-30/5). Day-of-week 0 or 7 = Sunday. When both
 * day-of-month and day-of-week are restricted, either may match (POSIX).
 */

const FIELDS: Array<{ min: number; max: number }> = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
]

function parseField(expr: string, { min, max }: { min: number; max: number }): Set<number> | null {
  const out = new Set<number>()
  for (const part of expr.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isInteger(step) || step < 1) return null
    let lo: number
    let hi: number
    if (rangePart === '*') {
      lo = min
      hi = max
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-').map(Number)
      lo = a
      hi = b
    } else {
      lo = Number(rangePart)
      hi = stepPart === undefined ? lo : max
    }
    if (![lo, hi].every(Number.isInteger) || lo < min || hi > max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

export function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  return parts.length === 5 && parts.every((p, i) => parseField(p, FIELDS[i]) !== null)
}

export function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const sets = parts.map((p, i) => parseField(p, FIELDS[i]))
  if (sets.some((s) => s === null)) return false
  const [minute, hour, dom, month, dow] = sets as Set<number>[]
  const day = date.getUTCDay()
  const domRestricted = parts[2] !== '*'
  const dowRestricted = parts[4] !== '*'
  const domOk = dom.has(date.getUTCDate())
  const dowOk = dow.has(day) || (day === 0 && dow.has(7))
  const dayOk = domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk
  return minute.has(date.getUTCMinutes()) && hour.has(date.getUTCHours()) && month.has(date.getUTCMonth() + 1) && dayOk
}
