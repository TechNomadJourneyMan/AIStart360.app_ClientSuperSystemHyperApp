/**
 * lib/comm pure rules: channel choice («Авто» and skips), conversation state
 * transitions, phone normalisation (same rule as SQL comm_phone_key), stop
 * words, the 6-hour receipt / warning window, moderation helpers, the
 * client feed shaping and the direct-message email (escaped).
 */
import { describe, expect, it } from 'vitest'
import { autoCandidates, channelAvailability, resolveCommChannels, type AvailabilityInput } from '@/lib/comm/channels'
import { isOverdue, isStopWord, previewOf, shouldSendReceipt, threadPatchOnInbound, threadPatchOnOutbound } from '@/lib/comm/state'
import { phoneE164, phoneKey, whatsappJid } from '@/lib/comm/phone'
import { assertCleanOutbound, moderateInbound, sanitizeBotReply, shouldWarnProfanity, staffVisibleBody, ProfanityError } from '@/lib/comm/moderation'
import { clientFeed } from '@/lib/comm/client'
import { deliveryReasonLabel } from '@/lib/comm/labels'
import { telegramText, whatsappText } from '@/lib/comm/format'
import { buildDirectMessageEmail } from '@/lib/email/templates'
import { renderEmail } from '@/lib/email/layout'
import type { CommMessageRow } from '@/lib/comm/types'

const ALL: AvailabilityInput = { hasEmail: true, hasTelegramChat: true, telegramBotConfigured: true, hasPhone: true, whatsappOptOut: false, whatsappTransport: true }
const NOW = new Date('2026-10-16T10:00:00.000Z')
const BASE = { status: 'open' as const, staff_reply_due_at: null, escalated_at: null, unread_staff: 0, unread_user: 0 }

describe('channel availability', () => {
  it('app is always available; each other channel names why it is not', () => {
    const a = channelAvailability({ hasEmail: false, hasTelegramChat: false, telegramBotConfigured: true, hasPhone: false, whatsappOptOut: false, whatsappTransport: true })
    expect(a.app).toEqual({ ok: true })
    expect(a.email).toEqual({ ok: false, reason: 'no_email' })
    expect(a.telegram).toEqual({ ok: false, reason: 'telegram_not_linked' })
    expect(a.whatsapp).toEqual({ ok: false, reason: 'no_phone' })
    expect(channelAvailability({ ...ALL, telegramBotConfigured: false }).telegram).toEqual({ ok: false, reason: 'telegram_not_configured' })
    expect(channelAvailability({ ...ALL, whatsappOptOut: true }).whatsapp).toEqual({ ok: false, reason: 'whatsapp_opt_out' })
    expect(channelAvailability({ ...ALL, whatsappTransport: false }).whatsapp).toEqual({ ok: false, reason: 'whatsapp_not_configured' })
  })
})

describe('resolveCommChannels', () => {
  it('explicit: every ticked channel is either sent or skipped with the reason', () => {
    const availability = channelAvailability({ ...ALL, hasTelegramChat: false, whatsappOptOut: true })
    const r = resolveCommChannels(['app', 'telegram', 'whatsapp', 'email'], { availability, prefs: null, lastInboundChannel: null })
    expect(r.send).toEqual(['app', 'email'])
    expect(r.skipped).toEqual([{ channel: 'telegram', reason: 'telegram_not_linked' }, { channel: 'whatsapp', reason: 'whatsapp_opt_out' }])
  })

  it('auto: «Эксперт» preferences (in-app + email by default) plus the channel the user last wrote from', () => {
    const availability = channelAvailability(ALL)
    expect(resolveCommChannels('auto', { availability, prefs: null, lastInboundChannel: null }).send).toEqual(['app', 'email'])
    expect(resolveCommChannels('auto', { availability, prefs: null, lastInboundChannel: 'whatsapp' }).send).toEqual(['app', 'email', 'whatsapp'])
    const prefs = { notifications: { expert: { in_app: false, email: false, telegram: true } } }
    expect(autoCandidates(prefs, null)).toEqual(['telegram'])
  })

  it('auto drops unavailable channels silently and never ends empty (falls back to the feed)', () => {
    const prefs = { notifications: { expert: { in_app: false, email: true, telegram: false } } }
    const r = resolveCommChannels('auto', { availability: channelAvailability({ ...ALL, hasEmail: false }), prefs, lastInboundChannel: null })
    expect(r).toEqual({ send: ['app'], skipped: [] })
  })

  it('auto respects the WhatsApp opt-out even when the user last wrote from WhatsApp', () => {
    const r = resolveCommChannels('auto', { availability: channelAvailability({ ...ALL, whatsappOptOut: true }), prefs: null, lastInboundChannel: 'whatsapp' })
    expect(r.send).not.toContain('whatsapp')
  })
})

