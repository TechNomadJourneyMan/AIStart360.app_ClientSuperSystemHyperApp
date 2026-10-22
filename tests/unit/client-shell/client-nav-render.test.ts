/**
 * W2: the cabinet bar as rendered — landmarks, the active section, the staff
 * button only when the server passed one, no bar on gate / full-screen flows;
 * and the server loader that decides who is staff.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const s = vi.hoisted(() => ({
  pathname: '/client/home',
  facts: null as null | { role: string; status: string; is_staff: boolean },
  staffRow: null as null | { role: string },
  thread: null as null | { unread_user: number },
  staffReads: 0,
}))

vi.mock('next/navigation', () => ({ usePathname: () => s.pathname }))
vi.mock('next/image', () => ({ default: (p: { alt: string; src: string }) => createElement('img', { alt: p.alt, src: p.src }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: async () => ({}) } }) }))
vi.mock('@/lib/events/client', () => ({ trackLogout: () => {} }))
vi.mock('@/lib/platform/facts', () => ({ getRequestUserFacts: async () => s.facts }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { s.staffReads++; return { data: s.staffRow, error: null } } }) }) }),
  }),
}))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: s.thread, error: null }) }) }) }),
  }),
}))

const { ClientNav } = await import('@/components/client/ClientNav')
const { buildClientNav } = await import('@/lib/client-shell/nav')
const { staffPanelLink } = await import('@/lib/client-shell/staff-links')
const { clientShellData, loadClientShellAccount } = await import('@/lib/client-shell/server')

const items = buildClientNav({ approved: true, hiddenPaths: [], unreadMessages: 2 })
const render = (panel: ReturnType<typeof staffPanelLink> = null) => renderToStaticMarkup(createElement(ClientNav, { items, panel, email: 'owner@example.kz' }))

beforeEach(() => {
  s.pathname = '/client/home'
  s.facts = null
  s.staffRow = null
  s.thread = null
  s.staffReads = 0
})

describe('ClientNav markup', () => {
  it('is a labelled navigation landmark with every section and the active one marked', () => {
    s.pathname = '/client/point-a'
    const html = render()
    expect(html).toContain('<nav aria-label="Разделы кабинета"')
    for (const label of ['Главная', 'Дашборд', 'Точка А', 'Точка Б', 'Анкета', 'GRI', 'Сообщения', 'Документы']) expect(html).toContain(label)
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/client\/point-a"/)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toContain('sticky top-0')
  })

  it('shows the unread badge with a screen-reader text, but not on the messages page itself', () => {
    expect(render()).toContain('непрочитанных: 2')
    s.pathname = '/client/messages'
    expect(render()).not.toContain('непрочитанных')
  })

  it('a regular client has no panel button', () => {
    const html = render(null)
    expect(html).not.toContain('Вернуться в панель')
    expect(html).not.toContain('/admin-giga-panel')
  })

  it('staff get «Вернуться в панель» to their panel', () => {
    const html = render(staffPanelLink({ profileRole: 'super_admin', staffRole: null, status: 'approved' }))
    expect(html).toContain('Вернуться в панель')
    expect(html).toContain('href="/admin-giga-panel"')
    const expert = render(staffPanelLink({ profileRole: 'expert', staffRole: null, status: 'approved' }))
    expect(expert).toContain('href="/expert/dashboard"')
  })

  it('the survey wizard gets a bar that scrolls away (its own header is sticky)', () => {
    s.pathname = '/client/onboarding'
    const html = render()
    expect(html).not.toContain('sticky top-0')
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/client\/onboarding"/)
  })

  it('gate and full-screen flows keep their own chrome', () => {
    for (const p of ['/client/waiting-room', '/client/welcome', '/client/journey']) {
      s.pathname = p
      expect(render(), p).toBe('')
    }
  })

  it('uses design tokens only — no hard-coded colours', () => {
    expect(render(staffPanelLink({ profileRole: 'super_admin', staffRole: null, status: 'approved' }))).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

describe('loadClientShellAccount (server)', () => {
  const user = { id: 'u-1', email: 'owner@example.kz' }

  it('a regular approved client: full menu, unread counter, no panel, staff_roles not even read', async () => {
    s.facts = { role: 'client', status: 'approved', is_staff: false }
    s.thread = { unread_user: 4 }
    const acc = await loadClientShellAccount(user)
    expect(acc.panel).toBeNull()
    expect(s.staffReads).toBe(0)
    const data = clientShellData(acc, [])
    expect(data.items.map((i) => i.key)).toContain('point_b')
    expect(data.items.find((i) => i.key === 'messages')?.badge).toBe(4)
  })

  it('staff role comes from staff_roles on the server', async () => {
    s.facts = { role: 'client', status: 'approved', is_staff: true }
    s.staffRow = { role: 'super_expert' }
    expect((await loadClientShellAccount(user)).panel?.href).toBe('/super-expert')
    s.staffRow = { role: 'crm_manager' }
    expect((await loadClientShellAccount(user)).panel?.href).toBe('/admin-giga-panel')
  })

  it('an expert profile returns to the expert portal', async () => {
    s.facts = { role: 'expert', status: 'approved', is_staff: false }
    const acc = await loadClientShellAccount(user)
    expect(acc.panel?.href).toBe('/expert/dashboard')
    expect(clientShellData(acc, []).items.map((i) => i.href)).not.toContain('/dashboard')
  })

  it('a pending client sees only the open sections', async () => {
    s.facts = { role: 'client', status: 'pending_approval', is_staff: false }
    const keys = clientShellData(await loadClientShellAccount(user), []).items.map((i) => i.key)
    expect(keys).not.toContain('point_a')
    expect(keys).toContain('survey')
  })

  it('unreadable facts fail open for the menu and never grant a panel', async () => {
    s.facts = null
    const acc = await loadClientShellAccount(user)
    expect(acc.panel).toBeNull()
    expect(acc.approved).toBe(true)
  })

  it('no user → no panel, no badge', async () => {
    const acc = await loadClientShellAccount(null)
    expect(acc).toMatchObject({ panel: null, unreadMessages: 0, approved: false })
  })
})
