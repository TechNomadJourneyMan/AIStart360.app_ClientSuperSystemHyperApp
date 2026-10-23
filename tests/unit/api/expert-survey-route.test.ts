/**
 * /api/expert/clients/[id]/survey — PO decision 2026-10-23 (spec §18.3 item 3):
 * an expert reads and edits the questionnaire of HIS (assigned) clients only;
 * the edit is signed «Изменил эксперт Имя» (role expert, path staff), audited
 * with the reason, and the client is notified. Admin / super_admin — any client.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { memoryClient, type Row } from '../data-layer/memory-client'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const OTHER = '33333333-3333-4333-8333-333333333333'
const EXPERT = '22222222-2222-4222-8222-222222222222'
const ADMIN = '44444444-4444-4444-8444-444444444444'

const s = vi.hoisted(() => ({
  db: null as unknown as { client: unknown; db: Record<string, Row[]> },
  expert: { ok: true, viewer: { id: '', role: 'expert', email: 'e@x.kz' } } as Record<string, unknown>,
  audits: [] as Array<Record<string, unknown>>,
  notices: [] as Array<Record<string, unknown>>,
  actorClients: [] as Array<{ id: string; source: string }>,
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => s.db.client,
  createActorServiceClient: (a: { id: string; source: string }) => { s.actorClients.push(a); return s.db.client },
}))
vi.mock('@/lib/expert-auth', async (orig) => ({ ...(await orig<typeof import('@/lib/expert-auth')>()), resolveExpert: async () => s.expert }))
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_a: unknown, entry: Record<string, unknown>) => { s.audits.push(entry); return true },
}))
vi.mock('@/lib/notifications/notify', () => ({
  notifyClient: async (input: Record<string, unknown>) => { s.notices.push(input); return { ok: true, delivered: { inApp: true, email: false, telegram: false } } },
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))

const route = await import('@/app/api/expert/clients/[id]/survey/route')

const params = (id: string) => ({ params: { id } })
const get = async (id: string) => {
  const res = await route.GET(new NextRequest(`http://t/api/expert/clients/${id}/survey`), params(id))
  return { status: res.status, body: await res.json() }
}
const patch = async (id: string, body: unknown) => {
  const res = await route.PATCH(new NextRequest(`http://t/api/expert/clients/${id}/survey`, { method: 'PATCH', body: JSON.stringify(body) }), params(id))
  return { status: res.status, body: await res.json() }
}
const row = (user: string, key: string) => s.db.db.survey_answers.find((r) => r.user_id === user && r.question_key === key)

beforeEach(() => {
  s.audits = []
  s.notices = []
  s.actorClients = []
  s.expert = { ok: true, viewer: { id: EXPERT, role: 'expert', email: 'e@x.kz' } }
  s.db = memoryClient({
    user_assignments: [{ user_id: CLIENT, assignee_id: EXPERT }, { user_id: OTHER, assignee_id: ADMIN }],
    profiles: [
      { id: CLIENT, full_name: 'Айгуль Клиент', email: 'c@x.kz', role: 'client' },
      { id: EXPERT, full_name: 'Иван Петров', email: 'e@x.kz', role: 'expert' },
    ],
    survey_answers: [
      { user_id: CLIENT, question_key: 's3_deal_cycle_days', step: 5, answer: { value: 30 }, answered_at: '2026-10-20T09:00:00Z', updated_by: CLIENT, updated_by_role: 'user', updated_at: '2026-10-20T09:00:00Z', updated_via: 'full' },
      { user_id: CLIENT, question_key: 'gri_expert_cash', step: 0, answer: { value: 'note' } },
      { user_id: OTHER, question_key: 's3_deal_cycle_days', step: 5, answer: { value: 10 } },
    ],
    survey_answer_history: [],
  }) as never
})

describe('GET', () => {
  it('the assigned expert reads answers with author + path, the client name, canEdit', async () => {
    const { status, body } = await get(CLIENT)
    expect(status).toBe(200)
    expect(body.data.answers).toEqual({ s3_deal_cycle_days: 30 })
    expect(body.data.attribution.s3_deal_cycle_days).toMatchObject({ updatedByRole: 'user', updatedVia: 'full' })
    expect(body.data.ownerName).toBe('Айгуль Клиент')
    expect(body.data.canEdit).toBe(true)
  })

  it('a client not assigned to the expert → 403', async () => {
    const { status, body } = await get(OTHER)
    expect(status).toBe(403)
    expect(body.error).toBe('Клиент вам не назначен')
  })

  it('admin reads any client; a non-expert session is refused', async () => {
    s.expert = { ok: true, viewer: { id: ADMIN, role: 'admin', email: null } }
    expect((await get(CLIENT)).status).toBe(200)
    s.expert = { ok: false, block: 'forbidden' }
    expect((await get(CLIENT)).status).toBe(403)
  })
})

describe('PATCH — an expert edits his client', () => {
  it('assigned: written as «эксперт», path staff, audited with the reason, client notified', async () => {
    const { status, body } = await patch(CLIENT, { changes: { s3_deal_cycle_days: 45, s9n_net_profit: { value: null, unknown: true } }, reason: 'уточнили на встрече' })
    expect(status).toBe(200)
    expect(body.data).toMatchObject({ updated: 2, deleted: 0 })
    expect(row(CLIENT, 's3_deal_cycle_days')).toMatchObject({ answer: { value: 45 }, step: 5, updated_by: EXPERT, updated_by_role: 'expert', updated_via: 'staff' })
    expect(row(CLIENT, 's9n_net_profit')).toMatchObject({ answer: { value: null, unknown: true }, updated_via: 'staff' })
    expect(s.audits[0]).toMatchObject({ action: 'expert.survey_edited', targetUserId: CLIENT, oldValue: { s3_deal_cycle_days: 30 }, metadata: { reason: 'уточнили на встрече' } })
    expect(s.actorClients[0]).toMatchObject({ id: EXPERT, source: 'admin' })
    expect(s.notices).toHaveLength(1)
    expect(s.notices[0]).toMatchObject({ userId: CLIENT, category: 'expert', event: 'survey_edited_by_expert', ctaUrl: '/client/onboarding/answers?filter=staff' })
    expect(String(s.notices[0].body)).toContain('Эксперт Иван Петров изменил ответы: Цикл сделки (дней), Чистая прибыль / убыток.')
  })

  it('not assigned → 403, nothing written, nobody notified', async () => {
    const { status } = await patch(OTHER, { changes: { s3_deal_cycle_days: 99 }, reason: 'попытка' })
    expect(status).toBe(403)
    expect(row(OTHER, 's3_deal_cycle_days')).toMatchObject({ answer: { value: 10 } })
    expect(s.audits).toHaveLength(0)
    expect(s.notices).toHaveLength(0)
  })

  it('admin edits any client, signed as admin', async () => {
    s.expert = { ok: true, viewer: { id: ADMIN, role: 'admin', email: null } }
    expect((await patch(OTHER, { changes: { s3_deal_cycle_days: 12 }, reason: 'исправление' })).status).toBe(200)
    expect(row(OTHER, 's3_deal_cycle_days')).toMatchObject({ updated_by_role: 'admin', updated_via: 'staff' })
  })

  it('a reason is required; deletes, staff notes and profanity are refused', async () => {
    expect((await patch(CLIENT, { changes: { s3_deal_cycle_days: 1 } })).status).toBe(400)
    expect((await patch(CLIENT, { changes: { s3_deal_cycle_days: null }, reason: 'удалить' })).status).toBe(400)
    expect((await patch(CLIENT, { changes: { s6_main_pain: 'всё хуёво' }, reason: 'текст' })).status).toBe(400)
    const notes = await patch(CLIENT, { changes: { gri_expert_cash: 'x' }, reason: 'заметка' })
    expect(notes.status).toBe(400)
    expect(row(CLIENT, 's3_deal_cycle_days')).toMatchObject({ answer: { value: 30 } })
    expect(s.notices).toHaveLength(0)
  })

  it('an unchanged value writes nothing and notifies nobody', async () => {
    const { body } = await patch(CLIENT, { changes: { s3_deal_cycle_days: 30 }, reason: 'проверка' })
    expect(body.data).toMatchObject({ updated: 0, deleted: 0 })
    expect(s.notices).toHaveLength(0)
  })
})
