'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useAuthStore } from '@/stores/auth.store'
import { getNavForRole } from '@/lib/navigation'
import type { UserRole } from '@/types'

export function MobileNav() {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const t = useTranslations()
  const { user } = useAuthStore()

  // ── Bottom bar — 4 primary tabs ─────────────────────────────────────────────
  const BOTTOM_TABS = [
    { label: t('nav.dashboard'),  href: '/dashboard', icon: 'dashboard'       },
    { label: t('nav.pulse'),      href: '/pulse',      icon: 'cell_tower'      },
    { label: t('nav.clients'),    href: '/clients',    icon: 'business_center' },
    { label: t('nav.metrics'),    href: '/metrics',    icon: 'monitoring'      },
  ]

  // ── All sections shown in the "More" drawer ──────────────────────────────────
  const DRAWER_SECTIONS = [
    {
      title: t('mobileNav.sections.main'),
      items: [
        { label: t('nav.dashboard'),    href: '/dashboard',  icon: 'dashboard'        },
        { label: t('nav.gri'),          href: '/gri',         icon: 'radar'            },
        { label: t('nav.pulse'),        href: '/pulse',       icon: 'cell_tower'       },
        { label: t('nav.metrics'),      href: '/metrics',     icon: 'monitoring'       },
        { label: t('nav.insights'),     href: '/insights',    icon: 'lightbulb'        },
      ],
    },
    {
      title: t('mobileNav.sections.analysis'),
      items: [
        { label: t('nav.market'),       href: '/market',      icon: 'public'           },
        { label: t('nav.pointA'),       href: '/point-a',     icon: 'my_location'      },
        { label: t('nav.pointB'),       href: '/point-b',     icon: 'flag'             },
        { label: t('nav.competitors'),  href: '/competitors', icon: 'compare_arrows'   },
        { label: t('nav.intelligence'), href: '/intelligence',icon: 'hub'              },
      ],
    },
    {
      title: t('mobileNav.sections.work'),
      items: [
        { label: t('nav.clients'),      href: '/clients',      icon: 'business_center' },
        { label: t('nav.reports'),       href: '/reports',      icon: 'description'     },
        { label: t('nav.analytics'),     href: '/analytics',    icon: 'bar_chart'       },
        { label: t('nav.team'),          href: '/team',         icon: 'group'           },
      ],
    },
    {
      title: t('mobileNav.sections.system'),
      items: [
        { label: t('nav.notifications'),href: '/notifications',icon: 'notifications'   },
        { label: t('nav.users'),        href: '/users',       icon: 'manage_accounts' },
        { label: t('nav.profile'),      href: '/profile',      icon: 'account_circle'  },
        { label: t('nav.settings'),     href: '/settings',     icon: 'settings'        },
        { label: t('nav.admin'),        href: '/admin',        icon: 'admin_panel_settings'},
      ],
    },
  ]
  
  const role = ((user?.role || 'client').toUpperCase()) as UserRole
  const allowedNav = getNavForRole(role).map(item => item.href)

  // Filter out sections
  const filteredDrawer = DRAWER_SECTIONS.map(sec => ({
    ...sec,
    items: sec.items.filter(item => allowedNav.includes(item.href))
  })).filter(sec => sec.items.length > 0)
  
  const filteredTabs = BOTTOM_TABS.filter(item => allowedNav.includes(item.href))

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href)

  const isAnyDrawerActive = filteredDrawer.flatMap(s => s.items).some(i => isActive(i.href))

  return (
    <>
      {/* ── Bottom navigation bar ── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#111318]/95 backdrop-blur-xl border-t border-outline-variant/20 safe-area-bottom">
        <div className="flex">
          {filteredTabs.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 text-[10px] font-medium transition-colors ${
                  active ? 'text-primary' : 'text-[#8B95A3]'
                }`}
              >
                <span
                  className="material-symbols-outlined text-2xl"
                  style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            )
          })}

          {/* More button */}
          <button
            onClick={() => setDrawerOpen(v => !v)}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 text-[10px] font-medium transition-colors ${
              drawerOpen || isAnyDrawerActive ? 'text-primary' : 'text-[#8B95A3]'
            }`}
          >
            <span
              className="material-symbols-outlined text-2xl transition-transform duration-200"
              style={drawerOpen || isAnyDrawerActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {drawerOpen ? 'close' : 'menu'}
            </span>
            <span>{t('nav.more')}</span>
          </button>
        </div>
      </nav>

      {/* ── "More" drawer ── */}
      {/* Backdrop */}
      <div
        className={`lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setDrawerOpen(false)}
      />

      {/* Sheet */}
      <div
        className={`lg:hidden fixed left-0 right-0 bottom-[64px] z-40 transition-transform duration-300 ease-out ${
          drawerOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="bg-[#13151c] border border-white/[0.06] rounded-t-3xl shadow-2xl max-h-[75vh] overflow-y-auto">
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
            <div>
              <p className="text-sm font-semibold text-on-surface">{t('common.allSections')}</p>
              <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wider mt-0.5">{t('common.portal')}</p>
            </div>
            <button
              onClick={() => setDrawerOpen(false)}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-container hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-base text-on-surface-variant">close</span>
            </button>
          </div>

          {/* Sections */}
          <div className="px-4 py-4 space-y-5">
            {filteredDrawer.map((section) => (
              <div key={section.title}>
                <p className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.15em] mb-2 px-1">
                  {section.title}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {section.items.map((item) => {
                    const active = isActive(item.href)
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setDrawerOpen(false)}
                        className={`flex flex-col items-center gap-2 rounded-2xl p-3 transition-all duration-150 ${
                          active
                            ? 'bg-primary/10 border border-primary/20'
                            : 'bg-surface-container border border-white/[0.04] hover:border-white/[0.10] active:scale-95'
                        }`}
                      >
                        <span
                          className={`material-symbols-outlined text-2xl ${active ? 'text-primary' : 'text-on-surface-variant'}`}
                          style={active ? { fontVariationSettings: "'FILL' 0.8" } : undefined}
                        >
                          {item.icon}
                        </span>
                        <span className={`text-[10px] font-medium text-center leading-tight ${active ? 'text-primary' : 'text-on-surface-variant'}`}>
                          {item.label}
                        </span>
                        {active && (
                          <span className="w-1 h-1 rounded-full bg-primary" />
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Bottom safe area padding */}
          <div className="h-4" />
        </div>
      </div>
    </>
  )
}
