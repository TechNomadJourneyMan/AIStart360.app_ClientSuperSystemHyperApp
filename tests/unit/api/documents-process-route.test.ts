/**
 * POST /api/v1/onboarding/documents/[id]/process no longer parses inline: it
 * resets the document and enqueues a document_intelligence task (202),
 * idempotent per document + processing attempt. Authz: staff, a company
 * manager, or the uploader while still a non-viewer member of the company.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const DOC = '44444444-4444-4444-8444-444444444444'
const OWNER = 'owner-1'

const s = vi.hoisted(() => ({
  user: null as { id: string } | null,
  role: 'client' as string | null,
  doc: null as Record<string, unknown> | null,
  live: null as { id: string; status: string } | null,
  enqueued: [] as Array<Record<string, unknown>>,
  existingKeys: new Map<string, { id: string; status: string }>(),
  /** Role of the session user in the document's company (null = not a member). */
  tenantRole: 'owner' as string | null,
}))

vi.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], get: () => undefined, set: vi.fn() }) }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/api-identity', () => ({
  getSessionUser: async () => s.user,
  getSessionRole: async () => s.role,
  isStaffRole: (r: string | null) => ['admin', 'super_admin', 'expert', 'manager', 'analyst'].includes(r ?? ''),
}))
vi.mock('@/lib/tenancy', () => ({
  resolveTenant: async ({ companyId }: { companyId: string }) => (s.tenantRole && s.user
    ? { ok: true, tenant: { userId: s.user.id, companyId, role: s.tenantRole, canManage: ['owner', 'admin', 'staff'].includes(s.tenantRole), legacy: false } }
    : { ok: false, status: 404, error: 'no_company' }),
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/agents/queue', () => ({
  enqueueAgentTask: vi.fn(async (opts: Record<string, unknown>) => {
    const existing = s.existingKeys.get(opts.idempotencyKey as string)
    if (existing) return { id: existing.id, created: false }
    s.enqueued.push(opts)
    return { id: `task-${s.enqueued.length}`, created: true }
  }),
}))
vi.mock('@/lib/documents/repository', () => ({
  isUuid: (v: string) => /^[0-9a-f-]{36}$/.test(v),
  getDocument: async () => s.doc,
  attachOwnerCompany: async () => null,
  liveTaskForDocument: async () => s.live,
  resetForReprocess: async () => (s.doc ? { ...s.doc, parse_status: 'queued', processing_stage: 'validated' } : null),
  taskStatus: async (id: string) => [...s.existingKeys.values()].find((t) => t.id === id)?.status ?? null,
}))

async function call(id = DOC) {
  const { POST } = await import('@/app/api/v1/onboarding/documents/[id]/process/route')
  const res = await POST(new NextRequest(`http://localhost/x/${id}/process`, { method: 'POST' }), { params: { id } })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  s.user = { id: OWNER }
  s.role = 'client'
  s.doc = { id: DOC, user_id: OWNER, company_id: 'company-a', parse_status: 'error', security_status: 'clean', security_reason: null, attempts: 2 }
  s.live = null
  s.enqueued = []
  s.existingKeys.clear()
  s.tenantRole = 'owner'
})

describe('POST …/documents/[id]/process', () => {
  it('401 without a session, 404 for someone else’s document', async () => {
    s.user = null
    expect((await call()).status).toBe(401)
    s.user = { id: 'stranger' }
    s.tenantRole = null
    expect((await call()).status).toBe(404)
  })

  it('a viewer cannot get their own (PostgREST-inserted) row processed; a removed member neither', async () => {
    s.tenantRole = 'viewer'
    expect(await call()).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
    s.tenantRole = null // no longer a member of the company
    expect((await call()).status).toBe(404)
    expect(s.enqueued).toEqual([])
  })

  it('a plain member may reprocess the document they uploaded', async () => {
    s.tenantRole = 'member'
    expect((await call()).status).toBe(202)
  })

  it('enqueues a manual document_intelligence task keyed by document + attempt (202)', async () => {
    const res = await call()
    expect(res).toMatchObject({ status: 202, body: { ok: true, task_id: 'task-1', status: 'queued' } })
    expect(s.enqueued[0]).toMatchObject({
      agentKey: 'document_intelligence', companyId: 'company-a', trigger: 'manual', requestedBy: OWNER,
      input: { document_id: DOC }, idempotencyKey: `doc_process:${DOC}:2`,
    })
  })

  it('returns the task already in flight instead of starting another', async () => {
    s.live = { id: 'task-live', status: 'running' }
    expect(await call()).toMatchObject({ status: 202, body: { task_id: 'task-live', already_queued: true } })
    expect(s.enqueued).toEqual([])
  })

  it('a finished task under the same key does not block a new run', async () => {
    s.existingKeys.set(`doc_process:${DOC}:2`, { id: 'old', status: 'succeeded' })
    const res = await call()
    expect(res.status).toBe(202)
    expect(res.body.task_id).toBe('task-1')
    expect(String(s.enqueued[0].idempotencyKey)).toMatch(new RegExp(`^doc_process:${DOC}:2:\\d+$`))
  })

  it('rejected files cannot be reprocessed', async () => {
    s.doc = { ...s.doc!, parse_status: 'rejected', security_status: 'rejected', security_reason: 'PDF содержит активное содержимое' }
    expect(await call()).toMatchObject({ status: 409, body: { code: 'REJECTED', error: 'PDF содержит активное содержимое' } })
  })

  it('platform staff may reprocess another user’s document', async () => {
    s.user = { id: 'staff-1' }
    s.role = 'expert'
    s.tenantRole = null
    expect((await call()).status).toBe(202)
    expect(s.enqueued[0].requestedBy).toBe('staff-1')
  })
})
