'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { useUIStore } from '@/stores/ui.store'
import { useAuthStore } from '@/stores/auth.store'
import { getPrimaryNavForRole, getSecondaryNavForRole } from '@/lib/navigation'
import { UserRole } from '@/types'

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { logout, role } = useAuthStore()
  const [moreOpen, setMoreOpen] = useState(false)

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  // Security: Use actual role from auth store instead of hardcoded 'MANAGER'.
  // Default to 'ANALYST' if role is not set to ensure minimal exposure.
  const userRole = (role?.toUpperCase() as UserRole) || 'ANALYST'

  const primaryNav = getPrimaryNavForRole(userRole)
  const secondaryNav = getSecondaryNavForRole(userRole)

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href)

  const isAnySecondaryActive = secondaryNav.some((item) => isActive(item.href))

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
          <Image
            src="/logo-icon.svg"
            alt="AIStart360"
            width={32}
            height={32}
            className="flex-shrink-0"
          />
        ) : (
          <Image
            src="/logo.svg"
            alt="AIStart360"
            width={148}
            height={27}
            className="flex-shrink-0"
            priority
          />
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto no-scrollbar px-2 py-3 flex flex-col gap-0.5">

        {primaryNav.map((item) => {
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
                  ? 'bg-primary/10 text-primary'
                  : 'text-[#6b7280] hover:text-[#c9d1d9] hover:bg-white/[0.04]'
                }
              `}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
              )}
              <span
                className={`material-symbols-outlined text-[20px] flex-shrink-0 transition-all duration-150
                  ${active ? 'text-primary' : 'text-[#6b7280] group-hover:text-[#c9d1d9]'}
                `}
                style={active ? { fontVariationSettings: "'FILL' 0.7, 'wght' 400" } : undefined}
              >
                {item.icon}
              </span>
              {!sidebarCollapsed && (
                <span className={`text-sm truncate font-medium ${active ? 'text-primary' : ''}`}>
                  {item.label}
                </span>
              )}
            </Link>
          )
        })}

        {/* Divider */}
        <div className="mx-3 my-1.5 border-t border-white/[0.04]" />

        {/* More / Secondary nav toggle */}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          title={sidebarCollapsed ? 'Ещё' : undefined}
          className={`
            group flex items-center rounded-xl transition-all duration-150 w-full
            ${sidebarCollapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3 py-2.5'}
            ${isAnySecondaryActive ? 'text-primary' : 'text-[#6b7280] hover:text-[#c9d1d9] hover:bg-white/[0.04]'}
          `}
        >
          <span className={`material-symbols-outlined text-[20px] flex-shrink-0 transition-all duration-200
            ${moreOpen ? 'rotate-180' : ''}
          `}>
            {isAnySecondaryActive ? 'more_horiz' : 'more_horiz'}
          </span>
          {!sidebarCollapsed && (
            <span className="text-sm font-medium flex-1 text-left">Ещё</span>
          )}
          {!sidebarCollapsed && (
            <span className={`material-symbols-outlined text-[16px] transition-transform duration-200 ${moreOpen ? 'rotate-180' : ''}`}>
              expand_more
            </span>
          )}
        </button>

        {/* Secondary nav items */}
        {moreOpen && secondaryNav.map((item) => {
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
                  ? 'bg-primary/10 text-primary'
                  : 'text-[#6b7280] hover:text-[#c9d1d9] hover:bg-white/[0.04]'
                }
              `}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-primary rounded-r-full" />
              )}
              <span
                className={`material-symbols-outlined text-[18px] flex-shrink-0 ${active ? 'text-primary' : 'text-[#6b7280] group-hover:text-[#c9d1d9]'}`}
                style={active ? { fontVariationSettings: "'FILL' 0.5" } : undefined}
              >
                {item.icon}
              </span>
              {!sidebarCollapsed && (
                <span className={`text-sm truncate ${active ? 'text-primary font-medium' : ''}`}>
                  {item.label}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer: Profile + Settings + Collapse */}
      <div className="border-t border-white/[0.04] px-2 py-2 space-y-0.5">
        {/* System status */}
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2 px-3 py-1.5 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />
            <span className="text-[10px] font-mono text-primary/70 tracking-wider">СИСТЕМА АКТИВНА</span>
          </div>
        )}

        <Link
          href="/profile"
          title={sidebarCollapsed ? 'Профиль' : undefined}
          className={`
            group flex items-center rounded-xl transition-all duration-150
            ${isActive('/profile') ? 'bg-primary/10 text-primary' : 'text-[#6b7280] hover:text-[#c9d1d9] hover:bg-white/[0.04]'}
            ${sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'}
          `}
        >
          <span className="material-symbols-outlined text-[20px]">account_circle</span>
          {!sidebarCollapsed && <span className="text-sm font-medium">Профиль</span>}
        </Link>

        <Link
          href="/settings"
          title={sidebarCollapsed ? 'Настройки' : undefined}
          className={`
            group flex items-center rounded-xl transition-all duration-150
            ${isActive('/settings') ? 'bg-primary/10 text-primary' : 'text-[#6b7280] hover:text-[#c9d1d9] hover:bg-white/[0.04]'}
            ${sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'}
          `}
        >
          <span className="material-symbols-outlined text-[20px]">settings</span>
          {!sidebarCollapsed && <span className="text-sm font-medium">Настройки</span>}
        </Link>

        {/* Logout */}
        <button
          onClick={handleLogout}
          title={sidebarCollapsed ? 'Выйти' : undefined}
          className={`
            w-full flex items-center rounded-xl transition-all duration-150 text-[#6b7280] hover:text-error hover:bg-error/5
            ${sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'}
          `}
        >
          <span className="material-symbols-outlined text-[20px]">logout</span>
          {!sidebarCollapsed && <span className="text-sm">Выйти</span>}
        </button>

        {/* Collapse toggle */}
        <button
          onClick={toggleSidebar}
          className={`
            w-full flex items-center rounded-xl transition-all duration-150 text-[#6b7280] hover:text-[#c9d1d9] hover:bg-white/[0.04]
            ${sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'}
          `}
          aria-label={sidebarCollapsed ? 'Развернуть' : 'Свернуть'}
        >
          <span className="material-symbols-outlined text-[20px]">
            {sidebarCollapsed ? 'chevron_right' : 'chevron_left'}
          </span>
          {!sidebarCollapsed && <span className="text-sm">Свернуть</span>}
        </button>
      </div>
    </aside>
  )
}
