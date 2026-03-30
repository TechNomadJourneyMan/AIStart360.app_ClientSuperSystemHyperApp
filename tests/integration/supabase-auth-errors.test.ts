import { describe, expect, it } from 'vitest'
import { isSupabaseEmailRateLimitError } from '@/lib/supabase/auth-errors'
import { isSupabaseEmailNotConfirmedError } from '@/lib/supabase/auth-errors'

describe('isSupabaseEmailRateLimitError', () => {
  it('returns true for email rate limit exceeded message', () => {
    expect(isSupabaseEmailRateLimitError('email rate limit exceeded')).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isSupabaseEmailRateLimitError('invalid login credentials')).toBe(false)
  })
})

describe('isSupabaseEmailNotConfirmedError', () => {
  it('returns true for email not confirmed message', () => {
    expect(isSupabaseEmailNotConfirmedError('Email not confirmed')).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isSupabaseEmailNotConfirmedError('invalid login credentials')).toBe(false)
  })
})
