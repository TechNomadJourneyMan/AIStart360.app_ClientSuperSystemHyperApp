import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  staff: [] as Array<Record<string, unknown>>,
  staffKeys: new Set<string>(),
  client: [] as Array<Record<string, unknown>>,
  messages: [] as Array<{ input: Record<string, unknown>; deps: unknown }>,
  claims: new Set<string>(),
  released: [] as string[],
  events: [] as Array<Record<string, unknown>>,
  failStaff: false,
  failSend: false,
  sendOk: true,
}))

vi.mock('@/lib/notifications/staff', () => ({
  notifyStaff: async (n: Record<string, unknown>) => {
    if (h.failStaff) throw new Error('staff down')
    const key = n.dedupeKey as string | null
    if (key && h.staffKeys.has(key)) return { eventId: null, duplicate: true, deliveries: [] }
    if (key) h.staffKeys.add(key)
    h.staff.push(n)
    return { eventId: 'e1', duplicate: false, deliveries: [] }
  },
}))
vi.mock('@/lib/notifications/notify', () => ({
  notifyClient: async (input: Record<string, unknown>) => {
    h.client.push(input)
    return { ok: true, delivered: { inApp: true, email: false, telegram: false } }
  },
}))
vi.mock('@/lib/notifications/store', () => ({
  claimSend: async (input: { dedupeKey: string }) => {
    if (h.claims.has(input.dedupeKey)) return { result: 'duplicate', id: null }
    h.claims.add(input.dedupeKey)
    return { result: 'claimed', id: input.dedupeKey }
  },
  releaseSend: async (id: string) => { h.claims.delete(id); h.released.push(id) },
}))
vi.mock('@/lib/comm/send', () => ({
  sendToUser: async (input: Record<string, unknown>, deps: unknown) => {
    if (h.failSend) throw new Error('comm down')
    h.messages.push({ input, deps })
    return { ok: h.sendOk, threadId: 't1', groupId: 'g1', messages: [] }
  },
}))
vi.mock('@/lib/events/track', () => ({
  trackEventOnce: async (e: Record<string, unknown>) => {
    if (!h.events.some((x) => x.userId === e.userId && x.name === e.name && x.entityId === e.entityId)) h.events.push(e)
  },
}))

const notify = await import('@/lib/point-b/plan/notify')
const { pbDb } = await import('./_pbdb')
const { isEventName, EVENTS } = await import('@/lib/events/registry')

const USER = '00000000-0000-4000-8000-000000000001'
const APPROVER = { id: '00000000-0000-4000-8000-0000000000a1', name: 'Админ Иванова' }
const EXPERT = { id: '00000000-0000-4000-8000-0000000000e1', name: 'Анна Эксперт' }
const ASSIGNEE = '00000000-0000-4000-8000-0000000000e2'

beforeEach(() => {
  h.staff.length = 0; h.staffKeys.clear(); h.client.length = 0; h.messages.length = 0; h.claims.clear(); h.released.length = 0
  h.events.length = 0; h.failStaff = false; h.failSend = false; h.sendOk = true
})

describe('events', () => {
  it('the four plan events are registered as server-only facts', () => {
    for (const name of ['POINT_B_PLAN_SUBMITTED', 'POINT_B_PLAN_APPROVED', 'POINT_B_GOAL_CORRECTED', 'POINT_B_GOAL_RESPONDED'] as const) {
      expect(isEventName(name)).toBe(true)
      expect(EVENTS[name].client).toBe(false)
      expect(EVENTS[name].label.length).toBeGreaterThan(0)
    }
  })
})

