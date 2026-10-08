/**
 * Agent notifier (lib/agents/lifecycle.ts): levels per lifecycle event,
 * idempotency keys, buttons per bot, scrubbed errors, «started» once per task,
 * burst summary instead of a message per start, the lifecycle switch (dead
 * and stuck always go), stuck detection. The database and notifyStaff are
 * fakes; the Telegram buttons are signed for real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffNotification } from '@/lib/notifications/staff'

const fake = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  burst: 0,
  stuck: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ sql: string; values: unknown[] }>,
}))

vi.mock('@/lib/settings/store', () => ({
  getSetting: async (key: string) => {
    const { SETTINGS } = await import('@/lib/settings/registry')
    return key in fake.settings ? fake.settings[key] : (SETTINGS as Record<string, { default: unknown }>)[key].default
  },
  getAllSettings: async () => { throw new Error('not used') },
  saveSettings: async () => undefined,
}))
vi.mock('@/lib/agents/registry', () => ({
  getAgent: (k: string) => ({ data_collection: { name: 'Сбор данных' }, report: { name: 'Отчёт' } } as Record<string, { name: string }>)[k] ?? null,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      fake.queries.push({ sql, values })
      if (sql.includes('FROM public.companies')) return [{ name: 'ТОО «Ромашка»' }]
      if (sql.includes('GROUP BY agent_key')) return [{ agent_key: 'data_collection', n: 4 }, { agent_key: 'report', n: 3 }]
      if (sql.includes('count(*)::int AS n FROM public.agent_tasks')) return [{ n: fake.burst }]
      if (sql.includes("t.status = 'running'")) return fake.stuck
      return []
    }),
    $executeRaw: vi.fn(async () => 1),
  },
}))

const {
  lifecycleNotification, lifecycleKeyboard, safeErrorText, notifyTaskStarted, notifyTaskFinished, alertStuckTasks,
} = await import('@/lib/agents/lifecycle')
const { verifyCallback } = await import('@/lib/telegram/bots/callback')

const TASK = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'
const task = (attempts = 1) => ({ id: TASK, agent_key: 'data_collection', company_id: 'co-1', attempts, max_attempts: 3 })
const ENV = ['TELEGRAM_ADMIN_BOT_TOKEN', 'TELEGRAM_ADMIN_WEBHOOK_SECRET', 'TELEGRAM_CALLBACK_SECRET', 'AUTH_URL']
const saved: Record<string, string | undefined> = {}

function recorder() {
  const sent: StaffNotification[] = []
  const notify = vi.fn(async (n: StaffNotification) => {
    const duplicate = sent.some((s) => s.dedupeKey === n.dedupeKey)
    sent.push(n)
    return { eventId: 'e', duplicate, deliveries: [] }
  })
  return { sent, notify }
}

describe('agent lifecycle notifications', () => {
  beforeAll(() => {
    for (const k of ENV) saved[k] = process.env[k]
    process.env.TELEGRAM_ADMIN_BOT_TOKEN = 'admin-token'
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    delete process.env.TELEGRAM_CALLBACK_SECRET
    process.env.AUTH_URL = 'https://portal.test'
  })
  afterAll(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  })
  beforeEach(() => {
    fake.settings = {}
    fake.burst = 1
    fake.stuck = []
    fake.queries = []
  })

  const base = { taskId: TASK, agentKey: 'data_collection', agentName: 'Сбор данных', companyId: 'co-1', companyName: 'Ромашка', attempt: 2, maxAttempts: 3 }

  it('maps events to levels and idempotency keys, for agents.view only', () => {
    const cases = [
      ['started', 'INFO', `agent:${TASK}:started`],
      ['succeeded', 'INFO', `agent:${TASK}:succeeded:2`],
      ['retrying', 'WARNING', `agent:${TASK}:retrying:2`],
      ['dead', 'CRITICAL', `agent:${TASK}:dead:2`],
      ['stuck', 'CRITICAL', `agent:${TASK}:stuck`],
    ] as const
    for (const [kind, level, key] of cases) {
      const n = lifecycleNotification({ ...base, kind })
      expect(n.level, kind).toBe(level)
      expect(n.dedupeKey, kind).toBe(key)
      expect(n.audiencePermission).toBe('agents.view')
      expect(n.type).toBe(`agent.${kind}`)
      expect(n.title).toContain('«Сбор данных»')
      expect(n.lines).toContain('Компания: Ромашка')
      expect(n.lines).toContain('Попытка 2/3')
      expect(n.link).toBe(`/admin-giga-panel/agents/tasks/${TASK}`)
    }
  })

  it('buttons: open everywhere; retry for dead-letter and cancel for a scheduled retry — signed for the admin bot only', () => {
    const dead = lifecycleKeyboard('dead', TASK, 'admin').flat()
    expect(dead.map((b) => b.text)).toEqual(['🔎 Открыть', '🔁 Повторить'])
    expect(dead[0].url).toBe(`https://portal.test/admin-giga-panel/agents/tasks/${TASK}`)
    expect(verifyCallback('admin', dead[1].callback_data)).toEqual({ action: 'tk.rq', args: [TASK] })

    const retrying = lifecycleKeyboard('retrying', TASK, 'admin').flat()
    expect(retrying.map((b) => b.text)).toEqual(['🔎 Открыть', '✖️ Отменить'])
    expect(verifyCallback('admin', retrying[1].callback_data)).toEqual({ action: 'tk.cn', args: [TASK] })
    expect(lifecycleKeyboard('stuck', TASK, 'admin').flat().map((b) => b.text)).toEqual(['🔎 Открыть', '✖️ Отменить'])
    expect(lifecycleKeyboard('started', TASK, 'admin').flat().map((b) => b.text)).toEqual(['🔎 Открыть'])

    // Staff traffic still on the client bot: its webhook does not route admin actions.
    expect(lifecycleKeyboard('dead', TASK, 'client').flat().map((b) => b.text)).toEqual(['🔎 Открыть'])
    // Telegram rejects a message with a non-https URL button.
    process.env.AUTH_URL = 'http://localhost:3000'
    expect(lifecycleKeyboard('dead', TASK, 'admin').flat().map((b) => b.text)).toEqual(['🔁 Повторить'])
    process.env.AUTH_URL = 'https://portal.test'
  })

  it('errors carry the code and a scrubbed, short message — no links, emails, phones or keys', () => {
    const t = safeErrorText('PROVIDER_ERROR', 'ключ sk-live_ABCDEF123456 отклонён для owner@corp.kz, см. https://api.x/y?key=1, тел +7 701 123 45 67')!
    expect(t.startsWith('PROVIDER_ERROR — ')).toBe(true)
    for (const leak of ['sk-live', 'owner@corp.kz', 'https://', '701 123']) expect(t).not.toContain(leak)
    expect(safeErrorText('X', 'a'.repeat(500))!.length).toBeLessThan(200)
    expect(safeErrorText(null, null)).toBeNull()
    expect(safeErrorText('bad code with spaces', 'текст')).toBe('текст')
    const n = lifecycleNotification({ ...base, kind: 'dead', errorCode: 'TIMEOUT', errorMessage: 'модель не ответила за 60 с' })
    expect(n.lines).toContain('Ошибка: TIMEOUT — модель не ответила за 60 с')
  })

  it('«started» goes once per task: first attempt only, with the company name', async () => {
    const r = recorder()
    expect(await notifyTaskStarted(task(1), { notify: r.notify })).toBe('sent')
    expect(r.sent[0]).toMatchObject({ level: 'INFO', type: 'agent.started', dedupeKey: `agent:${TASK}:started` })
    expect(r.sent[0].lines).toContain('Компания: ТОО «Ромашка»')
    expect(await notifyTaskStarted(task(2), { notify: r.notify })).toBe('repeat_attempt')
    expect(r.sent).toHaveLength(1)
  })

  it('more than 5 starts within 2 minutes → one summary per window instead of a message per task', async () => {
    fake.burst = 6
    const r = recorder()
    const now = new Date('2026-10-08T05:00:30Z')
    expect(await notifyTaskStarted(task(1), { notify: r.notify, now })).toBe('summary')
    expect(await notifyTaskStarted({ ...task(1), id: 'aaaaaaaa-0000-4000-8000-000000000002' }, { notify: r.notify, now })).toBe('summary')
    expect(r.sent.every((n) => n.type === 'agent.started_burst')).toBe(true)
    expect(new Set(r.sent.map((n) => n.dedupeKey)).size).toBe(1) // same window → one message
    expect(r.sent[0].lines?.[0]).toContain('запущено задач: 6')
    expect(r.sent[0].lines?.[1]).toBe('Больше всего: Сбор данных × 4, Отчёт × 3')
    expect(r.sent[0].audiencePermission).toBe('agents.view')
    const later = recorder()
    await notifyTaskStarted(task(1), { notify: later.notify, now: new Date('2026-10-08T05:02:30Z') })
    expect(later.sent[0].dedupeKey).not.toBe(r.sent[0].dedupeKey)

    fake.burst = 5 // at the threshold: still one message per task
    const r2 = recorder()
    expect(await notifyTaskStarted(task(1), { notify: r2.notify })).toBe('sent')
  })

  it('outcomes: succeeded / retry scheduled / dead-letter; awaiting approval is left to the approval card', async () => {
    const r = recorder()
    const report = (finalStatus: string | null, errorCode: string | null = null) =>
      ({ taskId: TASK, runId: 'r', finalStatus, summary: 'собрано 12 источников', errorCode, errorMessage: errorCode ? 'временный сбой' : null })
    expect(await notifyTaskFinished(task(1), report('succeeded'), { notify: r.notify })).toBe('succeeded')
    expect(await notifyTaskFinished(task(1), report('queued', 'TIMEOUT'), { notify: r.notify })).toBe('retrying')
    expect(await notifyTaskFinished(task(3), report('dead', 'TIMEOUT'), { notify: r.notify })).toBe('dead')
    expect(await notifyTaskFinished(task(1), report('awaiting_approval', 'APPROVAL_REQUIRED'), { notify: r.notify })).toBe('ignored')
    expect(await notifyTaskFinished(task(1), report('queued', 'APPROVAL_REQUIRED'), { notify: r.notify })).toBe('ignored')
    expect(await notifyTaskFinished(task(1), report('cancelled', 'AGENT_DISABLED'), { notify: r.notify })).toBe('ignored')
    expect(await notifyTaskFinished(task(1), report(null), { notify: r.notify })).toBe('ignored')
    expect(r.sent.map((n) => [n.type, n.level])).toEqual([
      ['agent.succeeded', 'INFO'], ['agent.retrying', 'WARNING'], ['agent.dead', 'CRITICAL'],
    ])
    expect(r.sent[0].lines).toContain('Итог: собрано 12 источников')
    expect(r.sent[2].lines).toContain('Попытка 3/3')
    expect(r.sent[2].lines).toContain('Ошибка: TIMEOUT — временный сбой')
  })

  it('the lifecycle switch silences INFO / WARNING, never dead-letter', async () => {
    fake.settings.agents_notify_lifecycle = false
    const r = recorder()
    expect(await notifyTaskStarted(task(1), { notify: r.notify })).toBe('disabled')
    const rep = (s: string, c: string | null) => ({ taskId: TASK, runId: 'r', finalStatus: s, summary: null, errorCode: c })
    expect(await notifyTaskFinished(task(1), rep('succeeded', null), { notify: r.notify })).toBe('disabled')
    expect(await notifyTaskFinished(task(1), rep('queued', 'TIMEOUT'), { notify: r.notify })).toBe('disabled')
    expect(await notifyTaskFinished(task(3), rep('dead', 'TIMEOUT'), { notify: r.notify })).toBe('dead')
    expect(r.sent.map((n) => n.level)).toEqual(['CRITICAL'])
  })

  it('stuck tasks: CRITICAL once per task, threshold from settings, switchable', async () => {
    fake.settings.agents_stuck_minutes = 30
    fake.stuck = [
      { id: TASK, agent_key: 'data_collection', company_id: 'co-1', company_name: 'Ромашка', attempts: 1, max_attempts: 3, lease_expired: true, last_progress_at: null },
      { id: 'bbbbbbbb-0000-4000-8000-000000000003', agent_key: 'report', company_id: null, company_name: null, attempts: 2, max_attempts: 3, lease_expired: false, last_progress_at: new Date('2026-10-08T04:00:00Z') },
    ]
    const r = recorder()
    expect(await alertStuckTasks({ notify: r.notify, now: new Date('2026-10-08T05:00:00Z') })).toBe(2)
    const stuckQuery = fake.queries.find((q) => q.sql.includes("t.status = 'running'"))!
    expect(stuckQuery.values).toContain(30)
    expect(stuckQuery.sql).toContain("':stuck'") // already reported tasks are not selected again
    expect(r.sent.map((n) => [n.level, n.dedupeKey])).toEqual([
      ['CRITICAL', `agent:${TASK}:stuck`], ['CRITICAL', 'agent:bbbbbbbb-0000-4000-8000-000000000003:stuck'],
    ])
    expect(r.sent[0].lines?.join('\n')).toContain('аренды')
    expect(r.sent[1].lines).toContain('Нет прогресса больше 60 мин.')
    expect(r.sent[1].lines).toContain('Задача платформы')
    // A repeat (another worker already told) does not count as reported.
    expect(await alertStuckTasks({ notify: r.notify })).toBe(0)

    fake.settings.agents_stuck_alerts = false
    const off = recorder()
    expect(await alertStuckTasks({ notify: off.notify })).toBe(0)
    expect(off.sent).toHaveLength(0)
  })
})
