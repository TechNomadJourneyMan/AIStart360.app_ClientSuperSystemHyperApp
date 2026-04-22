import { describe, expect, it } from 'vitest'

import {
  hashBytes,
  hashSurveyAnswers,
  shortHash,
} from '@/lib/ai/document-hash'

describe('hashBytes', () => {
  it('returns 64-char hex sha256', () => {
    const h = hashBytes(Buffer.from('hello'))
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('deterministic across calls', () => {
    const a = hashBytes(Buffer.from('same'))
    const b = hashBytes(Buffer.from('same'))
    expect(a).toBe(b)
  })

  it('different inputs produce different hashes', () => {
    expect(hashBytes(Buffer.from('a'))).not.toBe(hashBytes(Buffer.from('b')))
  })

  it('handles ArrayBuffer + Uint8Array', () => {
    const buf = new TextEncoder().encode('test')
    expect(hashBytes(buf)).toMatch(/^[0-9a-f]{64}$/)

    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    expect(hashBytes(ab)).toBe(hashBytes(buf))
  })
})

describe('hashSurveyAnswers', () => {
  it('same answers → same hash regardless of key order', () => {
    const a = hashSurveyAnswers({ a: 1, b: 2 })
    const b = hashSurveyAnswers({ b: 2, a: 1 })
    expect(a).toBe(b)
  })

  it('different values → different hash', () => {
    expect(hashSurveyAnswers({ x: 1 })).not.toBe(hashSurveyAnswers({ x: 2 }))
  })
})

describe('shortHash', () => {
  it('returns first 8 chars', () => {
    expect(shortHash('abcdef1234567890')).toBe('abcdef12')
  })
})
