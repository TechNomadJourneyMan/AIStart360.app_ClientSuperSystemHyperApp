import { describe, it, expect } from 'vitest'
import { formatScreenContext } from '@/lib/assistant/gree-chat'

describe('formatScreenContext (GRI-01)', () => {
  it('injects the current-screen focus for a known screen (ru)', () => {
    const out = formatScreenContext('/gri', 'ru')
    expect(out).toContain('ТЕКУЩИЙ ЭКРАН')
    expect(out).toContain('/gri')
    expect(out).toContain('GRI-индекс')
  })

  it('returns empty for an unknown screen', () => {
    expect(formatScreenContext('/does-not-exist', 'ru')).toBe('')
  })

  it('returns empty for null / undefined', () => {
    expect(formatScreenContext(null, 'ru')).toBe('')
    expect(formatScreenContext(undefined, 'ru')).toBe('')
  })

  it('renders English for the en locale', () => {
    const out = formatScreenContext('/point-a', 'en')
    expect(out).toContain('CURRENT SCREEN')
    expect(out).toContain('/point-a')
  })
})
