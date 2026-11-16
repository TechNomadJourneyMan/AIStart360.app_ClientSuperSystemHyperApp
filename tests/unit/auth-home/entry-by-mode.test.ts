/**
 * R4 B3 «Вход по режиму регистрации и честные тексты» — что видит человек
 * на /, /login, /register и в зале ожидания (react-dom/server):
 *   N4B-3  режим «по приглашению»: вместо формы регистрации — «Регистрация по
 *          приглашению» и «Запросить приглашение»; режимы approval/open — как раньше;
 *   R-051  «Демо-доступ» — только когда демо реально открыто (то же условие, что у API);
 *   R-104  один текст ожидания от режима и авто-одобрения, без «1 рабочего дня» и «24 часов»;
 *   R-107  без «500+», «27 отраслей», «94 % NPS» и отзыва «Вортекс Лабс»;
 *   N4B-8  на /register — только существующие разделы (без «Рынка»/TAM-SAM-SOM), GRI — 7 блоков.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ReactElement } from 'react'

const s = vi.hoisted(() => ({ mode: 'approval' as string, autoApprove: false }))

vi.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}))
vi.mock('@/lib/settings/system-settings', () => ({
  getRegistrationMode: async () => s.mode,
  getAutoApproveClients: async () => s.autoApprove,
}))
vi.mock('@/stores/auth.store', () => {
  const state = {
    user: null, isLoading: false, error: null,
    login: vi.fn(), loginWithGoogle: vi.fn(), register: vi.fn(), clearError: vi.fn(),
  }
  const useAuthStore = Object.assign(() => state, { getState: () => state, setState: vi.fn() })
  return { useAuthStore }
})
vi.mock('@/lib/supabase-client', () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }))
vi.mock('@/lib/auth/sign-out-client', () => ({ signOutThisBrowser: async () => '/login' }))
vi.mock('@/lib/events/client', () => ({ trackLogout: () => {} }))

import HomePage from '@/app/page'
import LoginPage, * as loginModule from '@/app/(auth)/login/page'
import RegisterPage, * as registerModule from '@/app/(auth)/register/page'
import * as homeModule from '@/app/page'
import WaitingRoomPage from '@/app/client/waiting-room/page'
import { demoAccessOpen } from '@/lib/registration/entry'
import { registrationWaitText } from '@/lib/registration/wait-text'

const home = async (tab?: string) => renderToStaticMarkup((await HomePage({ searchParams: tab ? { tab } : undefined })) as ReactElement)
const login = async () => renderToStaticMarkup((await LoginPage()) as ReactElement)
const register = async (notice?: string) => renderToStaticMarkup((await RegisterPage({ searchParams: notice ? { notice } : undefined })) as ReactElement)

const FAKE = ['500+', 'отраслей', 'диагностик<', '94%', 'NPS', 'Вортекс', 'вырасти в 3 раза']

beforeEach(() => {
  s.mode = 'approval'
  s.autoApprove = false
  delete process.env.DEMO_ACCESS_ENABLED
})

describe('N4B-3: главная / по режиму регистрации', () => {
  it('«по приглашению»: вкладка «Регистрация» — запрос приглашения, формы регистрации и пароля нет', async () => {
    s.mode = 'invite'
    const html = await home('register')
    expect(html).toContain('Регистрация по приглашению')
    expect(html).toContain('data-invite-request')
    for (const id of ['invite-name', 'invite-email', 'invite-company', 'invite-contact', 'invite-consent']) {
      expect(html).toContain(`id="${id}"`)
      expect(html).toContain(`for="${id}"`)
    }
    expect(html).toContain('Запросить приглашение')
    // Ловушка для ботов есть, но людям не видна.
    expect(html).toMatch(/aria-hidden="true"[^>]*>\s*<label for="invite-website"/)
    expect(html).toContain('tabindex="-1"')
    expect(html).not.toContain('id="register-password"')
    expect(html).not.toContain('Подать заявку')
    expect(html).not.toContain('1 рабочего дня')
  })

  it('«по приглашению»: на вкладке входа нет демо-кнопки, внизу — «Запросить приглашение»', async () => {
    s.mode = 'invite'
    const html = await home()
    expect(html).not.toContain('data-demo-access')
    expect(html).not.toContain('Демо-доступ')
    expect(html).toContain('Запросить приглашение')
    expect(html).not.toContain('Создать аккаунт')
  })

  it('«по подтверждению»: форма регистрации как раньше, текст ожидания без срока и с письмом только при ручной проверке', async () => {
    let html = await home('register')
    expect(html).toContain('id="register-password"')
    expect(html).toContain('Подать заявку')
    expect(html).not.toContain('data-invite-request')
    expect(html).toContain('data-register-wait')
    expect(html).toContain('Заявку рассмотрит администратор. Когда доступ откроют, на указанную почту придёт письмо.')
    expect(html).not.toContain('1 рабочего дня')
    s.autoApprove = true
    html = await home('register')
    expect(html).toContain('Обычно доступ к кабинету открывается сразу после регистрации.')
  })

  it('«открытая»: доступ сразу, писем не обещаем', async () => {
    s.mode = 'open'
    const html = await home('register')
    expect(html).toContain('Доступ к кабинету откроется сразу после регистрации.')
    expect(html).not.toContain('придёт письмо')
  })
})

describe('R-051: «Демо-доступ» — только когда демо открыто', () => {
  it('открыто (режим не «по приглашению», DEMO_ACCESS_ENABLED не false) — кнопка есть', async () => {
    expect(await home()).toContain('data-demo-access')
    expect(await login()).toContain('data-demo-access')
  })

  it('DEMO_ACCESS_ENABLED=false или режим «по приглашению» — кнопки нет нигде', async () => {
    process.env.DEMO_ACCESS_ENABLED = 'false'
    expect(await home()).not.toContain('Демо-доступ')
    expect(await login()).not.toContain('Демо-доступ')
    delete process.env.DEMO_ACCESS_ENABLED
    s.mode = 'invite'
    expect(await login()).not.toContain('Демо-доступ')
  })

  it('условие то же, что у POST /api/auth/demo-access', () => {
    expect(demoAccessOpen('approval', {})).toBe(true)
    expect(demoAccessOpen('open', {})).toBe(true)
    expect(demoAccessOpen('invite', {})).toBe(false)
    expect(demoAccessOpen('approval', { DEMO_ACCESS_ENABLED: 'false' })).toBe(false)
  })
})

describe('R-107 / N4B-8: /login и /register без придуманных чисел и «Рынка»', () => {
  it('/login: ни «500+», ни «27 отраслей», ни отзыва — только существующие разделы и бесплатная проверка GRI', async () => {
    const html = await login()
    for (const bad of FAKE) expect(html).not.toContain(bad)
    expect(html).toContain('Диагностика GRI')
    expect(html).toContain('Точка А')
    expect(html).toContain('Точка Б')
    expect(html).toContain('href="/gri-free"')
  })

  it('/login в режиме «по приглашению»: строка внизу ведёт к запросу приглашения', async () => {
    s.mode = 'invite'
    const html = await login()
    expect(html).toContain('Запросить приглашение')
    expect(html).not.toContain('Зарегистрироваться')
  })

  it('/register: GRI — 7 блоков, без «Рынка» и TAM/SAM/SOM, без «500+ / 27 / 94 % NPS»', async () => {
    const html = await register()
    for (const bad of FAKE) expect(html).not.toContain(bad)
    for (const bad of ['TAM', 'SOM', 'Рыночная аналитика', 'рыночной аналитикой', '6 доменам']) expect(html).not.toContain(bad)
    expect(html).toContain('7 блокам')
    expect(html).toContain('href="/gri-free"')
  })

  it('/register «по приглашению»: заголовок и форма запроса; пометка после Google без приглашения', async () => {
    s.mode = 'invite'
    let html = await register()
    expect(html).toContain('Регистрация по приглашению')
    expect(html).toContain('data-invite-request')
    expect(html).not.toContain('id="register-password"')
    expect(html).not.toContain('data-invite-notice')
    html = await register('invite_only')
    expect(html).toContain('data-invite-notice')
    expect(html).toContain('Вход через Google открыт только для тех, у кого уже есть аккаунт или приглашение.')
  })

  it('страницы входа читают режим при каждом заходе, а не при сборке', () => {
    expect(loginModule.dynamic).toBe('force-dynamic')
    expect(registerModule.dynamic).toBe('force-dynamic')
    expect(homeModule.dynamic).toBe('force-dynamic')
  })
})

describe('R-104: зал ожидания и тексты ожидания', () => {
  it('зал ожидания: без «24 часов», обещает письмо (одобрение в ГИГА его шлёт)', () => {
    const html = renderToStaticMarkup(createElement(WaitingRoomPage))
    expect(html).not.toContain('24 часов')
    expect(html).toContain('data-wait-note')
    expect(html).toContain('Когда доступ откроют, на вашу почту придёт письмо')
  })

  it('registrationWaitText: письмо — только при ручной проверке, срока нет нигде', () => {
    const all = [registrationWaitText('open', false), registrationWaitText('approval', false), registrationWaitText('approval', true), registrationWaitText('invite', false)]
    for (const t of all) {
      expect(t).not.toMatch(/рабоч(ий|его) дн|24 час|в течение/)
    }
    expect(registrationWaitText('open', true)).not.toContain('письмо')
  })
})