describe('thread state', () => {
  it('first inbound: waiting_staff, unread + 1, deadline = now + escalation minutes, staff notified', () => {
    const { patch, startsWaiting } = threadPatchOnInbound(BASE, { body: 'Привет', at: NOW, now: NOW, escalationMinutes: 30 })
    expect(startsWaiting).toBe(true)
    expect(patch).toMatchObject({ status: 'waiting_staff', unread_staff: 1, staff_reply_due_at: '2026-10-16T10:30:00.000Z', escalated_at: null })
  })

  it('a second inbound keeps the first deadline and does not notify again', () => {
    const waiting = { ...BASE, status: 'waiting_staff' as const, staff_reply_due_at: '2026-10-16T10:30:00.000Z', escalated_at: '2026-10-16T10:31:00.000Z', unread_staff: 1 }
    const later = new Date('2026-10-16T10:20:00.000Z')
    const { patch, startsWaiting } = threadPatchOnInbound(waiting, { body: 'Алло?', at: later, now: later, escalationMinutes: 30 })
    expect(startsWaiting).toBe(false)
    expect(patch).toMatchObject({ unread_staff: 2, staff_reply_due_at: '2026-10-16T10:30:00.000Z', escalated_at: '2026-10-16T10:31:00.000Z' })
  })

  it('a staff reply resets the deadline and escalation and waits for the user', () => {
    const waiting = { ...BASE, status: 'waiting_staff' as const, staff_reply_due_at: 'x', escalated_at: 'y', unread_staff: 3 }
    expect(threadPatchOnOutbound(waiting, { authorKind: 'staff', body: 'Ответ', at: NOW })).toMatchObject({
      status: 'waiting_user', staff_reply_due_at: null, escalated_at: null, unread_staff: 0, unread_user: 1, last_outbound_at: NOW.toISOString(),
    })
  })

  it('a bot reply waits for the user but keeps the human deadline; a system notice changes neither status nor preview', () => {
    const waiting = { ...BASE, status: 'waiting_staff' as const, staff_reply_due_at: 'due' }
    const bot = threadPatchOnOutbound(waiting, { authorKind: 'bot', body: 'Я бот', at: NOW })
    expect(bot.status).toBe('waiting_user')
    expect(bot).not.toHaveProperty('staff_reply_due_at')
    const sys = threadPatchOnOutbound(waiting, { authorKind: 'system', body: 'Предупреждение', at: NOW })
    expect(sys).toEqual({ last_outbound_at: NOW.toISOString(), unread_user: 1 })
  })

  it('profanity counts; a blocked user does not start waiting', () => {
    expect(threadPatchOnInbound({ ...BASE, profanity_count: 2 }, { body: 'x', at: NOW, now: NOW, escalationMinutes: 30, profanity: true }).patch.profanity_count).toBe(3)
    const blocked = threadPatchOnInbound({ ...BASE, blocked_at: 'b' }, { body: 'x', at: NOW, now: NOW, escalationMinutes: 30, profanity: true })
    expect(blocked.startsWaiting).toBe(false)
    expect(blocked.patch).not.toHaveProperty('status')
    expect(blocked.patch).not.toHaveProperty('unread_staff')
    expect(blocked.patch.profanity_count).toBe(1)
  })

  it('overdue, preview, receipt window, stop words', () => {
    expect(isOverdue({ status: 'waiting_staff', staff_reply_due_at: '2026-10-16T09:59:00.000Z' }, NOW)).toBe(true)
    expect(isOverdue({ status: 'waiting_user', staff_reply_due_at: '2026-10-16T09:59:00.000Z' }, NOW)).toBe(false)
    expect(previewOf('a\n\n b   c')).toBe('a b c')
    expect(previewOf('x'.repeat(500))).toHaveLength(140)
    expect(shouldSendReceipt(null, NOW)).toBe(true)
    expect(shouldSendReceipt('2026-10-16T05:00:00.000Z', NOW)).toBe(false)
    expect(shouldSendReceipt('2026-10-16T03:59:00.000Z', NOW)).toBe(true)
    expect(isStopWord(' Стоп! ')).toBe(true)
    expect(isStopWord('STOP')).toBe(true)
    expect(isStopWord('не стоп')).toBe(false)
  })
})

describe('phone key (= SQL comm_phone_key)', () => {
  it.each([
    ['+7 (701) 123-45-67', '77011234567'],
    ['87011234567', '77011234567'],
    ['7011234567', '77011234567'],
    ['9161234567', '79161234567'],
    ['77011234567', '77011234567'],
    ['+44 20 7946 0958', '442079460958'],
    ['12345', null],
    ['', null],
    [null, null],
  ])('%s → %s', (raw, key) => expect(phoneKey(raw as string | null)).toBe(key))

  it('E.164 and JID', () => {
    expect(phoneE164('8 701 123 45 67')).toBe('+77011234567')
    expect(whatsappJid('8 701 123 45 67')).toBe('77011234567@s.whatsapp.net')
    expect(whatsappJid('nope')).toBeNull()
  })
})

