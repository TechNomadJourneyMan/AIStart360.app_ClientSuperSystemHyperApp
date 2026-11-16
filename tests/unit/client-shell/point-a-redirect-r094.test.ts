/**
 * R-094: /point-a of the old shell (the main Point A entry of its menus, the
 * quick actions, the mascot) sends a client to the cabinet's /client/point-a —
 * one page, one paywall, one menu — keeping the query; staff still get the
 * shell version. The same rule as /point-b.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'

const s = vi.hoisted(() => ({
  user: { id: 'u-1' } as null | { id: string },
  role: 'client' as string | null,
  redirects: [] as string[],
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => { s.redirects.push(url); throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;${url}` }) },
}))
vi.mock('@/lib/request-user', () => ({ getRequestUser: async () => s.user }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/api-identity', async (orig) => ({ ...(await orig<typeof import('@/lib/api-identity')>()), getSessionRole: async () => s.role }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => true }))
vi.mock('@/components/point-a-v4/PointAV4Page', () => ({ default: () => createElement('div', null, 'V4') }))
vi.mock('@/components/point-a/legacy/PointALegacyPage', () => ({ default: () => createElement('div', null, 'LEGACY') }))
vi.mock('@/components/access/FeatureGate', () => ({ default: ({ children }: { children: unknown }) => children }))

const { default: PointAPage } = await import('@/app/(dashboard)/point-a/page')

beforeEach(() => {
  s.user = { id: 'u-1' }
  s.role = 'client'
  s.redirects = []
})

describe('R-094: /point-a for a client → /client/point-a', () => {
  it.each(['client', 'owner', null])('profiles.role=%s is redirected, with the query kept', async (role) => {
    s.role = role
    await expect(PointAPage({ searchParams: { tab: 'risks' } })).rejects.toThrow('NEXT_REDIRECT')
    expect(s.redirects).toEqual(['/client/point-a?tab=risks'])
  })

  it('without a query — the bare cabinet page', async () => {
    await expect(PointAPage({})).rejects.toThrow('NEXT_REDIRECT')
    expect(s.redirects).toEqual(['/client/point-a'])
  })

  it.each(['admin', 'super_admin', 'expert'])('staff (%s) keep the shell page', async (role) => {
    s.role = role
    const el = await PointAPage({})
    expect(s.redirects).toEqual([])
    expect(el).toBeTruthy()
  })
})
