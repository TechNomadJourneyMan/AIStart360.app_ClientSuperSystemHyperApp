/**
 * GAP-20: the live sign-up paths tell the admins about a new registration
 * (notifyAdmins 'user_registered'), not only the dead NextAuth action.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const s = vi.hoisted(() => ({
  notify: vi.fn(async (..._a: unknown[]) => {}),
  status: 'pending_approval' as string,
  existingProfile: null as { id: string; status: string } | null,
}))

vi.mock('@/lib/notifications', () => ({ notifyAdmins: s.notify }))
vi.mock('@/lib/background', () => ({ runInBackground: async (_l: string, work: () => Promise<unknown>) => { await work() } }))
vi.mock('@/lib/rate-limit', () => ({
  isRateLimitedKey: async () => false,
  isRateLimited: async () => false,
  checkRateLimitForRequest: async () => ({ limited: false, reason: 'ok', limit: 20, remaining: 19, retryAfterSeconds: 0, backend: 'memory' }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}))
vi.mock('@/lib/events/track', () => ({ trackEvent: async () => {} }))
vi.mock('@/lib/db', () => ({ prisma: { adminRequest: { create: async () => ({ id: 'req-1' }) } } }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: (table: string) => ({
      upsert: async () => ({ error: null }),
      insert: async () => ({ error: null }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { status: s.status } }),
          single: async () => ({ data: table === 'profiles' ? s.existingProfile : null }),
        }),
      }),
    }),
  }),
}))
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { exchangeCodeForSession: async () => ({ data: { user: { id: 'u-2', email: 'g@corp.kz', user_metadata: { full_name: 'Гуля' } } } }) },
  }),
}))

import { POST as register } from '@/app/api/client/register/route'
import { GET as callback } from '@/app/auth/callback/route'

beforeEach(() => {
  s.notify.mockClear()
  s.status = 'pending_approval'
  s.existingProfile = null
})

const body = { userId: 'u-1', email: 'a@corp.kz', name: 'Айдар', company: 'ТОО Ромашка' }
const post = () => new NextRequest('http://localhost/api/client/register', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('registration notifications (GAP-20)', () => {
  it('POST /api/client/register notifies the admins once, with the request id and no secrets', async () => {
    const res = await register(post())
    expect(res.status).toBe(201)
    expect(s.notify).toHaveBeenCalledTimes(1)
    const [type, data, userId] = s.notify.mock.calls[0] as [string, Record<string, unknown>, string]
    expect(type).toBe('user_registered')
    expect(userId).toBe('u-1')
    expect(data).toMatchObject({ name: 'Айдар', email: 'a@corp.kz', organization: 'ТОО Ромашка', status: 'pending_approval', requestId: 'req-1' })
    expect(JSON.stringify(data)).not.toMatch(/password|token/i)
  })

  it('OPEN mode (already approved) still announces the sign-up', async () => {
    s.status = 'approved'
    await register(post())
    expect(s.notify.mock.calls[0][1]).toMatchObject({ status: 'approved', requestId: null })
  })

  it('a first Google sign-in notifies the admins; a returning user does not', async () => {
    await callback(new NextRequest('http://localhost/auth/callback?code=abc'))
    expect(s.notify).toHaveBeenCalledWith('user_registered', expect.objectContaining({ email: 'g@corp.kz', name: 'Гуля' }), 'u-2')
    s.notify.mockClear()
    s.existingProfile = { id: 'u-2', status: 'approved' }
    await callback(new NextRequest('http://localhost/auth/callback?code=abc'))
    expect(s.notify).not.toHaveBeenCalled()
  })
})
