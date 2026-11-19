/**
 * N5-3 — the newer client crons ignored «Режим технических работ» (the class of R-026): the CRM
 * digest (e-mail / Telegram / WhatsApp / bell to CRM owners, plus «пора пересчитать GRI») and the
 * billing job («Платный доступ закончился», «заканчивается через N дней») went out while the cabinet
 * they link to said «Ведутся работы». Both now ask the same gate as reminders / client-digest and
 * skip the whole run: nothing read, nothing sent, nothing downgraded; the next run does it.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  skip: null as null | 'maintenance' | 'maintenance_unknown',
  gateCalls: [] as string[],
  serviceClient: vi.fn(() => { throw new Error('the database must not be read during maintenance') }),
  expire: vi.fn(async () => ({ expired: 0, kept: 0 })),
  warnings: vi.fn(async () => ({ sent: 0 })),
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
vi.mock('@/lib/payments/expiry-notices', () => ({ sendExpiryWarnings: h.warnings }))
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

describe('N5-3: billing-expiry in maintenance', () => {
  it.each(['maintenance', 'maintenance_unknown'] as const)('%s: no downgrade, no notice — 200 with the reason', async (reason) => {
    h.skip = reason
    const res = await billing.GET(req('/api/cron/billing-expiry'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, skippedReason: reason })
    expect(h.gateCalls).toEqual(['billing-expiry'])
    expect(h.expire).not.toHaveBeenCalled()
    expect(h.warnings).not.toHaveBeenCalled()
  })

  it('maintenance off: downgrades and warns as before', async () => {
    const res = await billing.GET(req('/api/cron/billing-expiry'))
    expect(res.status).toBe(200)
    expect(h.expire).toHaveBeenCalledTimes(1)
    expect(h.warnings).toHaveBeenCalledTimes(1)
  })
})
