/**
 * lib/comm sendToUser / recordInbound / Telegram and WhatsApp inbound routing
 * against an in-memory database (no network, no real Supabase).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/settings/store', () => ({
  getSetting: vi.fn(async (k: string) => (k === 'comm_escalation_minutes' ? 30 : k === 'comm_bot_auto_default' ? false : null)),
}))
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: vi.fn(async () => ({ eventId: 'e', duplicate: false, deliveries: [] })) }))
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: vi.fn(async () => true) }))

import { sendToUser } from '@/lib/comm/send'
import { handleTelegramInbound, mirrorWhatsAppInbound, notifyStaffOfInbound, recordInbound, type InboundNotice } from '@/lib/comm/inbound'
import { CommError } from '@/lib/comm/store'
import { ProfanityError, PROFANITY_WARNING } from '@/lib/comm/moderation'
import { TELEGRAM_RECEIPT_TEXT } from '@/lib/comm/format'
import { notifyStaff } from '@/lib/notifications/staff'
import { commDb, fakeTransports, type Row } from './_db'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const STAFF = '33333333-3333-4333-8333-333333333333'
const NOW = new Date('2026-10-16T10:00:00.000Z')

function profile(p: Partial<Row> = {}): Row {
  return { id: USER, full_name: 'Иван Петров', email: 'ivan@example.com', phone: '+7 701 123 45 67', telegram_chat_id: '555', preferences: null, ...p }
}

function deps() {
  const notices: InboundNotice[] = []
  const warnings: Array<{ userId: string; channel: string; text: string }> = []
  const receipts: Array<[string, string]> = []
  return {
    notices, warnings, receipts,
    d: {
      now: NOW,
      escalationMinutes: 30,
      notify: async (n: InboundNotice) => { notices.push(n) },
      warn: async (w: { userId: string; channel: 'app' | 'email' | 'telegram' | 'whatsapp'; text: string }) => { warnings.push(w) },
      sendReceipt: async (chatId: string, text: string) => { receipts.push([chatId, text]); return true },
    },
  }
}

beforeEach(() => vi.clearAllMocks())

describe('sendToUser', () => {
  it('creates the thread, one row per channel (skipped with reason), delivers and waits for the user', async () => {
    const { sb, db } = commDb({ profiles: [profile({ telegram_chat_id: null })], companies: [{ id: 'c1', user_id: USER }] })
    const t = fakeTransports()
    const res = await sendToUser({ userId: USER, channels: ['app', 'email', 'telegram'], body: '  Добрый день!  ', authorKind: 'staff', authorId: STAFF, authorName: 'Анна' }, { sb, transports: t.transports, now: NOW })

    expect(res.ok).toBe(true)
    expect(res.messages.map((m) => [m.channel, m.status, m.error])).toEqual([
      ['app', 'delivered', null], ['email', 'sent', null], ['telegram', 'skipped', 'telegram_not_linked'],
    ])
    expect(t.sent.map((s) => s.channel)).toEqual(['app', 'email'])
    expect(db.comm_threads).toHaveLength(1)
    expect(db.comm_threads[0]).toMatchObject({ user_id: USER, company_id: 'c1', status: 'waiting_user', last_message_preview: 'Добрый день!' })
    expect(new Set(db.comm_messages.map((m) => m.group_id)).size).toBe(1)
    expect(db.comm_messages.every((m) => m.direction === 'out' && m.author_kind === 'staff' && m.body === 'Добрый день!')).toBe(true)
    const email = t.sent.find((s) => s.channel === 'email')!.input
    expect(email).toMatchObject({ to: 'ivan@example.com', subject: 'Новое сообщение от AIStart360' })
  })

  it('WhatsApp goes to the E.164 JID; an opt-out on the thread skips it', async () => {
    const { sb, db } = commDb({ profiles: [profile({ phone: '8 701 123 45 67' })] })
    const t = fakeTransports()
    await sendToUser({ userId: USER, channels: ['whatsapp'], body: 'Привет', authorKind: 'staff', authorName: 'Анна' }, { sb, transports: t.transports, now: NOW })
    expect(t.sent[0].input).toMatchObject({ jid: '77011234567@s.whatsapp.net', text: 'Привет\n\n— Анна, AIStart360' })

    db.comm_threads[0].whatsapp_opt_out_at = NOW.toISOString()
    const res = await sendToUser({ userId: USER, channels: ['whatsapp'], body: 'Ещё', authorKind: 'staff' }, { sb, transports: t.transports, now: NOW })
    expect(res.messages[0]).toMatchObject({ status: 'skipped', error: 'whatsapp_opt_out' })
    expect(res.ok).toBe(false)
  })

  it('auto picks preferences + the channel the user last wrote from', async () => {
    const { sb, db } = commDb({ profiles: [profile()] })
    const t = fakeTransports()
    await recordInbound({ userId: USER, channel: 'telegram', body: 'Вопрос' }, { sb, now: NOW, escalationMinutes: 30, notify: async () => {} })
    expect(db.comm_threads[0].last_inbound_at).toBeTruthy()
    const res = await sendToUser({ userId: USER, channels: 'auto', body: 'Ответ', authorKind: 'staff' }, { sb, transports: t.transports, now: NOW })
    expect(res.messages.map((m) => m.channel).sort()).toEqual(['app', 'email', 'telegram'])
    expect(db.comm_threads[0]).toMatchObject({ status: 'waiting_user', staff_reply_due_at: null, unread_staff: 0 })
  })

  it('nothing delivered → the conversation state stays as it was', async () => {
    const { sb, db } = commDb({ profiles: [profile()] })
    await recordInbound({ userId: USER, channel: 'app', body: 'Вопрос' }, { sb, now: NOW, escalationMinutes: 30, notify: async () => {} })
    const t = fakeTransports({ fail: ['email'] })
    const res = await sendToUser({ userId: USER, channels: ['email'], body: 'Ответ', authorKind: 'staff' }, { sb, transports: t.transports, now: NOW })
    expect(res.ok).toBe(false)
    expect(db.comm_threads[0].status).toBe('waiting_staff')
    expect(db.comm_messages.find((m) => m.direction === 'out')).toMatchObject({ status: 'failed', error: 'email_down' })
  })

  it('refuses empty text, no channels, an unknown user, staff profanity and a blocked user', async () => {
    const { sb, db } = commDb({ profiles: [profile()] })
    const t = fakeTransports()
    await expect(sendToUser({ userId: USER, channels: ['app'], body: '   ', authorKind: 'staff' }, { sb, transports: t.transports })).rejects.toThrow(CommError)
    await expect(sendToUser({ userId: USER, channels: [], body: 'x', authorKind: 'staff' }, { sb, transports: t.transports })).rejects.toThrow('канал')
    await expect(sendToUser({ userId: OTHER, channels: ['app'], body: 'x', authorKind: 'staff' }, { sb, transports: t.transports })).rejects.toMatchObject({ code: 'not_found' })
    await expect(sendToUser({ userId: USER, channels: ['app'], body: 'ну ты блядь', authorKind: 'staff' }, { sb, transports: t.transports })).rejects.toBeInstanceOf(ProfanityError)
    await expect(sendToUser({ userId: USER, channels: ['app'], body: 'ok', subject: 'хуй', authorKind: 'staff' }, { sb, transports: t.transports })).rejects.toMatchObject({ field: 'subject' })
    expect(t.sent).toHaveLength(0)

    await sendToUser({ userId: USER, channels: ['app'], body: 'ok', authorKind: 'staff' }, { sb, transports: t.transports })
    db.comm_threads[0].blocked_at = NOW.toISOString()
    await expect(sendToUser({ userId: USER, channels: ['app'], body: 'ok', authorKind: 'staff' }, { sb, transports: t.transports })).rejects.toMatchObject({ code: 'blocked' })
  })

  it('a bot reply is masked, never refused', async () => {
    const { sb, db } = commDb({ profiles: [profile()] })
    const t = fakeTransports()
    await sendToUser({ userId: USER, channels: ['app'], body: 'это блядь ответ', authorKind: 'bot' }, { sb, transports: t.transports })
    expect(db.comm_messages[0].body).not.toContain('блядь')
  })
})

describe('recordInbound', () => {
  it('waiting_staff + unread + deadline; staff notified once per unanswered stretch', async () => {
    const { sb, db } = commDb({ profiles: [profile()] })
    const x = deps()
    const first = await recordInbound({ userId: USER, channel: 'app', body: 'Здравствуйте' }, { ...x.d, sb })
    expect(first.startsWaiting).toBe(true)
    expect(db.comm_threads[0]).toMatchObject({ status: 'waiting_staff', unread_staff: 1, staff_reply_due_at: '2026-10-16T10:30:00.000Z' })
    expect(db.comm_messages[0]).toMatchObject({ direction: 'in', author_kind: 'user', author_id: USER, status: 'delivered', body_masked: null, flags: {} })
    await recordInbound({ userId: USER, channel: 'app', body: 'Ау' }, { ...x.d, sb })
    expect(db.comm_threads[0].unread_staff).toBe(2)
    expect(x.notices).toHaveLength(1)
    expect(x.notices[0].userName).toBe('Иван Петров')
  })

  it('a redelivered message (same channel + external id) is a duplicate and notifies nobody', async () => {
    const { sb, db } = commDb({ profiles: [profile()] })
    const x = deps()
    await recordInbound({ userId: USER, channel: 'telegram', body: 'a', externalId: 'tg:555:1' }, { ...x.d, sb })
    const again = await recordInbound({ userId: USER, channel: 'telegram', body: 'a', externalId: 'tg:555:1' }, { ...x.d, sb })
    expect(again.duplicate).toBe(true)
    expect(db.comm_messages).toHaveLength(1)
    expect(x.notices).toHaveLength(1)
  })

  it('profanity: original stored, masked copy + flags, count + 1, warning once per 6 h on the same channel', async () => {
    const { sb, db } = commDb({ profiles: [profile()] })
    const x = deps()
    const r1 = await recordInbound({ userId: USER, channel: 'whatsapp', body: 'где ответ блядь' }, { ...x.d, sb })
    expect(r1.warned).toBe(true)
    expect(db.comm_messages[0]).toMatchObject({ body: 'где ответ блядь', flags: { profanity: true, words: 1 } })
    expect(db.comm_messages[0].body_masked).toMatch(/^где ответ б\*+$/)
    expect(db.comm_threads[0]).toMatchObject({ profanity_count: 1, profanity_warned_at: NOW.toISOString() })
    expect(db.comm_threads[0].last_message_preview).not.toContain('блядь')
    expect(x.warnings).toEqual([{ userId: USER, channel: 'whatsapp', text: PROFANITY_WARNING }])

    const r2 = await recordInbound({ userId: USER, channel: 'whatsapp', body: 'хуй' }, { ...x.d, sb, now: new Date('2026-10-16T12:00:00.000Z') })
    expect(r2.warned).toBe(false)
    expect(db.comm_threads[0].profanity_count).toBe(2)
    await recordInbound({ userId: USER, channel: 'app', body: 'хуй' }, { ...x.d, sb, now: new Date('2026-10-16T16:30:00.000Z') })
    expect(x.warnings).toHaveLength(2)
    expect(x.warnings[1].channel).toBe('app')
  })

  it('a blocked user: stored, but no staff notification, no warning', async () => {
    const { sb, db } = commDb({ profiles: [profile()] })
    const x = deps()
    await recordInbound({ userId: USER, channel: 'app', body: 'Привет' }, { ...x.d, sb })
    db.comm_threads[0].status = 'waiting_user'
    db.comm_threads[0].staff_reply_due_at = null
    db.comm_threads[0].blocked_at = NOW.toISOString()
    const r = await recordInbound({ userId: USER, channel: 'app', body: 'блядь' }, { ...x.d, sb })
    expect(r.startsWaiting).toBe(false)
    expect(r.warned).toBe(false)
    expect(db.comm_messages).toHaveLength(2)
    expect(db.comm_threads[0].status).toBe('waiting_user')
    expect(x.notices).toHaveLength(1)
    expect(x.warnings).toHaveLength(0)
  })

  it('the staff notification goes to the assignee, otherwise to inbox.manage, without cooldown, with masked text', async () => {
    const thread = { id: 't1', user_id: USER, company_id: null, assignee_id: STAFF, staff_reply_due_at: '2026-10-16T10:30:00.000Z' } as never
    const message = { id: 'm1', channel: 'telegram', body: 'хуй', body_masked: 'х**', flags: { profanity: true } } as never
    await notifyStaffOfInbound({ thread, message, userName: 'Иван' })
    const n = vi.mocked(notifyStaff).mock.calls[0][0]
    expect(n).toMatchObject({ level: 'WARNING', type: 'comm.inbound', audienceUserIds: [STAFF], audiencePermission: 'inbox.view', skipCooldown: true, link: `/admin-giga-panel/messages?user=${USER}`, dedupeKey: 'comm.inbound:m1' })
    expect(n.lines?.join(' ')).toContain('х**')
    expect(n.lines?.join(' ')).not.toContain('хуй')
    await notifyStaffOfInbound({ thread: { ...(thread as object), assignee_id: null } as never, message, userName: 'Иван' })
    expect(vi.mocked(notifyStaff).mock.calls[1][0]).toMatchObject({ audienceUserIds: null, audiencePermission: 'inbox.manage' })
  })
})

describe('Telegram inbound routing', () => {
  it('a linked chat → inbound telegram message in that user\'s thread + receipt once per 6 h', async () => {
    const { sb, db } = commDb({ profiles: [profile(), profile({ id: OTHER, telegram_chat_id: '999' })] })
    const x = deps()
    expect(await handleTelegramInbound({ chatId: '555', text: 'Когда будет отчёт?', messageId: 10, date: NOW.getTime() / 1000 }, { ...x.d, sb })).toBe(true)
    expect(db.comm_threads.map((t) => t.user_id)).toEqual([USER])
    expect(db.comm_messages[0]).toMatchObject({ channel: 'telegram', direction: 'in', external_id: 'tg:555:10', body: 'Когда будет отчёт?' })
    expect(x.receipts).toEqual([['555', TELEGRAM_RECEIPT_TEXT]])
    await handleTelegramInbound({ chatId: '555', text: 'И ещё', messageId: 11 }, { ...x.d, sb, now: new Date('2026-10-16T11:00:00.000Z') })
    expect(x.receipts).toHaveLength(1)
    await handleTelegramInbound({ chatId: '555', text: 'Утро', messageId: 12 }, { ...x.d, sb, now: new Date('2026-10-16T17:00:00.000Z') })
    expect(x.receipts).toHaveLength(2)
  })

  it('an unlinked chat and commands are ignored without writing anything', async () => {
    const { sb, db, writes } = commDb({ profiles: [profile()] })
    const x = deps()
    expect(await handleTelegramInbound({ chatId: '777', text: 'Привет', messageId: 1 }, { ...x.d, sb })).toBe(false)
    expect(await handleTelegramInbound({ chatId: '555', text: '/help', messageId: 2 }, { ...x.d, sb })).toBe(false)
    expect(db.comm_messages).toHaveLength(0)
    expect(writes).toHaveLength(0)
    expect(x.receipts).toHaveLength(0)
  })

  it('profanity in Telegram: the warning replaces the receipt', async () => {
    const { sb } = commDb({ profiles: [profile()] })
    const x = deps()
    await handleTelegramInbound({ chatId: '555', text: 'блядь где отчёт', messageId: 3 }, { ...x.d, sb })
    expect(x.warnings).toEqual([{ userId: USER, channel: 'telegram', text: PROFANITY_WARNING }])
    expect(x.receipts).toHaveLength(0)
  })
})

describe('WhatsApp mirror', () => {
  const base = {
    text: 'Добрый день', messageType: 'text', externalMessageId: 'waweb:primary:M1', occurredAt: '2026-10-16T09:59:00.000Z', live: true,
    bridgeSessionId: 'primary', jid: '77011234567@s.whatsapp.net', omnichannelConversationId: 'conv-1', omnichannelMessageId: 'om-1',
  }

  it('matches the sender phone to profiles.phone through one normalised lookup', async () => {
    const { sb, db, rpcCalls } = commDb({ profiles: [profile({ phone: '8 (701) 123-45-67' })] })
    const x = deps()
    expect(await mirrorWhatsAppInbound({ ...base, phone: '77011234567' }, { ...x.d, sb })).toBe('recorded')
    expect(rpcCalls).toEqual([{ fn: 'comm_user_by_phone', args: { p_key: '77011234567' } }])
    expect(db.comm_messages[0]).toMatchObject({
      channel: 'whatsapp', external_id: 'waweb:primary:M1', created_at: '2026-10-16T09:59:00.000Z',
      metadata: { omnichannelConversationId: 'conv-1', omnichannelMessageId: 'om-1', bridgeSessionId: 'primary', jid: base.jid },
    })
    expect(await mirrorWhatsAppInbound({ ...base, phone: '77011234567' }, { ...x.d, sb })).toBe('duplicate')
  })

  it('no phone, unknown number and reactions touch no conversation', async () => {
    const { sb, db, rpcCalls } = commDb({ profiles: [profile()] })
    const x = deps()
    expect(await mirrorWhatsAppInbound({ ...base, phone: null }, { ...x.d, sb })).toBe('no_phone')
    expect(rpcCalls).toHaveLength(0)
    expect(await mirrorWhatsAppInbound({ ...base, phone: '79990000000' }, { ...x.d, sb })).toBe('no_user')
    expect(await mirrorWhatsAppInbound({ ...base, phone: '77011234567', messageType: 'reaction' }, { ...x.d, sb })).toBe('ignored')
    expect(db.comm_messages).toHaveLength(0)
  })

  it('media gets a label; «стоп» opts the user out of WhatsApp', async () => {
    const { sb, db } = commDb({ profiles: [profile()] })
    const x = deps()
    await mirrorWhatsAppInbound({ ...base, phone: '77011234567', text: null, messageType: 'image' }, { ...x.d, sb })
    expect(db.comm_messages[0].body).toBe('[фото]')
    await mirrorWhatsAppInbound({ ...base, phone: '77011234567', text: 'Стоп', externalMessageId: 'waweb:primary:M2' }, { ...x.d, sb })
    expect(db.comm_threads[0].whatsapp_opt_out_at).toBe(NOW.toISOString())
  })
})
