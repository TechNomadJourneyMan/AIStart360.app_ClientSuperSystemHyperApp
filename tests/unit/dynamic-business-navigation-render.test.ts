import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth.store'
import { useUIStore } from '@/stores/ui.store'

const { navigationState } = vi.hoisted(() => ({
  navigationState: { pathname: '/dashboard' },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

import { Sidebar } from '@/components/layout/Sidebar'
import { MobileNav } from '@/components/layout/MobileNav'

function setClient() {
  useAuthStore.setState({
    user: {
      id: 'client-id',
      name: 'Клиент',
      email: 'client@example.test',
      role: 'client',
      status: 'approved',
    },
    role: 'client',
    isInitialized: true,
  })
}

describe('dynamic business navigation rendering', () => {
  afterEach(() => {
    navigationState.pathname = '/dashboard'
    useUIStore.setState({ sidebarCollapsed: false })
    useAuthStore.setState({ user: null, role: null, isInitialized: false })
  })

  it('gives the Clinic link a Russian accessible name and current state', () => {
    setClient()
    navigationState.pathname = '/clinic'
    useUIStore.setState({ sidebarCollapsed: true })

    const html = renderToStaticMarkup(React.createElement(Sidebar, { vertical: 'medical' }))

    expect(html).toContain('href="/clinic"')
    expect(html).toContain('aria-label="Клиника"')
    expect(html).toContain('aria-current="page"')
    expect(html).not.toContain('href="/store"')
  })

  it('renders one inert closed mobile drawer with the e-commerce Store item', () => {
    setClient()
    navigationState.pathname = '/dashboard'

    const html = renderToStaticMarkup(React.createElement(MobileNav, { vertical: 'ecommerce' }))

    expect(html).toContain('aria-controls="mobile-navigation-drawer"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('id="mobile-navigation-drawer"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('hidden=""')
    expect((html.match(/href="\/store"/g) ?? [])).toHaveLength(1)
    expect(html).not.toContain('href="/clinic"')
  })

  it('announces the active vertical destination through the mobile More control', () => {
    setClient()
    navigationState.pathname = '/store'

    const html = renderToStaticMarkup(React.createElement(MobileNav, { vertical: 'ecommerce' }))

    expect(html).toContain('aria-label="Ещё — текущий раздел: Магазин"')
    expect(html).toContain('aria-current="page"')
  })
})
