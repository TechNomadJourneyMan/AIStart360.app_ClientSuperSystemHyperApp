/**
 * Одно правило пароля и понятные причины отказа Supabase (W6).
 */
import { describe, expect, it } from 'vitest'
import {
  PASSWORD_MIN,
  classifyPasswordUpdateError,
  passwordPolicyError,
  passwordUpdateErrorText,
  passwordUpdateMessage,
} from '@/lib/auth/password-policy'

describe('passwordPolicyError', () => {
  it('минимум 8 символов, максимум 72 байта (bcrypt)', () => {
    expect(PASSWORD_MIN).toBe(8)
    expect(passwordPolicyError('1234567')).toMatch(/минимум 8/)
    expect(passwordPolicyError('12345678')).toBeNull()
    expect(passwordPolicyError('я'.repeat(37))).toMatch(/слишком длинный/) // 74 байта
    expect(passwordPolicyError('a'.repeat(72))).toBeNull()
  })
})

describe('classifyPasswordUpdateError', () => {
  it('распознаёт коды и тексты Supabase Auth', () => {
    expect(classifyPasswordUpdateError({ code: 'weak_password', message: 'x' })).toBe('weak_password')
    expect(classifyPasswordUpdateError({ message: 'Password should be at least 8 characters.' })).toBe('weak_password')
    expect(classifyPasswordUpdateError({ code: 'same_password', message: 'x' })).toBe('same_password')
    expect(classifyPasswordUpdateError({ message: 'New password should be different from the old password.' })).toBe('same_password')
    expect(classifyPasswordUpdateError({ code: 'reauthentication_needed', message: 'x' })).toBe('reauthentication_needed')
    expect(classifyPasswordUpdateError({ message: 'Request rate limit reached', status: 429 })).toBe('rate_limited')
    expect(classifyPasswordUpdateError({ message: 'Auth session missing!' })).toBe('session_expired')
    expect(classifyPasswordUpdateError({ message: 'Database error' })).toBe('update_failed')
    expect(classifyPasswordUpdateError(null)).toBe('update_failed')
  })
})

describe('тексты', () => {
  it('слабый пароль — перечисляет причины по-русски', () => {
    expect(passwordUpdateErrorText({ code: 'weak_password', message: 'x', reasons: ['pwned'] })).toMatch(/утёкших/)
    expect(passwordUpdateMessage('weak_password')).toMatch(/простой/)
  })

  it('ни одного английского текста наружу', () => {
    for (const k of ['weak_password', 'same_password', 'reauthentication_needed', 'rate_limited', 'session_expired', 'update_failed', 'wrong_current_password', 'whatever']) {
      expect(passwordUpdateMessage(k)).toMatch(/[а-яё]/i)
      expect(passwordUpdateMessage(k)).not.toMatch(/[a-z]{4,}/)
    }
  })
})
