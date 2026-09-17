import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({ enabled: {} as Record<string, boolean>, fail: false, sent: 0 }))

vi.mock('@/lib/settings/store', () => ({
  getSetting: async () => {
    if (s.fail) throw new Error('db down')
    return s.enabled
  },
}))
vi.mock('@/lib/email', () => ({ sendNotificationEmail: async () => { s.sent++ } }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => { throw new Error('no db in test') } }))

const { notifyAdmins } = await import('@/lib/notifications')

beforeEach(() => {
  s.enabled = { user_registered: true, survey_completed: false }
  s.fail = false
  s.sent = 0
  process.env.RESEND_API_KEY = 'test'
  process.env.ADMIN_NOTIFICATION_EMAIL = 'admin@example.com'
  process.env.TELEGRAM_ADMIN_CHAT_IDS = ''
  process.env.TELEGRAM_CHAT_ID = ''
})

describe('admin notification switches', () => {
  it('skips a type switched off in settings', async () => {
    await notifyAdmins('survey_completed', { n: 1 })
    expect(s.sent).toBe(0)
  })

  it('sends a type switched on', async () => {
    await notifyAdmins('user_registered', { n: 2 })
    expect(s.sent).toBe(1)
  })

  it('types outside the registry and unreadable settings keep notifying', async () => {
    await notifyAdmins('document_approved', { n: 3 })
    s.fail = true
    await notifyAdmins('survey_completed', { n: 4 })
    expect(s.sent).toBe(2)
  })
})
