/**
 * W6: вход через Google не должен навязывать /dashboard, а /login должен
 * объяснять, почему туда вернули (просроченная ссылка, блокировка).
 */
import { describe, expect, it } from 'vitest'
import { friendlyAuthError, loginNotice, oauthCallbackUrl } from '@/lib/auth/login-links'

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

describe('friendlyAuthError', () => {
  it('переводит типовые отказы Supabase на русский', () => {
    expect(friendlyAuthError('Invalid login credentials')).toMatch(/Неверный email или пароль/)
    expect(friendlyAuthError('Invalid login credentials')).toMatch(/Google/)
    expect(friendlyAuthError('Request rate limit reached')).toMatch(/Слишком много/)
    expect(friendlyAuthError('Failed to fetch')).toMatch(/Нет связи/)
    expect(friendlyAuthError('User is banned')).toMatch(/закрыт/)
    expect(friendlyAuthError('Unsupported provider: provider is not enabled')).toMatch(/недоступен/)
  })
  it('русский текст из нашего API пропускает, неизвестный английский — нет', () => {
    expect(friendlyAuthError('Регистрация доступна только по приглашению.')).toBe('Регистрация доступна только по приглашению.')
    expect(friendlyAuthError('Some internal GoTrue error 500')).toBe('Не удалось войти. Попробуйте ещё раз.')
    expect(friendlyAuthError('', 'Ошибка регистрации')).toBe('Ошибка регистрации')
  })
})
