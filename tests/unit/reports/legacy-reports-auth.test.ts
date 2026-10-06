/**
 * Security P2-12 — the legacy (Prisma) report surfaces:
 *  - /api/reports/[id]: staff may read / delete only reports of their OWN
 *    organization's clients (any staff role used to reach every report); a
 *    failed storage delete keeps the row;
 *  - app/actions/reports.ts: every exported server action is an RPC endpoint
 *    and authorizes on its own; the uploader is the session, never the
 *    forgeable `aistart360_user_id` cookie.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  session: null as null | { user: { id?: string; role?: string; orgId?: string } },
  report: null as null | Record<string, unknown>,
  removeError: null as null | { message: string },
  deleted: [] as string[],
  removed: [] as string[][],
  viewer: null as null | { id: string; role: string | null; email: string | null },
  created: [] as Array<Record<string, unknown>>,
  writes: [] as string[],
}))

vi.mock('@/lib/api-utils', () => ({
  requireAuth: async () => (s.session ? { session: s.session } : { error: new Response('{}', { status: 401 }) }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    report: {
      findUnique: async () => s.report,
      delete: async ({ where }: { where: { id: string } }) => { s.deleted.push(where.id); return {} },
    },
    reportDocument: {
      create: async ({ data }: { data: Record<string, unknown> }) => { s.created.push(data); return { id: 'rd-1', ...data } },
      findMany: async () => [{ id: 'rd-1' }],
    },
    user: { findUnique: async () => ({ name: 'Cookie Victim', email: 'victim@x.kz' }) },
  },
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: 'https://signed/x' }, error: null }),
        remove: async (paths: string[]) => { s.removed.push(paths); return { data: null, error: s.removeError } },
      }),
    },
  }),
}))
vi.mock('@/lib/expert-auth', () => ({ requireExpert: async () => s.viewer }))
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (n: string) => (n === 'aistart360_user_id' ? { value: 'victim-id' } : undefined) }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('fs/promises', () => ({
  mkdir: async () => undefined,
  writeFile: async (p: string) => { s.writes.push(p) },
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.example'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'

const route = await import('@/app/api/reports/[id]/route')
const actions = await import('@/app/actions/reports')

const ctx = { params: { id: 'rep-1' } }
const orgBReport = () => ({ id: 'rep-1', uploadedBy: 'someone', filePath: 'reports/c/x.pdf', client: { managerId: 'mgr-b', orgId: 'org-b' } })

function uploadForm() {
  const fd = new FormData()
  fd.set('file', new File([new Uint8Array([1, 2, 3])], 'q1.pdf', { type: 'application/pdf' }))
  fd.set('name', 'Q1')
  fd.set('clientName', 'Acme')
  fd.set('category', 'Growth')
  return fd
}

beforeEach(() => {
  s.session = null
  s.report = orgBReport()
  s.removeError = null
  s.deleted = []
  s.removed = []
  s.viewer = null
  s.created = []
  s.writes = []
})

describe('/api/reports/[id] — tenant scoping', () => {
  it('staff of another organization gets 404 on GET and DELETE', async () => {
    s.session = { user: { id: 'staff-a', role: 'ADMIN', orgId: 'org-a' } }
    expect((await route.GET(new Request('http://x'), ctx)).status).toBe(404)
    expect((await route.DELETE(new Request('http://x'), ctx)).status).toBe(404)
    expect(s.deleted).toEqual([])
    expect(s.removed).toEqual([])
  })

  it('staff without an organization (e.g. a Google-only NextAuth session) gets 404', async () => {
    s.session = { user: { id: 'g-1', role: 'ADMIN' } }
    expect((await route.GET(new Request('http://x'), ctx)).status).toBe(404)
  })

  it('staff of the owning organization may read', async () => {
    s.session = { user: { id: 'staff-b', role: 'ANALYST', orgId: 'org-b' } }
    const res = await route.GET(new Request('http://x'), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).fileUrl).toBe('https://signed/x')
  })

  it('the client manager keeps access', async () => {
    s.session = { user: { id: 'mgr-b', role: 'CLIENT' } }
    expect((await route.GET(new Request('http://x'), ctx)).status).toBe(200)
  })

  it('a failed storage delete keeps the database row', async () => {
    s.session = { user: { id: 'staff-b', role: 'ADMIN', orgId: 'org-b' } }
    s.removeError = { message: 'storage down' }
    const res = await route.DELETE(new Request('http://x'), ctx)
    expect(res.status).toBe(502)
    expect(s.deleted).toEqual([])
    s.removeError = null
    expect((await route.DELETE(new Request('http://x'), ctx)).status).toBe(200)
    expect(s.deleted).toEqual(['rep-1'])
  })
})

describe('app/actions/reports — server actions authorize on their own', () => {
  it('uploadReport without a staff session returns UNAUTHORIZED and writes nothing', async () => {
    expect(await actions.uploadReport(uploadForm())).toEqual({ error: 'UNAUTHORIZED' })
    expect(s.writes).toEqual([])
    expect(s.created).toEqual([])
  })

  it('an expert (not allowed on /reports) is refused too', async () => {
    s.viewer = { id: 'e-1', role: 'expert', email: 'e@x.kz' }
    expect(await actions.uploadReport(uploadForm())).toEqual({ error: 'UNAUTHORIZED' })
  })

  it('getReportDocuments and createReportMetadata refuse without a staff session', async () => {
    await expect(actions.getReportDocuments()).rejects.toThrow('UNAUTHORIZED')
    await expect(actions.createReportMetadata({
      name: 'x', clientName: 'y', category: 'GRI', type: 'pdf', fileUrl: '/x', fileSizeBytes: 1, uploadedBy: 'forged',
    })).rejects.toThrow('UNAUTHORIZED')
    expect(s.created).toEqual([])
  })

  it('an approved admin uploads; the uploader is the session, not the cookie', async () => {
    s.viewer = { id: 'admin-1', role: 'admin', email: 'admin@x.kz' }
    expect(await actions.uploadReport(uploadForm())).toEqual({ success: true })
    expect(s.created).toHaveLength(1)
    expect(s.created[0].uploadedBy).toBe('admin@x.kz')
    await actions.createReportMetadata({
      name: 'x', clientName: 'y', category: 'GRI', type: 'pdf', fileUrl: '/x', fileSizeBytes: 1, uploadedBy: 'forged',
    })
    expect(s.created[1].uploadedBy).toBe('admin@x.kz')
    await expect(actions.getReportDocuments()).resolves.toEqual([{ id: 'rd-1' }])
  })
})
