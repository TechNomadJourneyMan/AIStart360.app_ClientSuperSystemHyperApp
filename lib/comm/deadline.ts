/**
 * lib/comm/deadline.ts — the staff reply deadline of a conversation
 * (the «30-minute rule», docs/superpowers/specs/2026-10-16-user-communications-design.md §6.4).
 *
 *   replyDueAt(now, minutes, window)  now + minutes, or — with «Учитывать рабочие
 *                                     часы» on — now + that many minutes counted
 *                                     only inside the communication work window
 *                                     (comm_work_days / comm_work_from /
 *                                     comm_work_to / comm_timezone). A message that
 *                                     arrives at night becomes overdue `minutes`
 *                                     after the next window opens.
 *   loadReplyDeadline()               the settings above, fail-safe (30 min, no window).
 *
 * Pure except loadReplyDeadline (settings read). The deadline is stored on the
 * thread (comm_threads.staff_reply_due_at) when the user writes, so the
 * escalation check stays one indexed query. The window is the same one
 * broadcasts use (lib/comm/schedule.ts): from = to is the whole work day; an
 * overnight window (from > to) counts every minute.
 */

import type { WorkWindow } from './schedule'

export type { WorkWindow }

export const DEFAULT_ESCALATION_MINUTES = 30

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

/** 'HH:MM' → minutes since midnight, or null. */
export function parseHHMM(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** Weekday (1–7) and minute of the day of `at` in `timeZone`. */
export function localClock(at: Date, timeZone: string): { weekday: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0'
  const hour = Number(get('hour')) % 24
  return { weekday: WEEKDAY[get('weekday')] ?? 1, minute: hour * 60 + Number(get('minute')), second: Number(get('second')) }
}

/**
 * `start` + `minutes` counted only inside the work window. An unusable window
 * (no days, from ≥ to, bad time zone) falls back to plain minutes.
 */
export function addWorkingMinutes(start: Date, minutes: number, window: WorkWindow): Date {
  const rawFrom = parseHHMM(window.from)
  const rawTo = parseHHMM(window.to)
  const whole = rawFrom !== null && rawFrom === rawTo
  const from = whole ? 0 : rawFrom
  const to = whole ? 1440 : rawTo
  const days = new Set(window.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))
  const plain = new Date(start.getTime() + minutes * 60_000)
  if (from === null || to === null || from >= to || days.size === 0) return plain
  try {
    localClock(start, window.timeZone)
  } catch {
    return plain
  }

  let remaining = Math.max(0, minutes)
  // Whole minutes from here on: drop the seconds of `start`.
  let cursor = start.getTime()
  for (let i = 0; i < 400; i++) {
    const clock = localClock(new Date(cursor), window.timeZone)
    const minuteStart = cursor - clock.second * 1000 - (cursor % 1000)
    if (days.has(clock.weekday) && clock.minute < to) {
      const begin = Math.max(clock.minute, from)
      const available = to - begin
      const offset = begin === clock.minute ? cursor - minuteStart : 0
      if (remaining <= available) {
        return new Date(minuteStart + (begin - clock.minute) * 60_000 + remaining * 60_000 + offset)
      }
      remaining -= available
    }
    // Next local midnight (a DST jump is corrected by the next iteration).
    cursor = minuteStart + (1440 - clock.minute) * 60_000
  }
  return plain
}

/** The reply deadline of a message that arrives at `now`. */
export function replyDueAt(now: Date, minutes: number, window: WorkWindow | null): Date {
  const m = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_ESCALATION_MINUTES
  return window ? addWorkingMinutes(now, m, window) : new Date(now.getTime() + m * 60_000)
}

export interface ReplyDeadlineConfig {
  minutes: number
  /** null — the deadline counts every minute (setting «Учитывать рабочие часы» off). */
  window: WorkWindow | null
}

/** Settings of the «Общение» group; any read error → 30 minutes, no window. */
export async function loadReplyDeadline(): Promise<ReplyDeadlineConfig> {
  const { getSetting } = await import('@/lib/settings/store')
  let minutes = DEFAULT_ESCALATION_MINUTES
  try {
    minutes = (await getSetting('comm_escalation_minutes')) || DEFAULT_ESCALATION_MINUTES
  } catch { /* default */ }
  let window: WorkWindow | null = null
  try {
    if (await getSetting('comm_escalation_work_hours')) {
      const [days, from, to, timeZone] = await Promise.all([
        getSetting('comm_work_days'), getSetting('comm_work_from'), getSetting('comm_work_to'), getSetting('comm_timezone'),
      ])
      if (Array.isArray(days) && typeof from === 'string' && typeof to === 'string' && typeof timeZone === 'string') {
        window = { days, from, to, timeZone }
      }
    }
  } catch { /* plain minutes */ }
  return { minutes, window }
}
