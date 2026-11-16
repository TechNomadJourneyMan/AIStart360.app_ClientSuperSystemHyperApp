/**
 * R4 (решения PO 2026-11-16): клиент знает, что с его платным доступом.
 *   N4B-2  «Доступ открыт» — лента + письмо + Telegram (если чат привязан); без «Рынка»
 *          (раздел на проде только для персонала, N4B-8); одна заявка — одно уведомление;
 *   N4B-9  отказ по заявке — лента + письмо (+ Telegram) с причиной, один раз на заявку;
 *   N4B-10 окончание Pro — за 7 дней, за сутки и когда закончился: лента + письмо,
 *          идемпотентно по ключу.
 * БД, почта, Telegram и лента подменены: ничего реального не уходит.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  profiles: new Map<string, { id: string; email: string | null; fullName: string | null; telegramChatId: string | null; preferences: unknown }>(),
  keys: [] as string[],
  email: vi.fn(),
  feed: vi.fn(),
  telegram: vi.fn(),
}))

vi.mock('@/lib/notifications/store', () => ({
  getRecipient: async (id: string) => h.profiles.get(id) ?? null,
  countCapTouches: async () => 0,
  claimSend: async (input: { dedupeKey: string | null }) => {
    if (input.dedupeKey && h.keys.includes(input.dedupeKey)) return { result: 'duplicate', id: null }
    if (input.dedupeKey) h.keys.push(input.dedupeKey)
    return { result: 'claimed', id: String(h.keys.length) }
  },
  releaseSend: async () => undefined,
}))
vi.mock('@/lib/email/send', () => ({
  sendTransactionalEmail: async (input: unknown) => {
    h.email(input)
    return { ok: true }
  },
}))
vi.mock('@/lib/notifications/create', () => ({
  createNotification: async (input: unknown) => {
    h.feed(input)
    return true
  },
}))
vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: async (chatId: string, html: string) => {
    h.telegram(chatId, html)
    return true
  },
}))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => undefined }))
vi.mock('@/lib/access/recipient', () => ({ pointAClosedFor: async () => false }))

const product = await import('@/lib/notifications/product')

const feedOf = () => h.feed.mock.calls.map((c) => c[0] as { title: string; body: string; link?: string; category: string })
const mailOf = () => h.email.mock.calls.map((c) => c[0] as { to: string; subject: string; dedupeKey: string | null; content: unknown })

beforeEach(() => {
  h.profiles.clear()
  h.profiles.set('linked', { id: 'linked', email: 'owner@corp.kz', fullName: 'Иван', telegramChatId: '777', preferences: {} })
  h.profiles.set('plain', { id: 'plain', email: 'plain@corp.kz', fullName: 'Анна', telegramChatId: null, preferences: {} })
  h.keys = []
  h.email.mockReset()
  h.feed.mockReset()
  h.telegram.mockReset()
})

describe('N4B-2: «Доступ открыт» — feed, e-mail and Telegram when linked', () => {
  it('Pro opened → the feed, a letter and a Telegram message; the sections named are the open ones (no «Рынок»)', async () => {
    const r = await product.notifyPaidAccessOpened('linked', { periodEnd: '2026-12-31T23:59:59.000Z', dedupeKey: 'paid_access_opened:req-1' })
    expect(r.delivered).toEqual({ inApp: true, email: true, telegram: true })
    const feed = feedOf()[0]
    expect(feed.title).toBe('Доступ открыт')
    expect(feed.body).toContain('Точка А, Точка Б и полный GRI')
    expect(feed.body).toContain('31 декабря 2026')
    expect(feed.body).not.toContain('Рынок')
    expect(feed.category).toBe('security')
    expect(mailOf()[0]).toMatchObject({ to: 'owner@corp.kz', dedupeKey: 'paid_access_opened:req-1' })
    expect(JSON.stringify(mailOf()[0].content)).not.toContain('Рынок')
    expect(h.telegram).toHaveBeenCalledWith('777', expect.stringContaining('Доступ открыт'))
  })

  it('without a linked Telegram: feed + e-mail, no Telegram', async () => {
    const r = await product.notifyPaidAccessOpened('plain', { dedupeKey: 'paid_access_opened:req-2' })
    expect(r.delivered).toEqual({ inApp: true, email: true, telegram: false })
    expect(h.telegram).not.toHaveBeenCalled()
  })

  it('the same request twice → one notice in every channel', async () => {
    await product.notifyPaidAccessOpened('linked', { dedupeKey: 'paid_access_opened:req-1' })
    const again = await product.notifyPaidAccessOpened('linked', { dedupeKey: 'paid_access_opened:req-1' })
    expect(again.skipped).toBe('duplicate')
    expect(h.feed).toHaveBeenCalledTimes(1)
    expect(h.email).toHaveBeenCalledTimes(1)
    expect(h.telegram).toHaveBeenCalledTimes(1)
  })

  it('an extension of a paid plan says «Доступ продлён»', async () => {
    await product.notifyPaidAccessOpened('plain', { periodEnd: '2027-01-31T23:59:59.000Z', dedupeKey: 'paid_access_opened:req-3', renewed: true })
    expect(feedOf()[0].title).toBe('Доступ продлён')
    expect(feedOf()[0].body).toContain('продлил')
  })
})

describe('N4B-9: a refused request — the client learns it, with the reason', () => {
  it('feed + e-mail + Telegram; the reason and the sections; the way to «Сообщения»; once per request', async () => {
    const r = await product.notifyAccessRequestRejected('linked', { requestId: 'req-9', features: ['point_a', 'market'], reason: '  Не смогли дозвониться.\n' })
    expect(r.delivered).toEqual({ inApp: true, email: true, telegram: true })
    const feed = feedOf()[0]
    expect(feed.title).toBe('Заявка на доступ отклонена')
    expect(feed.body).toContain('(Точка А, Рынок)')
    expect(feed.body).toContain('Причина: Не смогли дозвониться.')
    expect(feed.body).not.toContain('..')
    expect(feed.body).toContain('Новую заявку можно оставить')
    expect(feed.link).toBe('/client/messages')
    expect(mailOf()[0].dedupeKey).toBe('access_request_rejected:req-9')
    await product.notifyAccessRequestRejected('linked', { requestId: 'req-9', features: ['point_a'], reason: 'x' })
    expect(h.feed).toHaveBeenCalledTimes(1)
  })

  it('no reason given → no «Причина:» line', async () => {
    await product.notifyAccessRequestRejected('plain', { requestId: 'req-10', features: [], reason: null })
    expect(feedOf()[0].body).not.toContain('Причина')
  })
})

describe('N4B-10: the end of paid access — 7 days, 1 day, ended', () => {
  const END = '2026-12-10T23:59:59.000Z'

  it('7 days before: feed + e-mail (no Telegram), the date and the way to renew; once', async () => {
    const r = await product.notifyProExpiry('linked', { stage: 'd7', endsAt: END, daysLeft: 7, dedupeKey: `pro_expiry:d7:org:${END}` })
    expect(r.delivered).toEqual({ inApp: true, email: true, telegram: false })
    const feed = feedOf()[0]
    expect(feed.title).toBe('Платный доступ заканчивается через 7 дней')
    expect(feed.body).toContain('10 декабря 2026')
    expect(feed.body).toContain('«Настройки → Биллинг»')
    expect(feed.body).not.toContain('Рынок')
    expect(feed.link).toBe('/settings?tab=billing')
    const again = await product.notifyProExpiry('linked', { stage: 'd7', endsAt: END, daysLeft: 7, dedupeKey: `pro_expiry:d7:org:${END}` })
    expect(again.skipped).toBe('duplicate')
    expect(h.email).toHaveBeenCalledTimes(1)
  })

  it('1 day before and the day it ended have their own texts (trial wording for a pilot)', () => {
    expect(product.proExpiryText({ stage: 'd1', endsAt: END }).title).toBe('Платный доступ заканчивается меньше чем через сутки')
    expect(product.proExpiryText({ stage: 'd7', endsAt: END, daysLeft: 3 }).title).toBe('Платный доступ заканчивается через 3 дня')
    const ended = product.proExpiryText({ stage: 'ended', endsAt: END, trial: true })
    expect(ended.title).toBe('Пробный доступ закончился')
    expect(ended.body).toContain('переведён на бесплатный')
  })
})
