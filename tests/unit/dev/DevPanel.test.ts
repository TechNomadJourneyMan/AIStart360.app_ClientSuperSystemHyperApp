/**
 * The floating developer panel (components/dev/DevPanel.tsx).
 *
 * The repo has neither jsdom nor @testing-library, so — as for the pop-up
 * layer — the behaviour lives in plain functions that take `fetch` as an
 * argument and is tested with a fetch double, and the markup is a stateless
 * view rendered with react-dom/server. What needs a real browser (focus,
 * Escape, the page reload) is left to the manual pass in docs/dev-login.md.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import DevPanel, {
  DevPanelView,
  currentRoleLabel,
  devErrorText,
  devLogin,
  devLogout,
  devSetMode,
  loadDevSession,
  resolveDevSession,
  safeRedirect,
  type DevPanelViewProps,
  type DevSession,
} from '@/components/dev/DevPanel'

const ROLES = [
  { role: 'client', label: 'Клиент' },
  { role: 'expert', label: 'Эксперт' },
  { role: 'super_expert', label: 'Супер-эксперт' },
  { role: 'admin', label: 'Админ' },
  { role: 'super_admin', label: 'Супер-админ' },
  { role: 'crm_manager', label: 'CRM-менеджер' },
  { role: 'content_manager', label: 'Контент-менеджер' },
  { role: 'analyst', label: 'Аналитик' },
  { role: 'support', label: 'Поддержка' },
]
const SESSION: DevSession = { devMode: false, roles: ROLES, current: null }

function view(over: Partial<DevPanelViewProps> = {}): string {
  const props: DevPanelViewProps = {
    session: SESSION,
    open: true,
    busy: false,
    error: null,
    email: '',
    onOpenChange: () => {},
    onEmailChange: () => {},
    onToggleMode: () => {},
    onLoginRole: () => {},
    onLoginEmail: () => {},
    onLogout: () => {},
    ...over,
  }
  return renderToStaticMarkup(createElement(DevPanelView, props))
}

/** Every `<button …>text</button>` of the markup: its attributes and its text. */
function buttons(html: string): Array<{ attrs: string; text: string }> {
  return Array.from(html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)).map((m) => ({
    attrs: m[1],
    text: m[2].replace(/<[^>]+>/g, '').trim(),
  }))
}

type Call = { url: string; init?: RequestInit }
function fetchDouble(answer: (call: Call) => { status: number; body?: unknown; raw?: string } | Error) {
  const calls: Call[] = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url, init }
    calls.push(call)
    const res = answer(call)
    if (res instanceof Error) throw res
    return new Response(res.raw ?? JSON.stringify(res.body ?? {}), { status: res.status, headers: { 'content-type': 'application/json' } })
  })
  return { fetchFn: fn as unknown as typeof fetch, calls }
}

describe('before the session is known', () => {
  it('the panel renders nothing (also on the server)', () => {
    expect(renderToStaticMarkup(createElement(DevPanel))).toBe('')
  })

  it('a host that is not local is not even asked', async () => {
    for (const hostname of ['portal.aistart360.app', '192.168.1.5', 'localhost.evil.com', '0.0.0.0', '']) {
      const { fetchFn, calls } = fetchDouble(() => ({ status: 200, body: { enabled: true, devMode: false, roles: ROLES, current: null } }))
      expect(await resolveDevSession(hostname, fetchFn), hostname).toBeNull()
      expect(calls, hostname).toEqual([])
    }
  })

  it('on a local host the panel appears only when GET /api/dev/session answers 200', async () => {
    const ok = fetchDouble(() => ({ status: 200, body: { enabled: true, devMode: true, roles: ROLES, current: { email: 'dev-client@dev.aistart360.test', role: 'client', staffRole: null } } }))
    for (const hostname of ['localhost', '127.0.0.1', '[::1]', 'app.localhost']) {
      expect(await resolveDevSession(hostname, ok.fetchFn), hostname).toEqual({
        devMode: true,
        roles: ROLES,
        current: { email: 'dev-client@dev.aistart360.test', role: 'client', staffRole: null },
      })
    }
    expect(ok.calls[0].url).toBe('/api/dev/session')

    expect(await loadDevSession(fetchDouble(() => ({ status: 404, body: { error: 'NOT_FOUND' } })).fetchFn)).toBeNull()
    expect(await loadDevSession(fetchDouble(() => ({ status: 500 })).fetchFn)).toBeNull()
    expect(await loadDevSession(fetchDouble(() => new Error('offline')).fetchFn)).toBeNull()
    expect(await loadDevSession(fetchDouble(() => ({ status: 200, raw: '<html>' })).fetchFn)).toBeNull()
    expect(await loadDevSession(fetchDouble(() => ({ status: 200, body: { devMode: true, roles: ROLES } })).fetchFn)).toBeNull()
    expect(await loadDevSession(fetchDouble(() => ({ status: 200, body: { enabled: true } })).fetchFn)).toBeNull()
  })
})

