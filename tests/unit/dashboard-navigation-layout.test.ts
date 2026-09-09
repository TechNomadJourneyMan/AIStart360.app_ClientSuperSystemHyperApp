import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileNav } from '@/components/layout/MobileNav'

const { getCurrentOrgVerticalMock } = vi.hoisted(() => ({
  getCurrentOrgVerticalMock: vi.fn(),
}))

vi.mock('@/lib/vertical', () => ({
  getCurrentOrgVertical: getCurrentOrgVerticalMock,
}))

import DashboardLayout from '@/app/(dashboard)/layout'

function verticalProp(
  root: Awaited<ReturnType<typeof DashboardLayout>>,
  component: typeof Sidebar | typeof MobileNav,
): unknown {
  const children = React.Children.toArray(
    (root.props as { children: React.ReactNode }).children,
  ) as React.ReactElement[]
  const element = children.find((child) => child.type === component)
  return element?.props.vertical
}

describe('dashboard navigation context', () => {
  beforeEach(() => {
    getCurrentOrgVerticalMock.mockReset()
  })

  it('passes the trusted server vertical to desktop and mobile navigation', async () => {
    getCurrentOrgVerticalMock.mockResolvedValue({
      userId: 'medical-user',
      vertical: 'medical',
      branding: null,
      role: 'admin',
    })

    const root = await DashboardLayout({
      children: React.createElement('div', null, 'content'),
    })

    expect(verticalProp(root, Sidebar)).toBe('medical')
    expect(verticalProp(root, MobileNav)).toBe('medical')
    const children = React.Children.toArray(
      (root.props as { children: React.ReactNode }).children,
    ) as React.ReactElement[]
    expect(children.find((child) => child.type === Sidebar)?.props.serverRole).toBe('admin')
    expect(children.find((child) => child.type === MobileNav)?.props.serverRole).toBe('admin')
  })

  it('fails closed to generic when no profile context is available', async () => {
    getCurrentOrgVerticalMock.mockResolvedValue(null)

    const root = await DashboardLayout({
      children: React.createElement('div', null, 'content'),
    })

    expect(verticalProp(root, Sidebar)).toBe('generic')
    expect(verticalProp(root, MobileNav)).toBe('generic')
  })
})
