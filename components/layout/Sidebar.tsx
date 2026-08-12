'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useUIStore } from '@/stores/ui.store'
import { useAuthStore } from '@/stores/auth.store'
import { getPrimaryNavForRole, getSecondaryNavForRole, isActiveNavPath } from '@/lib/navigation'
import { isPremiumLocked, premiumLockedRoot } from '@/lib/premium'
import type { NavItem, UserRole } from '@/types'
import { UploadFilesNavItem } from './UploadFilesNavItem'

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { user, logout } = useAuthStore()
  const [moreOpen, setMoreOpen] = useState(false)
  const [openSubMenus, setOpenSubMenus] = useState<string[]>([])

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  // FE-01/02: role is the canonical lowercase Supabase value; default the
  // least-privileged 'client' when missing (no more toUpperCase bridge).
  const role: UserRole = (user?.role as UserRole | undefined) ?? 'client'
  const primaryNav = getPrimaryNavForRole(role)
  const secondaryNav = getSecondaryNavForRole(role)

  // Items locked behind a paid plan — see lib/premium.ts
  const isLocked = (href: string) => isPremiumLocked(role, href)

  const isActive = (href: string) => isActiveNavPath(pathname, href)

  const isAnySecondaryActive = secondaryNav.some((item) => isActive(item.href))

  // Auto-expand submenu if a sub-item is active
  useEffect(() => {
    primaryNav.forEach((item) => {
      if (item.subItems?.some((sub) => isActive(sub.href))) {
        setOpenSubMenus((prev) => (prev.includes(item.href) ? prev : [...prev, item.href]))
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const toggleSubMenu = (href: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOpenSubMenus((prev) =>
      prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href]
    )
  }

  const isParentActive = (item: NavItem) =>
    isActive(item.href) || (item.subItems?.some((sub) => isActive(sub.href)) ?? false)

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
            className="h-8 w-auto flex-shrink-0"
          />
        ) : (
          <Image
            src="/logo.svg"
            alt="AIStart360"
            width={148}
            height={27}
            className="h-7 w-auto flex-shrink-0"
            priority
          />
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto no-scrollbar px-2 py-3 flex flex-col gap-0.5">

        {primaryNav.map((item) => {
          const active = isParentActive(item)
          const hasSubItems = !sidebarCollapsed && item.subItems && item.subItems.length > 0
          const isSubOpen = openSubMenus.includes(item.href)

          if (hasSubItems && isLocked(item.href)) {
            // Locked parent item — badged as Pro, still navigates to the section root
            const lockedKey = premiumLockedRoot(item.href) ?? item.href
            return (
              <button
                key={item.href}
                onClick={() => router.push(lockedKey)}
                className={`
                  relative flex items-center rounded-xl cursor-pointer select-none w-full
                  hover:bg-amber-500/5 transition-colors duration-150
                  gap-3 px-3 py-2.5
                `}
              >
                <span className="material-symbols-outlined text-[20px] flex-shrink-0 text-[#6b7280] opacity-55">
                  {item.icon}
                </span>
                <span className="text-sm truncate font-medium text-[#6b7280] opacity-55 flex-1">
                  {item.label}
                </span>
                <span className="flex items-center px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-mono tracking-wide flex-shrink-0">
                  Pro
                </span>
              </button>
            )
          }

          if (hasSubItems) {
            return (
              <div key={item.href}>
                {/* Parent row: toggle-only (no navigation — navigate via sub-items) */}
                <button
                  onClick={(e) => toggleSubMenu(item.href, e)}
                  className={`
                    group flex items-center rounded-xl transition-all duration-150 relative w-full
                    ${active ? 'bg-primary/10' : 'hover:bg-white/[0.04]'}
                  `}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full pointer-events-none" />
                  )}
                  <span className="flex items-center gap-3 px-3 py-2.5 flex-1 min-w-0">
                    <span
                      className={`material-symbols-outlined text-[20px] flex-shrink-0 transition-all duration-150 ${active ? 'text-primary' : 'text-[#6b7280] group-hover:text-[#c9d1d9]'}`}
                      style={active ? { fontVariationSettings: "'FILL' 0.7, 'wght' 400" } : undefined}
                    >
                      {item.icon}
                    </span>
                    <span className={`text-sm truncate font-medium ${active ? 'text-primary' : 'text-[#6b7280] group-hover:text-[#c9d1d9]'}`}>
                      {item.label}
                    </span>
                  </span>
                  <span className={`pr-2.5 flex-shrink-0 transition-colors ${active ? 'text-primary/60' : 'text-[#6b7280]/60 group-hover:text-[#c9d1d9]'}`}>
                    <span className={`material-symbols-outlined text-[16px] transition-transform duration-200 ${isSubOpen ? 'rotate-180' : ''}`}>
                      expand_more
                    </span>
                  </span>
                </button>

                {/* Sub-items */}
                {isSubOpen && item.subItems!
                  .filter((sub) => sub.roles.includes(role))
                  .map((sub) => {
                    const subActive = isActive(sub.href)
                    return (
                      <Link
                        key={sub.href}
                        href={sub.href}
                        className={`
                          group flex items-center gap-2.5 rounded-xl transition-all duration-150 relative
                          pl-9 pr-3 py-2.5 mt-0.5 min-h-[40px]
                          ${subActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-[#6b7280] hover:text-[#c9d1d9] hover:bg-white/[0.04]'}
                        `}
                      >
                        {subActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-primary rounded-r-full" />
                        )}
                        <span className={`material-symbols-outlined text-[16px] flex-shrink-0 ${subActive ? 'text-primary' : 'text-[#6b7280] group-hover:text-[#c9d1d9]'}`}>
                          {sub.icon}
                        </span>
                        <span className={`text-xs truncate ${subActive ? 'font-medium' : ''}`}>
                          {sub.label}
                        </span>
                      </Link>
                    )
                  })
                }
              </div>
            )
          }

          // Regular item (no sub-items)
          const locked = isLocked(item.href)
          if (locked) {
            const lockedKey = premiumLockedRoot(item.href) ?? item.href
            return (
              <button
                key={item.href}
                title={sidebarCollapsed ? `${item.label} — Pro тариф` : undefined}
                onClick={() => router.push(lockedKey)}
                className={`
                  relative flex items-center rounded-xl cursor-pointer select-none w-full
                  hover:bg-amber-500/5 transition-colors duration-150
                  ${sidebarCollapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3 py-2.5'}
                `}
              >
                <span className="material-symbols-outlined text-[20px] flex-shrink-0 text-[#6b7280] opacity-55">
                  {item.icon}
                </span>
                {!sidebarCollapsed && (
                  <span className="text-sm truncate font-medium text-[#6b7280] opacity-55 flex-1">
                    {item.label}
                  </span>
                )}
                {/* Lock badge */}
                {!sidebarCollapsed ? (
                  <span className="flex items-center px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-mono tracking-wide flex-shrink-0">
                    Pro
                  </span>
                ) : (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center rounded-full bg-amber-500/20 border border-amber-500/30">
                    <span className="text-amber-400 text-[7px] font-mono font-bold">P</span>
                  </span>
                )}
              </button>
            )
          }

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

        {/* Upload files quick-action — pulses brightly when no docs uploaded */}
        <UploadFilesNavItem collapsed={sidebarCollapsed} />

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
                group flex items-center rounded-xl transition-all duration-150 relative min-h-[40px]
                ${sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5 pl-9'}
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
