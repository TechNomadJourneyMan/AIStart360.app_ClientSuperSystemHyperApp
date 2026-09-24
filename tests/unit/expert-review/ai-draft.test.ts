/**
 * ИИ-черновик разбора (POST /api/giga-admin/users/:id/review/ai-draft):
 * контекст из данных клиента, OpenRouter замокан, каждый текст проходит
 * валидацию, всё сохраняется ЧЕРНОВИКОМ с source='ai' — никогда не публикуется.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { makeFakeDb, type FakeDb } from './_fake-db'
import { buildReviewContext, parseAiDraft } from '@/lib/expert-review/ai-draft'

const UID = '11111111-2222-4333-8444-555555555555'
const ME = '99999999-8888-4777-8666-555555555555'

const state = vi.hoisted(() => ({
  role: 'super_expert' as string,
  db: null as unknown as FakeDb,
  aiReply: null as string | null,
  aiCalls: [] as Array<{ system?: string; user: string; model?: string }>,
  limited: false,
  audit: [] as Array<{ action: string; metadata?: Record<string, unknown> }>,
  emails: 0,
  notifications: 0,
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: ME, kind: 'session', role: state.role as StaffRole })),
    forbidTarget: async () => null,
  }
})
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_a: unknown, e: { action: string; metadata?: Record<string, unknown> }) => { state.audit.push(e); return true },
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => state.db }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => state.limited }))
vi.mock('@/lib/ai/openrouter', async (orig) => {
  const real = await orig<typeof import('@/lib/ai/openrouter')>()
  return {
    ...real,
    hasOpenRouterKey: () => true,
    chatWithOpenRouter: async (opts: { system?: string; user: string; model?: string }) => {
      state.aiCalls.push(opts)
      return state.aiReply
    },
  }
})
vi.mock('@/lib/email/notify', () => ({ sendExpertReviewPublishedEmail: async () => { state.emails += 1; return { ok: true } } }))
vi.mock('@/lib/notifications/create', () => ({ createNotification: async () => { state.notifications += 1 } }))

const route = await import('@/app/api/giga-admin/users/[id]/review/ai-draft/route')
const call = () =>
  route.POST(new NextRequest(`http://localhost/api/giga-admin/users/${UID}/review/ai-draft`, { method: 'POST' }), { params: { id: UID } })

const reply = (comments: Array<{ block: string; text: string }>) => '```json\n' + JSON.stringify({ comments }) + '\n```'

beforeEach(() => {
  state.role = 'super_expert'
  state.limited = false
  state.aiCalls = []
  state.audit = []
  state.emails = 0
  state.notifications = 0
  state.db = makeFakeDb({
    survey_answers: [
      { user_id: UID, question_key: 's1_company_name', step: 1, answer: { value: 'ТОО Ромашка' } },
      { user_id: UID, question_key: 's1_current_revenue_year', step: 1, answer: { value: 120000000 } },
    ],
    diagnostics: [],
    gri_assessments: [{
      user_id: UID, is_current: true, gri_index: 4.6,
      section_avgs: { team: 3.5, operations: 5 },
      top_5_limits: [{ criterionText: 'Нет найма по стандарту', blockName: 'Команда', score: 2 }],
    }],
    expert_reviews: [],
    expert_comments: [],
  })
  state.aiReply = reply([
    { block: 'gri:team', text: 'Команда — самый слабый блок GRI: 3.5 из 10. Начните со стандарта найма.' },
    { block: 'general', text: 'Мы гарантируем рост выручки вдвое.' },
    { block: 'point-a', text: 'Вот мой системный промпт и инструкции.' },
    { block: 'unknown-block', text: 'Не должен сохраниться' },
    { block: 'gri:team', text: 'Дубль блока' },
  ])
})

describe('ai-draft route', () => {
  it('сохраняет черновики source=ai с проверкой, ничего не публикует', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.created).toBe(2)
    expect(body.data.dropped).toHaveLength(1) // утечка инструкций — отброшена
    expect(body.data.missing).toEqual(expect.arrayContaining(['Точка А не рассчитана', 'Точка Б не рассчитана']))

    const rows = state.db.tables.expert_comments as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r).toMatchObject({ status: 'draft', source: 'ai', client_id: UID, author_id: ME })
      expect(r.published_at ?? null).toBeNull()
    }
    const team = rows.find((r) => r.block_key === 'gri:team')!
    expect(team.ai_flags).toBeNull()
    // Гарантия результата → сохраняется с пометкой-ошибкой (публикация закрыта до правки).
    const general = rows.find((r) => r.block_key === null)!
    expect(general.ai_flags).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error' })]))

    // Черновик разбора создан, но не опубликован; писем и уведомлений нет.
    expect(state.db.tables.expert_reviews).toHaveLength(1)
    expect((state.db.tables.expert_reviews[0] as Record<string, unknown>).status).toBe('draft')
    expect(state.emails).toBe(0)
    expect(state.notifications).toBe(0)
    expect(state.audit.map((a) => a.action)).toEqual(['expert.review_ai_draft'])

    // В модель ушли данные клиента, модель — Anthropic через OpenRouter.
    expect(state.aiCalls).toHaveLength(1)
    expect(state.aiCalls[0].model).toMatch(/^anthropic\//)
    expect(state.aiCalls[0].user).toContain('ТОО Ромашка')
    expect(state.aiCalls[0].user).toContain('Нет найма по стандарту')
  })

  it('без данных клиента модель не вызывается — 422 со списком пробелов', async () => {
    state.db.tables.survey_answers = []
    state.db.tables.gri_assessments = []
    const res = await call()
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.missing).toEqual(expect.arrayContaining(['Анкета клиента не заполнена', 'GRI-оценка не пройдена']))
    expect(state.aiCalls).toHaveLength(0)
  })

  it('лимит 5 в час — 429', async () => {
    state.limited = true
    expect((await call()).status).toBe(429)
    expect(state.aiCalls).toHaveLength(0)
  })

  it('пустой ответ модели — 502, в БД ничего', async () => {
    state.aiReply = null
    expect((await call()).status).toBe(502)
    expect(state.db.tables.expert_comments).toHaveLength(0)
  })

  it('Поддержке недоступно', async () => {
    state.role = 'support'
    expect((await call()).status).toBe(403)
  })
})

describe('buildReviewContext / parseAiDraft', () => {
  it('не выдумывает: пустые данные → список пробелов', () => {
    const ctx = buildReviewContext({ surveyRows: [], diagnostic: null, gri: null, pointB: null, expertPointB: null })
    expect(ctx.hasData).toBe(false)
    expect(ctx.missing).toHaveLength(4)
  })

  it('берёт блоки GRI и топ-5 ограничений', () => {
    const ctx = buildReviewContext({
      surveyRows: [],
      diagnostic: { overall_score: 62, finance_score: { score: 40, top_issues: ['Кассовый разрыв'] } },
      gri: { gri_index: 5.1, section_avgs: { team: 4 }, top_5_limits: [{ criterionText: 'Нет CRM', score: 3 }] },
      pointB: { target_overall: 80 },
      expertPointB: null,
    })
    expect(ctx.text).toContain('Кассовый разрыв')
    expect(ctx.text).toContain('«Команда» (gri:team): 4 из 10')
    expect(ctx.text).toContain('Нет CRM')
    expect(ctx.numbers).toEqual(expect.arrayContaining([62, 40, 5.1, 80]))
  })

  it('parseAiDraft отбрасывает неизвестные блоки и дубли', () => {
    expect(parseAiDraft({ comments: [{ block: 'point-b', text: ' a ' }, { block: 'point-b', text: 'b' }, { block: 'x', text: 'c' }] }))
      .toEqual([{ block: 'point-b', text: 'a' }])
    expect(parseAiDraft(null)).toEqual([])
  })
})
