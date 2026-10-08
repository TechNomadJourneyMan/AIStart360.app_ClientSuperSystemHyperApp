/**
 * Agent automation (lib/agents/automation.ts, digest.ts): the company
 * diagnostic starts at most once per company per local day (a second event
 * books the next day), a re-dispatched event books nothing, empty documents
 * and the switch; settings changed from the bot are validated and audited
 * before the write; the daily digest content, switch, recipients and dedupe.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffNotification } from '@/lib/notifications/staff'

const fake = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  seenEvent: false,
  order: [] as string[],
  digest: {
    runs: { runs: 12, ok: 9, failed: 3 },
    tasks: { dead: 1, queued: 2, running: 1 },
    approvals: { pending: 2 },
    agentSpend: { today: 0.5, yesterday: 1.25 },
    ledger: { today: 0.25, yesterday: 0.75 } as { today: number; yesterday: number } | Error,
    errors: [{ code: 'TIMEOUT', agent_key: 'diagnostic', count: 2 }, { code: 'PARSE_FAILED', agent_key: 'document_intelligence', count: 1 }],
  },
}))

vi.mock('@/lib/settings/store', () => ({
  getSetting: async (key: string) => {
    const { SETTINGS } = await import('@/lib/settings/registry')
    return key in fake.settings ? fake.settings[key] : (SETTINGS as Record<string, { default: unknown }>)[key].default
  },
  getAllSettings: async () => {
    const { SETTINGS, SETTING_KEYS } = await import('@/lib/settings/registry')
    return { values: Object.fromEntries(SETTING_KEYS.map((k) => [k, k in fake.settings ? fake.settings[k] : SETTINGS[k].default])), meta: {} }
  },
  saveSettings: vi.fn(async (values: Record<string, unknown>) => {
    fake.order.push('save')
    Object.assign(fake.settings, values)
  }),
}))
vi.mock('@/lib/agents/registry', () => ({
  getAgent: (k: string) => ({ diagnostic: { name: 'Диагностика' }, document_intelligence: { name: 'Разбор документов' } } as Record<string, { name: string }>)[k] ?? null,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      if (sql.includes("input -> 'event' ->> 'id'")) return fake.seenEvent ? [{ id: 't' }] : []
      if (sql.includes("count(*) FILTER (WHERE status = 'succeeded')")) return [fake.digest.runs]
      if (sql.includes("count(*) FILTER (WHERE status = 'dead'")) return [fake.digest.tasks]
      if (sql.includes('FROM public.agent_approvals')) return [fake.digest.approvals]
      if (sql.includes('FROM public.agent_runs WHERE started_at >=') && sql.includes('AS today')) return [fake.digest.agentSpend]
      if (sql.includes('FROM public.ai_usage_ledger')) {
        if (fake.digest.ledger instanceof Error) throw fake.digest.ledger
        return [fake.digest.ledger]
      }
      if (sql.includes("coalesce(error_code, 'UNKNOWN')")) return fake.digest.errors
      return []
    }),
    $executeRaw: vi.fn(async () => 1),
  },
}))

const { autoDiagnosticSlots, enqueueAutoDiagnostic, setAutomationSetting, documentHasData } = await import('@/lib/agents/automation')
const { formatAgentsDigest, runAgentsDigest, collectAgentsDigest, digestIsEmpty } = await import('@/lib/agents/digest')

describe('auto-start of the company diagnostic', () => {
  const tasks = new Map<string, Date | null>()
  const enqueue = vi.fn(async (slot: { idempotencyKey: string; runAfter: Date | null }) => {
    if (tasks.has(slot.idempotencyKey)) return { id: slot.idempotencyKey, created: false }
    tasks.set(slot.idempotencyKey, slot.runAfter)
    return { id: slot.idempotencyKey, created: true }
  })
  const ev = (id: number, name = 'QUESTIONNAIRE_COMPLETED', payload: Record<string, unknown> = {}) => ({ id, name: name as never, company_id: 'co-1', payload })
  // 20:30 in Almaty (UTC+5) on 8 October.
  const now = new Date('2026-10-08T15:30:00Z')

  beforeEach(() => {
    tasks.clear()
    enqueue.mockClear()
    fake.settings = {}
    fake.seenEvent = false
  })

  it('one slot per local (Almaty) day; the next slot starts at local midnight', () => {
    const s = autoDiagnosticSlots('co-1', now, 'Asia/Almaty')
    expect(s.today).toEqual({ key: 'auto-diagnostic:co-1:2026-10-08', runAfter: null })
    expect(s.next.key).toBe('auto-diagnostic:co-1:2026-10-09')
    expect(s.next.runAfter?.toISOString()).toBe('2026-10-08T19:00:00.000Z')
    // 01:00 Almaty on the 9th is already the 9th.
    expect(autoDiagnosticSlots('co-1', new Date('2026-10-08T20:00:00Z'), 'Asia/Almaty').today.key).toBe('auto-diagnostic:co-1:2026-10-09')
  })

  it('first event today starts it; a second one books tomorrow; a third changes nothing', async () => {
    expect(await enqueueAutoDiagnostic(ev(1), enqueue, now)).toBe('started')
    expect(await enqueueAutoDiagnostic(ev(2, 'FILE_PROCESSED', { field_count: 4 }), enqueue, now)).toBe('deferred')
    expect(await enqueueAutoDiagnostic(ev(3), enqueue, now)).toBe('already_deferred')
    expect([...tasks.keys()]).toEqual(['auto-diagnostic:co-1:2026-10-08', 'auto-diagnostic:co-1:2026-10-09'])
    expect(tasks.get('auto-diagnostic:co-1:2026-10-08')).toBeNull()
    expect(tasks.get('auto-diagnostic:co-1:2026-10-09')?.toISOString()).toBe('2026-10-08T19:00:00.000Z')
  })

  it('books nothing for a re-dispatched event, an empty document, a missing company or when switched off', async () => {
    fake.seenEvent = true
    expect(await enqueueAutoDiagnostic(ev(1), enqueue, now)).toBe('duplicate_event')
    fake.seenEvent = false
    expect(await enqueueAutoDiagnostic(ev(2, 'FILE_PROCESSED', { field_count: 0, row_count: 0 }), enqueue, now)).toBe('empty_document')
    expect(await enqueueAutoDiagnostic({ ...ev(3), company_id: null }, enqueue, now)).toBe('no_company')
    fake.settings.agents_auto_diagnostic = false
    expect(await enqueueAutoDiagnostic(ev(4), enqueue, now)).toBe('disabled')
    expect(enqueue).not.toHaveBeenCalled()
    expect(documentHasData({ bound_count: 1 })).toBe(true)
    expect(documentHasData(null)).toBe(false)
  })
})

describe('automation settings from the bot', () => {
  beforeEach(() => {
    fake.settings = {}
    fake.order = []
  })

  it('validates, audits BEFORE the write, and skips a no-op', async () => {
    const audit = vi.fn(async () => { fake.order.push('audit'); return true })
    expect(await setAutomationSetting({ key: 'agents_stuck_minutes', value: 2, actorId: 'u', audit })).toMatchObject({ ok: false })
    expect(audit).not.toHaveBeenCalled()

    expect(await setAutomationSetting({ key: 'agents_auto_retry', value: true, actorId: 'u', audit })).toEqual({ ok: true, changed: false })
    expect(audit).not.toHaveBeenCalled()

    expect(await setAutomationSetting({ key: 'agents_auto_retry', value: false, actorId: 'u', audit })).toEqual({ ok: true, changed: true })
    expect(fake.order).toEqual(['audit', 'save'])
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'settings.changed', entityId: 'agents_auto_retry', oldValue: { agents_auto_retry: true }, newValue: { agents_auto_retry: false },
    }), { required: true })
    expect(fake.settings.agents_auto_retry).toBe(false)
  })

  it('no journal entry → no change', async () => {
    const audit = vi.fn(async () => { throw new Error('audit down') })
    await expect(setAutomationSetting({ key: 'agents_daily_digest', value: false, actorId: 'u', audit })).rejects.toThrow('audit down')
    expect(fake.settings.agents_daily_digest).toBeUndefined()
  })
})

describe('daily agents digest', () => {
  const now = new Date('2026-10-08T04:00:00Z') // 09:00 Almaty

  beforeEach(() => {
    fake.settings = {}
    fake.digest.ledger = { today: 0.25, yesterday: 0.75 }
  })

  it('collects the last 24 h, the queue, approvals and today / yesterday spend (agents + other features)', async () => {
    const d = await collectAgentsDigest(now, 'Asia/Almaty')
    expect(d).toMatchObject({
      date: '2026-10-08', runs: 12, succeeded: 9, failed: 3, dead: 1, queued: 2, running: 1, pendingApprovals: 2,
      spend: { today: { total: 0.75, agents: 0.5 }, yesterday: { total: 2, agents: 1.25 } },
    })
    expect(d.topErrors[0]).toEqual({ code: 'TIMEOUT', agentKey: 'diagnostic', count: 2 })
    // Before migration 093: agents only.
    fake.digest.ledger = new Error('relation "public.ai_usage_ledger" does not exist')
    expect((await collectAgentsDigest(now, 'Asia/Almaty')).spend.today.total).toBe(0.5)
  })

  it('formats a readable Russian summary', async () => {
    const { title, lines } = formatAgentsDigest(await collectAgentsDigest(now, 'Asia/Almaty'))
    expect(title).toBe('Сводка ИИ-агентов на 08.10')
    expect(lines).toEqual([
      'За сутки запусков: 12 · успешно 9 (75%) · с ошибкой 3',
      'В dead-letter за сутки: 1',
      'Сейчас: в очереди 2 · выполняются 1',
      'Ждут одобрения: 2',
      'Расход ИИ: сегодня $0.7500 (агенты $0.5000) · вчера $2.00 (агенты $1.25)',
      '',
      'Частые ошибки:',
      '• TIMEOUT × 2 — Диагностика',
      '• PARSE_FAILED × 1 — Разбор документов',
    ])
  })

  it('goes to agents.view staff as a scheduled digest, once per day; switch and empty days', async () => {
    const sent: StaffNotification[] = []
    const notify = vi.fn(async (n: StaffNotification) => { sent.push(n); return { eventId: 'e', duplicate: false, deliveries: [] } })
    const out = await runAgentsDigest(now, { notify })
    expect(out.status).toBe('sent')
    expect(sent[0]).toMatchObject({
      level: 'INFO', type: 'agent.digest', scheduled: true, audiencePermission: 'agents.view',
      dedupeKey: 'agent:digest:2026-10-08', link: '/admin-giga-panel/agents',
    })

    fake.settings.agents_daily_digest = false
    expect(await runAgentsDigest(now, { notify })).toEqual({ status: 'disabled' })
    expect(sent).toHaveLength(1)

    expect(digestIsEmpty({
      date: 'x', runs: 0, succeeded: 0, failed: 0, dead: 0, queued: 0, running: 0, pendingApprovals: 0,
      spend: { today: { total: 0, agents: 0 }, yesterday: { total: 0, agents: 0 } }, topErrors: [],
    })).toBe(true)
  })
})
