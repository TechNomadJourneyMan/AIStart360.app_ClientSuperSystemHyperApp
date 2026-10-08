import { describe, expect, it } from 'vitest'
import { isBearerAuthorized, safeSecretEquals } from '@/lib/security/cron-auth'

const req = (headers: Record<string, string> = {}, url = 'http://localhost/api/cron/crm-digest') => new Request(url, { headers })

describe('cron bearer auth (S19)', () => {
  it('accepts only the Authorization header', () => {
    expect(isBearerAuthorized(req({ authorization: 'Bearer s3cret' }), ['s3cret'])).toBe(true)
    expect(isBearerAuthorized(req({}, 'http://localhost/api/cron/crm-digest?secret=s3cret'), ['s3cret'])).toBe(false)
  })

  it('rejects wrong / empty secrets and unset configuration', () => {
    expect(isBearerAuthorized(req({ authorization: 'Bearer nope' }), ['s3cret'])).toBe(false)
    expect(isBearerAuthorized(req({ authorization: 'Bearer ' }), ['s3cret'])).toBe(false)
    expect(isBearerAuthorized(req({ authorization: 'Bearer s3cret' }), [undefined, ''])).toBe(false)
    expect(isBearerAuthorized(req({ authorization: 's3cret' }), ['s3cret'])).toBe(false)
  })

  it('matches any configured secret', () => {
    expect(isBearerAuthorized(req({ authorization: 'Bearer cron' }), ['tg', 'cron'])).toBe(true)
  })

  it('compares in constant time regardless of length', () => {
    expect(safeSecretEquals('abc', 'abcd')).toBe(false)
    expect(safeSecretEquals('abc', 'abc')).toBe(true)
  })
})
