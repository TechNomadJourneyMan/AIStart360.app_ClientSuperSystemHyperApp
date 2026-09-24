/**
 * lib/automation/time.ts — календарь автоматических касаний.
 *
 * Все «сегодня», «вчера», «эта неделя», «пятница» считаются в поясе
 * платформы (EMAIL_TIMEZONE, по умолчанию Asia/Almaty), а не в UTC: cron
 * Vercel работает в UTC, и «вчерашние регистрации» в 08:00 по Алматы — это
 * сутки по Алматы.
 */

import { emailTimeZone } from '@/lib/email/brand'

export const DAY_MS = 24 * 60 * 60 * 1000

/** Календарная дата (YYYY-MM-DD) момента в поясе платформы. */
export function localDate(at: Date, timeZone: string = emailTimeZone()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Смещение пояса от UTC в минутах в момент `at` (Алматы: +300). */
export function tzOffsetMinutes(at: Date, timeZone: string = emailTimeZone()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000)
}

/** Начало локальных суток `date` (YYYY-MM-DD) как момент UTC. */
export function startOfLocalDay(date: string, timeZone: string = emailTimeZone()): Date {
  const [y, m, d] = date.split('-').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d))
  return new Date(guess.getTime() - tzOffsetMinutes(guess, timeZone) * 60000)
}

/** Сдвиг календарной даты на n дней. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10)
}

/** День недели локальной даты: 1 = понедельник … 7 = воскресенье. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return dow === 0 ? 7 : dow
}

/** Понедельник недели, в которую попадает локальная дата. */
export function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date))
}

/** Полных дней между моментами (вниз). */
export function daysBetween(from: Date | string, to: Date): number {
  const t = typeof from === 'string' ? new Date(from).getTime() : from.getTime()
  if (!Number.isFinite(t)) return -1
  return Math.floor((to.getTime() - t) / DAY_MS)
}

/** Полных часов между моментами (вниз). */
export function hoursBetween(from: Date | string, to: Date): number {
  const t = typeof from === 'string' ? new Date(from).getTime() : from.getTime()
  if (!Number.isFinite(t)) return -1
  return Math.floor((to.getTime() - t) / 3_600_000)
}