describe('notifyPlanSubmitted', () => {
  it('plan submitted notifies staff with a link and never throws on failure', async () => {
    const { sb } = pbDb()
    await notify.notifyPlanSubmitted(sb, { companyId: 'c1', userId: USER, versionId: 'v1', authorName: 'Анна Эксперт' })
    expect(h.staff).toHaveLength(1)
    expect(h.staff[0]).toMatchObject({
      type: 'point_b.plan.submitted', level: 'WARNING', companyId: 'c1', entityId: 'v1', audiencePermission: 'clients.review',
      link: `/admin-giga-panel/users/${USER}?tab=point-b`,
    })
    expect(String(h.staff[0].title)).toContain('одобрения')
    expect(h.events.map((e) => e.name)).toEqual(['POINT_B_PLAN_SUBMITTED'])

    h.failStaff = true
    await expect(notify.notifyPlanSubmitted(sb, { companyId: 'c1', userId: USER, versionId: 'v2', authorName: 'А' })).resolves.toBeUndefined()
  })

  it('dedupe: the same versionId is notified once; a resubmission (new submit time) is a new request', async () => {
    const { sb } = pbDb()
    const input = { companyId: 'c1', userId: USER, versionId: 'v1', authorName: 'А', submittedAt: '2026-10-18T10:00:00Z' }
    await notify.notifyPlanSubmitted(sb, input)
    await notify.notifyPlanSubmitted(sb, input)
    expect(h.staff).toHaveLength(1)
    expect(h.events).toHaveLength(1)
    await notify.notifyPlanSubmitted(sb, { ...input, submittedAt: '2026-10-19T10:00:00Z' })
    expect(h.staff).toHaveLength(2)
  })
})

describe('notifyPlanApproved', () => {
  it('plan approved sends the client a notification and a staff-authored app message; first publication is important', async () => {
    const { sb } = pbDb()
    await notify.notifyPlanApproved(sb, { userId: USER, versionId: 'v1', first: true, actor: APPROVER })
    expect(h.messages).toHaveLength(1)
    expect(h.messages[0].input).toMatchObject({
      userId: USER, channels: ['app'], authorKind: 'staff', authorId: APPROVER.id, authorName: APPROVER.name, flags: { important: true },
    })
    expect(h.messages[0].deps).toEqual({ sb })
    expect(String(h.messages[0].input.body)).toContain('«Точка Б»')
    expect(h.client).toHaveLength(1)
    expect(h.client[0]).toMatchObject({
      userId: USER, category: 'expert', event: 'point_b_plan_approved', dedupeKey: 'point_b_plan_approved:v1', ctaUrl: '/client/point-b',
    })
    // the message already makes the bell entry: the notification skips in-app
    expect(h.client[0].channels).toEqual({ inApp: false })
    expect(h.events.map((e) => e.name)).toEqual(['POINT_B_PLAN_APPROVED'])
  })

  it('later publications are not important', async () => {
    const { sb } = pbDb()
    await notify.notifyPlanApproved(sb, { userId: USER, versionId: 'v2', first: false, actor: APPROVER })
    expect(h.messages[0].input).toMatchObject({ flags: { important: false } })
    expect(String(h.messages[0].input.appTitle)).toContain('обновлён')
  })

  it('the notification keeps in-app when the message did not reach the cabinet', async () => {
    const { sb } = pbDb()
    h.sendOk = false
    await notify.notifyPlanApproved(sb, { userId: USER, versionId: 'v3', first: true, actor: APPROVER })
    expect(h.client[0].channels).toBeUndefined()
    expect(h.released).toEqual(['point_b_plan_approved:v3:msg']) // can be retried

    h.client.length = 0; h.failSend = true
    await expect(notify.notifyPlanApproved(sb, { userId: USER, versionId: 'v4', first: true, actor: APPROVER })).resolves.toBeUndefined()
    expect(h.client).toHaveLength(1)
    expect(h.client[0].channels).toBeUndefined()
  })

  it('dedupe: the same versionId sends one message', async () => {
    const { sb } = pbDb()
    await notify.notifyPlanApproved(sb, { userId: USER, versionId: 'v1', first: true, actor: APPROVER })
    await notify.notifyPlanApproved(sb, { userId: USER, versionId: 'v1', first: true, actor: APPROVER })
    expect(h.messages).toHaveLength(1)
    expect(h.events).toHaveLength(1)
    // notifyClient dedupes by its own key (the same dedupeKey on both calls)
    expect(h.client.map((c) => c.dedupeKey)).toEqual(['point_b_plan_approved:v1', 'point_b_plan_approved:v1'])
  })
})

