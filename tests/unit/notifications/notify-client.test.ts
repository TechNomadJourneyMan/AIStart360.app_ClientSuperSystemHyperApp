/**
 * notifyClient — единая точка клиентских уведомлений (F-056).
 * БД, почта, Telegram и лента подменены: ничего реального не уходит.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  profiles: new Map<string, { id: string; email: string | null; fullName: string | null; telegramChatId: string | null; preferences: unknown }>(),
  sends: [] as Array<{ id: string; userId: string | null; kind: string; dedupeKey: string | null; countsTowardCap: boolean; sentAt: number }>,
  settings: { auto_reminders_enabled: true, auto_touch_weekly_cap: 2 } as Record<string, unknown>,
  journalDown: false,
  email: vi.fn(),
  feed: vi.fn(),
  telegram: vi.fn(),
}))

vi.mock('@/lib/notifications/store', () => ({
  getRecipient: async (id: string) => h.profiles.get(id) ?? null,
  countCapTouches: async (userId: string, sinceIso: string) => {
    if (h.journalDown) return null
    const since = new Date(sinceIso).getTime()
    return h.sends.filter((s) => s.userId === userId && s.countsTowardCap && s.sentAt >= since).length
  },
  claimSend: async (input: { userId: string | null; kind: string; dedupeKey: string | null; countsTowardCap: boolean }) => {
    if (h.journalDown) return { result: 'unavailable', id: null }
    if (input.dedupeKey && h.sends.some((s) => s.dedupeKey === input.dedupeKey)) return { result: 'duplicate', id: null }
    const id = `s${h.sends.length + 1}`
    h.sends.push({ id, ...input, sentAt: Date.now() })
    return { result: 'claimed', id }
  },
  releaseSend: async (id: string) => {
    h.sends = h.sends.filter((s) => s.id !== id)
  },
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
vi.mock('@/lib/settings/store', () => ({
  getSetting: async (key: string) => h.settings[key],
}))

const { notifyClient } = await import('@/lib/notifications/notify')

const base = { userId: 'u1', event: 'gri_completed', title: 'GRI пройден', body: 'Результат в кабинете.', ctaUrl: '/gri' }

beforeEach(() => {
  h.profiles.clear()
  h.profiles.set('u1', { id: 'u1', email: 'owner@example.com', fullName: 'Иван', telegramChatId: null, preferences: {} })
  h.sends = []
  h.settings = { auto_reminders_enabled: true, auto_touch_weekly_cap: 2 }
  h.journalDown = false
  h.email.mockReset()
  h.feed.mockReset()
  h.telegram.mockReset()
})

describe('notifyClient — preferences', () => {
  it('defaults: gri → лента + email, без Telegram', async () => {
    const res = await notifyClient({ ...base, category: 'gri' })
    expect(res.ok).toBe(true)
    expect(h.feed).toHaveBeenCalledTimes(1)
    expect(h.email).toHaveBeenCalledTimes(1)
    expect(h.telegram).not.toHaveBeenCalled()
    const feed = h.feed.mock.calls[0][0] as { category: string; link: string }
    expect(feed).toMatchObject({ category: 'gri', link: '/gri' })
  })

  it('reports: по умолчанию только лента', async () => {
    await notifyClient({ ...base, category: 'reports', event: 'point_a_recalculated' })
    expect(h.feed).toHaveBeenCalledTimes(1)
    expect((h.feed.mock.calls[0][0] as { category: string }).category).toBe('report')
    expect(h.email).not.toHaveBeenCalled()
  })

  it('выключенный email в категории → письма нет, лента есть', async () => {
    h.profiles.get('u1')!.preferences = { notifications: { gri: { email: false } } }
    await notifyClient({ ...base, category: 'gri' })
    expect(h.email).not.toHaveBeenCalled()
    expect(h.feed).toHaveBeenCalledTimes(1)
  })

  it('все каналы выключены → skipped: disabled, ничего не бронирует', async () => {
    h.profiles.get('u1')!.preferences = { notifications: { expert: { in_app: false, email: false } } }
    const res = await notifyClient({ ...base, category: 'expert', dedupeKey: 'k1' })
    expect(res.skipped).toBe('disabled')
    expect(h.sends).toHaveLength(0)
    expect(h.feed).not.toHaveBeenCalled()
  })

  it('security нельзя выключить', async () => {
    h.profiles.get('u1')!.preferences = { notifications: { security: { in_app: false, email: false } } }
    await notifyClient({ ...base, category: 'security', event: 'access_granted' })
    expect(h.feed).toHaveBeenCalledTimes(1)
    expect(h.email).toHaveBeenCalledTimes(1)
  })

  it('Telegram — только если чат привязан И канал включён в категории', async () => {
    h.profiles.get('u1')!.telegramChatId = '123'
    await notifyClient({ ...base, category: 'gri' })
    expect(h.telegram).not.toHaveBeenCalled() // по умолчанию выключен

    h.profiles.get('u1')!.preferences = { notifications: { gri: { telegram: true } } }
    await notifyClient({ ...base, category: 'gri' })
    expect(h.telegram).toHaveBeenCalledTimes(1)
    expect(h.telegram.mock.calls[0][0]).toBe('123')

    h.profiles.get('u1')!.telegramChatId = null
    h.telegram.mockReset()
    await notifyClient({ ...base, category: 'gri' })
    expect(h.telegram).not.toHaveBeenCalled()
  })

  it('channels override: inApp:false выключает ленту', async () => {
    await notifyClient({ ...base, category: 'gri', channels: { inApp: false } })
    expect(h.feed).not.toHaveBeenCalled()
    expect(h.email).toHaveBeenCalledTimes(1)
  })
})

describe('notifyClient — идемпотентность', () => {
  it('тот же dedupeKey второй раз ничего не шлёт; ключ уходит и в email_deliveries', async () => {
    const first = await notifyClient({ ...base, category: 'gri', dedupeKey: 'gri_completed:a1' })
    const second = await notifyClient({ ...base, category: 'gri', dedupeKey: 'gri_completed:a1' })
    expect(first.ok).toBe(true)
    expect(second.skipped).toBe('duplicate')
    expect(h.email).toHaveBeenCalledTimes(1)
    expect(h.feed).toHaveBeenCalledTimes(1)
    expect(h.email.mock.calls[0][0]).toMatchObject({ dedupeKey: 'gri_completed:a1', to: 'owner@example.com', kind: 'client_notification' })
  })

  it('событие продукта уходит и без журнала (лучше лишнее, чем потерянное)', async () => {
    h.journalDown = true
    const res = await notifyClient({ ...base, category: 'gri', dedupeKey: 'gri_completed:a2' })
    expect(res.ok).toBe(true)
    expect(h.email).toHaveBeenCalledTimes(1)
  })
})

describe('notifyClient — автоматические касания', () => {
  const auto = { ...base, category: 'reminders' as const, event: 'survey_reminder', automated: { kind: 'survey_reminder' } }

  it('недельный потолок: третье касание за 7 дней не уходит', async () => {
    const a = await notifyClient({ ...auto, dedupeKey: 'r1' })
    const b = await notifyClient({ ...auto, dedupeKey: 'r2' })
    const c = await notifyClient({ ...auto, dedupeKey: 'r3' })
    expect([a.ok, b.ok]).toEqual([true, true])
    expect(c.skipped).toBe('capped')
    expect(h.email).toHaveBeenCalledTimes(2)
    // Письмо напоминания — вид reminder.
    expect((h.email.mock.calls[0][0] as { kind: string }).kind).toBe('reminder')
  })

  it('касание вне лимита (дайджест) не тратит потолок и не блокируется им', async () => {
    await notifyClient({ ...auto, dedupeKey: 'r1' })
    await notifyClient({ ...auto, dedupeKey: 'r2' })
    const digest = await notifyClient({
      ...base, category: 'digest', event: 'client_digest', dedupeKey: 'client_digest:u1:2026-09-21',
      automated: { kind: 'client_digest', countsTowardCap: false },
    })
    expect(digest.ok).toBe(true)
    expect(h.sends.filter((s) => s.countsTowardCap)).toHaveLength(2)
  })

  it('выключатель auto_reminders_enabled останавливает напоминания', async () => {
    h.settings.auto_reminders_enabled = false
    const res = await notifyClient({ ...auto, dedupeKey: 'r1' })
    expect(res.skipped).toBe('automation_off')
    expect(h.email).not.toHaveBeenCalled()
  })

  it('без журнала автоматика не шлёт (иначе cron повторял бы касание каждый день)', async () => {
    h.journalDown = true
    const res = await notifyClient({ ...auto, dedupeKey: 'r1' })
    expect(res.ok).toBe(false)
    expect(h.email).not.toHaveBeenCalled()
    expect(h.feed).not.toHaveBeenCalled()
  })

  it('клиент выключил «Напоминания» → касание не тратит потолок', async () => {
    h.profiles.get('u1')!.preferences = { notifications: { reminders: { in_app: false, email: false } } }
    const res = await notifyClient({ ...auto, dedupeKey: 'r1' })
    expect(res.skipped).toBe('disabled')
    expect(h.sends).toHaveLength(0)
  })
})
