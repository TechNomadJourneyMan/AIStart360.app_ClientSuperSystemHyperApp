/**
 * SR-04: /auth/verify передаёт в принятие приглашения токен `invite=` из
 * ссылки и сессию, которую только что создала ссылка; совпадение e-mail без
 * токена роль не даёт. Аккаунт, отобранный у прежнего держателя, отправляется
 * задавать новый пароль.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const s = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  result: { accepted: false, staffRole: null, secured: false } as Record<string, unknown>,
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      verifyOtp: async () => ({
        data: { user: { id: 'u-1', email: 'victim@corp.kz' }, session: { access_token: 'jwt-of-link' } },
        error: null,
      }),
    },
  }),
}))
vi.mock('@/lib/admin/invites', () => ({
  acceptInvitation: async (input: Record<string, unknown>) => { s.calls.push(input); return s.result },
}))
vi.mock('@/lib/events/track', () => ({ trackEvent: async () => undefined }))
vi.mock('@/lib/site-url', () => ({ requestOrigin: () => 'https://portal.aistart360.app' }))

const { GET } = await import('@/app/auth/verify/route')

const visit = (qs: string) => GET(new NextRequest(`https://portal.aistart360.app/auth/verify?${qs}`))

beforeEach(() => {
  s.calls = []
  s.result = { accepted: false, staffRole: null, secured: false }
})

describe('SR-04: /auth/verify', () => {
  it('SR-04: токен приглашения из ссылки и сессия ссылки уходят в принятие', async () => {
    await visit('token_hash=th&type=magiclink&next=/dashboard&invite=tok-abc')
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0]).toMatchObject({ inviteToken: 'tok-abc', userId: 'u-1', email: 'victim@corp.kz', accessToken: 'jwt-of-link' })
  })

  it('SR-04: без токена приглашения принятие не вызывается вовсе (e-mail роль не даёт)', async () => {
    const res = await visit('token_hash=th&type=magiclink&next=/dashboard')
    expect(s.calls).toHaveLength(0)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard')
  })

  it('SR-04: отобранный аккаунт ведём задавать новый пароль', async () => {
    s.result = { accepted: true, staffRole: 'admin', secured: true }
    const res = await visit('token_hash=th&type=magiclink&next=/dashboard&invite=tok-abc')
    expect(new URL(res.headers.get('location')!).pathname).toBe('/auth/reset-password')
  })

  it('SR-04: обычное принятие ведёт по next', async () => {
    s.result = { accepted: true, staffRole: 'admin', secured: false }
    const res = await visit('token_hash=th&type=invite&next=/auth/reset-password&invite=tok-abc')
    expect(new URL(res.headers.get('location')!).pathname).toBe('/auth/reset-password')
  })
})
