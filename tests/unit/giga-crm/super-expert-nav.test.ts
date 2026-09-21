/**
 * Кабинет SuperExpert: меню ведёт в свой базовый путь и не показывает
 * системных разделов, а каждая его позиция закрыта правом, которое у роли есть.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GIGA_BASE, SUPER_EXPERT_BASE, SUPER_EXPERT_NAV, gigaSectionTitle, isNavActive } from '@/lib/admin/nav'
import { hasPermission } from '@/lib/admin/rbac'

const items = SUPER_EXPERT_NAV.flatMap((g) => g.items)

describe('навигация SuperExpert', () => {
  it('все ссылки ведут в свой кабинет, а не в админскую панель', () => {
    for (const i of items) {
      expect(i.href.startsWith(SUPER_EXPERT_BASE), i.href).toBe(true)
      expect(i.href.startsWith(GIGA_BASE), i.href).toBe(false)
    }
  })

  it('каждый раздел доступен роли super_expert', () => {
    for (const i of items) expect(hasPermission('super_expert', i.permission), i.label).toBe(true)
  })

  it('в меню нет системных разделов', () => {
    const labels = items.map((i) => i.label.toLowerCase())
    for (const forbidden of ['настройки', 'роли', 'аудит', 'от имени', 'разделы', 'контент']) {
      expect(labels.some((l) => l.includes(forbidden)), forbidden).toBe(false)
    }
  })

  it('подписи разделов работают для обоих кабинетов', () => {
    expect(gigaSectionTitle(`${SUPER_EXPERT_BASE}/users/abc`)).toBe('Пользователи')
    expect(gigaSectionTitle(`${GIGA_BASE}/audit`)).toBe('Журнал аудита')
  })

  it('«Главная» подсвечивается только на самой главной', () => {
    const home = items[0]
    expect(isNavActive(home, SUPER_EXPERT_BASE)).toBe(true)
    expect(isNavActive(home, `${SUPER_EXPERT_BASE}/users`)).toBe(false)
  })
})

describe('вход в кабинет SuperExpert', () => {
  it('на странице входа есть вход по ссылке на почту', () => {
    // Без этого сотрудник с Google-аккаунтом (пароля нет, Google-вход сломан
    // из-за чужого Site URL в Supabase) не попадёт в свой кабинет вообще.
    const src = readFileSync(resolve(process.cwd(), 'app/super-expert/login/page.tsx'), 'utf8')
    expect(src).toContain('/api/v1/auth/email-link')
    expect(src).toContain('Войти по ссылке на почту')
    // Ссылка ведёт в кабинет SuperExpert, а не в клиентский дашборд.
    expect(src).toContain('next: SUPER_EXPERT_BASE')
    // Права подтверждает сервер, а не форма.
    expect(src).toContain('/api/giga-admin/me')
  })
})
