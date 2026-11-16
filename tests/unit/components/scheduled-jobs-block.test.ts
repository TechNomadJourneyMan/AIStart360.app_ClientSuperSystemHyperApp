/**
 * GIGA → «Состояние системы»: the block of scheduled jobs and alarm routes (R4-A1). It shows what
 * the journal says — the last run of every job and its health by the watchdog's rules — and says
 * loudly when alarms have nowhere to go. A failed read is never an empty «all fine».
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ScheduledJobsBlock, opsCounts, type OpsData } from '@/components/giga-panel/settings/ScheduledJobsBlock'

const job = (over: Partial<OpsData['jobs'][number]>): OpsData['jobs'][number] => ({
  job: '/api/cron/expert-sla', label: 'SLA экспертов', kind: 'cron', schedule: '*/5 * * * *',
  lastAt: new Date(Date.now() - 3 * 60_000).toISOString(), lastStatus: 'ok', health: 'ok', allowedMinutes: 20, ...over,
})
const data = (over: Partial<OpsData> = {}): OpsData => ({
  journal: 'ok',
  jobs: [job({}), job({ job: 'inngest:ops-ping', label: 'пинг Inngest', health: 'stale', lastAt: new Date(Date.now() - 3 * 3600_000).toISOString() }), job({ job: '/api/cron/reminders', label: 'напоминания', health: 'failing' })],
  alertRoutes: { linkedStaff: 2, envChats: 0, direct: false, nowhere: false },
  ...over,
})
const html = (ops: OpsData | null, error: { kind: 'not_migrated' | 'failed'; message: string } | null = null) =>
  renderToStaticMarkup(createElement(ScheduledJobsBlock, { ops, error }))

describe('ScheduledJobsBlock', () => {
  it('lists every job with its last run and health', () => {
    const out = html(data())
    expect(out).toContain('SLA экспертов')
    expect(out).toContain('3 мин назад')
    expect(out).toContain('пинг Inngest')
    expect(out).toContain('не запускалась')
    expect(out).toContain('ошибки')
    expect(out).toContain('привязано сотрудников — 2')
    expect(out).not.toContain('Тревогам некуда приходить')
  })

  it('says loudly when alarms have nowhere to go', () => {
    const out = html(data({ alertRoutes: { linkedStaff: 0, envChats: 0, direct: false, nowhere: true } }))
    expect(out).toContain('role="alert"')
    expect(out).toContain('Тревогам некуда приходить')
  })

  it('without migration 154 it says so; a failed read is an alert with the message', () => {
    expect(html(data({ journal: 'not_migrated', jobs: [] }))).toContain('миграция 154')
    const failed = html(null, { kind: 'failed', message: "Can't reach database server" })
    expect(failed).toContain('Журнал задач не прочитан')
    expect(failed).toContain('role="alert"')
  })

  it('counts for the card: stale / never / nowhere / a failed read are problems, failing jobs warnings', () => {
    expect(opsCounts(data(), null)).toEqual({ problems: 1, warnings: 1 })
    expect(opsCounts(data({ alertRoutes: { linkedStaff: 0, envChats: 0, direct: false, nowhere: true } }), null)).toEqual({ problems: 2, warnings: 1 })
    expect(opsCounts(null, { kind: 'failed', message: 'x' })).toEqual({ problems: 1, warnings: 0 })
    expect(opsCounts(undefined, undefined)).toEqual({ problems: 0, warnings: 0 })
  })
})
