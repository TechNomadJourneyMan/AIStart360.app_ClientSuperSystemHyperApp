/**
 * R2-A (ревью M-2): an UNREADABLE access_gates switch must not open the paid
 * sections. The real reader (lib/settings/system-settings.ts) and the real
 * decision (lib/access/decision.ts); only the Supabase clients are fakes.
 * Before the fix: a read error → default false → «gates_off» → everything open.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The test environment pins the switch OFF (tests/helpers/setup.ts) — here the real reader is under test.
vi.unmock('@/lib/settings/system-settings')

const s = vi.hoisted(() => ({
  mode: 'ok' as 'ok' | 'error' | 'throw' | 'missing',
  value: true as unknown,
  staff: null as { id: string; role: string } | null,
}))

function settingsClient() {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = self
  chain.maybeSingle = async () => {
    if (s.mode === 'throw') throw new Error('fetch failed')
    if (s.mode === 'error') return { data: null, error: { code: '53300', message: 'sorry, too many clients already' } }
    if (s.mode === 'missing') return { data: null, error: null }
    return { data: { value: s.value }, error: null }
  }
  return { from: () => chain }
}
function sessionClient() {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const m of ['select', 'eq', 'order', 'limit', 'in']) chain[m] = self
  chain.maybeSingle = async () => ({ data: { tier: 'free', feature_flags: {} }, error: null })
  return { from: () => chain }
}

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => settingsClient(), requireServiceRoleKey: () => 'k' }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => 1 }))
vi.mock('@/lib/api-identity', async () => {
  const real = await vi.importActual<Record<string, unknown>>('@/lib/api-identity')
  return { ...real, getSessionStaff: async () => s.staff }
})

const settings = await import('@/lib/settings/system-settings')
const { resolveFeature } = await import('@/lib/access/decision')
const PAID = ['point_a', 'point_b', 'market', 'gri_full'] as const

beforeEach(() => {
  settings.resetAccessGatesCacheForTests()
  s.mode = 'ok'
  s.value = true
  s.staff = null
})

describe('access_gates reader', () => {
  it('a stored value is returned (boolean or the legacy {enabled})', async () => {
    expect(await settings.getAccessGatesEnabled()).toBe(true)
    s.value = { enabled: false }
    expect(await settings.getAccessGatesEnabled()).toBe(false)
  })

  it('no row → false, the default (nothing restricted)', async () => {
    s.mode = 'missing'
    expect(await settings.getAccessGatesEnabled()).toBe(false)
  })

  it('a read ERROR (overloaded DB) with nothing known → gates ON (fail closed)', async () => {
    s.mode = 'error'
    expect(await settings.getAccessGatesEnabled()).toBe(true)
    s.mode = 'throw'
    expect(await settings.getAccessGatesEnabled()).toBe(true)
  })

  it('a read error right after a successful read → the last known value (no flapping)', async () => {
    s.value = false
    expect(await settings.getAccessGatesEnabled()).toBe(false)
    s.mode = 'error'
    expect(await settings.getAccessGatesEnabled()).toBe(false)
  })
})

describe('the decision during a settings outage', () => {
  it('a Free client gets every paid section CLOSED (it used to get «gates_off» = open)', async () => {
    s.mode = 'error'
    for (const f of PAID) {
      const d = await resolveFeature(sessionClient() as never, 'u-free', f, { exemptStaff: true })
      expect(d.allowed, f).toBe(false)
      expect(d.reason, f).toBe('upgrade_required')
    }
  })

  it('staff of the session still pass', async () => {
    s.mode = 'error'
    s.staff = { id: 'u-staff', role: 'admin' }
    for (const f of PAID) expect((await resolveFeature(sessionClient() as never, 'u-staff', f, { exemptStaff: true })).allowed, f).toBe(true)
  })
})
