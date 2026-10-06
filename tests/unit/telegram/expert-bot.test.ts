/**
 * Expert bot (lib/telegram/bots/expert): only linked experts (EXPERT_ROLES,
 * approved), scope like /api/expert/** (all clients, published reports only,
 * unreviewed AI hypotheses labelled), no system changes, own buttons only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { msg, press, recordingFetch, testDeps } from './_bot-harness'

const s = vi.hoisted(() => ({ expert: true }))
const CO = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'

const link = vi.hoisted(() => ({
  consumeExpertLinkCode: vi.fn(async () => ({ ok: true, userId: 'e1' })),
}))
vi.mock('@/lib/telegram/bots/expert/link', () => ({
  EXPERT_START_PREFIX: 'expert_',
  consumeExpertLinkCode: link.consumeExpertLinkCode,
  expertByTelegramUser: async () => (s.expert ? { userId: 'e0e0e0e0-0000-4000-8000-000000000001', role: 'expert', email: 'exp@aistart360.test', name: 'Эксперт' } : null),
}))
const data = vi.hoisted(() => ({
  companyCard: vi.fn(async () => ({
    id: CO, name: 'ТОО Ромашка', industry: 'retail', stage: null, owner: { id: 'o', email: 'owner@romashka.kz', name: 'Владелец', status: 'approved' },
    diagnostic: { score: 61, health: 55, stage: 'growth', calculatedAt: new Date(), dataGaps: ['выручка по месяцам'] },
    session: { id: 's', status: 'ready', stage: 'recommendation', completeness: 0.7, startedAt: new Date(), completedAt: new Date(), error: null },
    criticalCount: 1,
    findings: [
      { id: 'f1', title: 'Кассовый разрыв в 3 квартале', severity: 'critical', provenance_type: 'CALCULATED', reviewed: false, visible: true },
      { id: 'f2', title: 'Зависимость от одного поставщика', severity: 'high', provenance_type: 'AI_HYPOTHESIS', reviewed: false, visible: false },
    ],
    pendingHypotheses: 1,
    publishedReports: 1,
  })),
  searchCompanies: vi.fn(async () => ({ items: [], hasMore: false })),
  recentSessions: vi.fn(async () => ({ items: [], hasMore: false })),
}))
vi.mock('@/lib/telegram/bots/data', () => data)
const versions = vi.hoisted(() => ({
  listReportVersions: vi.fn(async () => [
    { id: '11111111-2222-4333-8444-555555555555', company_id: CO, company_name: 'ТОО Ромашка', report_type: 'point_a', version: 3, status: 'published', published_at: new Date() },
    { id: '22222222-2222-4333-8444-555555555555', company_id: CO, company_name: 'ТОО Ромашка', report_type: 'point_a', version: 4, status: 'ready', published_at: null },
  ]),
}))
vi.mock('@/lib/reports/versions', () => versions)
vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: vi.fn(async () => []), $executeRaw: vi.fn(async () => 1) } }))

const { expertRouter } = await import('@/lib/telegram/bots/expert')
const { handleUpdate } = await import('@/lib/telegram/bots/dispatcher')
const { signCallback } = await import('@/lib/telegram/bots/callback')

const ENV = ['TELEGRAM_EXPERT_BOT_TOKEN', 'TELEGRAM_EXPERT_WEBHOOK_SECRET', 'TELEGRAM_ADMIN_WEBHOOK_SECRET', 'TELEGRAM_CALLBACK_SECRET', 'NEXT_PUBLIC_APP_URL', 'AUTH_URL']
const saved: Record<string, string | undefined> = {}

describe('expert bot', () => {
  let tg = recordingFetch()
  let h = testDeps(tg.fetchImpl)
  const run = (u: Parameters<typeof handleUpdate>[1]) => handleUpdate(expertRouter(), u, h.deps)

  beforeAll(() => {
    for (const k of ENV) saved[k] = process.env[k]
    process.env.TELEGRAM_EXPERT_BOT_TOKEN = 'expert-token'
    process.env.TELEGRAM_EXPERT_WEBHOOK_SECRET = 'expert-secret'
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    delete process.env.TELEGRAM_CALLBACK_SECRET
    delete process.env.AUTH_URL
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.aistart360.test'
  })
  afterAll(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  })
  beforeEach(() => {
    s.expert = true
    tg = recordingFetch()
    h = testDeps(tg.fetchImpl)
    data.companyCard.mockClear()
    versions.listReportVersions.mockClear()
  })

  it('links through /start expert_<code> and refuses everyone not linked as an expert', async () => {
    expect(await run(msg('/start expert_AbCdEf123456'))).toBe('start')
    expect(link.consumeExpertLinkCode).toHaveBeenCalledWith(expect.objectContaining({ code: 'AbCdEf123456' }))
    expect(tg.calls[0].url).toContain('/botexpert-token/sendMessage')
    expect(tg.lastText()).toContain('Telegram привязан')

    s.expert = false
    expect(await run(msg('👥 Клиенты'))).toBe('not_linked')
    expect(await run(press(signCallback('expert', 'cl.c', CO)))).toBe('not_linked')
    expect(data.companyCard).not.toHaveBeenCalled()
  })

  it('client card: score, completeness, gaps, findings; AI hypotheses labelled as unreviewed', async () => {
    expect(await run(press(signCallback('expert', 'cl.c', CO)))).toBe('callback')
    expect(data.companyCard).toHaveBeenCalledWith(CO, { includeUnreviewedHypotheses: true })
    const text = tg.lastText()
    expect(text).toContain('Точка А: <b>61</b>/100')
    expect(text).toContain('полнота 70%')
    expect(text).toContain('выручка по месяцам')
    expect(text).toContain('Кассовый разрыв')
    expect(text).toContain('гипотеза ИИ, не проверена')
  })

  it('reports: published versions only, PDF through the access-checked route', async () => {
    await run(msg('📄 Отчёты'))
    expect(versions.listReportVersions).toHaveBeenCalledWith(expect.objectContaining({ status: 'published' }))
    const text = tg.lastText()
    expect(text).toContain('v3')
    expect(text).not.toContain('v4') // a 'ready' row never reaches an expert even if returned
    const urls = tg.lastButtons().map((b) => b.url).filter(Boolean)
    expect(urls).toEqual(['https://app.aistart360.test/api/v1/reports/11111111-2222-4333-8444-555555555555/pdf'])
  })

  it('does not accept admin-bot buttons and has no system actions', async () => {
    const adminButton = signCallback('admin', 'cl.c', CO)
    expect(await run(press(adminButton))).toBe('bad_signature')
    const r = expertRouter()
    expect(Object.keys(r.confirmed)).toEqual([])
    expect(Object.keys(r.callbacks).sort()).toEqual(['cl.c', 'cl.l', 'cl.s', 'ds.l', 'en.lv', 'en.mu', 'en.v', 'rp.l'])
  })

  it('notification level change is audited as the expert', async () => {
    expect(await run(press(signCallback('expert', 'en.lv', 'w')))).toBe('callback')
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e0e0e0e0-0000-4000-8000-000000000001', kind: 'telegram' }),
      expect.objectContaining({ action: 'expert.telegram.level', newValue: { minLevel: 'WARNING' } }),
    )
  })
})
