/**
 * The default lock of buildPointASnapshot (the manual «Пересчитать»): it holds the company in the
 * recalculation queue so two recalculations never run at once. It used to catch EVERY error of the
 * claim and run unlocked — meant only for a database before migration 111 (no queue table). A
 * transient failure of the claim (pool timeout, statement timeout, overload) then let a second
 * recalculation of the same company run alongside one the drain held. Only the missing table may
 * run unlocked now; any other failure of the claim fails the recalculation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const claimCompany = vi.fn()
vi.mock('@/lib/point-a/recalc-queue', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  claimCompany: (...args: unknown[]) => claimCompany(...args),
  finish: vi.fn(async () => undefined),
}))

// The snapshot store before migration 111: every read answers «relation does not exist».
const service = vi.fn()
function missingRelation(): unknown {
  const result = { data: null, error: { code: '42P01', message: 'relation "public.point_a_snapshots" does not exist' } }
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'is', 'maybeSingle']) chain[m] = () => chain
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return { from: () => chain, rpc: () => chain }
}
vi.mock('@/lib/supabase-service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createServiceClient: () => { service(); return missingRelation() },
}))

const { buildPointASnapshot } = await import('@/lib/point-a/snapshot')

describe('Point A snapshot — the default lock', () => {
  beforeEach(() => { claimCompany.mockReset(); service.mockReset() })

  it('the claim failed for another reason (pool timeout): no unlocked recalculation, the error goes up', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    claimCompany.mockRejectedValue(new Error('Timed out fetching a new connection from the connection pool'))
    await expect(buildPointASnapshot('co', { trigger: 'manual', lock: true })).rejects.toThrow(/connection pool/)
    expect(service).not.toHaveBeenCalled()
  })

  it('no queue table yet (before migration 111): runs unlocked, as before', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    claimCompany.mockRejectedValue(Object.assign(new Error('relation "public.point_a_recalc_queue" does not exist'), { meta: { code: '42P01' } }))
    expect(await buildPointASnapshot('co', { trigger: 'manual', lock: true })).toEqual({ status: 'skipped', reason: 'not_migrated' })
    expect(service).toHaveBeenCalled()
  })

  it('another recalculation holds the company: skipped as busy', async () => {
    claimCompany.mockResolvedValue(null)
    expect(await buildPointASnapshot('co', { trigger: 'manual', lock: true })).toEqual({ status: 'skipped', reason: 'busy' })
    expect(service).not.toHaveBeenCalled()
  })
})
