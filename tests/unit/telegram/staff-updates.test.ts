/**
 * lib/telegram/staff-updates.ts
 *   #37 an approval press writes the audit entry BEFORE deciding; when the
 *       journal is unavailable the decision is not taken;
 *   #64 a staff link is accepted only in the private chat with the bot.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  order: [] as string[],
  consume: vi.fn(async (_a: unknown) => ({ ok: true })),
  send: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  answer: vi.fn(async (..._a: unknown[]) => true),
  decide: vi.fn(async (_a: unknown) => ({ ok: true, status: 'approved', summary: 's' })),
  staff: vi.fn(async (_id: number) => ({ userId: 'staff-1', role: 'admin', email: 'a@x' }) as { userId: string; role: string; email: string } | null),
  sql: [] as string[],
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async (strings: TemplateStringsArray) => { m.sql.push(strings.join('?')); return [{ update_id: BigInt(1) }] },
    $executeRaw: async (strings: TemplateStringsArray) => { m.sql.push(strings.join('?')); return 3 },
  },
}))
vi.mock('@/lib/telegram/staff-link', () => ({
  STAFF_START_PREFIX: 'staff_',
  consumeStaffLinkCode: m.consume,
  staffByTelegramUser: m.staff,
}))
vi.mock('@/lib/telegram/bot-api', () => ({ sendBotMessage: m.send, answerCallback: m.answer }))
vi.mock('@/lib/agents/approvals', () => ({
  decideApproval: async (a: unknown) => { m.order.push('decide'); return m.decide(a) },
}))
vi.mock('@/lib/notifications/approval-cards', () => ({ closeApprovalCards: vi.fn(async () => {}) }))
vi.mock('@/lib/notifications/approval-callback', () => ({
  parseApprovalCallback: (d: string) => (d === 'ap:good' ? { approvalId: 'ap-1', action: 'approve' } : null),
}))

import { firstSeenUpdate, forgetUpdate, handleApprovalCallback, handleStaffStart } from '@/lib/telegram/staff-updates'

beforeEach(() => {
  vi.clearAllMocks()
  m.order.length = 0
  m.sql.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('handleStaffStart — private chat only (#64)', () => {
  it('links in the private chat (chat id = user id)', async () => {
    expect(await handleStaffStart('/start staff_abc', { id: 42 }, '42')).toBe(true)
    expect(m.consume).toHaveBeenCalledWith(expect.objectContaining({ code: 'abc', telegramUserId: 42, chatId: '42' }))
  })

  it('refuses a group chat without consuming the code', async () => {
    expect(await handleStaffStart('/start staff_abc', { id: 42 }, '-100123')).toBe(true)
    expect(m.consume).not.toHaveBeenCalled()
    expect(String(m.send.mock.calls[0][1])).toContain('только в личном чате')
  })
})

describe('handleApprovalCallback — audit first (#37)', () => {
  const q = { id: 'cb', from: { id: 42 }, data: 'ap:good' }

  it('writes the audit entry before the decision', async () => {
    const audit = vi.fn(async () => { m.order.push('audit') })
    expect(await handleApprovalCallback(q, { audit })).toBe('decided')
    expect(m.order).toEqual(['audit', 'decide'])
    expect(audit).toHaveBeenCalledWith({ actorId: 'staff-1', role: 'admin', approvalId: 'ap-1', decision: 'approve' })
  })

  it('does not decide when the journal cannot be written', async () => {
    const audit = vi.fn(async () => { throw new Error('Audit log unavailable — action refused') })
    expect(await handleApprovalCallback(q, { audit })).toBe('audit_unavailable')
    expect(m.decide).not.toHaveBeenCalled()
    expect(String(m.answer.mock.calls[0][1])).toContain('Журнал аудита недоступен')
  })
})

describe('telegram_updates_seen housekeeping (#63)', () => {
  it('prunes old ids now and then and can forget a failed update', async () => {
    expect(await firstSeenUpdate(401)).toBe(true)
    expect(m.sql.some((q) => q.includes('DELETE'))).toBe(false)
    expect(await firstSeenUpdate(400)).toBe(true) // every PRUNE_EVERY-th id
    expect(m.sql.filter((q) => /DELETE FROM public\.telegram_updates_seen WHERE received_at </.test(q))).toHaveLength(1)
    await forgetUpdate(401)
    expect(m.sql.at(-1)).toMatch(/DELETE FROM public\.telegram_updates_seen WHERE update_id =/)
  })
})
