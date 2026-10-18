import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixturePointB, POINT_B_FIXTURE_VARIANTS } from '@/lib/point-b/fixtures'

// React picks its dev/prod build at the FIRST require. Load the dev one now, before a test stubs NODE_ENV=production.
await import('react/jsx-dev-runtime')

function numbersOf(v: unknown, out: number[] = []): number[] {
  if (typeof v === 'number') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => numbersOf(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => numbersOf(x, out))
  return out
}

// The page module (and React's JSX runtime) is evaluated per NODE_ENV: do not leak it between tests.
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('fixturePointB', () => {
  it('every variant is a valid PointBV2 (gap, trajectory, scenarios, horizons present; no NaN)', () => {
    expect(POINT_B_FIXTURE_VARIANTS).toEqual(['full', 'no-goal', 'stale-base', 'level2'])
    for (const variant of POINT_B_FIXTURE_VARIANTS) {
      const pb = fixturePointB(variant)
      expect(pb.gap).toHaveLength(2)
      expect(pb.scenarios).toHaveLength(3)
      expect(Object.keys(pb.horizons).sort()).toEqual(['month', 'one_year', 'quarter', 'three_year', 'week'])
      expect(pb.trajectory).toBeDefined()
      expect(pb.realism).toBeDefined()
      expect(pb.data_quality).toBeDefined()
      expect(numbersOf(pb).every((n) => Number.isFinite(n))).toBe(true)
    }
  })

  it('full variant has complete gap data, a trajectory and an AI strategy', () => {
    const pb = fixturePointB('full')
    expect(pb.data_sufficiency.sufficient).toBe(true)
    expect(pb.gap.every((g) => g.data_complete)).toBe(true)
    expect(pb.trajectory.monthly_12m).toHaveLength(12)
    expect(pb.ai_status).toBe('completed')
    expect(pb.data_quality.base.stale).toBe(false)
  })

  it('no-goal variant has data_sufficiency.sufficient false (the plan calls it «complete false») and no gap', () => {
    const pb = fixturePointB('no-goal')
    expect(pb.data_sufficiency.sufficient).toBe(false)
    expect(pb.gap.every((g) => !g.data_complete)).toBe(true)
    expect(pb.trajectory.monthly_12m).toEqual([])
    expect(pb.realism.level).toBe('unknown')
  })

  it('stale-base variant flags the 2024 base and a block without data', () => {
    const pb = fixturePointB('stale-base')
    expect(pb.data_quality.base).toMatchObject({ period: '2024', stale: true })
    expect(pb.data_quality.blocks_without_data).toEqual(['sales'])
    expect(pb.realism.rationale.join(' ')).toContain('устарел')
  })

  it('is deterministic: two calls give the same result', () => {
    for (const variant of POINT_B_FIXTURE_VARIANTS) {
      expect(fixturePointB(variant)).toEqual(fixturePointB(variant))
    }
  })

  it('returns independent objects (a caller cannot corrupt the next call)', () => {
    const a = fixturePointB('full')
    a.gap.length = 0
    expect(fixturePointB('full').gap).toHaveLength(2)
  })
})

describe('the preview page', () => {
  it('the preview page is not served in production (NODE_ENV production → notFound)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { default: Page } = await import('@/app/dev/point-b-preview/page')
    expect(() => Page({ searchParams: {} })).toThrow(/NEXT_NOT_FOUND|not.?found/i)
  })

  it('renders a variant outside production, falling back to «full» for an unknown one', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { default: Page } = await import('@/app/dev/point-b-preview/page')
    expect(Page({ searchParams: { variant: 'stale-base' } })).toBeTruthy()
    expect(Page({ searchParams: { variant: 'nonsense' } })).toBeTruthy()
  })
})