describe('notifyGoalCorrection', () => {
  const base = { userId: USER, reviewId: 'rv-1', metricLabel: 'Выручка за год', from: 100_000_000, to: 150_000_000, reason: 'Рынок позволяет рост выше', reviewer: EXPERT }

  it('goal correction message is important and carries from/to and the reason', async () => {
    const { sb } = pbDb()
    await notify.notifyGoalCorrection(sb, base)
    expect(h.messages).toHaveLength(1)
    const msg = h.messages[0].input
    expect(msg).toMatchObject({ authorKind: 'staff', authorId: EXPERT.id, channels: ['app'], flags: { important: true } })
    const body = String(msg.body)
    expect(body).toContain('Выручка за год')
    expect(body).toContain('100 000 000')
    expect(body).toContain('150 000 000')
    expect(body).toContain('Рынок позволяет рост выше')
    expect(body).toContain('не изменится')
    expect(h.client[0]).toMatchObject({ category: 'expert', event: 'point_b_goal_corrected', dedupeKey: 'point_b_goal_corrected:rv-1' })
    expect(String(h.client[0].body)).toContain('Рынок позволяет рост выше')
    expect(h.events.map((e) => e.name)).toEqual(['POINT_B_GOAL_CORRECTED'])
  })

  it('a goal the expert set directly (no previous value) is informational, not a pop-up asking for an answer', async () => {
    const { sb } = pbDb()
    await notify.notifyGoalCorrection(sb, { ...base, from: null })
    expect(h.messages[0].input).toMatchObject({ flags: { important: false } })
    expect(String(h.messages[0].input.body)).toContain('Для вас задана цель')
    expect(String(h.messages[0].input.body)).not.toContain('Пока вы не согласитесь')
  })

  it('dedupe: the same reviewId sends one message', async () => {
    const { sb } = pbDb()
    await notify.notifyGoalCorrection(sb, base)
    await notify.notifyGoalCorrection(sb, base)
    expect(h.messages).toHaveLength(1)
  })
})

describe('notifyGoalNeedsReview', () => {
  const input = { userId: USER, companyId: 'c1', metricLabel: 'Выручка за год' }

  it('goal needs review notifies the assigned expert, falling back to everyone with clients.review', async () => {
    const withAssignee = pbDb({ user_assignments: [{ user_id: USER, assignee_id: ASSIGNEE }] })
    await notify.notifyGoalNeedsReview(withAssignee.sb, input)
    expect(h.staff[0]).toMatchObject({ audienceUserIds: [ASSIGNEE], audiencePermission: 'clients.review', companyId: 'c1', type: 'point_b.goal.needs_review' })

    const nobody = pbDb({ user_assignments: [] })
    await notify.notifyGoalNeedsReview(nobody.sb, { ...input, metricLabel: 'Другая цель' })
    expect(h.staff[1].audienceUserIds).toBeNull()
    expect(h.staff[1].audiencePermission).toBe('clients.review')
  })

  it('never throws, and the same goal is announced once a day', async () => {
    const { sb } = pbDb()
    await notify.notifyGoalNeedsReview(sb, input)
    await notify.notifyGoalNeedsReview(sb, input)
    expect(h.staff).toHaveLength(1)
    h.failStaff = true
    await expect(notify.notifyGoalNeedsReview(sb, { ...input, metricLabel: 'Новая' })).resolves.toBeUndefined()
  })
})

describe('notifyGoalResponded', () => {
  it('tells the reviewer (or the assignee) how the owner answered', async () => {
    const { sb } = pbDb()
    await notify.notifyGoalResponded(sb, { userId: USER, companyId: 'c1', reviewId: 'rv-1', metricLabel: 'Выручка', accepted: false, reviewerId: EXPERT.id })
    expect(h.staff[0]).toMatchObject({ level: 'WARNING', audienceUserIds: [EXPERT.id], entityId: 'rv-1' })
    await notify.notifyGoalResponded(sb, { userId: USER, companyId: 'c1', reviewId: 'rv-2', metricLabel: 'Выручка', accepted: true })
    expect(h.staff[1]).toMatchObject({ level: 'INFO', audienceUserIds: null })
    expect(h.events.map((e) => e.name)).toEqual(['POINT_B_GOAL_RESPONDED', 'POINT_B_GOAL_RESPONDED'])
    expect(h.events[0].source).toBe('server')
  })
})
