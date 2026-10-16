/**
 * Broadcasts, pure parts: the working-hours window (Asia/Almaty default,
 * weekends, overnight windows, DST zones), the pause between messages
 * (interval + jitter), the audience normalisation and the recipient plan
 * (dedupe, block / opt-out / unreachable channels skipped with the reason).
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_WINDOW, describeWindow, hhmmToMinutes, isWithinWindow, nextWindowStart, sendPauseMs, type WorkWindow } from '@/lib/comm/schedule'
import { MAX_PICKED, normalizeAudience, planRecipients, type Reach } from '@/lib/comm/audience'
import { NO_ASSIGNEE, userListFilterArgs } from '@/lib/admin/list-users'
import { estimateDuration, plural, reasonLabel } from '@/components/giga-panel/comm/CampaignWizard'

const ACTOR = '33333333-3333-4333-8333-333333333333'
/** Local Almaty time (UTC+5) → Date. */
const almaty = (iso: string) => new Date(new Date(`${iso}Z`).getTime() - 5 * 3_600_000)

describe('working hours (default: Mon–Fri 09:00–19:00 Asia/Almaty)', () => {
  const w = DEFAULT_WINDOW

  it('inside / outside the window', () => {
    expect(isWithinWindow(almaty('2026-10-19T09:00:00'), w)).toBe(true) // Monday, opening minute
    expect(isWithinWindow(almaty('2026-10-19T18:59:59'), w)).toBe(true)
    expect(isWithinWindow(almaty('2026-10-19T08:59:59'), w)).toBe(false)
    expect(isWithinWindow(almaty('2026-10-19T19:00:00'), w)).toBe(false) // «до 19:00» is exclusive
    expect(isWithinWindow(almaty('2026-10-24T12:00:00'), w)).toBe(false) // Saturday
    expect(isWithinWindow(almaty('2026-10-25T12:00:00'), w)).toBe(false) // Sunday
    // 04:30 UTC on Monday is 09:30 in Almaty — the zone matters, not the server clock.
    expect(isWithinWindow(new Date('2026-10-19T04:30:00Z'), w)).toBe(true)
    expect(isWithinWindow(new Date('2026-10-19T03:30:00Z'), w)).toBe(false)
  })

  it('next window start', () => {
    const now = almaty('2026-10-19T12:00:00')
    expect(nextWindowStart(now, w)).toBe(now) // inside → now
    expect(nextWindowStart(almaty('2026-10-19T07:15:00'), w).toISOString()).toBe(almaty('2026-10-19T09:00:00').toISOString())
    expect(nextWindowStart(almaty('2026-10-19T19:00:00'), w).toISOString()).toBe(almaty('2026-10-20T09:00:00').toISOString())
    // Friday evening and the weekend → Monday 09:00.
    expect(nextWindowStart(almaty('2026-10-16T19:30:00'), w).toISOString()).toBe(almaty('2026-10-19T09:00:00').toISOString())
    expect(nextWindowStart(almaty('2026-10-24T10:00:00'), w).toISOString()).toBe(almaty('2026-10-26T09:00:00').toISOString())
    expect(nextWindowStart(almaty('2026-10-25T23:59:00'), w).toISOString()).toBe(almaty('2026-10-26T09:00:00').toISOString())
  })

  it('custom days and hours from the settings', () => {
    const sat: WorkWindow = { days: [6], from: '10:30', to: '14:00', timeZone: 'Asia/Almaty' }
    expect(isWithinWindow(almaty('2026-10-24T10:30:00'), sat)).toBe(true)
    expect(isWithinWindow(almaty('2026-10-19T11:00:00'), sat)).toBe(false)
    expect(nextWindowStart(almaty('2026-10-19T11:00:00'), sat).toISOString()).toBe(almaty('2026-10-24T10:30:00').toISOString())
  })

  it('overnight window belongs to the day it starts on; from = to is the whole day', () => {
    const night: WorkWindow = { days: [1], from: '22:00', to: '06:00', timeZone: 'Asia/Almaty' }
    expect(isWithinWindow(almaty('2026-10-19T23:00:00'), night)).toBe(true) // Monday night
    expect(isWithinWindow(almaty('2026-10-20T05:00:00'), night)).toBe(true) // …until Tuesday 06:00
    expect(isWithinWindow(almaty('2026-10-20T07:00:00'), night)).toBe(false)
    expect(isWithinWindow(almaty('2026-10-19T05:00:00'), night)).toBe(false) // Sunday night is not a work night
    const allDay: WorkWindow = { days: [1, 2, 3, 4, 5], from: '00:00', to: '00:00', timeZone: 'Asia/Almaty' }
    expect(isWithinWindow(almaty('2026-10-19T03:00:00'), allDay)).toBe(true)
    expect(isWithinWindow(almaty('2026-10-24T03:00:00'), allDay)).toBe(false)
  })

  it('a zone with daylight saving time (Europe/Berlin, ends 2026-10-25)', () => {
    const berlin: WorkWindow = { days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00', timeZone: 'Europe/Berlin' }
    // Friday 23 Oct (CEST, UTC+2) evening → Monday 26 Oct 09:00 CET = 08:00 UTC.
    expect(nextWindowStart(new Date('2026-10-23T17:00:00Z'), berlin).toISOString()).toBe('2026-10-26T08:00:00.000Z')
    expect(nextWindowStart(new Date('2026-10-22T05:00:00Z'), berlin).toISOString()).toBe('2026-10-22T07:00:00.000Z')
  })

  it('a broken time zone falls back to Almaty instead of stopping the engine', () => {
    const broken: WorkWindow = { ...w, timeZone: 'Mars/Olympus' }
    expect(isWithinWindow(almaty('2026-10-19T10:00:00'), broken)).toBe(true)
  })

  it('labels', () => {
    expect(describeWindow(w)).toBe('пн–пт 09:00–19:00 (Asia/Almaty)')
    expect(describeWindow({ ...w, days: [1, 3, 6, 7] })).toBe('пн, ср, сб, вс 09:00–19:00 (Asia/Almaty)')
    expect(hhmmToMinutes('19:00')).toBe(1140)
    expect(hhmmToMinutes('junk')).toBe(0)
  })
})

describe('pause between messages: interval + random 0…jitter', () => {
  it('bounds with an injected RNG', () => {
    expect(sendPauseMs(10, 5, () => 0)).toBe(10_000)
    expect(sendPauseMs(10, 5, () => 0.5)).toBe(12_500)
    expect(sendPauseMs(10, 5, () => 0.9999999)).toBe(15_000)
    expect(sendPauseMs(10, 0, () => 0.7)).toBe(10_000)
    expect(sendPauseMs(3, 120, () => 1)).toBeLessThanOrEqual(123_000)
  })

  it('always within [interval, interval + jitter] with the real RNG', () => {
    for (let i = 0; i < 2000; i++) {
      const ms = sendPauseMs(10, 5)
      expect(ms).toBeGreaterThanOrEqual(10_000)
      expect(ms).toBeLessThanOrEqual(15_000)
    }
  })

  it('estimate in the wizard', () => {
    expect(estimateDuration(6, { intervalSeconds: 10, jitterSeconds: 5 })).toBe('≈ 75 с')
    expect(estimateDuration(100, { intervalSeconds: 10, jitterSeconds: 5 })).toBe('≈ 21 мин')
    expect(estimateDuration(1000, { intervalSeconds: 10, jitterSeconds: 5 })).toBe('≈ 3,5 ч рабочего времени')
    expect(plural(1, 'ь', 'я', 'ей')).toBe('ь')
    expect(plural(3, 'ь', 'я', 'ей')).toBe('я')
    expect(plural(11, 'ь', 'я', 'ей')).toBe('ей')
    expect(reasonLabel('blocked')).toBe('заблокирован в сообщениях')
    expect(reasonLabel('no_email')).toBe('нет email')
  })
})

describe('audience', () => {
  it('filters: the same allowed values and argument mapping as the users list; «me» is stored as the author', () => {
    expect(normalizeAudience({ kind: 'filters', filters: { segment: 'survey_completed', status: 'approved', role: 'client', assignee: 'me', q: '  ООО ' } }, ACTOR)).toEqual({
      kind: 'filters', filters: { q: 'ООО', segment: 'survey_completed', status: 'approved', role: 'client', assignee: ACTOR },
    })
    expect(normalizeAudience({ kind: 'filters', filters: { assignee: 'none' } }, ACTOR)).toMatchObject({ filters: { assignee: 'none' } })
    expect(normalizeAudience({ kind: 'filters', filters: { segment: 'everyone' } }, ACTOR)).toBeNull()
    expect(normalizeAudience({ kind: 'filters', filters: { role: "admin' or 1=1" } }, ACTOR)).toBeNull()
    expect(normalizeAudience({ kind: 'filters', filters: { assignee: 'junk' } }, ACTOR)).toBeNull()
    expect(userListFilterArgs({ assignee: 'none', segment: 'gri_completed' }, ACTOR)).toEqual({ p_assignee: NO_ASSIGNEE, p_search: null, p_status: null, p_role: null, p_segment: 'gri_completed' })
  })

  it('users: deduplicated, junk ids dropped, empty or too long refused', () => {
    const a = '11111111-1111-4111-8111-111111111111'
    expect(normalizeAudience({ kind: 'users', userIds: [a, a.toUpperCase(), 'nope', 5] }, ACTOR)).toEqual({ kind: 'users', userIds: [a] })
    expect(normalizeAudience({ kind: 'users', userIds: ['nope'] }, ACTOR)).toBeNull()
    const many = Array.from({ length: MAX_PICKED + 1 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`)
    expect(normalizeAudience({ kind: 'users', userIds: many }, ACTOR)).toBeNull()
    expect(normalizeAudience({ kind: 'all' }, ACTOR)).toBeNull()
    expect(normalizeAudience(null, ACTOR)).toBeNull()
  })
})

describe('recipient plan', () => {
  const user = (id: string, p: Partial<Reach> = {}): Reach => ({ id, name: id, hasEmail: true, hasTelegram: true, hasPhone: true, whatsappOptOut: false, blocked: false, ...p })
  const on = { telegramConfigured: true, whatsappConfigured: true }

  it('one row per user × channel, a user listed twice gets one row per channel', () => {
    const plan = planRecipients([user('a'), user('a'), user('b')], ['email', 'app', 'email' as never], on)
    expect(plan.users).toBe(2)
    expect(plan.rows.map((r) => `${r.user_id}:${r.channel}`)).toEqual(['a:app', 'a:email', 'b:app', 'b:email'])
    expect(plan.perChannel.app).toEqual({ send: 2, skipped: 0, reasons: {} })
  })

  it('unreachable channels, WhatsApp opt-out and the communication block are skipped with the reason', () => {
    const plan = planRecipients([
      user('a'),
      user('b', { hasEmail: false, hasTelegram: false, hasPhone: false }),
      user('c', { whatsappOptOut: true }),
      user('d', { blocked: true }),
    ], ['app', 'email', 'telegram', 'whatsapp'], on)
    const row = (u: string, c: string) => plan.rows.find((r) => r.user_id === u && r.channel === c)
    expect(row('a', 'whatsapp')).toMatchObject({ status: 'pending', error: null })
    expect(row('b', 'email')).toMatchObject({ status: 'skipped', error: 'no_email' })
    expect(row('b', 'telegram')).toMatchObject({ status: 'skipped', error: 'telegram_not_linked' })
    expect(row('b', 'whatsapp')).toMatchObject({ status: 'skipped', error: 'no_phone' })
    expect(row('b', 'app')).toMatchObject({ status: 'pending' })
    expect(row('c', 'whatsapp')).toMatchObject({ status: 'skipped', error: 'whatsapp_opt_out' })
    expect(row('c', 'email')).toMatchObject({ status: 'pending' })
    for (const c of ['app', 'email', 'telegram', 'whatsapp']) expect(row('d', c)).toMatchObject({ status: 'skipped', error: 'blocked' })
    expect(plan.perChannel.whatsapp).toEqual({ send: 1, skipped: 3, reasons: { no_phone: 1, whatsapp_opt_out: 1, blocked: 1 } })
    expect(plan.perChannel.app).toEqual({ send: 3, skipped: 1, reasons: { blocked: 1 } })
  })

  it('a channel whose transport is off is skipped for everybody (the preview says why)', () => {
    const plan = planRecipients([user('a'), user('b')], ['telegram', 'whatsapp'], { telegramConfigured: false, whatsappConfigured: false })
    expect(plan.perChannel.telegram).toEqual({ send: 0, skipped: 2, reasons: { telegram_not_configured: 2 } })
    expect(plan.perChannel.whatsapp).toEqual({ send: 0, skipped: 2, reasons: { whatsapp_not_configured: 2 } })
  })
})
