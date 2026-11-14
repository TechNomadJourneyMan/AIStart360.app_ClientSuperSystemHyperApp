/**
 * SR-06 — браузерная сторона «Выйти»: решает сервер; сам браузер стирает
 * только свою сессию (scope 'local'), даже когда сервер недоступен.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ signOuts: [] as unknown[] }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut: async (o?: unknown) => { h.signOuts.push(o ?? 'DEFAULT(global)'); return { error: null } } } }),
}))

const { signOutThisBrowser, SIGN_OUT_ENDPOINT } = await import('@/lib/auth/sign-out-client')
const realFetch = globalThis.fetch

beforeEach(() => { h.signOuts = [] })
afterEach(() => { globalThis.fetch = realFetch })

describe('SR-06: signOutThisBrowser', () => {
  it('SR-06: спрашивает сервер и ведёт туда, куда он сказал (карточка клиента после impersonation)', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (url: string) => {
      calls.push(url)
      return new Response(JSON.stringify({ ok: true, impersonation: true, redirect: '/admin-giga-panel/users/u-1' }), { status: 200 })
    }) as typeof fetch
    expect(await signOutThisBrowser()).toBe('/admin-giga-panel/users/u-1')
    expect(calls).toEqual([SIGN_OUT_ENDPOINT])
    expect(h.signOuts).toEqual([{ scope: 'local' }])
  })

  it('SR-06: сервер недоступен — только local, никогда global', async () => {
    globalThis.fetch = (async () => { throw new Error('offline') }) as typeof fetch
    expect(await signOutThisBrowser()).toBe('/login')
    expect(h.signOuts).toEqual([{ scope: 'local' }])
  })

  it('SR-06: чужой адрес в ответе не используется', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, redirect: '//evil.example' }), { status: 200 })) as typeof fetch
    expect(await signOutThisBrowser()).toBe('/login')
  })
})
