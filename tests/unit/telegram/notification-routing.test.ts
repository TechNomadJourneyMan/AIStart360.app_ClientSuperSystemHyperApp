/**
 * Which bot carries what: staff notifications, approval cards and the staff
 * link go to the admin bot once it is configured (token + webhook secret) and
 * stay on the client bot before that; approval buttons signed before the
 * switch keep working; the expert bot stays silent until configured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordingFetch } from './_bot-harness'

const db = vi.hoisted(() => ({ executeRaw: vi.fn(async () => 1), queryRaw: vi.fn(async () => { throw new Error('no database in this test') }) }))
vi.mock('@/lib/db', () => ({ prisma: { $executeRaw: db.executeRaw, $queryRaw: db.queryRaw } }))

const { staffBot, staffBotReady, isBotConfigured } = await import('@/lib/telegram/bots/registry')
const { sendBotMessage } = await import('@/lib/telegram/bot-api')
const { createStaffLinkCode } = await import('@/lib/telegram/staff-link')
const { approvalCallbackData, parseApprovalCallback } = await import('@/lib/notifications/approval-callback')
const { notifyExperts } = await import('@/lib/telegram/bots/expert/notify')

const ENV = [
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET',
  'TELEGRAM_ADMIN_BOT_TOKEN', 'TELEGRAM_ADMIN_BOT_USERNAME', 'TELEGRAM_ADMIN_WEBHOOK_SECRET',
  'TELEGRAM_EXPERT_BOT_TOKEN', 'TELEGRAM_EXPERT_WEBHOOK_SECRET', 'TELEGRAM_CALLBACK_SECRET',
]
const saved: Record<string, string | undefined> = {}
const APPROVAL = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'

describe('notification routing between bots', () => {
  beforeEach(() => {
    for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] }
    process.env.TELEGRAM_BOT_TOKEN = 'client-token'
    process.env.TELEGRAM_BOT_USERNAME = 'aist360clientbot'
    process.env.TELEGRAM_WEBHOOK_SECRET = 'client-secret'
  })
  afterEach(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  })

  it('staff traffic stays on the client bot until the admin bot has a token AND a secret', async () => {
    expect(staffBot()).toBe('client')
    process.env.TELEGRAM_ADMIN_BOT_TOKEN = 'admin-token'
    expect(staffBot()).toBe('client') // no secret yet: its webhook would fail closed
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    expect(staffBot()).toBe('admin')
    expect(staffBotReady()).toBe(true)

    const tg = recordingFetch()
    await sendBotMessage('42', 'x', undefined, tg.fetchImpl)
    await sendBotMessage('42', 'x', undefined, tg.fetchImpl, staffBot())
    expect(tg.calls.map((c) => c.url)).toEqual([
      'https://api.telegram.org/botclient-token/sendMessage',
      'https://api.telegram.org/botadmin-token/sendMessage',
    ])
  })

  it('the GIGA staff link points at the admin bot once configured', async () => {
    expect((await createStaffLinkCode('b0b0b0b0-0000-4000-8000-000000000001')).deepLink).toMatch(/^https:\/\/t\.me\/aist360clientbot\?start=staff_/)
    process.env.TELEGRAM_ADMIN_BOT_TOKEN = 'admin-token'
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    process.env.TELEGRAM_ADMIN_BOT_USERNAME = '@Command_panel_aistart360_bot'
    expect((await createStaffLinkCode('b0b0b0b0-0000-4000-8000-000000000001')).deepLink).toMatch(/^https:\/\/t\.me\/Command_panel_aistart360_bot\?start=staff_/)
  })

  it('approval buttons signed before the admin bot existed are still accepted after the switch', () => {
    const before = approvalCallbackData(APPROVAL, 'approve')!
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    const after = approvalCallbackData(APPROVAL, 'reject')!
    expect(parseApprovalCallback(before)).toEqual({ approvalId: APPROVAL, action: 'approve' })
    expect(parseApprovalCallback(after)).toEqual({ approvalId: APPROVAL, action: 'reject' })
    // Flipping the action invalidates the signature.
    expect(parseApprovalCallback(after.replace(':r:', ':a:'))).toBeNull()
  })

  it('the expert bot sends nothing and reads nothing until it is configured', async () => {
    expect(isBotConfigured('expert')).toBe(false)
    const tg = recordingFetch()
    expect(await notifyExperts({ kind: 'diagnostic.completed', dedupeKey: 'event:1', lines: ['x'] }, { fetchImpl: tg.fetchImpl })).toEqual([])
    expect(db.queryRaw).not.toHaveBeenCalled()
    expect(tg.calls).toHaveLength(0)
  })
})
