import { describe, it, expect, afterEach, vi } from 'vitest'
import { safeErrorMessage } from '@/lib/api-error'

// process.env.NODE_ENV is typed read-only, so stub it via vitest instead of
// assigning directly.
afterEach(() => { vi.unstubAllEnvs() })

describe('safeErrorMessage', () => {
  it('returns the real error message in non-production (for local debugging)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(safeErrorMessage(new Error('connect ECONNREFUSED 10.0.0.1:5432'))).toBe(
      'connect ECONNREFUSED 10.0.0.1:5432',
    )
  })

  it('hides the message in production (no internal detail leak)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(safeErrorMessage(new Error('secret db host detail'), 'Ошибка сервера')).toBe(
      'Ошибка сервера',
    )
  })

  it('uses the fallback for non-Error throwables even in dev', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(safeErrorMessage('a string', 'Ошибка')).toBe('Ошибка')
    expect(safeErrorMessage(undefined, 'Ошибка')).toBe('Ошибка')
  })

  it('uses the fallback for an Error with an empty message', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(safeErrorMessage(new Error(''), 'Ошибка')).toBe('Ошибка')
  })

  it('defaults the fallback when omitted', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(safeErrorMessage(new Error('x'))).toBe('Внутренняя ошибка сервера')
  })
})
