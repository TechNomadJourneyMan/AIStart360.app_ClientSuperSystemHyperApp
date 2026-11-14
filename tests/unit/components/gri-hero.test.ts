import { describe, it, expect, vi } from 'vitest'

// GriHero pulls in framer-motion at module load; stub it so the pure-helper
// import works under the node test environment without a DOM.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => 'div' }),
}))

import { heroStatus } from '@/components/gri/page/GriHero'

describe('heroStatus', () => {
  // R-036 / BI-60: the hero uses the one set of GRI zones (lib/format/gri.ts):
  // < 4 critical, 4–6 developing, 6–8 strong, ≥ 8 excellent.
  it('maps GRI to readiness tone', () => {
    expect(heroStatus(null).tone).toBe('none')
    expect(heroStatus(0).tone).toBe('none')
    expect(heroStatus(8.2)).toEqual({ label: 'Отлично', tone: 'ok' })
    expect(heroStatus(7)).toEqual({ label: 'Устойчиво', tone: 'ok' })
    expect(heroStatus(4.9)).toEqual({ label: 'Развивается', tone: 'warn' })
    expect(heroStatus(3.9)).toEqual({ label: 'Критично', tone: 'bad' })
  })
})
