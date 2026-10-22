/**
 * W6: вход через Google не должен навязывать /dashboard, а /login должен
 * объяснять, почему туда вернули (просроченная ссылка, блокировка).
 */
import { describe, expect, it } from 'vitest'
import { loginNotice, oauthCallbackUrl } from '@/lib/auth/login-links'

describe('oauthCallbackUrl', () => {
  it('без ?from= не передаёт next — /auth/callback выберет кабинет по роли', () => {
    const url = new URL(oauthCallbackUrl('https://portal.aistart360.app'))
    expect(url.origin + url.pathname).toBe('https://portal.aistart360.app/auth/callback')
    expect(url.searchParams.has('next')).toBe(false)
  })

  it('явный внутренний ?from= сохраняется', () => {
    const url = new URL(oauthCallbackUrl('https://portal.aistart360.app', '/admin-giga-panel/users'))
    expect(url.searchParams.get('next')).toBe('/admin-giga-panel/users')
  })

  it('чужой адрес в from отбрасывается', () => {
    const url = new URL(oauthCallbackUrl('https://portal.aistart360.app', 'https://evil.example'))
    expect(url.searchParams.has('next')).toBe(false)
  })
})

describe('loginNotice', () => {
  const p = (q: string) => new URLSearchParams(q)
  it('объясняет просроченную и неполную ссылку и блокировку', () => {
    expect(loginNotice(p('error=link_expired'))).toMatch(/устарела/)
    expect(loginNotice(p('error=link_invalid'))).toMatch(/неполная/)
    expect(loginNotice(p('blocked=1'))).toMatch(/закрыт/)
  })
  it('молчит без параметров и на чужих значениях', () => {
    expect(loginNotice(p(''))).toBeNull()
    expect(loginNotice(p('error=<script>'))).toBeNull()
  })
})
