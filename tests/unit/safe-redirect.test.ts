import { describe, it, expect } from 'vitest'
import { safeInternalPath } from '@/lib/safe-redirect'

describe('safeInternalPath', () => {
  it('accepts a simple internal path', () => {
    expect(safeInternalPath('/dashboard', '/fallback')).toBe('/dashboard')
  })

  it('accepts an internal path with query and hash', () => {
    expect(safeInternalPath('/client/point-a?tab=1#s', '/fallback')).toBe('/client/point-a?tab=1#s')
  })

  it('accepts the root path', () => {
    expect(safeInternalPath('/', '/fallback')).toBe('/')
  })

  it('rejects an absolute http(s) URL', () => {
    expect(safeInternalPath('https://evil.com', '/fallback')).toBe('/fallback')
    expect(safeInternalPath('http://evil.com/x', '/fallback')).toBe('/fallback')
  })

  it('rejects a protocol-relative URL (//host)', () => {
    expect(safeInternalPath('//evil.com', '/fallback')).toBe('/fallback')
  })

  it('rejects a backslash escape that URL parsers fold to //host', () => {
    expect(safeInternalPath('/\\evil.com', '/fallback')).toBe('/fallback')
    expect(safeInternalPath('/\\/evil.com', '/fallback')).toBe('/fallback')
  })

  it('rejects a value that does not start with a slash', () => {
    expect(safeInternalPath('dashboard', '/fallback')).toBe('/fallback')
    expect(safeInternalPath('javascript:alert(1)', '/fallback')).toBe('/fallback')
  })

  it('rejects a scheme even if slash-prefixed after trim tricks', () => {
    expect(safeInternalPath('  https://evil.com', '/fallback')).toBe('/fallback')
  })

  it('rejects control characters (newline / tab / null)', () => {
    expect(safeInternalPath('/foo\nbar', '/fallback')).toBe('/fallback')
    expect(safeInternalPath('/foo\tbar', '/fallback')).toBe('/fallback')
    expect(safeInternalPath('/foo\x00bar', '/fallback')).toBe('/fallback')
  })

  it('returns the fallback for empty, null or undefined input', () => {
    expect(safeInternalPath('', '/fallback')).toBe('/fallback')
    expect(safeInternalPath(null, '/fallback')).toBe('/fallback')
    expect(safeInternalPath(undefined, '/fallback')).toBe('/fallback')
  })

  it('trims surrounding whitespace on an otherwise valid path', () => {
    expect(safeInternalPath('  /dashboard  ', '/fallback')).toBe('/dashboard')
  })

  it('defaults the fallback to /dashboard when omitted', () => {
    expect(safeInternalPath('//evil.com')).toBe('/dashboard')
  })
})
