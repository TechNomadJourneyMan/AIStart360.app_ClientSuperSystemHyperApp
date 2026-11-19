/**
 * N5-3 — the newer client crons ignored «Режим технических работ» (the class of R-026): the CRM
 * digest (e-mail / Telegram / WhatsApp / bell to CRM owners, plus «пора пересчитать GRI») and the
 * billing job («Платный доступ закончился», «заканчивается через N дней») went out while the cabinet
 * they link to said «Ведутся работы». Both now ask the same gate as reminders / client-digest.
 * The CRM digest skips the whole run (nothing read, nothing sent; the next run does it).
 * Review of wave 1A (HIGH): billing-expiry must NOT skip the downgrade — an expired trial / Pro kept
 * profiles.tier 'pro' for as long as maintenance lasted (or the gate could not be read). It always
 * downgrades; only the client notices wait: no «доступ закончился» right after the downgrade, no
 * d7 / d1, no catch-up of missed «закончился» — the first run after maintenance sends those.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  skip: null as null | 'maintenance' | 'maintenance_unknown',
  gateCalls: [] as string[],
  serviceClient: vi.fn(() => { throw new Error('the database must not be read during maintenance') }),
  expire: vi.fn(async (_opts?: { notify?: boolean }) => ({ due: 1, downgraded: 1, skipped: 0, failed: 0 })),
  warnings: vi.fn(async () => ({ sent: 0 })),
  ended: vi.fn(async () => ({ due: 0, sent: 0, duplicate: 0, failed: 0 })),
  sends: [] as string[],
}))

vi.mock('@/lib/automation/maintenance-gate', () => ({
  maintenanceSkipReason: async (job: string) => {
    h.gateCalls.push(job)
    return h.skip
  },
}))
vi.mock('@/lib/cron-auth', () => ({ isAuthorizedCron: () => ({ ok: true }) }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: h.serviceClient }))
vi.mock('@/lib/payments/billing', () => ({
  expireDuePlans: h.expire,
  BillingError: class BillingError extends Error { code = 'x' },
}))
vi.mock('@/lib/payments/expiry-notices', () => ({ sendExpiryWarnings: h.warnings, sendMissedEndNotices: h.ended }))
vi.mock('@/lib/notifications/create', () => ({ createNotification: async () => { h.sends.push('inapp'); return true } }))
vi.mock('@/lib/notifications/notify', () => ({ notifyClient: async () => { h.sends.push('notify'); return { ok: true } } }))
vi.mock('@/lib/email', () => ({ sendUserEmail: async () => { h.sends.push('email'); return { ok: true } } }))
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: async () => { h.sends.push('tg'); return true } }))

const crmDigest = await import('@/app/api/cron/crm-digest/route')
const billing = await import('@/app/api/cron/billing-expiry/route')

const req = (p: string) => new NextRequest(`http://localhost${p}`, { headers: { authorization: 'Bearer s' } })

beforeEach(() => {
  process.env.CRON_SECRET = 's'
  h.skip = null
  h.gateCalls = []
  h.sends = []
  h.serviceClient.mockClear()
  h.expire.mockClear()
  h.warnings.mockClear()
  h.ended.mockClear()
})

describe('N5-3: crm-digest in maintenance', () => {
  it.each(['maintenance', 'maintenance_unknown'] as const)('%s: skipped as a whole — 200, the reason, no read, no send', async (reason) => {
    h.skip = reason
    const res = await crmDigest.GET(req('/api/cron/crm-digest'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, data: { skippedReason: reason, usersNotified: 0 } })
    expect(h.gateCalls).toEqual(['crm-digest'])
    expect(h.serviceClient).not.toHaveBeenCalled()
    expect(h.sends).toEqual([])
  })

  it('maintenance off: the run goes on (it reads the database)', async () => {
    const res = await crmDigest.GET(req('/api/cron/crm-digest'))
    expect(h.gateCalls).toEqual(['crm-digest'])
    expect(h.serviceClient).toHaveBeenCalled()
    expect(res.status).toBe(500) // the stub client throws — the run did start
  })
})

describe('N5-3 + review: billing-expiry in maintenance downgrades, only the notices wait', () => {
  it.each(['maintenance', 'maintenance_unknown'] as const)('%s: the expired plans ARE downgraded (without the «ended» notice); no d7 / d1, no catch-up — 200 with the reason', async (reason) => {
    h.skip = reason
    const res = await billing.GET(req('/api/cron/billing-expiry'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, downgraded: 1, warnings: null, ended: null, noticesSkippedReason: reason })
    expect(h.gateCalls).toEqual(['billing-expiry'])
    expect(h.expire).toHaveBeenCalledTimes(1)
    expect(h.expire).toHaveBeenCalledWith({ notify: false })
    expect(h.warnings).not.toHaveBeenCalled()
    expect(h.ended).not.toHaveBeenCalled()
  })

  it('maintenance off: downgrades with the notice, warns, and catches up the «ended» notices maintenance held back', async () => {
    const res = await billing.GET(req('/api/cron/billing-expiry'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, downgraded: 1, warnings: { sent: 0 }, ended: { sent: 0 } })
    expect(body.noticesSkippedReason).toBeUndefined()
    expect(h.expire).toHaveBeenCalledWith({ notify: true })
    expect(h.warnings).toHaveBeenCalledTimes(1)
    expect(h.ended).toHaveBeenCalledTimes(1)
  })
})
