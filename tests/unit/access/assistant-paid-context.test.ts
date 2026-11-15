/**
 * R2-A (ревью H-2, L-3): the assistant, the chats and the bots do not hand a
 * Free account the data of the paid sections (Point A scores and blocks, the
 * gap / realism of Point B, the full GRI). One filter inside
 * buildAssistantContext; the mascot answers about a closed section with the
 * paywall; the LLM prompt says the section is in paid access.
 * The fixture is the reviewer's (paid markers in every paid field).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { AssistantContext } from '@/lib/assistant/types'

const CTX: AssistantContext = {
  userId: 'u-1',
  diagnosticId: 'd-1',
  generatedAt: '2026-11-14T00:00:00.000Z',
  company: { id: 'c-1', name: 'ООО Тест', stage: 'growth', industry: 'retail', employee_count: 20, target_revenue_12m_kzt: 300_000_000, target_revenue_3y_kzt: 900_000_000 },
  answers: { s1_company_name: 'ООО Тест' },
  pointA: {
    has_diagnostic: true, overall_score: 73, health_index: 68, stage: 'growth',
    blocks: [{ key: 'finance', label: 'Финансы', score: 81, status: 'good' }, { key: 'sales', label: 'Продажи', score: 44, status: 'critical' }],
    weakest_blocks: [{ key: 'sales', label: 'Продажи', score: 44, status: 'critical' }],
    blocks_without_data: [], assessment: 'scored',
    risks: [{ level: 'high', area: 'sales', text: 'ПЛАТНЫЙ_РИСК' }],
    data_gaps: [{ field: 's2_margin', step: 2, impact: 'high' }],
    quick_wins: [{ action: 'ПЛАТНЫЙ_QUICKWIN', timeline: '30d', area: 'sales' }],
  },
  pointB: {
    has_goal: true, current_revenue_year: 100_000_000, goal_12m_revenue_year: 300_000_000, goal_3y_revenue_year: 900_000_000,
    gap: { multiplier: 3, required_cagr: 2, required_mom_growth: 0.096, data_complete: true },
    realism: { level: 'unrealistic', score: 21, rationale: ['ПЛАТНАЯ_ТОЧКА_Б'], weak_blocks: ['sales'] },
    data_sufficiency: { sufficient: true, confidence: 0.8, missing: [], have: [] },
    levers: [{ key: 'conv', label: 'ПЛАТНЫЙ_РЫЧАГ', expected_effect: '+20%', data_available: true }],
    top5_limits: [{ rank: 1, title: 'ПЛАТНОЕ_ОГРАНИЧЕНИЕ_Б', block: 'sales', severity: 'high' }],
  },
  gri: { has_assessment: true, gri_index: 4.2, top_5_limits: [{ rank: 1, title: 'ПЛАТНОЕ_ОГРАНИЧЕНИЕ_GRI_1', block: 'sales', score: 2 }] },
  metrics: { revenue: 100_000_000, revenue_year: 2025 },
  llm_analysis: null,
}
const PAID_MARKERS = ['73/100', '81', 'ПЛАТНЫЙ_РИСК', 'ПЛАТНЫЙ_QUICKWIN', 'ПЛАТНАЯ_ТОЧКА_Б', 'ПЛАТНЫЙ_РЫЧАГ', 'ПЛАТНОЕ_ОГРАНИЧЕНИЕ_Б', 'ПЛАТНОЕ_ОГРАНИЧЕНИЕ_GRI_1', '4.2']

const s = vi.hoisted(() => ({
  sections: { point_a: false, point_b: false, market: false, gri_full: false } as Record<string, boolean>,
  ctx: null as unknown,
  llm: [] as Array<{ system: string; user: string }>,
  snapshotRow: { id: 'snap' } as unknown,
}))

const { scrubAssistantContext, ALL_SECTIONS_OPEN, ALL_SECTIONS_CLOSED, paidScriptOutcome } = await import('@/lib/assistant/paid-context')

describe('scrubAssistantContext (the one filter)', () => {
  it('closed sections: no Point A scores / blocks / risks / quick wins, no Point B gap / realism / levers, no full GRI', () => {
    const out = scrubAssistantContext(CTX, ALL_SECTIONS_CLOSED)
    const text = JSON.stringify({ a: out.pointA, b: out.pointB, g: out.gri })
    for (const m of ['ПЛАТНЫЙ_РИСК', 'ПЛАТНЫЙ_QUICKWIN', 'ПЛАТНАЯ_ТОЧКА_Б', 'ПЛАТНЫЙ_РЫЧАГ', 'ПЛАТНОЕ_ОГРАНИЧЕНИЕ_Б', 'ПЛАТНОЕ_ОГРАНИЧЕНИЕ_GRI_1']) expect(text).not.toContain(m)
    expect(out.pointA).toMatchObject({ has_diagnostic: true, overall_score: null, health_index: null, stage: null, blocks: [], weakest_blocks: [] })
    expect(out.pointB.gap.multiplier).toBeNull()
    expect(out.gri).toEqual({ has_assessment: true, gri_index: null, top_5_limits: [] })
    expect(out.paidLocked).toEqual(['point_a', 'point_b', 'market', 'gri_full'])
  })

  it('the free parts stay: survey answers, the goals the client typed, data gaps of the questionnaire, the company', () => {
    const out = scrubAssistantContext(CTX, ALL_SECTIONS_CLOSED)
    expect(out.answers).toEqual(CTX.answers)
    expect(out.pointB).toMatchObject({ has_goal: true, goal_12m_revenue_year: 300_000_000, current_revenue_year: 100_000_000 })
    expect(out.pointA.data_gaps).toEqual(CTX.pointA.data_gaps)
    expect(out.company).toEqual(CTX.company)
  })

  it('open sections → the snapshot unchanged; one closed → only its data goes', () => {
    expect(scrubAssistantContext(CTX, ALL_SECTIONS_OPEN)).toBe(CTX)
    const onlyGriClosed = scrubAssistantContext(CTX, { ...ALL_SECTIONS_OPEN, gri_full: false })
    expect(onlyGriClosed.pointA.overall_score).toBe(73)
    expect(onlyGriClosed.gri.top_5_limits).toEqual([])
  })
})

describe('mascot ready-made answers about a closed section → the paywall', () => {
  it('7.5 / 7.6 / 7.7 / 7.9: the whole answer is the section → paywall text with the way to the request', () => {
    for (const [id, feature] of [['7.5', 'point_a'], ['7.6', 'point_b'], ['7.7', 'gri_full'], ['7.9', 'gri_full']] as const) {
      const o = paidScriptOutcome(id, ALL_SECTIONS_CLOSED, 'ru')
      expect(o.replace, id).toContain('в платном доступе')
      expect(o.replace, id).toContain('заявку на доступ')
      expect(o.paywall?.feature, id).toBe(feature)
    }
  })

  it('a mixed answer keeps the free part and adds a note; open sections → nothing changes', () => {
    expect(paidScriptOutcome('7.1', ALL_SECTIONS_CLOSED, 'ru')).toMatchObject({ replace: null, note: expect.stringContaining('в платном доступе') })
    expect(paidScriptOutcome('7.5', ALL_SECTIONS_OPEN, 'ru')).toEqual({ replace: null, note: null, paywall: null })
    expect(paidScriptOutcome('7.3', ALL_SECTIONS_CLOSED, 'ru')).toEqual({ replace: null, note: null, paywall: null })
  })
})

// ─── Routes: buildAssistantContext answers what the real one returns for the account ───
vi.mock('@/lib/assistant/context', async () => {
  const pc = await import('@/lib/assistant/paid-context')
  return { buildAssistantContext: async () => pc.scrubAssistantContext(s.ctx as AssistantContext, s.sections as never) }
})
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) }, from: () => { throw new Error('no db') } }) }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false, isRateLimited: async () => false, checkRateLimit: async () => ({ limited: false }), rateLimitResponse: () => new Response('{}', { status: 429 }) }))
vi.mock('@/lib/ai/budget', () => ({ guardAiBudget: async () => null, assertAiBudget: async () => undefined }))
vi.mock('@/lib/ai/openrouter', async () => ({ ...(await vi.importActual<Record<string, unknown>>('@/lib/ai/openrouter')), hasOpenRouterKey: () => true }))
vi.mock('@/lib/ai/structured', () => ({ generateObjectViaOpenRouter: async (a: { system: string; user: string }) => { s.llm.push(a); return null } }))
vi.mock('@/lib/ai/retrieval', () => ({ retrieveUserChunks: async () => [], documentIndexStatus: async () => ({ state: 'none', documents: 0 }), DOCUMENTS_NOT_INDEXED_NOTICE: 'n' }))
vi.mock('@/lib/events/server', () => ({ trackUserAction: async () => undefined }))

const chatRoute = await import('@/app/api/v1/assistant/chat/route')
const aiChatRoute = await import('@/app/api/v1/ai/chat/route')
const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  s.ctx = CTX
  s.sections = { ...ALL_SECTIONS_CLOSED }
  s.llm = []
})

describe('POST /api/v1/assistant/chat (mascot «Гри») for a Free account', () => {
  it('7.5 «Что такое моя Точка А» → the paywall answer, no score (before: «73», «Финансы (81/100)»)', async () => {
    const body = await (await chatRoute.POST(post('/api/v1/assistant/chat', { scriptId: '7.5' }))).json()
    expect(body.answer_ru).toContain('в платном доступе')
    expect(body.paywall).toEqual({ feature: 'point_a', href: '/client/point-a' })
    for (const m of PAID_MARKERS) expect(body.answer_ru).not.toContain(m)
  })

  it('7.6 / 7.7 → paywall, no gap / realism / GRI limits', async () => {
    for (const id of ['7.6', '7.7', '7.9']) {
      const body = await (await chatRoute.POST(post('/api/v1/assistant/chat', { scriptId: id }))).json()
      for (const m of PAID_MARKERS) expect(body.answer_ru, id).not.toContain(m)
      expect(body.answer_ru, id).toContain('в платном доступе')
    }
  })

  it('7.1 keeps the free part (questionnaire), no «Недостаточно данных» about a closed section', async () => {
    const body = await (await chatRoute.POST(post('/api/v1/assistant/chat', { scriptId: '7.1' }))).json()
    expect(body.answer_ru).not.toContain('Недостаточно данных')
    expect(body.answer_ru).toContain('в платном доступе')
    expect(body.answer_ru).not.toContain('73')
  })

  it('Pro (sections open) gets the numbers as before', async () => {
    s.sections = { ...ALL_SECTIONS_OPEN }
    const body = await (await chatRoute.POST(post('/api/v1/assistant/chat', { scriptId: '7.5' }))).json()
    expect(body.answer_ru).toContain('73')
    expect(body.paywall).toBeUndefined()
  })
})

describe('POST /api/v1/ai/chat («чат по отчёту», paid LLM) for a Free account', () => {
  it('the prompt has no paid data and says the sections are in paid access (before: score 73 and GRI limits)', async () => {
    await aiChatRoute.POST(post('/api/v1/ai/chat', { message: 'Расскажи мою Точку А и Точку Б' }))
    expect(s.llm).toHaveLength(1)
    const prompt = s.llm[0].system
    for (const m of ['ПЛАТНЫЙ_РИСК', 'ПЛАТНЫЙ_QUICKWIN', 'ПЛАТНАЯ_ТОЧКА_Б', 'ПЛАТНЫЙ_РЫЧАГ', 'ПЛАТНОЕ_ОГРАНИЧЕНИЕ_GRI_1']) expect(prompt).not.toContain(m)
    expect(prompt).toContain('ПЛАТНЫЙ ДОСТУП')
    expect(prompt).not.toMatch(/Общий балл: 73/)
  })
})

describe('the real buildAssistantContext applies the decision (one place for every caller)', () => {
  it('source: the snapshot is scrubbed with resolveAccess before it is returned; staff overrides only in GIGA', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('lib/assistant/context.ts', 'utf8')
    expect(src).toMatch(/const sections = await sectionsP/)
    expect(src).toMatch(/return scrubAssistantContext\(full, sections\)/)
    expect(src).toContain('resolveAccess(sb, userId)')
    expect(src).toContain('return ALL_SECTIONS_CLOSED') // a failed decision → all closed
  })
})

describe('the unified chat (ai/assistant): tools of a closed section are not offered to the model', () => {
  it('toolsFor drops get_point_a / explain_block / get_gri / get_point_b when closed', async () => {
    const { toolsFor } = await import('@/lib/chat/tools')
    const names = (sections?: Record<'point_a' | 'point_b' | 'gri_full' | 'market', boolean>) => toolsFor(false, sections).map((t) => t.name)
    expect(names()).toEqual(expect.arrayContaining(['get_point_a', 'get_gri', 'get_point_b']))
    const closed = names({ point_a: false, point_b: false, gri_full: false, market: false })
    for (const n of ['get_point_a', 'explain_block', 'get_gri', 'get_point_b', 'list_discrepancies']) expect(closed).not.toContain(n)
    expect(closed).toEqual(expect.arrayContaining(['get_metrics', 'get_goals', 'search_documents']))
  })
})
