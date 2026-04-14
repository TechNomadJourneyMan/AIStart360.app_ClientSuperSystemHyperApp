'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useUIStore } from '@/stores/ui.store'
import { useAuthStore } from '@/stores/auth.store'

export function OwnerSidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const t = useTranslations()
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { logout } = useAuthStore()
  const [moreOpen, setMoreOpen] = useState(false)

  const PRIMARY_NAV = [
    { label: t('nav.dashboard'),    href: '/owner/dashboard',  icon: 'dashboard'       },
    { label: t('nav.gri'),          href: '/owner/gri',         icon: 'radar'           },
    { label: t('nav.market'),       href: '/owner/market',      icon: 'public'          },
    { label: t('nav.pointA'),       href: '/owner/point-a',     icon: 'my_location'     },
    { label: t('nav.pointB'),       href: '/owner/point-b',     icon: 'flag'            },
    { label: t('nav.insights'),     href: '/owner/insights',    icon: 'lightbulb'       },
    { label: t('nav.competitors'),  href: '/owner/competitors', icon: 'compare_arrows'  },
    { label: t('nav.metrics'),      href: '/owner/metrics',     icon: 'monitoring'      },
  ]

  const SECONDARY_NAV = [
    { label: t('nav.clients'),       href: '/owner/clients',       icon: 'business_center'     },
    { label: t('nav.reports'),        href: '/owner/reports',       icon: 'description'         },
    { label: t('nav.analytics'),      href: '/owner/analytics',     icon: 'bar_chart'           },
    { label: t('nav.intelligence'),   href: '/owner/intelligence',  icon: 'hub'                 },
    { label: t('nav.team'),           href: '/owner/team',          icon: 'group'               },
    { label: t('nav.notifications'),  href: '/owner/notifications', icon: 'notifications'       },
    { label: t('nav.users'),          href: '/owner/users',         icon: 'manage_accounts'     },
    { label: t('nav.admin'),          href: '/owner/admin',         icon: 'admin_panel_settings'},
  ]

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  const isActive = (href: string) =>
    href === '/owner/dashboard' ? pathname === href : pathname.startsWith(href)

  const isAnySecondaryActive = SECONDARY_NAV.some((item) => isActive(item.href))

  return (
    <aside
      className={`
        hidden lg:flex fixed left-0 top-0 h-screen z-50 flex-col
        bg-[#0e0f14] border-r border-white/[0.04] shadow-2xl transition-all duration-300
        ${sidebarCollapsed ? 'w-[68px]' : 'w-[220px]'}
      `}
    >
      {/* Logo */}
      <div className={`
        flex items-center border-b border-white/[0.04] flex-shrink-0
        ${sidebarCollapsed ? 'justify-center px-2 py-5' : 'gap-3 px-4 py-5'}
      `}>
        {sidebarCollapsed ? (
          <Image src="/logo-icon.svg" alt="AIStart360" width={32} height={32} className="flex-shrink-0" />
        ) : (
          <div className="flex flex-col">
            <Image src="/logo.svg" alt="AIStart360" width={148} height={27} className="flex-shrink-0" priority />
            <p className="text-[9px] font-mono text-secondary/60 uppercase tracking-[0.2em] mt-1">{t('owner.portal')}</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto no-scrollbar px-2 py-3 flex flex-col gap-0.5">
        {PRIMARY_NAV.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              title={sidebarCollapsed ? item.label : undefined}
              className={`
                group flex items-center rounded-xl transition-all duration-150 relative
                ${sidebarCollapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3 py-2.5'}
                ${active
                  ? 'bg-secondary/10 text-secondary'
                  : 'text-[#6b7280] hover:text-[#c9d1d9] hover:bg-white/[0.04]'
                }
              `}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-secondary rounded-r-full" />
              )}
              <span
                className={`material-symbols-outlined text-[20px] flex-shrink-0 transition-all duration-150
                  ${active ? 'text-secondary' : 'text-[#6b7280] group-hover:text-[#c9d1d9]'}
                `}
                style={active ? { fontVariationSettings: "'FILL' 0.7, 'wght' 400" } : undefined}
              >
                {item.icon}
              </span>
              {!sidebarCollapsed && (
                <span className={`text-sm truncate font-medium ${active ? 'text-secondary' : ''}`}>
                  {item.label}
                </span>
              )}
            </Link>
          )
        })}

        {/* Divider */}
        <div className="mx-3 my-1.5 border-t border-white/[0.04]" />

        {/* More toggle */}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          title={sidebarCollapsed ? t('nav.more') : undefined}
          className={`
            group flex items-center rounded-xl transition-all duration-150 w-full
            ${sidebarCollapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3 py-2.5'}
            ${isAnySecondaryActive ? 'text-secondary' : 'text-[#6b7280] hover:text-[#c9d1d9] hover:bg-white/[0.04]'}
          `}
        >
          <span className="material-symbols-outlined text-[20px] flex-shrink-0">more_horiz</span>
          {!sidebarCollapsed && (
            <>
              <span className="text-sm font-medium flex-1 text-left">{t('nav.more')}</span>
              <span className={`material-symbols-outlined text-[16px] transition-transform duration-200 ${moreOpen ? 'rotate-180' : ''}`}>
                expand_more
              </span>
            </>
          )}
        </button>

        {/* Secondary nav */}
        {moreOpen && SECONDARY_NAV.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              title={sidebarCollapsed ? item.label : undefined}
              className={`
                group flex items-center rounded-xl transition-all duration-150 relative
                ${sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2 pl-9'}
                ${active
                  ? 'bg-secondary/10 text-secondary'
                  : 'text-[#6b7280] hover:text-[#c9d1d9] hover:bg-white/[0.04]'
                }
              `}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-secondary rounded-r-full" />
              )}
              <span
                className={`material-symbols-outlined text-[18px] flex-shrink-0 ${active ? 'text-secondary' : 'text-[#6b7280] group-hover:text-[#c9d1d9]'}`}
                style={active ? { fontVariationSettings: "'FILL' 0.5" } : undefined}
              >
                {item.icon}
              </span>
              {!sidebarCollapsed && (
                <span className={`text-sm truncate ${active ? 'text-secondary font-medium' : ''}`}>
                  {item.label}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/[0.04] px-2 py-2 space-y-0.5">
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2 px-3 py-1.5 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse flex-shrink-0" />
            <span className="text-[10px] font-mono text-secondary/70 tracking-wider">{t('owner.online')}</span>
          </div>
        )}

        <Link
          href="/owner/profile"
          title={sidebarCollapsed ? t('nav.profile') : undefined}
          className={`
            group flex items-center rounded-xl transition-all duration-150
            ${isActive('/owner/profile') ? 'bg-secondary/10 text-secondary' : 'text-[#6b7280] hover:text-[#c9d1d9] hover:bg-white/[0.04]'}
            ${sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'}
          `}
        >
          <span className="material-symbols-outlined text-[20px]">account_circle</span>
          {!sidebarCollapsed && <span className="text-sm font-medium">{t('nav.profile')}</span>}
        </Link>

        <Link
          href="/owner/settings"
          title={sidebarCollapsed ? t('nav.settings') : undefined}
          className={`
            group flex items-center rounded-xl transition-all duration-150
            ${isActive('/owner/settings') ? 'bg-secondary/10 text-secondary' : 'text-[#6b7280] hover:text-[#c9d1d9] hover:bg-white/[0.04]'}
            ${sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'}
          `}
        >
          <span className="material-symbols-outlined text-[20px]">settings</span>
          {!sidebarCollapsed && <span className="text-sm font-medium">{t('nav.settings')}</span>}
        </Link>

        <button
          onClick={handleLogout}
          title={sidebarCollapsed ? t('nav.logout') : undefined}
          className={`
            w-full flex items-center rounded-xl transition-all duration-150 text-[#6b7280] hover:text-error hover:bg-error/5
            ${sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'}
          `}
        >
          <span className="material-symbols-outlined text-[20px]">logout</span>
          {!sidebarCollapsed && <span className="text-sm">{t('nav.logout')}</span>}
        </button>

        <button
          onClick={toggleSidebar}
          className={`
            w-full flex items-center rounded-xl transition-all duration-150 text-[#6b7280] hover:text-[#c9d1d9] hover:bg-white/[0.04]
            ${sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'}
          `}
          aria-label={sidebarCollapsed ? t('common.expand') : t('common.collapse')}
        >
          <span className="material-symbols-outlined text-[20px]">
            {sidebarCollapsed ? 'chevron_right' : 'chevron_left'}
          </span>
          {!sidebarCollapsed && <span className="text-sm">{t('common.collapse')}</span>}
        </button>
      </div>
    </aside>
  )
}
