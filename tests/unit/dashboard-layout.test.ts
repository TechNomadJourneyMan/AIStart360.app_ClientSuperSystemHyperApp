import { describe, it, expect } from 'vitest'
import { sanitizeWidgetLayout } from '@/lib/dashboard/layout'

const VALID = ['alerts', 'activity', 'gri'] as const
const FALLBACK = [{ id: 'default-alerts', type: 'alerts' }]

describe('sanitizeWidgetLayout (DASH-01)', () => {
  it('returns the fallback for a non-array or empty layout', () => {
    expect(sanitizeWidgetLayout(null, VALID, FALLBACK)).toEqual(FALLBACK)
    expect(sanitizeWidgetLayout('nope', VALID, FALLBACK)).toEqual(FALLBACK)
    expect(sanitizeWidgetLayout([], VALID, FALLBACK)).toEqual(FALLBACK)
  })

  it('drops widgets whose type is not in the registry', () => {
    const out = sanitizeWidgetLayout(
      [{ id: 'a', type: 'alerts' }, { id: 'b', type: 'bogus' }],
      VALID,
      FALLBACK,
    )
    expect(out).toEqual([{ id: 'a', type: 'alerts' }])
  })

  it('dedups ids and preserves order', () => {
    const out = sanitizeWidgetLayout(
      [{ id: 'x', type: 'gri' }, { id: 'x', type: 'alerts' }, { id: 'y', type: 'activity' }],
      VALID,
      FALLBACK,
    )
    expect(out).toEqual([{ id: 'x', type: 'gri' }, { id: 'y', type: 'activity' }])
  })

  it('generates an id when one is missing', () => {
    const out = sanitizeWidgetLayout([{ type: 'gri' }], VALID, FALLBACK)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('gri')
    expect(typeof out[0].id).toBe('string')
    expect(out[0].id.length).toBeGreaterThan(0)
  })

  it('ignores non-object entries', () => {
    const out = sanitizeWidgetLayout(
      ['nope', 42, null, { id: 'a', type: 'alerts' }],
      VALID,
      FALLBACK,
    )
    expect(out).toEqual([{ id: 'a', type: 'alerts' }])
  })
})