describe('collapsed', () => {
  it('is one small pill «DEV» in the bottom-left corner, above everything else', () => {
    const html = view({ open: false })
    const all = buttons(html)
    expect(all).toHaveLength(1)
    expect(all[0].text).toBe('DEV')
    expect(all[0].attrs).toContain('aria-expanded="false"')
    expect(html).toMatch(/class="[^"]*\bfixed\b[^"]*"/)
    expect(html).toMatch(/\bleft-3\b/)
    expect(html).toMatch(/\bbottom-/)
    expect(html).toContain('z-[2147483647]')
    expect(html).not.toContain('Режим разработки')
    expect(html).not.toContain('Войти как роль')
  })
})

describe('expanded', () => {
  it('the pill stays, says it is expanded and names the card it controls', () => {
    const html = view()
    const pill = buttons(html).find((b) => b.text === 'DEV')
    expect(pill?.attrs).toContain('aria-expanded="true"')
    const cardId = /aria-controls="([^"]+)"/.exec(pill?.attrs ?? '')?.[1]
    expect(cardId).toBeTruthy()
    expect(html).toMatch(new RegExp(`<section[^>]*id="${cardId}"`))
    // the pill comes first in the document: Tab goes from it into the card
    expect(html.indexOf('>DEV</button>')).toBeLessThan(html.indexOf('<section'))
  })

  it('has the dev-mode switch with its hint', () => {
    const off = view()
    expect(off).toContain('Режим разработки')
    expect(off).toContain('Пропускает заглушку техработ и 2FA на этом компьютере')
    const sw = buttons(off).find((b) => b.attrs.includes('role="switch"'))
    expect(sw?.attrs).toContain('aria-checked="false"')
    expect(sw?.text).toContain('Режим разработки')
    // the hint belongs to the switch
    const hintId = /aria-describedby="([^"]+)"/.exec(sw?.attrs ?? '')?.[1]
    expect(hintId).toBeTruthy()
    expect(off).toContain(`id="${hintId}"`)

    const on = buttons(view({ session: { ...SESSION, devMode: true } })).find((b) => b.attrs.includes('role="switch"'))
    expect(on?.attrs).toContain('aria-checked="true"')
  })

  it('«Войти как роль» — nine buttons with the labels the server sent', () => {
    const html = view()
    expect(html).toContain('Войти как роль')
    const texts = buttons(html).map((b) => b.text)
    for (const { label } of ROLES) expect(texts.filter((t) => t === label), label).toHaveLength(1)
  })

  it('«Войти как пользователь» — an e-mail field and the button «Войти»', () => {
    const html = view({ email: 'someone@example.com' })
    expect(html).toContain('Войти как пользователь')
    expect(html).toMatch(/<input[^>]*type="email"[^>]*>/)
    expect(html).toMatch(/<input[^>]*value="someone@example.com"[^>]*>/)
    const submit = buttons(html).find((b) => b.text === 'Войти')
    expect(submit?.attrs).toContain('type="submit"')
    expect(html).toMatch(/<form[\s\S]*<input[\s\S]*Войти<\/button>[\s\S]*<\/form>/)
  })

  it('says who is signed in, with «Выйти» — or that nobody is', () => {
    const none = view()
    expect(none).toContain('Сейчас: без входа')
    expect(buttons(none).some((b) => b.text === 'Выйти')).toBe(false)

    const staff = view({ session: { ...SESSION, current: { email: 'dev-crm-manager@dev.aistart360.test', role: 'client', staffRole: 'crm_manager' } } })
    expect(staff).toContain('Сейчас: dev-crm-manager@dev.aistart360.test · CRM-менеджер')
    expect(buttons(staff).some((b) => b.text === 'Выйти')).toBe(true)
    expect(staff).not.toContain('без входа')
  })

  it('an unknown address shows «Такого пользователя нет»; any other failure shows its code', () => {
    const unknown = view({ error: 'USER_NOT_FOUND' })
    expect(unknown).toMatch(/role="alert"[^>]*>Такого пользователя нет</)
    const failed = view({ error: 'DEV_ACCOUNT_CONFLICT' })
    expect(failed).toMatch(/role="alert"[^>]*>Ошибка: DEV_ACCOUNT_CONFLICT</)
    expect(failed).not.toContain('Такого пользователя нет')
    expect(view()).not.toContain('role="alert"')
  })

  it('while a request is in flight every action is disabled', () => {
    const session = { ...SESSION, current: { email: 'someone@example.com', role: 'client', staffRole: null } }
    // everything but the pill itself: closing the card is always possible
    const actions = (html: string) => buttons(html).filter((b) => b.text !== 'DEV')

    const idle = actions(view({ session }))
    expect(idle).toHaveLength(1 + ROLES.length + 2) // the switch, nine roles, «Войти», «Выйти»
    // the attribute, not the `disabled:` class names
    for (const b of idle) expect(b.attrs, b.text).not.toContain(' disabled=""')
    expect(view({ session })).not.toMatch(/<input[^>]* disabled=""[^>]*>/)

    const busyHtml = view({ session, busy: true })
    for (const b of actions(busyHtml)) expect(b.attrs, b.text).toContain(' disabled=""')
    expect(busyHtml).toMatch(/<input[^>]* disabled=""[^>]*>/)
    // the pill still closes the card
    expect(buttons(busyHtml).find((b) => b.text === 'DEV')?.attrs).not.toContain(' disabled=""')
  })

  it('every control is a real button or input with a visible focus ring', () => {
    const html = view({ session: { ...SESSION, current: { email: 'someone@example.com', role: 'client', staffRole: null } } })
    for (const b of buttons(html)) {
      expect(b.attrs, b.text).toContain('focus-visible:outline')
      expect(b.attrs, b.text).toMatch(/type="(button|submit)"/)
    }
    expect(html).toMatch(/<input[^>]*class="[^"]*focus-visible:outline[^"]*"/)
    // no click handlers on things a keyboard cannot reach
    expect(html).not.toMatch(/<(div|span|p)[^>]*(tabindex|role="button")/)
  })

  it('fits a 360 px screen: never wider than the viewport minus its margins', () => {
    expect(view()).toContain('w-[min(22rem,calc(100vw-1.5rem))]')
  })
})

