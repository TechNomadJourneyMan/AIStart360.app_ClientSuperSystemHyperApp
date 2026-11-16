/**
 * R-028 (quick step of one shell): the old (dashboard) shell — /dashboard,
 * /gri, /settings, /notifications… — draws the SAME cabinet bar as /client/*
 * for a client: «Главная», «Анкета», «Сообщения», the bell, on the phone too
 * (one row, no separate bottom bar). Staff keep the sidebar, the header and
 * the bottom bar exactly as before. The layout is rendered on the server.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const s = vi.hoisted(() => ({
  pathname: '/dashboard',
  user: { id: 'u-1', email: 'owner@example.kz' } as null | { id: string; email: string },
  facts: null as null | { role: string; status: string; is_staff: boolean },
  staffRow: null as null | { role: string },
}))

const stub = (name: string) => {
  const Stub = () => createElement('div', { 'data-stub': name })
  Stub.displayName = `Stub(${name})`
  return Stub
}
vi.mock('next/navigation', () => ({ usePathname: () => s.pathname, useRouter: () => ({ push: () => {} }) }))
vi.mock('next/image', () => ({ default: (p: { alt: string; src: string }) => createElement('img', { alt: p.alt, src: p.src }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: async () => ({}) } }) }))
vi.mock('@/lib/events/client', () => ({ trackLogout: () => {} }))
vi.mock('@/components/layout/Sidebar', () => ({ Sidebar: stub('sidebar') }))
vi.mock('@/components/layout/Header', () => ({ Header: stub('header') }))
vi.mock('@/components/layout/MobileNav', () => ({ MobileNav: stub('mobile-nav') }))
vi.mock('@/components/layout/DashboardShell', () => ({ DashboardShell: ({ children }: { children: ReactElement }) => createElement('div', { 'data-stub': 'dashboard-shell' }, children) }))
vi.mock('@/components/assistant/mascot/MascotLauncher', () => ({ MascotLauncher: stub('mascot') }))
vi.mock('@/components/ai-chat/ChatHost', () => ({ ChatHost: stub('chat') }))
vi.mock('@/components/notifications/NotificationsBellSync', () => ({ NotificationsBellSync: stub('bell-sync') }))
vi.mock('@/components/platform/AnnouncementBar', () => ({ default: stub('announcement') }))
vi.mock('@/components/analytics/ActivityTracker', () => ({ default: stub('activity') }))
vi.mock('@/components/impersonation/ImpersonationBanner', () => ({ default: stub('impersonation') }))
vi.mock('@/hooks/usePlatformSections', () => ({ PlatformSectionsProvider: ({ children }: { children: ReactElement }) => children }))
vi.mock('@/lib/request-user', () => ({ getRequestUser: async () => s.user }))
vi.mock('@/lib/platform/sections', () => ({ visibleSectionsFor: async () => ({ sections: [], hiddenPaths: [] }) }))
vi.mock('@/lib/platform/facts', () => ({ getRequestUserFacts: async () => s.facts }))
vi.mock('@/lib/access/request-access', () => ({ getRequestAccess: async () => ({ sections: { point_a: false, point_b: false, market: false, gri_full: false } }) }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: s.staffRow, error: null }) }) }) }) }),
}))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      if (table === 'app_notifications') {
        const q = { eq: () => q, is: async () => ({ count: 4, error: null }) }
        return { select: () => q }
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { unread_user: 1 }, error: null }) }) }) }
    },
  }),
}))

const { default: DashboardLayout } = await import('@/app/(dashboard)/layout')

const render = async () => renderToStaticMarkup(await DashboardLayout({ children: createElement('p', null, 'PAGE-BODY') }))

beforeEach(() => {
  s.pathname = '/dashboard'
  s.user = { id: 'u-1', email: 'owner@example.kz' }
  s.facts = { role: 'client', status: 'approved', is_staff: false }
  s.staffRow = null
})

describe('R-028: a client in the old shell gets the cabinet bar', () => {
  it('the same menu as /client/*: «Главная», «Анкета», «Сообщения», the bell; no staff sidebar / header / bottom bar', async () => {
    const html = await render()
    expect(html).toContain('<nav aria-label="Разделы кабинета"')
    for (const [label, href] of [['Главная', '/client/home'], ['Анкета', '/client/onboarding'], ['Сообщения', '/client/messages'], ['Документы', '/client/onboarding/documents']]) {
      expect(html, label).toContain(label)
      expect(html, href).toContain(`href="${href}"`)
    }
    expect(html).toContain('href="/notifications"')
    expect(html).toContain('непрочитанных: 4')
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/dashboard"/)
    for (const old of ['sidebar', 'header', 'mobile-nav', 'dashboard-shell']) expect(html, old).not.toContain(`data-stub="${old}"`)
    expect(html).toContain('PAGE-BODY')
    expect(html).toContain('data-stub="mascot"') // the assistant stays
  })

  it('a pending client sees only the sections open before approval', async () => {
    s.facts = { role: 'client', status: 'pending_approval', is_staff: false }
    s.pathname = '/settings'
    const html = await render()
    expect(html).toContain('href="/client/home"')
    expect(html).toContain('href="/client/onboarding"')
    expect(html).not.toContain('href="/client/point-a"')
  })

  it('a legacy owner is a client too', async () => {
    s.facts = { role: 'owner', status: 'approved', is_staff: false }
    expect(await render()).toContain('<nav aria-label="Разделы кабинета"')
  })
})

describe('R-028: staff keep the old shell, unchanged', () => {
  it.each([
    ['super_admin', true],
    ['admin', true],
    ['client', true], // the role lives only in staff_roles
    ['expert', false],
  ])('profiles.role=%s is_staff=%s → sidebar, header, bottom bar', async (role, isStaff) => {
    s.facts = { role, status: 'approved', is_staff: isStaff }
    s.staffRow = isStaff ? { role: 'super_admin' } : null
    const html = await render()
    for (const old of ['sidebar', 'header', 'mobile-nav', 'bell-sync']) expect(html, old).toContain(`data-stub="${old}"`)
    expect(html).not.toContain('Разделы кабинета')
    expect(html).toContain('PAGE-BODY')
  })

  it('unknown facts or no session → the old shell (as before)', async () => {
    s.facts = null
    expect(await render()).toContain('data-stub="sidebar"')
    s.user = null
    expect(await render()).toContain('data-stub="sidebar"')
  })
})
