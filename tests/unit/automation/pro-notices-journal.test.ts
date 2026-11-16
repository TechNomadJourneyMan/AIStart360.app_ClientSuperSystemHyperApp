/**
 * R4 ревью WB-3: сводка персоналу узнаёт об окончании платного доступа из журнала
 * отправок клиенту (automation_sends: event paid_access_expiring / paid_access_ended,
 * metadata.stage / endsAt). Клиенту каждое предупреждение уходит один раз — значит,
 * и в сводку оно попадает один раз. Здесь — чтение журнала (fetchProNoticesSince).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  broken: false,
  calls: [] as Array<{ table: string; filters: string[] }>,
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from(table: string) {
      const filters: Array<(r: Record<string, unknown>) => boolean> = []
      const log: string[] = []
      s.calls.push({ table, filters: log })
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q,
        order: () => q,
        limit: () => q,
        in: (c: string, vs: unknown[]) => { log.push(`${c} in ${vs.join(',')}`); filters.push((r) => vs.includes(r[c])); return q },
        gte: (c: string, v: string) => { log.push(`${c} >= ${v}`); filters.push((r) => String(r[c]) >= v); return q },
        then: (ok: (v: unknown) => unknown) => Promise.resolve(
          s.broken ? { data: null, error: { message: 'down' } } : { data: s.rows.filter((r) => filters.every((f) => f(r))), error: null },
        ).then(ok),
      })
      return q
    },
  }),
}))

const { fetchProNoticesSince } = await import('@/lib/automation/data')

beforeEach(() => {
  s.broken = false
  s.calls = []
  s.rows = [
    { user_id: 'c1', kind: 'paid_access_expiring', metadata: { stage: 'd7', endsAt: '2026-12-10T23:59:59.000Z' }, sent_at: '2026-12-04T00:15:00+00:00' },
    { user_id: 'c2', kind: 'paid_access_expiring', metadata: { stage: 'd1', endsAt: '2026-12-04T23:59:59.000Z' }, sent_at: '2026-12-04T00:15:00+00:00' },
    { user_id: 'c3', kind: 'paid_access_ended', metadata: { stage: 'ended', endsAt: '2026-12-03T23:59:59.000Z' }, sent_at: '2026-12-04T00:15:00+00:00' },
    // older than the window — was in yesterday's summary
    { user_id: 'c4', kind: 'paid_access_expiring', metadata: { stage: 'd7', endsAt: '2026-12-09T23:59:59.000Z' }, sent_at: '2026-12-03T00:15:00+00:00' },
    // other touches of the journal are not about the end of Pro
    { user_id: 'c5', kind: 'gri_completed', metadata: {}, sent_at: '2026-12-04T00:15:00+00:00' },
  ]
})

describe('fetchProNoticesSince', () => {
  it('reads the client notices of the last day from automation_sends: stage and end date', async () => {
    const rows = await fetchProNoticesSince('2026-12-03T03:00:00.000Z')
    expect(rows).toEqual([
      { userId: 'c1', stage: 'd7', endsAt: '2026-12-10T23:59:59.000Z' },
      { userId: 'c2', stage: 'd1', endsAt: '2026-12-04T23:59:59.000Z' },
      { userId: 'c3', stage: 'ended', endsAt: '2026-12-03T23:59:59.000Z' },
    ])
    expect(s.calls[0].table).toBe('automation_sends')
    expect(s.calls[0].filters).toContain('kind in paid_access_expiring,paid_access_ended')
  })

  it('a journal that cannot be read → an empty list (the summary still goes out)', async () => {
    s.broken = true
    expect(await fetchProNoticesSince('2026-12-03T03:00:00.000Z')).toEqual([])
  })
})
