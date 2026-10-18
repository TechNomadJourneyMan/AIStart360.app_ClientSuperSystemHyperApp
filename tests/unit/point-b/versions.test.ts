/**
 * Expert corrections of Point B are drafts until an Admin / Super Admin approves
 * them: one write path (saveExpertVersionDraft), the client sees approved ones only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { ADMIN, CLIENT, EXPERT, OTHER_CLIENT, pointBSeed } from './_pb'
import { saveExpertVersionDraft } from '@/lib/point-b/versions'

const VERSION_ID = 'dddddddd-0000-4000-8000-000000000001'

const s = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('./_pb').pointBSeed> | null,
  admin: null as ReturnType<typeof import('./_pb').pointBSeed> | null,
  sessionUser: null as { id: string } | null,
  expert: { ok: true, viewer: { id: 'x', role: 'expert', email: 'x@example.com' } } as Record<string, unknown>,
  actor: { role: 'super_expert' as StaffRole, scope: 'all' as 'all' | 'assigned', id: 'x' },
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.sessionUser } }) }, from: (t: string) => s.db!.sb.from(t) }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.db!.sb }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => s.admin!.sb }))
vi.mock('@/lib/events/server', () => ({ trackUserAction: async () => undefined }))
vi.mock('@/lib/goals/current', () => ({ loadGoalsWithEvaluation: async () => [] }))
vi.mock('@/lib/audit', () => ({ logAudit: () => undefined }))
vi.mock('@/lib/expert-auth', async (orig) => ({ ...(await orig<typeof import('@/lib/expert-auth')>()), resolveExpert: async () => s.expert }))
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  const inner = makeRequireGiga(() => ({ id: s.actor.id, kind: 'session', role: s.actor.role }))
  return {
    requireGiga: async (req: unknown, p: Parameters<typeof inner>[1]) => {
      const g = await inner(req, p)
      return g.actor ? { actor: { ...g.actor, clientScope: s.actor.scope } } : g
    },
    forbidTarget: async () => null,
    staffMfaGate: async () => 'ok',
  }
})
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async () => true }))

const clientRoute = await import('@/app/api/v1/diagnostics/point-b/route')
const expertVersion = await import('@/app/api/expert/clients/[id]/point-b-version/route')
const gigaPointB = await import('@/app/api/giga-admin/users/[id]/point-b/route')
const reviewRoute = await import('@/app/api/giga-admin/users/[id]/review/point-b/route')
const approveRoute = await import('@/app/api/giga-admin/users/[id]/review/point-b/approve/route')

const post = (body: unknown) => new NextRequest('http://t/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: 'http://t' } })
const get = () => new NextRequest('http://t/api')
const idParams = (id: string) => ({ params: { id } })
const versions = () => s.db!.db.point_b_versions as Array<Record<string, unknown>>

beforeEach(() => {
  s.db = pointBSeed({
    user_assignments: [{ user_id: CLIENT, assignee_id: EXPERT }],
    profiles: [{ id: EXPERT, full_name: 'Алия Эксперт' }, { id: ADMIN, full_name: 'Админ Главный' }, { id: CLIENT, role: 'client', full_name: 'Клиент' }],
    staff_roles: [],
  })
  s.admin = pointBSeed()
  s.sessionUser = { id: CLIENT }
  s.expert = { ok: true, viewer: { id: EXPERT, role: 'expert', email: 'expert@example.com' } }
  s.actor = { role: 'super_expert', scope: 'all', id: EXPERT }
})

describe('saveExpertVersionDraft', () => {
  it('saveExpertVersionDraft inserts is_approved false', async () => {
    const row = await saveExpertVersionDraft(s.db!.sb, { diagnosticId: 'diag-1', authorId: EXPERT, authorName: 'Алия Эксперт', notes: 'Сфокусируйтесь на конверсии', roadmap: { q1: 'x' } })
    expect(row).toMatchObject({ is_approved: false })
    expect(typeof row.id).toBe('string')
    expect(typeof row.created_at).toBe('string')
    expect(versions()).toHaveLength(1)
    expect(versions()[0]).toMatchObject({ diagnostic_id: 'diag-1', authored_by: EXPERT, author_name: 'Алия Эксперт', expert_notes: 'Сфокусируйтесь на конверсии', is_approved: false, roadmap: { q1: 'x' } })
  })

  it('throws when the insert fails (no silent success)', async () => {
    const failing = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: 'XX', message: 'boom' } }) }) }) }) }
    await expect(saveExpertVersionDraft(failing as never, { diagnosticId: 'd', authorId: 'a', authorName: 'n', notes: 'x' })).rejects.toThrow()
  })
})

describe('expert route', () => {
  it('POST expert point-b-version creates an unapproved version and the client route does not return it', async () => {
    const res = await expertVersion.POST(post({ expert_notes: 'Цель агрессивная — начните с конверсии' }), idParams(CLIENT))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.is_approved).toBe(false)
    expect(versions()).toHaveLength(1)
    expect(versions()[0].is_approved).toBe(false)
    // the label shown to the client is a name, never the email
    expect(versions()[0].author_name).toBe('Алия Эксперт')

    const client = await (await clientRoute.GET(get())).json()
    expect(client.ok).toBe(true)
    expect(client.expert_version).toBeNull()
  })

  it('profanity in notes → 400 with field expert_notes', async () => {
    const res = await expertVersion.POST(post({ expert_notes: 'Это полная хуйня' }), idParams(CLIENT))
    expect(res.status).toBe(400)
    expect((await res.json()).field).toBe('expert_notes')
    expect(versions()).toHaveLength(0)
  })

  it('a client not assigned to the expert gets 403 on GET and POST', async () => {
    s.db = pointBSeed({ user_assignments: [{ user_id: CLIENT, assignee_id: 'someone-else' }] })
    expect((await expertVersion.POST(post({ expert_notes: 'ok' }), idParams(CLIENT))).status).toBe(403)
    expect((await expertVersion.GET(get(), idParams(CLIENT))).status).toBe(403)
    expect(versions()).toHaveLength(0)
  })

  it('an unauthenticated viewer is refused', async () => {
    s.expert = { ok: false, block: 'unauthenticated' }
    expect((await expertVersion.POST(post({ expert_notes: 'ok' }), idParams(CLIENT))).status).toBe(401)
  })
})

describe('GIGA routes', () => {
  beforeEach(() => { s.actor = { role: 'super_expert', scope: 'all', id: ADMIN } })

  it('POST giga point-b creates an unapproved version', async () => {
    const res = await gigaPointB.POST(post({ expert_notes: 'Нужна корректировка плана' }), idParams(CLIENT))
    expect(res.status).toBe(200)
    expect((await res.json()).data.is_approved).toBe(false)
    expect(versions()[0]).toMatchObject({ is_approved: false, author_name: 'Админ Главный' })
    const client = await (await clientRoute.GET(get())).json()
    expect(client.expert_version).toBeNull()
  })

  it('profanity in notes → 400 with field expert_notes (unchanged)', async () => {
    const res = await gigaPointB.POST(post({ expert_notes: 'Это полная хуйня' }), idParams(CLIENT))
    expect(res.status).toBe(400)
    expect((await res.json()).field).toBe('expert_notes')
    expect(versions()).toHaveLength(0)
  })

  it('the review route saves a draft through the same helper', async () => {
    const res = await reviewRoute.POST(post({ expert_notes: 'Версия на проверку' }), idParams(CLIENT))
    expect(res.status).toBe(200)
    expect(versions()[0].is_approved).toBe(false)
  })

  it('an actor limited to assigned clients gets 403 on a foreign client (POST, review GET/POST, approve)', async () => {
    s.actor = { role: 'super_expert', scope: 'assigned', id: ADMIN }
    s.db!.db.user_assignments.length = 0
    s.db!.db.user_assignments.push({ user_id: OTHER_CLIENT, assignee_id: ADMIN })
    expect((await gigaPointB.POST(post({ expert_notes: 'x' }), idParams(CLIENT))).status).toBe(403)
    expect((await reviewRoute.GET(get(), idParams(CLIENT))).status).toBe(403)
    expect((await reviewRoute.POST(post({ expert_notes: 'x' }), idParams(CLIENT))).status).toBe(403)
    expect((await approveRoute.POST(post({ versionId: VERSION_ID }), idParams(CLIENT))).status).toBe(403)
    expect(versions()).toHaveLength(0)
  })
})

describe('client route', () => {
  it('client route returns only is_approved true versions', async () => {
    s.db!.db.point_b_versions.push(
      { id: 'v-old', diagnostic_id: 'diag-1', expert_notes: 'Одобренная', author_name: 'Алия Эксперт', is_approved: true, created_at: '2026-10-01T00:00:00Z' },
      { id: 'v-new', diagnostic_id: 'diag-1', expert_notes: 'Черновик', author_name: 'Алия Эксперт', is_approved: false, created_at: '2026-10-05T00:00:00Z' },
    )
    const body = await (await clientRoute.GET(get())).json()
    expect(body.expert_version.expert_notes).toBe('Одобренная')
  })
})

describe('approval', () => {
  beforeEach(() => {
    s.db!.db.point_b_versions.push({ id: VERSION_ID, diagnostic_id: 'diag-1', expert_notes: 'Черновик', author_name: 'Алия Эксперт', is_approved: false, created_at: '2026-10-05T00:00:00Z' })
  })

  it('only admin or super admin can approve (existing approve route) — expert gets 403', async () => {
    s.actor = { role: 'super_expert', scope: 'all', id: EXPERT }
    const denied = await approveRoute.POST(post({ versionId: VERSION_ID }), idParams(CLIENT))
    expect(denied.status).toBe(403)
    expect(versions()[0].is_approved).toBe(false)

    s.actor = { role: 'admin', scope: 'all', id: ADMIN }
    const ok = await approveRoute.POST(post({ versionId: VERSION_ID }), idParams(CLIENT))
    expect(ok.status).toBe(200)
    expect(versions()[0]).toMatchObject({ is_approved: true, approved_by: ADMIN })
    const body = await (await clientRoute.GET(get())).json()
    expect(body.expert_version.expert_notes).toBe('Черновик')
  })
})
