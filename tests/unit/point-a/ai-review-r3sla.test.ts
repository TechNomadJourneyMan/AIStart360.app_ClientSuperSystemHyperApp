/**
 * R3-SLA — проверка ИИ-разбора Точки А экспертом (решение PO «гибрид»):
 *   • правки поверх текста ИИ — только то, что отличается от текста ИИ (pruneEdits);
 *   • маршруты ГИГА (/api/giga-admin/users/:id/point-a/ai-review) и кабинета эксперта
 *     (/api/expert/clients/:id/point-a-ai-review): права и скоуп, сохранение правок
 *     (реакция задачи SLA), подтверждение («Проверено экспертом: имя», ответ — задача
 *     закрыта), журнал аудита, 409 при обновлённом разборе / правке подтверждённого без
 *     повторного подтверждения, мат — 400;
 *   • клиенту — «Эксперт проверит до <срок>» (AiAnalysisCard), панель проверки (AiReviewView).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import {
  aiAnalysisView, analysisContent, applyExpertEdits, editsFromForm, pruneEdits, reviewFormOf, type AiAnalysisContent,
} from '@/lib/point-a/ai-review'
import { slaDb, type Row } from '../expert-sla/_fake'

const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const EXPERT = 'eeeeeeee-0000-4000-8000-000000000001'
const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const DIAG = 'dddddddd-0000-4000-8000-000000000001'
const TASK = '77777777-0000-4000-8000-000000000001'
const BAD = 'Это полная хуйня'

const AI = {
  executive_summary: 'ИИ: бизнес растёт', industry_context: 'норма отрасли',
  strategic_priorities: [{ title: 'Повторные продажи', rationale: 'база есть', expected_impact: '+10 %' }],
  growth_roadmap: [{ horizon: '30_days', actions: ['Собрать базу'] }],
  blocks: { finance: { diagnosis: 'маржа ок', key_risk: 'нет плана' } },
}

const s = vi.hoisted(() => ({
  role: 'admin' as string,
  scopeOk: true,
  world: null as null | ReturnType<typeof import('../expert-sla/_fake').slaDb>,
  audits: [] as Array<Record<string, unknown>>,
  expertViewer: null as null | { id: string; role: string },
  expertClients: [] as string[],
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: ADMIN, kind: 'session', role: s.role as StaffRole, email: 'admin@x.io' })) }
})
vi.mock('@/lib/admin/client-scope', async () => {
  const { NextResponse } = await import('next/server')
  return { guardClientAccess: async () => (s.scopeOk ? null : NextResponse.json({ ok: false, error: 'Этот клиент вам не назначен' }, { status: 403 })) }
})
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.world!.sb }))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async (_a: unknown, e: Record<string, unknown>) => { s.audits.push(e); return true } }))
vi.mock('@/lib/expert-auth', async () => {
  const { NextResponse } = await import('next/server')
  return {
    resolveExpert: async () => (s.expertViewer ? { ok: true, viewer: { ...s.expertViewer, email: 'e@x.io' } } : { ok: false, block: 'forbidden' }),
    expertBlockResponse: () => NextResponse.json({ ok: false }, { status: 403 }),
    guardExpertClient: async (_v: unknown, id: string) => (s.expertClients.includes(id) ? null : NextResponse.json({ ok: false, error: 'not assigned' }, { status: 403 })),
  }
})

function diagRow(over: Row = {}): Row {
  return {
    id: DIAG, user_id: CLIENT, is_current: true, ai_status: 'completed', ai_analysis: AI, ai_error: null, ai_model: 'm',
    ai_generated_at: '2026-11-15T10:00:00Z', ai_reviewed_at: null, ai_reviewed_by: null, ai_reviewed_by_name: null, ai_expert_edits: null, ...over,
  }
}

beforeEach(() => {
  s.role = 'admin'
  s.scopeOk = true
  s.audits = []
  s.expertViewer = null
  s.expertClients = []
  s.world = slaDb({
    companies: [{ id: 'co-1', user_id: CLIENT, name: 'ООО Ромашка' }],
    profiles: [{ id: CLIENT, role: 'client', status: 'approved' }, { id: ADMIN, full_name: 'Анна Админ', email: 'admin@x.io' }, { id: EXPERT, full_name: 'Пётр Эксперт', role: 'expert', status: 'approved' }],
    diagnostics: [diagRow()],
    expert_sla_tasks: [{
      id: TASK, source: 'pa_ai_review', source_id: DIAG, client_id: CLIENT, assignee_id: EXPERT, received_at: '2026-11-15T10:00:00Z',
      reaction_due_at: '2026-11-16T10:00:00Z', answer_due_at: '2026-11-17T10:00:00Z', first_response_at: null, closed_at: null, answered: null,
    }],
  })
})

const req = (url: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${url}`, {
  method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: 'http://localhost' } } : {}),
})
const GIGA = `/api/giga-admin/users/${CLIENT}/point-a/ai-review`
const EXP = `/api/expert/clients/${CLIENT}/point-a-ai-review`
const diag = () => s.world!.db.diagnostics[0]
const task = () => s.world!.db.expert_sla_tasks[0]

describe('corrections over the AI text', () => {
  const ai = analysisContent(AI as never) as AiAnalysisContent

  it('the form of the AI text gives no correction; a changed field is the only correction', () => {
    const form = reviewFormOf(ai)
    expect(pruneEdits(ai, editsFromForm(form))).toBeNull()
    const changed = { ...form, executive_summary: 'Эксперт: рост есть, но маржа падает', blocks: { ...form.blocks, finance: { ...form.blocks.finance, key_risk: 'кассовый разрыв' } }, note: 'Созвонимся' }
    expect(pruneEdits(ai, editsFromForm(changed))).toEqual({
      executive_summary: 'Эксперт: рост есть, но маржа падает', blocks: { finance: { key_risk: 'кассовый разрыв' } }, note: 'Созвонимся',
    })
    // An emptied field keeps the AI text (never deleted, only replaced).
    expect(pruneEdits(ai, editsFromForm({ ...form, industry_context: '' }))).toBeNull()
    // The roadmap: one action more is a correction of the plan.
    const roadmap = pruneEdits(ai, editsFromForm({ ...form, growth_roadmap: { ...form.growth_roadmap, '90_days': 'Запустить CRM' } }))
    expect(roadmap?.growth_roadmap).toEqual([{ horizon: '30_days', actions: ['Собрать базу'] }, { horizon: '90_days', actions: ['Запустить CRM'] }])
    // Applied over the AI text, the form shows the corrections.
    expect(reviewFormOf(applyExpertEdits(ai, { executive_summary: 'X' }).content).executive_summary).toBe('X')
  })
})

describe('GIGA: /api/giga-admin/users/:id/point-a/ai-review', () => {
  it('read: users.view + users.sensitive and the client scope', async () => {
    const { GET } = await import('@/app/api/giga-admin/users/[id]/point-a/ai-review/route')
    s.role = 'content_manager'
    expect((await GET(req(GIGA), { params: { id: CLIENT } })).status).toBe(403)
    s.role = 'admin'
    s.scopeOk = false
    expect((await GET(req(GIGA), { params: { id: CLIENT } })).status).toBe(403)
    s.scopeOk = true
    const body = await (await GET(req(GIGA), { params: { id: CLIENT } })).json()
    expect(body.data).toMatchObject({ diagnosticId: DIAG, reviewable: true, view: { draft: true }, task: { id: TASK, assignee: { name: 'Пётр Эксперт' } } })
    expect(body.data.ai.executive_summary).toBe('ИИ: бизнес растёт')
  })

  it('save corrections (clients.review): only what differs, the SLA reaction, the audit; the AI text is untouched', async () => {
    const { PUT } = await import('@/app/api/giga-admin/users/[id]/point-a/ai-review/route')
    s.role = 'support'
    expect((await PUT(req(GIGA, 'PUT', { diagnosticId: DIAG, edits: { executive_summary: 'Новое' } }), { params: { id: CLIENT } })).status).toBe(403)
    s.role = 'admin'
    const res = await PUT(req(GIGA, 'PUT', { diagnosticId: DIAG, edits: { executive_summary: 'Эксперт: маржа падает', industry_context: 'норма отрасли' } }), { params: { id: CLIENT } })
    expect(res.status).toBe(200)
    expect(diag().ai_expert_edits).toEqual({ executive_summary: 'Эксперт: маржа падает' })
    expect(diag().ai_analysis).toEqual(AI)
    expect(diag().ai_reviewed_at).toBeNull()
    expect(task().first_response_at).toBeTruthy()
    expect(task().closed_at).toBeNull()
    expect(s.audits).toEqual([expect.objectContaining({ action: 'point_a.ai_review.edited', entityId: DIAG, targetUserId: CLIENT, metadata: expect.objectContaining({ edited: ['executive_summary'], via: 'giga' }) })])
    // The client sees the correction over the AI text, still a draft.
    const v = aiAnalysisView(diag())!
    expect(v).toMatchObject({ draft: true, editedByExpert: ['executive_summary'] })
    expect(v.analysis?.executive_summary).toBe('Эксперт: маржа падает')
  })

  it('confirm: «Проверено экспертом» with the profile name (never the email), the task answered and closed', async () => {
    const { POST, PUT } = await import('@/app/api/giga-admin/users/[id]/point-a/ai-review/route')
    const res = await POST(req(GIGA, 'POST', { diagnosticId: DIAG, edits: { note: 'Посмотрел, всё верно' } }), { params: { id: CLIENT } })
    expect(res.status).toBe(200)
    expect(diag()).toMatchObject({ ai_reviewed_by: ADMIN, ai_reviewed_by_name: 'Анна Админ', ai_expert_edits: { note: 'Посмотрел, всё верно' } })
    expect(diag().ai_reviewed_at).toBeTruthy()
    expect(task()).toMatchObject({ close_reason: 'reviewed', answered: true })
    expect(task().first_response_at).toBeTruthy()
    expect(s.audits.at(-1)).toMatchObject({ action: 'point_a.ai_review.confirmed', newValue: { reviewed_by_name: 'Анна Админ' } })
    const v = aiAnalysisView(diag())!
    expect(v).toMatchObject({ draft: false, review: { by: 'Анна Админ' }, expertNote: 'Посмотрел, всё верно' })
    // A confirmed analysis is changed only by confirming again.
    expect((await PUT(req(GIGA, 'PUT', { diagnosticId: DIAG, edits: { executive_summary: 'тихо' } }), { params: { id: CLIENT } })).status).toBe(409)
    expect(diag().ai_expert_edits).toEqual({ note: 'Посмотрел, всё верно' })
  })

  it('409 when the analysis was regenerated or is being generated; 400 for a bad body or profanity', async () => {
    const { PUT, POST } = await import('@/app/api/giga-admin/users/[id]/point-a/ai-review/route')
    expect((await PUT(req(GIGA, 'PUT', { diagnosticId: 'nope' }), { params: { id: CLIENT } })).status).toBe(400)
    expect((await PUT(req(GIGA, 'PUT', { diagnosticId: DIAG, edits: { unknown: 'x' } }), { params: { id: CLIENT } })).status).toBe(400)
    expect((await PUT(req(GIGA, 'PUT', { diagnosticId: DIAG, edits: { note: BAD } }), { params: { id: CLIENT } })).status).toBe(400)
    diag().ai_status = 'processing'
    expect((await POST(req(GIGA, 'POST', { diagnosticId: DIAG }), { params: { id: CLIENT } })).status).toBe(409)
    diag().ai_status = 'completed'
    diag().is_current = false
    expect((await POST(req(GIGA, 'POST', { diagnosticId: DIAG }), { params: { id: CLIENT } })).status).toBe(409)
    expect(diag().ai_reviewed_at).toBeNull()
    expect(s.audits).toEqual([])
  })
})

describe('expert cabinet: /api/expert/clients/:id/point-a-ai-review', () => {
  it('only an assigned client; the expert confirms with his name', async () => {
    const { GET, POST } = await import('@/app/api/expert/clients/[id]/point-a-ai-review/route')
    expect((await GET(req(EXP), { params: { id: CLIENT } })).status).toBe(403) // not an expert
    s.expertViewer = { id: EXPERT, role: 'expert' }
    expect((await GET(req(EXP), { params: { id: CLIENT } })).status).toBe(403) // not his client
    expect((await POST(req(EXP, 'POST', { diagnosticId: DIAG }), { params: { id: CLIENT } })).status).toBe(403)
    expect(diag().ai_reviewed_at).toBeNull()
    s.expertClients = [CLIENT]
    expect((await GET(req(EXP), { params: { id: CLIENT } })).status).toBe(200)
    expect((await POST(req(EXP, 'POST', { diagnosticId: DIAG, edits: { executive_summary: 'Поправил' } }), { params: { id: CLIENT } })).status).toBe(200)
    expect(diag()).toMatchObject({ ai_reviewed_by: EXPERT, ai_reviewed_by_name: 'Пётр Эксперт', ai_expert_edits: { executive_summary: 'Поправил' } })
    expect(s.audits.at(-1)).toMatchObject({ action: 'point_a.ai_review.confirmed', metadata: expect.objectContaining({ via: 'expert-portal' }) })
  })
})

describe('UI', () => {
  it('the client: «Эксперт проверит до <срок>» on a draft with an open task; no date once overdue or reviewed', async () => {
    const { AiAnalysisCard } = await import('@/components/point-a-v4/AiAnalysisCard')
    const base = aiAnalysisView(diagRow())!
    const html = (ai: typeof base) => renderToStaticMarkup(createElement(AiAnalysisCard, { ai, canRetry: false, onRetry: () => {} }))
    const due = html({ ...base, reviewDue: { at: '2026-11-17T09:00:00.000Z', overdue: false } })
    expect(due).toContain('data-ai-review-due')
    expect(due).toContain('Эксперт проверит до 17 ноября, 14:00')
    expect(html({ ...base, reviewDue: { at: '2026-11-17T09:00:00.000Z', overdue: true } })).not.toContain('Эксперт проверит до')
    expect(html({ ...base, reviewDue: null })).not.toContain('Эксперт проверит до')
    const reviewed = aiAnalysisView(diagRow({ ai_reviewed_at: '2026-11-16T10:00:00Z', ai_reviewed_by_name: 'Анна Админ' }))!
    expect(html({ ...reviewed, reviewDue: { at: '2026-11-17T09:00:00.000Z', overdue: false } })).not.toContain('Эксперт проверит до')
  })

  it('the review panel: draft / reviewed, the SLA line, editing only for those who may', async () => {
    const { AiReviewView } = await import('@/components/expert-review/AiReviewPanel')
    const ai = analysisContent(AI as never)
    const data = {
      diagnosticId: DIAG, view: aiAnalysisView(diagRow()), ai, edits: null, reviewable: true,
      task: { id: TASK, receivedAt: '2026-11-15T10:00:00Z', reactionDueAt: '2026-11-16T10:00:00Z', answerDueAt: '2026-11-17T10:00:00Z', firstResponseAt: null, closedAt: null, assignee: { id: EXPERT, name: 'Пётр Эксперт' }, stage: 'ok' as const, timer: 'осталось 40 ч' },
    }
    const html = renderToStaticMarkup(createElement(AiReviewView, { data, form: reviewFormOf(ai), canEdit: true, busy: null }))
    expect(html).toContain('Черновик ИИ — ждёт проверки')
    expect(html).toContain('Задача SLA: осталось 40 ч')
    expect(html).toContain('исполнитель: Пётр Эксперт')
    expect(html).toContain('Подтвердить разбор')
    expect(html).toContain('Сохранить правки')
    expect(html).toContain('ИИ: бизнес растёт')
    const readOnly = renderToStaticMarkup(createElement(AiReviewView, { data, form: reviewFormOf(ai), canEdit: false, busy: null }))
    expect(readOnly).not.toContain('Подтвердить разбор')
    const reviewed = renderToStaticMarkup(createElement(AiReviewView, {
      data: { ...data, view: aiAnalysisView(diagRow({ ai_reviewed_at: '2026-11-16T10:00:00Z', ai_reviewed_by_name: 'Анна Админ' })) },
      form: reviewFormOf(ai), canEdit: true, busy: null,
    }))
    expect(reviewed).toContain('Проверено: Анна Админ')
    expect(reviewed).not.toContain('Сохранить правки')
    expect(reviewed).toContain('Сохранить и подтвердить заново')
  })
})
