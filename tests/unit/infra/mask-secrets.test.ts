/**
 * lib/runtime/mask-secrets.ts — a database error message can echo the connection string, or the
 * user and password out of it. Whatever goes to the log passes through maskConnectionSecrets first.
 */
import { describe, expect, it } from 'vitest'
import { maskConnectionSecrets } from '@/lib/runtime/mask-secrets'

describe('maskConnectionSecrets', () => {
  const URL = 'postgres://claimuser:hunter2-secret@db.invalid:5432/app'

  it('masks the whole connection string', () => {
    const out = maskConnectionSecrets(`could not connect using ${URL}`, URL)
    expect(out).not.toContain(URL)
    expect(out).not.toContain('hunter2-secret')
    expect(out).toContain('***')
  })

  it('masks the user and the password on their own', () => {
    const out = maskConnectionSecrets('password authentication failed for user "claimuser" (hunter2-secret)', URL)
    expect(out).not.toContain('claimuser')
    expect(out).not.toContain('hunter2-secret')
    expect(out).toContain('password authentication failed for user')
  })

  it('masks a percent-encoded password both as written and decoded', () => {
    const url = 'postgres://app:p%40ss%2Fword@db.invalid:5432/app'
    expect(maskConnectionSecrets('raw p%40ss%2Fword', url)).not.toContain('p%40ss%2Fword')
    expect(maskConnectionSecrets('decoded p@ss/word', url)).not.toContain('p@ss/word')
  })

  it('a malformed % in the password still masks the raw password and the user', () => {
    // decodeURIComponent('bad%zzpass') throws; the raw values must be masked all the same
    const url = 'postgres://someuser:bad%zzpass@db.invalid:5432/app'
    const out = maskConnectionSecrets('user someuser, password bad%zzpass', url)
    expect(out).not.toContain('bad%zzpass')
    expect(out).not.toContain('someuser')
  })

  it('a malformed % in the user still masks the password', () => {
    const url = 'postgres://us%zzer:topsecret@db.invalid:5432/app'
    const out = maskConnectionSecrets('us%zzer / topsecret', url)
    expect(out).not.toContain('topsecret')
    expect(out).not.toContain('us%zzer')
  })

  it('something that is not a URL is masked as a whole', () => {
    const conn = 'host=db.invalid user=x password=y'
    expect(maskConnectionSecrets(`failed: ${conn}`, conn)).toBe('failed: ***')
  })

  it('no connection string, or one without user and password, leaves the message alone', () => {
    expect(maskConnectionSecrets('connect ECONNREFUSED 127.0.0.1:5432', undefined)).toBe('connect ECONNREFUSED 127.0.0.1:5432')
    expect(maskConnectionSecrets('connect ECONNREFUSED 127.0.0.1:5432', '')).toBe('connect ECONNREFUSED 127.0.0.1:5432')
    // an empty user or password must not turn into a split on '' (*** between every character)
    expect(maskConnectionSecrets('connect ECONNREFUSED', 'postgres://db.invalid:5432/app')).toBe('connect ECONNREFUSED')
  })
})
