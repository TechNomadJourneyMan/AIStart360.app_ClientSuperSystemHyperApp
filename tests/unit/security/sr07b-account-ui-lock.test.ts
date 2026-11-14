/**
 * SR-07b, вторая линия (главная — middleware): страницы, которые из браузера
 * меняют учётные данные клиента, сами не показывают форму, если сессия —
 * impersonation (или это не удаётся проверить):
 *  - /auth/reset-password не вызывает supabase.auth.updateUser — формы нет;
 *  - вкладка «Безопасность» настроек вместо кнопок 2FA / пароля / ключей
 *    показывает пояснение.
 * Обычный клиент видит всё как раньше.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const s = vi.hoisted(() => ({
  state: { kind: 'none' } as { kind: 'none' } | { kind: 'unknown' } | { kind: 'impersonation'; sid: string; adminId: string | null; via: 'cookie' | 'binding' },
  calls: [] as unknown[],
}))

vi.mock('@/lib/request-user', () => ({ getRequestUser: async () => ({ id: 'u-1' }) }))
vi.mock('@/lib/impersonation/guard', () => ({
  impersonationOfThisSession: async (userId: unknown) => { s.calls.push(userId); return s.state },
}))
// The form is a client component with the Supabase browser client; here only
// WHETHER it is rendered matters.
vi.mock('@/app/auth/reset-password/ResetPasswordForm', () => ({
  default: function ResetPasswordForm() { return createElement('form', { 'data-testid': 'reset-form' }) },
}))

const { default: ResetPasswordPage } = await import('@/app/auth/reset-password/page')
const { accountLockOf } = await import('@/lib/impersonation/account-lock')
const { SecurityTabContent } = await import('@/components/settings/SettingsClient')

const html = async () => {
  const el = (await ResetPasswordPage()) as ReactElement
  expect(isValidElement(el)).toBe(true)
  return renderToStaticMarkup(el)
}

beforeEach(() => {
  s.state = { kind: 'none' }
  s.calls = []
})

describe('SR-07b: /auth/reset-password (серверная обёртка)', () => {
  it('SR-07b: в impersonation формы смены пароля нет — только пояснение', async () => {
    s.state = { kind: 'impersonation', sid: 'imp-1', adminId: 'a-1', via: 'cookie' }
    const out = await html()
    expect(out).not.toContain('reset-form')
    expect(out).toContain('Недоступно в режиме просмотра от имени клиента')
    expect(s.calls).toEqual(['u-1'])
  })

  it('SR-07b: не удалось проверить режим → формы нет (fail closed)', async () => {
    s.state = { kind: 'unknown' }
    const out = await html()
    expect(out).not.toContain('reset-form')
    expect(out).toContain('Не удалось проверить')
  })

  it('SR-07b: обычная сессия / гость — форма как раньше', async () => {
    const out = await html()
    expect(out).toContain('reset-form')
    expect(out).not.toContain('Недоступно в режиме просмотра')
  })
})

describe('SR-07b: accountLockOf', () => {
  it('SR-07b: переводит состояние сессии в блокировку страниц учётной записи', () => {
    expect(accountLockOf({ kind: 'none' })).toBeNull()
    expect(accountLockOf({ kind: 'unknown' })).toBe('unknown')
    expect(accountLockOf({ kind: 'impersonation', sid: 'x', adminId: null, via: 'binding' })).toBe('impersonation')
  })
})

describe('SR-07b: вкладка «Безопасность» настроек', () => {
  const render = (lock: 'impersonation' | 'unknown' | null) =>
    renderToStaticMarkup(createElement(SecurityTabContent, { email: 'c@x.ru', lock }))

  it('SR-07b: в impersonation кнопок смены пароля / 2FA нет, есть пояснение', () => {
    const out = render('impersonation')
    expect(out).toContain('Недоступно в режиме просмотра от имени клиента')
    expect(out).not.toContain('<button')
    expect(out).not.toContain('type="password"')
  })

  it('SR-07b: режим не проверен → тоже заблокировано', () => {
    const out = render('unknown')
    expect(out).toContain('Не удалось проверить')
    expect(out).not.toContain('<button')
  })

  it('SR-07b: обычному клиенту вкладка доступна как раньше', () => {
    const out = render(null)
    expect(out).not.toContain('Недоступно в режиме просмотра')
    expect(out).toContain('type="password"')
  })
})
