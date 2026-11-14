/**
 * Крон свежести бэкапов (lib/ops/backup-freshness.ts, /api/cron/backup-freshness):
 * свежий успешный бэкап — тишина; нет успешного бэкапа дольше 10 ч или последний
 * запуск упал — одно уведомление супер-админам; повтор в течение 6 ч — без дубля.
 * База и рассылка подменены; на реальной базе — tests/integration/db/backup-freshness.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const deps = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: {} }))

import {
  assessBackups,
  runBackupFreshness,
  BACKUP_MAX_AGE_HOURS,
  BACKUP_REMIND_HOURS,
  type BackupProblem,
  type BackupRunRow,
  type BackupState,
  type FreshnessDeps,
} from '@/lib/ops/backup-freshness'

const H = 3600_000
const NOW = new Date('2026-11-14T10:07:00Z')

function run(over: Partial<BackupRunRow> & { hoursAgo: number }): BackupRunRow {
  const finished = new Date(NOW.getTime() - over.hoursAgo * H)
  return {
    id: over.id ?? `run-${over.hoursAgo}`,
    kind: over.kind ?? 'db',
    ok: over.ok ?? true,
    startedAt: over.startedAt ?? new Date(finished.getTime() - 5 * 60_000),
    finishedAt: over.finishedAt === undefined ? finished : over.finishedAt,
    error: over.error ?? null,
    objectKey: over.objectKey ?? 'runs/2026-11-14T00Z.dump',
    bytes: over.bytes ?? 50_000_000,
  }
}

function state(over: Partial<BackupState> = {}): BackupState {
  return { lastDb: null, lastOkDb: null, lastStorage: null, ...over }
}

/** Память вместо notification_events: когда о какой проблеме уже говорили. */
function fakeDeps(s: BackupState) {
  const alerts = new Map<string, Date>()
  const sent: Array<{ problem: BackupProblem; now: Date }> = []
  const d: FreshnessDeps = {
    loadState: async () => s,
    lastAlertAt: async (key) => alerts.get(key) ?? null,
    notify: async (problem, now) => {
      sent.push({ problem, now })
      alerts.set(problem.key, now)
      return { sent: true }
    },
  }
  return { d, sent, alerts }
}

describe('assessBackups', () => {
  it('a successful db backup younger than 10 h: nothing to say', () => {
    const last = run({ hoursAgo: 2 })
    expect(assessBackups(state({ lastDb: last, lastOkDb: last }), NOW)).toEqual([])
    expect(BACKUP_MAX_AGE_HOURS).toBe(10)
    expect(BACKUP_REMIND_HOURS).toBe(6)
  })

  it('the last successful db backup is older than 10 h: CRITICAL, keyed by that run', () => {
    const last = run({ id: 'old-ok', hoursAgo: 11 })
    const problems = assessBackups(state({ lastDb: last, lastOkDb: last }), NOW)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ key: 'db:stale:old-ok', level: 'CRITICAL' })
    expect(problems[0].title).toMatch(/бэкап/i)
    expect(problems[0].lines.join('\n')).toMatch(/11 ч/)
  })

  it('exactly 10 h is still fresh; the age counts from finished_at (started_at when it is missing)', () => {
    const edge = run({ hoursAgo: 10 })
    expect(assessBackups(state({ lastDb: edge, lastOkDb: edge }), NOW)).toEqual([])
    const noFinish = run({ hoursAgo: 0, finishedAt: null, startedAt: new Date(NOW.getTime() - 12 * H) })
    expect(assessBackups(state({ lastDb: noFinish, lastOkDb: noFinish }), NOW)[0]?.key).toBe(`db:stale:${noFinish.id}`)
  })

  it('the last db run failed: CRITICAL, keyed by the failed run, carries the error', () => {
    const ok = run({ id: 'ok-1', hoursAgo: 9 })
    const failed = run({ id: 'bad-1', hoursAgo: 1, ok: false, error: 'pg_dump: connection refused' })
    const problems = assessBackups(state({ lastDb: failed, lastOkDb: ok }), NOW)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ key: 'db:failed:bad-1', level: 'CRITICAL' })
    expect(problems[0].lines.join('\n')).toContain('pg_dump: connection refused')
  })

  it('no successful db backup at all: CRITICAL «missing»', () => {
    expect(assessBackups(state(), NOW)).toEqual([expect.objectContaining({ key: 'db:missing', level: 'CRITICAL' })])
  })

  it('a failed Storage copy is a WARNING of its own; a successful one is silent', () => {
    const db = run({ hoursAgo: 1 })
    const badStorage = run({ id: 'st-1', kind: 'storage', hoursAgo: 1, ok: false, error: 'rclone: 403' })
    expect(assessBackups(state({ lastDb: db, lastOkDb: db, lastStorage: badStorage }), NOW)).toEqual([
      expect.objectContaining({ key: 'storage:failed:st-1', level: 'WARNING' }),
    ])
    const okStorage = run({ kind: 'storage', hoursAgo: 1 })
    expect(assessBackups(state({ lastDb: db, lastOkDb: db, lastStorage: okStorage }), NOW)).toEqual([])
  })

  it('keeps the error text short (one line, at most 300 characters)', () => {
    const failed = run({ id: 'bad-2', hoursAgo: 1, ok: false, error: `x${'y'.repeat(1000)}\nsecond line` })
    const text = assessBackups(state({ lastDb: failed }), NOW).flatMap((p) => p.lines).join('\n')
    expect(text).not.toContain('second line')
    expect(text.length).toBeLessThan(800)
  })
})

