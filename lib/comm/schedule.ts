/**
 * lib/comm/schedule.ts — when a broadcast may send and how long it waits
 * between messages (pure, no IO; the settings come from the «Общение» group of
 * lib/settings/registry.ts).
 *
 *   isWithinWindow(now, w)     the moment is inside the working hours: a work
 *                              day (1 = Mon … 7 = Sun) and from ≤ time < to, in
 *                              the communication time zone. from > to is an
 *                              overnight window (22:00–06:00 belongs to the day
 *                              it starts on); from = to — the whole work day.
 *   nextWindowStart(now, w)    now when inside the window, otherwise the start
 *                              of the next window (the engine sleeps until it).
 *   sendPauseMs(i, j, rng)     the pause between two messages: i seconds plus a
 *                              random 0…j seconds (rng injectable for tests).
 *
 * Personal messages (lib/comm/send.ts) do not use any of this — they go at once.
 */

export interface WorkWindow {
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  days: number[]
  /** 'HH:MM' */
  from: string
  /** 'HH:MM' */
  to: string
  timeZone: string
}

export const DEFAULT_WINDOW: WorkWindow = { days: [1, 2, 3, 4, 5], from: '09:00', to: '19:00', timeZone: 'Asia/Almaty' }

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** A time zone Intl knows, else the default (a broken setting must not stop the engine). */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_WINDOW.timeZone
  try {
    formatter(tz)
    return tz
  } catch {
    return DEFAULT_WINDOW.timeZone
  }
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {}
  for (const p of formatter(timeZone).formatToParts(date)) parts[p.type] = p.value
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second),
    weekday: WEEKDAY[parts.weekday] ?? 1,
  }
}

/** Offset of the zone from UTC at `date`, ms (Almaty: +5 h). */
function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** Local wall time (date + minutes after midnight) in the zone → the UTC instant. */
function zonedToUtc(year: number, month: number, day: number, minutes: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, 0, minutes)
  const first = offsetMs(new Date(guess), timeZone)
  let t = guess - first
  // Across a DST change the offset at the result differs from the guess.
  const second = offsetMs(new Date(t), timeZone)
  if (second !== first) t = guess - second
  return new Date(t)
}

/** 'HH:MM' → minutes after midnight (a broken value counts as 0). */
export function hhmmToMinutes(v: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v?.trim() ?? '')
  if (!m) return 0
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]))
}

function workDays(w: WorkWindow): Set<number> {
  const days = (w.days ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
  return new Set(days.length ? days : DEFAULT_WINDOW.days)
}

const prevDay = (wd: number) => (wd === 1 ? 7 : wd - 1)

export function isWithinWindow(now: Date, w: WorkWindow): boolean {
  const tz = safeTimeZone(w.timeZone)
  const p = zonedParts(now, tz)
  const days = workDays(w)
  const mins = p.hour * 60 + p.minute
  const from = hhmmToMinutes(w.from)
  const to = hhmmToMinutes(w.to)
  if (from === to) return days.has(p.weekday)
  if (from < to) return days.has(p.weekday) && mins >= from && mins < to
  // Overnight: the evening part belongs to today, the morning part to yesterday.
  return (days.has(p.weekday) && mins >= from) || (days.has(prevDay(p.weekday)) && mins < to)
}

/** `now` when inside the window, otherwise the start of the next window. */
export function nextWindowStart(now: Date, w: WorkWindow): Date {
  if (isWithinWindow(now, w)) return now
  const tz = safeTimeZone(w.timeZone)
  const p = zonedParts(now, tz)
  const days = workDays(w)
  const from = hhmmToMinutes(w.from)
  for (let k = 0; k <= 8; k++) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + k))
    const weekday = ((p.weekday - 1 + k) % 7) + 1
    if (!days.has(weekday)) continue
    const start = zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), from, tz)
    if (start.getTime() > now.getTime()) return start
  }
  // Unreachable with at least one work day; never sleep forever.
  return new Date(now.getTime() + 24 * 3_600_000)
}

/** Pause between two broadcast messages: interval + random 0…jitter seconds, in ms. */
export function sendPauseMs(intervalSeconds: number, jitterSeconds: number, rng: () => number = Math.random): number {
  const base = Math.max(0, Number(intervalSeconds) || 0) * 1000
  const jitter = Math.max(0, Number(jitterSeconds) || 0) * 1000
  const r = Math.min(Math.max(rng(), 0), 0.999999)
  return base + Math.floor(r * (jitter + 1))
}

const DAY_SHORT = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

/** «пн–пт 09:00–19:00 (Asia/Almaty)» for the GIGA page. */
export function describeWindow(w: WorkWindow): string {
  const days = Array.from(workDays(w)).sort((a, b) => a - b)
  const runs: string[] = []
  for (let i = 0; i < days.length; ) {
    let j = i
    while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++
    runs.push(j - i >= 2 ? `${DAY_SHORT[days[i]]}–${DAY_SHORT[days[j]]}` : days.slice(i, j + 1).map((d) => DAY_SHORT[d]).join(', '))
    i = j + 1
  }
  return `${runs.join(', ')} ${w.from}–${w.to} (${safeTimeZone(w.timeZone)})`
}
