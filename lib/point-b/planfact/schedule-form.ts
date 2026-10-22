/**
 * lib/point-b/planfact/schedule-form.ts — the GIGA settings form of the Point B recompute (group «Точка Б»). Pure.
 *
 *   buildRecomputeCron(s)        days of week + an hour (UTC) → a valid `pb_recompute_cron` ('0 22 * * 1,4')
 *   scheduleFromCron(expr)       the reverse, when the expression fits the form (one hour, any day of month and
 *                                month); null — a hand-made expression the form cannot show
 *   localSchedule(s, tz)         the same moments in a time zone (Almaty by default): the days shift across midnight
 *   describeRecomputeSchedule    «Пн, Чт в 22:00 UTC · по Алматы: Вт, Пт в 03:00»
 *   parseTolerancesDraft         the two inputs of the verdict tolerances → the setting value or a Russian error
 *
 * Days are cron numbers: 0 = Sunday … 6 = Saturday (7 is folded into 0 by the parser).
 */
import { validateSetting } from '@/lib/settings/registry'
import { parseRecomputeCron } from './cron'

export interface RecomputeSchedule {
  /** Cron days of week, 0 = Sunday … 6 = Saturday, sorted, unique. */
  days: number[]
  /** 0…23, UTC. */
  hourUtc: number
}

/** The order of the checkboxes: Monday first. */
export const FORM_DAYS: ReadonlyArray<readonly [number, string]> = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']]
const DAY_LABEL: Record<number, string> = Object.fromEntries(FORM_DAYS.map(([d, l]) => [d, l]))
const mondayFirst = (d: number) => (d === 0 ? 7 : d)

export const ALMATY_TZ = 'Asia/Almaty'

function normDays(days: readonly number[]): number[] {
  return Array.from(new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 7).map((d) => (d === 7 ? 0 : d)))).sort((a, b) => a - b)
}

/** The cron of the form. No day chosen → '' (invalid: the form refuses to save). */
export function buildRecomputeCron(s: RecomputeSchedule): string {
  const days = normDays(s.days)
  const hour = Math.trunc(s.hourUtc)
  if (!days.length || !Number.isInteger(hour) || hour < 0 || hour > 23) return ''
  return `0 ${hour} * * ${days.length === 7 ? '*' : days.join(',')}`
}

/** The form's view of a cron, or null when it uses several hours, a day of month or a month. */
export function scheduleFromCron(expr: unknown): RecomputeSchedule | null {
  const c = parseRecomputeCron(expr)
  if (!c || c.dom !== 'any' || c.month !== 'any' || c.hour === 'any' || c.hour.size !== 1) return null
  const days = c.dow === 'any' ? [0, 1, 2, 3, 4, 5, 6] : normDays([...c.dow])
  return { days, hourUtc: [...c.hour][0] }
}

/** Offset of the zone from UTC at `at`, minutes (Almaty: +300). A zone Intl does not know → 0. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  try {
    const parts: Record<string, string> = {}
    const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    for (const p of f.formatToParts(at)) parts[p.type] = p.value
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute))
    return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000)
  } catch {
    return 0
  }
}

/** The scheduled moments in a time zone: the days (cron numbers) and 'HH:MM'. */
export function localSchedule(s: RecomputeSchedule, timeZone = ALMATY_TZ, at: Date = new Date()): { days: number[]; time: string } {
  const total = s.hourUtc * 60 + zoneOffsetMinutes(timeZone, at)
  const shift = Math.floor(total / 1440)
  const mins = ((total % 1440) + 1440) % 1440
  const days = normDays(s.days.map((d) => (((d + shift) % 7) + 7) % 7))
  return { days, time: `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}` }
}

export function daysLabel(days: readonly number[]): string {
  const list = normDays(days)
  if (list.length === 7) return 'ежедневно'
  return [...list].sort((a, b) => mondayFirst(a) - mondayFirst(b)).map((d) => DAY_LABEL[d]).join(', ')
}

/** «Пн, Чт в 22:00 UTC · по Алматы: Вт, Пт в 03:00». */
export function describeRecomputeSchedule(s: RecomputeSchedule, timeZone = ALMATY_TZ, at: Date = new Date()): string {
  if (!normDays(s.days).length) return 'Не выбран ни один день'
  const local = localSchedule(s, timeZone, at)
  const where = timeZone === ALMATY_TZ ? 'по Алматы' : timeZone
  return `${daysLabel(s.days)} в ${String(s.hourUtc).padStart(2, '0')}:00 UTC · ${where}: ${daysLabel(local.days)} в ${local.time}`
}

/** A schedule of the form → the setting value, checked by the same rule the API uses. */
export function validateScheduleDraft(s: RecomputeSchedule): { ok: true; value: string } | { ok: false; error: string } {
  if (!normDays(s.days).length) return { ok: false, error: 'Выберите хотя бы один день' }
  const expr = buildRecomputeCron(s)
  if (!expr) return { ok: false, error: 'Час — от 0 до 23 (UTC)' }
  const v = validateSetting('pb_recompute_cron', expr)
  return v.ok ? { ok: true, value: v.value } : { ok: false, error: v.error }
}

export interface TolerancesDraft { onTrack: string; risk: string }
export type Tolerances = { on_track_pct: number; risk_pct: number }

const num = (s: string): number | null => {
  const t = s.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** The two inputs → `pb_verdict_tolerances`, or the first problem in Russian. */
export function parseTolerancesDraft(d: TolerancesDraft): { ok: true; value: Tolerances } | { ok: false; error: string } {
  const onTrack = num(d.onTrack)
  const risk = num(d.risk)
  if (onTrack === null) return { ok: false, error: 'Укажите допуск «на курсе» числом' }
  if (risk === null) return { ok: false, error: 'Укажите допуск «риск» числом' }
  if (onTrack < 0 || onTrack > 50) return { ok: false, error: 'Допуск «на курсе» — от 0 до 50 %' }
  if (risk < 0 || risk > 90) return { ok: false, error: 'Допуск «риск» — от 0 до 90 %' }
  if (risk <= onTrack) return { ok: false, error: 'Допуск «риск» должен быть больше допуска «на курсе»' }
  const v = validateSetting('pb_verdict_tolerances', { on_track_pct: onTrack, risk_pct: risk })
  return v.ok ? { ok: true, value: v.value } : { ok: false, error: v.error }
}
