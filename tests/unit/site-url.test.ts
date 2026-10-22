import { describe, it, expect, afterEach } from 'vitest'
import { getSiteUrl } from '@/lib/site-url'

const SNAPSHOT = { ...process.env }
afterEach(() => {
  process.env = { ...SNAPSHOT }
})

describe('getSiteUrl', () => {
  it('prefers AUTH_URL', () => {
    process.env.AUTH_URL = 'https://portal.aistart360.app'
    process.env.NEXT_PUBLIC_APP_URL = 'https://ignored.example'
    expect(getSiteUrl()).toBe('https://portal.aistart360.app')
  })

  it('falls back to NEXT_PUBLIC_APP_URL when AUTH_URL is unset', () => {
    delete process.env.AUTH_URL
    process.env.NEXT_PUBLIC_APP_URL = 'https://ai-start360-app-client-super-system-xi.vercel.app'
    expect(getSiteUrl()).toBe('https://ai-start360-app-client-super-system-xi.vercel.app')
  })

  it('defaults to the canonical production domain when nothing is set', () => {
    delete process.env.AUTH_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(getSiteUrl()).toBe('https://portal.aistart360.app')
  })

  it('strips a trailing slash so concatenation is clean', () => {
    process.env.AUTH_URL = 'https://portal.aistart360.app/'
    expect(getSiteUrl()).toBe('https://portal.aistart360.app')
    expect(getSiteUrl('/register')).toBe('https://portal.aistart360.app/register')
  })

  it('joins a path argument', () => {
    process.env.AUTH_URL = 'https://portal.aistart360.app'
    expect(getSiteUrl('/register')).toBe('https://portal.aistart360.app/register')
    expect(getSiteUrl('register')).toBe('https://portal.aistart360.app/register')
  })
})

describe('getSiteUrl — stale or unsafe values never reach email links (W6)', () => {
  it('ignores the old friend deploy aistart360.vercel.app', () => {
    process.env.AUTH_URL = 'https://aistart360.vercel.app'
    expect(getSiteUrl('/auth/verify')).toBe('https://portal.aistart360.app/auth/verify')
  })

  it('in production ignores localhost and plain-http values', () => {
    const env = process.env as Record<string, string | undefined>
    env.NODE_ENV = 'production'
    env.AUTH_URL = 'http://localhost:3000'
    expect(getSiteUrl()).toBe('https://portal.aistart360.app')
    env.AUTH_URL = 'http://portal.aistart360.app'
    expect(getSiteUrl()).toBe('https://portal.aistart360.app')
  })

  it('ignores a value that is not a URL and falls through to the next one', () => {
    process.env.AUTH_URL = 'portal'
    process.env.NEXT_PUBLIC_APP_URL = 'https://portal.aistart360.app'
    expect(getSiteUrl()).toBe('https://portal.aistart360.app')
  })

  it('keeps localhost outside production (local development)', () => {
    process.env.AUTH_URL = 'http://localhost:3000'
    expect(getSiteUrl()).toBe('http://localhost:3000')
  })
})
