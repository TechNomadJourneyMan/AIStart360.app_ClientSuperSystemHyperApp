import { describe, expect, it } from 'vitest'
import { SETTINGS } from '@/lib/settings/registry'

describe('«Агенты по расписанию (24/7)»', () => {
  it('is off by default — scheduled agents do not run around the clock', () => {
    expect(SETTINGS.agents_scheduled.default).toBe(false)
    expect(SETTINGS.agents_scheduled.group).toBe('agents')
  })
})
