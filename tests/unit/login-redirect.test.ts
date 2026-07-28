import { describe, expect, it } from 'vitest'
import { safeInternalPath } from '@/app/(auth)/login/return-path'

describe('login return path', () => {
  it('keeps an internal path with its query string', () => {
    expect(safeInternalPath('/clients?q=acme&page=2')).toBe('/clients?q=acme&page=2')
  })

  it.each([
    null,
    '',
    'https://example.com/clients',
    '//example.com/clients',
    '/\\example.com/clients',
  ])('rejects an unsafe return path: %s', (value) => {
    expect(safeInternalPath(value)).toBeNull()
  })
})
