/**
 * /api/telegram/webhook — staff paths:
 *   #37 the approval audit entry is written with { required: true } and the
 *       Telegram actor kind (staff-updates writes it BEFORE the decision);
 *   #63 the replay table is touched only for authenticated updates, and an
 *       update whose handling failed is forgotten so Telegram's retry counts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  firstSeenUpdate: vi.fn(async (_id: unknown) => true),
  forgetUpdate: vi.fn(async (_id: unknown) => {}),
  handleApprovalCallback: vi.fn(async (_q: unknown, _deps: { audit: (e: Record<string, string>) => Promise<void> }) => 'decided'),
  handleStaffStart: vi.fn(async (_text: string, _from: unknown, _chat: string) => false),
  recordAdminAction: vi.fn(async (..._args: unknown[]) => true),
  send: vi.fn(async () => true),
}))

vi.mock('@/lib/telegram/staff-updates', () => ({
  firstSeenUpdate: m.firstSeenUpdate,
  forgetUpdate: m.forgetUpdate,
  handleApprovalCallback: m.handleApprovalCallback,
  handleStaffStart: m.handleStaffStart,
}))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: m.recordAdminAction }))
vi.mock('@/lib/telegram/bot-api', () => ({ answerCallback: vi.fn(async () => true) }))
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: m.send }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }) }) }),
}))

import { POST } from '@/app/api/telegram/webhook/route'

const SECRET = 'hook-secret'
function req(body: unknown, secret: string | null = SECRET): NextRequest {
  return new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  m.firstSeenUpdate.mockResolvedValue(true)
  m.handleStaffStart.mockResolvedValue(false)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  delete process.env.TELEGRAM_WEBHOOK_SECRET
})

describe('telegram webhook — replay table (#63)', () => {
  it('without a configured secret an unauthenticated update never writes the replay table', async () => {
    const res = await POST(req({ update_id: 777, message: { chat: { id: 5 }, text: 'привет' } }, null))
    expect(res.status).toBe(200)
    expect(m.firstSeenUpdate).not.toHaveBeenCalled()
  })

  it('with the secret, a repeated update id is ignored', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET
    m.firstSeenUpdate.mockResolvedValueOnce(false)
    const res = await POST(req({ update_id: 778, message: { chat: { id: 5 }, from: { id: 5 }, text: '/start staff_x' } }))
    expect(res.status).toBe(200)
    expect(m.firstSeenUpdate).toHaveBeenCalledWith(778)
    expect(m.handleStaffStart).not.toHaveBeenCalled()
  })

  it('a failed handling forgets the update id and answers 500 so the Telegram retry is processed', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET
    m.handleStaffStart.mockRejectedValueOnce(new Error('db down'))
    const res = await POST(req({ update_id: 779, message: { chat: { id: 5 }, from: { id: 5 }, text: '/start staff_x' } }))
    expect(res.status).toBe(500)
    expect(m.forgetUpdate).toHaveBeenCalledWith(779)
  })
})

describe('telegram webhook — approval audit (#37)', () => {
  it('passes an audit writer that is required and records the Telegram actor', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET
    const res = await POST(req({ update_id: 780, callback_query: { id: 'cb1', from: { id: 5 }, data: 'ap:x' } }))
    expect(res.status).toBe(200)
    const deps = m.handleApprovalCallback.mock.calls[0][1]
    await deps.audit({ actorId: 'staff-1', role: 'admin', approvalId: 'ap-1', decision: 'approve' })
    expect(m.recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'staff-1', kind: 'telegram', role: 'admin' }),
      expect.objectContaining({ action: 'agent.approval.decide', entityId: 'ap-1', newValue: { decision: 'approve' } }),
      expect.anything(),
      { required: true },
    )
  })
})
