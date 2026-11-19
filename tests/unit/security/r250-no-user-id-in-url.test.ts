/**
 * R-250: the client's own approval status is read from the session only. The waiting room and the
 * questionnaire used to call /api/client/status?userId=<id> — the id travelled in the URL (proxy and
 * access logs, browser history) although the route never read it. Now:
 *   • both pages call fetchOwnApprovalStatus() — a URL without any query;
 *   • no source file builds a /api/client/status URL with a query;
 *   • the route answers for the session user whatever the query says.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION_USER = 'aaaaaaaa-1111-2222-3333-444444444444'
const OTHER_USER = 'bbbbbbbb-1111-2222-3333-444444444444'
const s = vi.hoisted(() => ({ restUrls: [] as string[] }))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'aaaaaaaa-1111-2222-3333-444444444444' } } }) } }),
}))
vi.mock('@/lib/supabase-service', () => ({ requireServiceRoleKey: () => 'service-key' }))

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('R-250: no user id in the URL of the status check', () => {
  it('no page, component or library builds /api/client/status with a query', () => {
    const offenders = ['app', 'components', 'lib', 'hooks']
      .flatMap((d) => sourceFiles(d))
      .filter((f) => /\/api\/client\/status\?/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the waiting room and the questionnaire use fetchOwnApprovalStatus', () => {
    for (const page of ['app/client/waiting-room/page.tsx', 'app/client/onboarding/page.tsx']) {
      expect(readFileSync(page, 'utf8'), page).toMatch(/fetchOwnApprovalStatus\(/)
    }
  })

  it('fetchOwnApprovalStatus calls the bare URL and returns the status', async () => {
    const { fetchOwnApprovalStatus } = await import('@/lib/client-shell/approval-status')
    const calls: string[] = []
    const fake = (async (url: string) => { calls.push(url); return new Response(JSON.stringify({ status: 'approved' })) }) as unknown as typeof fetch
    await expect(fetchOwnApprovalStatus(fake)).resolves.toBe('approved')
    expect(calls).toEqual(['/api/client/status'])
    const broken = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    await expect(fetchOwnApprovalStatus(broken)).resolves.toBeNull()
  })

  describe('GET /api/client/status', () => {
    beforeEach(() => {
      s.restUrls = []
      vi.stubGlobal('fetch', vi.fn(async (url: string) => { s.restUrls.push(String(url)); return new Response(JSON.stringify([{ status: 'approved' }])) }))
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
    })

    it('answers for the session user, ignoring ?userId= of someone else', async () => {
      const { GET } = await import('@/app/api/client/status/route')
      const { NextRequest } = await import('next/server')
      const res = await GET(new NextRequest(`http://localhost/api/client/status?userId=${OTHER_USER}`))
      expect(await res.json()).toEqual({ status: 'approved' })
      expect(s.restUrls).toHaveLength(1)
      expect(s.restUrls[0]).toContain(`id=eq.${SESSION_USER}`)
      expect(s.restUrls[0]).not.toContain(OTHER_USER)
      vi.unstubAllGlobals()
    })
  })
})
