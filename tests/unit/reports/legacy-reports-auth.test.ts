/**
 * Security P2-12 — the legacy (Prisma) report server actions:
 * app/actions/reports.ts — every exported server action is an RPC endpoint
 * and authorizes on its own; the uploader is the session, never the
 * forgeable `aistart360_user_id` cookie. (The NextAuth /api/reports/[id]
 * route and its tests were removed together with NextAuth.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  viewer: null as null | { id: string; role: string | null; email: string | null },
  created: [] as Array<Record<string, unknown>>,
  writes: [] as string[],
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    reportDocument: {
      create: async ({ data }: { data: Record<string, unknown> }) => { s.created.push(data); return { id: 'rd-1', ...data } },
      findMany: async () => [{ id: 'rd-1' }],
    },
    user: { findUnique: async () => ({ name: 'Cookie Victim', email: 'victim@x.kz' }) },
  },
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

const actions = await import('@/app/actions/reports')

function uploadForm() {
  const fd = new FormData()
  fd.set('file', new File([new Uint8Array([1, 2, 3])], 'q1.pdf', { type: 'application/pdf' }))
  fd.set('name', 'Q1')
  fd.set('clientName', 'Acme')
  fd.set('category', 'Growth')
  return fd
}

beforeEach(() => {
  s.viewer = null
  s.created = []
  s.writes = []
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
