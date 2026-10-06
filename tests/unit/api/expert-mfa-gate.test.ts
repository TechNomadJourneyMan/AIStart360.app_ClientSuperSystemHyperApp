/**
 * Expert portal routes that used to check EXPERT_ROLES themselves (no profile
 * status, no second factor) now go through resolveExpert(): a session whose
 * role says «expert» but which has not passed the step-up (or is not approved)
 * gets the MFA code / 403 instead of the data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ block: 'step_up' as string | null }))

vi.mock('@/lib/expert-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/expert-auth')>('@/lib/expert-auth')
  return {
    ...actual,
    resolveExpert: async () => (h.block ? { ok: false, block: h.block } : { ok: true, viewer: { id: 'expert-1', role: 'expert', email: 'e@x' } }),
  }
})
// The session says: a signed-in user whose profile role is «expert».
const sessionClient = {
  auth: { getUser: async () => ({ data: { user: { id: 'expert-1', email: 'e@x' } }, error: null }) },
  from: () => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'update']) b[m] = () => b
    b.maybeSingle = async () => ({ data: { id: 'expert-1', role: 'expert', full_name: 'E', email: 'e@x', avatar_url: null, expert_title: null }, error: null })
    b.single = b.maybeSingle
    return b
  },
}
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => sessionClient }))
vi.mock('@/lib/notifications', () => ({ notifyUser: () => undefined, notifyAdmins: () => undefined }))
vi.mock('@/lib/audit', () => ({ logAudit: () => undefined }))

const clients = await import('@/app/api/expert/clients/route')
const profile = await import('@/app/api/expert/profile/route')
const comments = await import('@/app/api/expert/comments/route')
const comment = await import('@/app/api/expert/comments/[id]/route')

const CLIENT = '11111111-1111-4111-8111-111111111111'
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  h.block = 'step_up'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb.local'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  // Service-role REST answers as for an expert profile / empty tables.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('profiles?id=eq.')) return new Response(JSON.stringify([{ id: 'expert-1', role: 'expert', full_name: 'E', expert_title: null }]))
    if (String(url).includes('expert_comments?id=eq.')) return new Response(JSON.stringify([{ author_id: 'expert-1' }]))
    return new Response(JSON.stringify([]))
  }))
})
afterEach(() => vi.unstubAllGlobals())

const cases: Array<[string, () => Promise<Response>]> = [
  ['GET /api/expert/clients', () => clients.GET()],
  ['GET /api/expert/profile', () => profile.GET()],
  ['PATCH /api/expert/profile', () => profile.PATCH(new NextRequest('http://x/api/expert/profile', { ...json({ fullName: 'X' }), method: 'PATCH' }))],
  ['GET /api/expert/comments (another client)', () => comments.GET(new NextRequest(`http://x/api/expert/comments?clientId=${CLIENT}`))],
  ['POST /api/expert/comments', () => comments.POST(new NextRequest('http://x/api/expert/comments', json({ clientId: CLIENT, text: 'hi' })))],
  ['PATCH /api/expert/comments/[id]', () => comment.PATCH(new NextRequest('http://x', { ...json({ text: 'x' }), method: 'PATCH' }), { params: { id: 'c1' } })],
  ['DELETE /api/expert/comments/[id]', () => comment.DELETE(new NextRequest('http://x', { method: 'DELETE' }), { params: { id: 'c1' } })],
]

describe('expert routes go through resolveExpert', () => {
  it.each(cases)('%s: no step-up → 403 MFA_STEP_UP_REQUIRED', async (_name, run) => {
    const res = await run()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('MFA_STEP_UP_REQUIRED')
  })

  it.each(cases)('%s: a not approved / not expert profile → 403', async (_name, run) => {
    h.block = 'forbidden'
    expect((await run()).status).toBe(403)
  })

  it('a client still reads the comments about itself without the expert gate', async () => {
    const res = await comments.GET(new NextRequest('http://x/api/expert/comments?clientId=self'))
    expect(res.status).toBe(200)
  })

  it('an admitted expert gets the data', async () => {
    h.block = null
    expect((await clients.GET()).status).toBe(200)
    expect((await profile.GET()).status).toBe(200)
  })
})