describe('moderation', () => {
  it('inbound: original kept by the caller, masked copy and flags', () => {
    const m = moderateInbound('ну блядь когда ответ')
    expect(m.flags).toEqual({ profanity: true, words: 1 })
    expect(m.bodyMasked).toMatch(/^ну б\*+ когда ответ$/)
    expect(moderateInbound('Здравствуйте')).toEqual({ bodyMasked: null, flags: {} })
    expect(staffVisibleBody({ body: 'orig', body_masked: 'm***' })).toBe('m***')
    expect(staffVisibleBody({ body: 'orig', body_masked: null })).toBe('orig')
  })

  it('staff outbound is refused naming the field; bot replies are masked', () => {
    expect(() => assertCleanOutbound({ body: 'Добрый день', subject: 'блядь' })).toThrow(ProfanityError)
    try { assertCleanOutbound({ title: 'ок', body: 'хуй' }) } catch (e) { expect((e as ProfanityError).field).toBe('body') }
    expect(() => assertCleanOutbound({ body: 'Добрый день', subject: null })).not.toThrow()
    expect(sanitizeBotReply('это блядь бот')).not.toContain('блядь')
    expect(sanitizeBotReply('чистый текст')).toBe('чистый текст')
  })

  it('warning at most once per 6 h', () => {
    expect(shouldWarnProfanity(null, NOW)).toBe(true)
    expect(shouldWarnProfanity('2026-10-16T08:00:00.000Z', NOW)).toBe(false)
    expect(shouldWarnProfanity('2026-10-16T03:00:00.000Z', NOW)).toBe(true)
  })
})

describe('formatting and labels', () => {
  it('Telegram text escapes the author text; WhatsApp is plain with a signature', () => {
    const tg = telegramText({ body: '<b>x</b> & y', authorKind: 'staff', authorName: 'Анна' })
    expect(tg).toContain('&lt;b&gt;x&lt;/b&gt; &amp; y')
    expect(tg).toContain('Анна, AIStart360')
    expect(whatsappText({ body: 'Привет', authorKind: 'bot' })).toBe('Привет\n\n— Бот AIStart360')
  })

  it('reason codes read as Russian', () => {
    expect(deliveryReasonLabel('telegram_not_linked')).toBe('Telegram не привязан')
    expect(deliveryReasonLabel('whatsapp_pull_needs_recent_reply')).toMatch(/24 ч/)
    expect(deliveryReasonLabel(null)).toBeNull()
  })
})

describe('direct message email', () => {
  it('free text in the brand layout, user text escaped, CTA to the cabinet', () => {
    const built = buildDirectMessageEmail({ name: 'Иван', authorName: 'Анна <script>', subject: 'Про отчёт', body: 'Смотрите <img src=x onerror=alert(1)>\nвторая строка', url: 'https://aistart360.app/client/messages' })
    expect(built.subject).toBe('Про отчёт')
    const { html, text } = renderEmail(built.content)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;<br />вторая строка')
    expect(html).not.toContain('Анна <script>')
    expect(html).toContain('https://aistart360.app/client/messages')
    expect(text).toContain('Ответить в кабинете: https://aistart360.app/client/messages')
    expect(buildDirectMessageEmail({ body: 'x' }).subject).toBe('Новое сообщение от AIStart360')
  })
})

describe('client feed', () => {
  const row = (p: Partial<CommMessageRow>): CommMessageRow => ({
    id: 'm', thread_id: 't', group_id: 'g', direction: 'out', channel: 'app', author_kind: 'staff', author_id: 's', author_name: 'Анна',
    body: 'Текст', body_masked: null, flags: {}, subject: null, campaign_id: null, status: 'sent', error: 'internal', external_id: 'ext',
    reply_to_id: null, metadata: { secret: 1 }, created_at: '2026-10-16T10:00:00.000Z', sent_at: null, ...p,
  })

  it('one bubble per send with the channels that reached the user; nothing staff-only leaks', () => {
    const feed = clientFeed([
      row({ id: 'a', channel: 'app', status: 'delivered' }),
      row({ id: 'b', channel: 'telegram', status: 'sent' }),
      row({ id: 'c', channel: 'whatsapp', status: 'skipped' }),
      row({ id: 'd', group_id: 'g2', channel: 'email', status: 'failed', created_at: '2026-10-16T10:05:00.000Z' }),
      row({ id: 'e', group_id: 'g3', direction: 'in', author_kind: 'user', channel: 'telegram', body: 'ну блядь', body_masked: 'ну б****', flags: { profanity: true }, status: 'delivered', created_at: '2026-10-16T10:06:00.000Z' }),
    ])
    expect(feed).toHaveLength(2)
    expect(feed[0]).toEqual({ id: 'a', direction: 'out', authorKind: 'staff', authorName: 'Анна', body: 'Текст', subject: null, channels: ['app', 'telegram'], createdAt: '2026-10-16T10:00:00.000Z' })
    // The user sees his own text as written.
    expect(feed[1]).toMatchObject({ direction: 'in', body: 'ну блядь', authorName: null })
    expect(JSON.stringify(feed)).not.toMatch(/internal|secret|ext|б\*\*\*\*/)
  })
})
