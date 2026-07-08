import { describe, it, expect, vi } from 'vitest'

// GriHero pulls in framer-motion at module load; stub it so the pure-helper
// import works under the node test environment without a DOM.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => 'div' }),
}))

import { heroStatus } from '@/components/gri/page/GriHero'

describe('heroStatus', () => {
  it('maps GRI to readiness tone', () => {
    expect(heroStatus(null).tone).toBe('none')
    expect(heroStatus(8.2).tone).toBe('ok')
    expect(heroStatus(7).tone).toBe('warn')
    expect(heroStatus(4.9).tone).toBe('bad')
  })
})
