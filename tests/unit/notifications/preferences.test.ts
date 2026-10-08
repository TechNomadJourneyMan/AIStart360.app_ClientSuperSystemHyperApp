import { describe, expect, it } from 'vitest'
import { categoryPrefs, NOTIFY_CATEGORY_UI, NOTIFY_DEFAULTS, resolveChannels } from '@/lib/notifications/preferences'

describe('notification preferences', () => {
  it('экран настроек показывает ровно те категории, что читает notifyClient', () => {
    expect(NOTIFY_CATEGORY_UI.map((c) => c.key).sort()).toEqual(Object.keys(NOTIFY_DEFAULTS).sort())
  })

  it('значения по умолчанию: email включён для gri/expert/reminders/digest, reports — только лента', () => {
    for (const c of ['gri', 'expert', 'reminders', 'digest'] as const) expect(NOTIFY_DEFAULTS[c].email).toBe(true)
    expect(NOTIFY_DEFAULTS.reports).toEqual({ in_app: true, email: false, telegram: false })
  })

  it('сохранённое значение побеждает умолчание; мусор игнорируется', () => {
    expect(categoryPrefs({ notifications: { gri: { email: false } } }, 'gri')).toEqual({ in_app: true, email: false, telegram: false })
    expect(categoryPrefs({ notifications: { gri: { email: 'yes' } } }, 'gri').email).toBe(true)
    expect(categoryPrefs('junk', 'digest')).toEqual(NOTIFY_DEFAULTS.digest)
  })

  it('security не выключается', () => {
    expect(categoryPrefs({ notifications: { security: { in_app: false, email: false } } }, 'security')).toEqual(NOTIFY_DEFAULTS.security)
  })

  it('канал требует адрес/чат; override побеждает предпочтение', () => {
    expect(resolveChannels({}, 'gri', { hasEmail: false, hasTelegram: true })).toEqual({ inApp: true, email: false, telegram: false })
    expect(resolveChannels({}, 'gri', { hasEmail: true, hasTelegram: true, override: { inApp: false, telegram: true } })).toEqual({
      inApp: false,
      email: true,
      telegram: true,
    })
  })
})
