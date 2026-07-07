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