describe('runBackupFreshness', () => {
  it('fresh backup: silence', async () => {
    const last = run({ hoursAgo: 3 })
    const { d, sent } = fakeDeps(state({ lastDb: last, lastOkDb: last }))
    const res = await runBackupFreshness(NOW, d)
    expect(res).toMatchObject({ status: 'ok', problems: [], notified: [] })
    expect(sent).toHaveLength(0)
  })

  it('old backup: one notification; the next hourly run within 6 h does not repeat it', async () => {
    const last = run({ id: 'old', hoursAgo: 12 })
    const { d, sent } = fakeDeps(state({ lastDb: last, lastOkDb: last }))
    const first = await runBackupFreshness(NOW, d)
    expect(first).toMatchObject({ status: 'alerted', problems: ['db:stale:old'], notified: ['db:stale:old'] })
    expect(sent).toHaveLength(1)

    for (const h of [1, 2, 5]) {
      const again = await runBackupFreshness(new Date(NOW.getTime() + h * H), d)
      expect(again).toMatchObject({ status: 'quiet', problems: ['db:stale:old'], notified: [] })
    }
    expect(sent).toHaveLength(1)

    // Прошло 6 ч, проблема та же — напоминание.
    const later = await runBackupFreshness(new Date(NOW.getTime() + 6 * H), d)
    expect(later.notified).toEqual(['db:stale:old'])
    expect(sent).toHaveLength(2)
  })

  it('a new problem (another failed run) is announced at once, even right after the previous one', async () => {
    const failedA = run({ id: 'a', hoursAgo: 1, ok: false, error: 'boom' })
    const s = state({ lastDb: failedA })
    const { d, sent } = fakeDeps(s)
    await runBackupFreshness(NOW, d)
    s.lastDb = run({ id: 'b', hoursAgo: 0, ok: false, error: 'boom again' })
    const res = await runBackupFreshness(new Date(NOW.getTime() + H), d)
    expect(res.notified).toEqual(['db:failed:b'])
    // Упавший запуск важнее «нет успешных»: одно сообщение на ситуацию, без второго «missing».
    expect(sent.map((x) => x.problem.key)).toEqual(['db:failed:a', 'db:failed:b'])
  })

  it('a notification that reached nobody is not remembered: the next run tries again', async () => {
    const last = run({ id: 'old', hoursAgo: 12 })
    const { d, sent } = fakeDeps(state({ lastDb: last, lastOkDb: last }))
    let deliver = false
    const notify = d.notify
    d.notify = async (p, now) => (deliver ? notify(p, now) : { sent: false })
    expect((await runBackupFreshness(NOW, d)).notified).toEqual([])
    deliver = true
    expect((await runBackupFreshness(new Date(NOW.getTime() + H), d)).notified).toEqual(['db:stale:old'])
    expect(sent).toHaveLength(1)
  })

  it('the journal table is missing (migration 142 not applied): unavailable, nobody is woken up', async () => {
    const notify = vi.fn()
    const res = await runBackupFreshness(NOW, {
      loadState: async () => { throw Object.assign(new Error('relation "public.ops_backup_runs" does not exist'), { code: '42P01' }) },
      lastAlertAt: async () => null,
      notify,
    })
    expect(res).toMatchObject({ status: 'unavailable' })
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('GET /api/cron/backup-freshness', () => {
  const SECRET = 'cron-secret-for-tests'
  const saved = process.env.CRON_SECRET
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET
    deps.run.mockReset()
    vi.resetModules()
    vi.doMock('@/lib/ops/backup-freshness', () => ({ runBackupFreshness: deps.run }))
  })
  afterEach(() => {
    vi.doUnmock('@/lib/ops/backup-freshness')
    if (saved === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = saved
  })
  const call = async (auth?: string) => {
    const { GET } = await import('@/app/api/cron/backup-freshness/route')
    return GET(new NextRequest('http://localhost/api/cron/backup-freshness', { headers: auth ? { authorization: auth } : {} }))
  }

  it('refuses calls without the secret and fails closed when it is not configured', async () => {
    expect((await call()).status).toBe(401)
    expect((await call('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503)
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('runs the check and returns its report', async () => {
    deps.run.mockResolvedValue({ status: 'alerted', problems: ['db:missing'], notified: ['db:missing'] })
    const res = await call(`Bearer ${SECRET}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'alerted', problems: ['db:missing'], notified: ['db:missing'] })
  })

  it('a missing journal table is 503 migration_142_required; any other failure is a plain 500', async () => {
    deps.run.mockResolvedValue({ status: 'unavailable', problems: [], notified: [] })
    const a = await call(`Bearer ${SECRET}`)
    expect(a.status).toBe(503)
    expect(await a.json()).toEqual({ ok: false, error: 'migration_142_required' })
    deps.run.mockRejectedValue(new Error('db down: postgres://user:secret@host'))
    const b = await call(`Bearer ${SECRET}`)
    expect(b.status).toBe(500)
    expect(JSON.stringify(await b.json())).not.toContain('secret')
  })
})
