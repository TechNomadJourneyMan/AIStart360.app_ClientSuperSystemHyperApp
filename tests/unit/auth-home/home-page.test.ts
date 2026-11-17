/**
 * Главная (/) — окно входа и регистрации вместо маркетингового лендинга.
 * Гость видит форму входа и путь к регистрации; вошедший уходит на /login,
 * где middleware ведёт его в кабинет по роли.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'

const s = vi.hoisted(() => ({ cookies: [] as { name: string; value: string }[] }))

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => s.cookies }),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}))
// R4 B3: the page reads the registration mode on the server (approval here — the old form).
vi.mock('@/lib/settings/system-settings', () => ({
  getRegistrationMode: async () => 'approval',
  getAutoApproveClients: async () => false,
}))
vi.mock('@/stores/auth.store', () => {
  const state = {
    user: null, isLoading: false, error: null,
    login: vi.fn(), loginWithGoogle: vi.fn(), register: vi.fn(), clearError: vi.fn(),
  }
  const useAuthStore = Object.assign(() => state, { getState: () => state, setState: vi.fn() })
  return { useAuthStore }
})

import HomePage, { metadata } from '@/app/page'
import { hasSupabaseSessionCookie, homeRedirectFor, initialHomeTab } from '@/components/auth-home/home-routing'

const render = async (searchParams?: { tab?: string }) =>
  renderToStaticMarkup((await HomePage({ searchParams })) as ReactElement)

describe('главная / — гость', () => {
  beforeEach(() => { s.cookies = [] })

  it('показывает форму входа и ссылку на регистрацию', async () => {
    const html = await render()
    expect(html).toContain('id="login-email"')
    expect(html).toContain('autoComplete="username"')
    expect(html).toContain('id="login-password"')
    expect(html).toContain('autoComplete="current-password"')
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Вход</)
    expect(html).toContain('Регистрация')
    expect(html).toContain('Создать аккаунт')
    // Регистрационная форма не отрендерена, пока не выбрана вкладка.
    expect(html).not.toContain('id="register-email"')
  })

  it('ведёт на юридические страницы; «О платформе» — только когда сайт продукта снова открыт (R4 B3: сейчас 402)', async () => {
    const prev = process.env.PRODUCT_SITE_LINK
    try {
      delete process.env.PRODUCT_SITE_LINK
      let html = await render()
      expect(html).not.toContain('href="https://aistart360.app"')
      expect(html).not.toContain('О платформе')
      expect(html).toContain('href="/privacy"')
      expect(html).toContain('href="/terms"')
      process.env.PRODUCT_SITE_LINK = 'on'
      html = await render()
      expect(html).toContain('href="https://aistart360.app"')
      expect(html).toContain('rel="noopener noreferrer"')
    } finally {
      if (prev === undefined) delete process.env.PRODUCT_SITE_LINK
      else process.env.PRODUCT_SITE_LINK = prev
    }
  })

  it('лендинга больше нет: ни цен, ни A/B-вариантов', async () => {
    const html = await render()
    expect(html).not.toContain('id="pricing"')
    expect(html).not.toContain('GRI Health Check')
  })

  it('?tab=register открывает регистрацию с подписанными полями', async () => {
    const html = await render({ tab: 'register' })
    for (const id of ['register-name', 'register-email', 'register-organization', 'register-password', 'register-confirm', 'register-terms']) {
      expect(html).toContain(`for="${id}"`)
      expect(html).toContain(`id="${id}"`)
    }
    expect(html).toContain('autoComplete="new-password"')
    expect(html).toContain('Подать заявку')
    expect(html).not.toContain('id="login-email"')
  })

  it('поля ввода не мельче 16px (без зума на iOS)', async () => {
    for (const tab of ['login', 'register']) {
      const html = await render({ tab })
      const inputs = html.match(/<input[^>]*>/g) ?? []
      expect(inputs.length).toBeGreaterThan(1)
      for (const input of inputs.filter((i) => !i.includes('type="checkbox"'))) {
        expect(input).toContain('text-base')
      }
    }
  })

  it('заголовок страницы — «Вход — AIStart360»', () => {
    expect(metadata.title).toEqual({ absolute: 'Вход — AIStart360' })
  })
})

describe('главная / — вошедший пользователь', () => {
  it('с cookie сессии Supabase уходит на /login (оттуда middleware ведёт в кабинет)', async () => {
    s.cookies = [{ name: 'sb-abcdef-auth-token.0', value: 'x' }]
    await expect(HomePage({})).rejects.toThrow('NEXT_REDIRECT /login')
  })
})

describe('home-routing', () => {
  it('распознаёт cookie сессии Supabase, в том числе чанки', () => {
    expect(hasSupabaseSessionCookie([{ name: 'sb-ref-auth-token' }])).toBe(true)
    expect(hasSupabaseSessionCookie([{ name: 'sb-ref-auth-token.1' }])).toBe(true)
    expect(hasSupabaseSessionCookie([{ name: 'theme' }, { name: 'sb-ref-other' }])).toBe(false)
  })

  it('без сессии редиректа нет, с сессией — /login', () => {
    expect(homeRedirectFor([])).toBeNull()
    expect(homeRedirectFor([{ name: 'NEXT_LOCALE' }])).toBeNull()
    expect(homeRedirectFor([{ name: 'sb-ref-auth-token' }])).toBe('/login')
  })

  it('стартовая вкладка — вход, регистрация только по ?tab=register', () => {
    expect(initialHomeTab(undefined)).toBe('login')
    expect(initialHomeTab({ tab: 'nope' })).toBe('login')
    expect(initialHomeTab({ tab: 'register' })).toBe('register')
    expect(initialHomeTab({ tab: ['register', 'login'] })).toBe('register')
  })
})