describe('who is signed in', () => {
  it('a staff role names the account; otherwise the profile role; an unknown one is shown as is', () => {
    expect(currentRoleLabel({ email: 'a@example.com', role: 'client', staffRole: 'support' }, ROLES)).toBe('Поддержка')
    expect(currentRoleLabel({ email: 'a@example.com', role: 'expert', staffRole: null }, ROLES)).toBe('Эксперт')
    expect(currentRoleLabel({ email: 'a@example.com', role: 'manager', staffRole: null }, ROLES)).toBe('manager')
    expect(currentRoleLabel({ email: 'a@example.com', role: null, staffRole: null }, ROLES)).toBe('—')
  })
})

describe('requests', () => {
  it('a role button posts the role to /api/dev/login and gets the landing path', async () => {
    const { fetchFn, calls } = fetchDouble(() => ({ status: 200, body: { ok: true, redirect: '/admin-giga-panel' } }))
    expect(await devLogin(fetchFn, { role: 'super_admin' })).toEqual({ ok: true, data: { ok: true, redirect: '/admin-giga-panel' } })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/dev/login')
    expect(calls[0].init?.method).toBe('POST')
    expect(new Headers(calls[0].init?.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ role: 'super_admin' })
  })

  it('the e-mail form posts the address; an unknown one comes back as USER_NOT_FOUND', async () => {
    const { fetchFn, calls } = fetchDouble(() => ({ status: 404, body: { error: 'USER_NOT_FOUND' } }))
    const result = await devLogin(fetchFn, { email: 'nobody@example.com' })
    expect(result).toEqual({ ok: false, error: 'USER_NOT_FOUND' })
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ email: 'nobody@example.com' })
    expect(devErrorText('USER_NOT_FOUND')).toBe('Такого пользователя нет')
  })

  it('a failure without a code is named by its status; a dead network by NETWORK', async () => {
    expect(await devLogin(fetchDouble(() => ({ status: 500, raw: 'boom' })).fetchFn, { role: 'client' })).toEqual({ ok: false, error: 'HTTP 500' })
    expect(await devLogin(fetchDouble(() => new Error('offline')).fetchFn, { role: 'client' })).toEqual({ ok: false, error: 'NETWORK' })
    expect(devErrorText('HTTP 500')).toBe('Ошибка: HTTP 500')
  })

  it('the switch posts { on } to /api/dev/mode', async () => {
    const { fetchFn, calls } = fetchDouble(() => ({ status: 200, body: { ok: true, devMode: true } }))
    expect(await devSetMode(fetchFn, true)).toEqual({ ok: true, data: { ok: true, devMode: true } })
    expect(calls[0].url).toBe('/api/dev/mode')
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ on: true })
  })

  it('«Выйти» posts to /api/dev/logout', async () => {
    const { fetchFn, calls } = fetchDouble(() => ({ status: 200, body: { ok: true } }))
    expect((await devLogout(fetchFn)).ok).toBe(true)
    expect(calls[0].url).toBe('/api/dev/logout')
    expect(calls[0].init?.method).toBe('POST')
  })

  it('only a path on this site is followed after signing in', () => {
    expect(safeRedirect('/client/home')).toBe('/client/home')
    expect(safeRedirect('/admin-giga-panel?tab=users')).toBe('/admin-giga-panel?tab=users')
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', undefined, 42]) {
      expect(safeRedirect(bad), String(bad)).toBe('/')
    }
  })
})

describe('app/layout.tsx', () => {
  const layout = readFileSync('app/layout.tsx', 'utf8')

  it('mounts the panel behind the literal NODE_ENV check, so a production build drops the import and the chunk', () => {
    expect(layout).toMatch(
      /const DevPanel =\s*process\.env\.NODE_ENV !== 'production'\s*\?\s*dynamic\(\(\) => import\('@\/components\/dev\/DevPanel'\)\)\s*:\s*null/,
    )
    expect(layout).toContain('{DevPanel && <DevPanel />}')
  })

  it('never imports the panel statically', () => {
    expect(layout).not.toMatch(/^import [^\n]*from '@\/components\/dev\/DevPanel'/m)
  })
})
