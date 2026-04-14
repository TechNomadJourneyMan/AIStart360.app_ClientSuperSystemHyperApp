'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useUIStore } from '@/stores/ui.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import { useAuthStore } from '@/stores/auth.store'
import { useLocaleStore } from '@/stores/locale.store'
import { hasPermission } from '@/lib/navigation'
import type { UserRole } from '@/types'

export function Header() {
  const t = useTranslations()
  const { sidebarCollapsed } = useUIStore()
  const { unreadCount } = useNotificationsStore()
  const { user, logout } = useAuthStore()
  const { locale, toggleLocale } = useLocaleStore()
  const router = useRouter()
  const [searchFocused, setSearchFocused] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showQuickAction, setShowQuickAction] = useState(false)
  const [time, setTime] = useState('')

  useEffect(() => {
    const update = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString(locale === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [locale])

  const QUICK_ACTIONS = [
    { label: t('header.newClient'),       icon: 'person_add',    href: '/clients',    reqPermission: 'clients.write' },
    { label: t('header.griDiagnostics'),  icon: 'radar',         href: '/gri',        reqPermission: 'reports.read'  },
    { label: t('header.createReport'),    icon: 'description',   href: '/reports',    reqPermission: 'reports.write' },
    { label: t('header.analytics'),       icon: 'monitoring',    href: '/analytics',  reqPermission: 'analytics.read'},
    { label: t('header.insights'),        icon: 'lightbulb',     href: '/insights',   reqPermission: 'own.reports'   },
    { label: t('header.teamManagement'),  icon: 'groups',        href: '/team',       reqPermission: 'team.write'    },
  ]

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() ?? 'AS'

  return (
    <header
      className={`
        fixed top-0 right-0 z-40 h-16
        bg-background/80 backdrop-blur-xl
        border-b border-outline-variant/10
        flex items-center justify-between px-4 md:px-6 lg:px-8
        transition-all duration-250
        ${sidebarCollapsed ? 'lg:left-[68px]' : 'lg:left-[220px]'}
        left-0
      `}
    >
      {/* Left: Search */}
      <div className={`relative transition-all duration-200 ${searchFocused ? 'w-56 lg:w-72' : 'w-32 lg:w-44'}`}>
        <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-[18px] pointer-events-none">
          search
        </span>
        <input
          type="search"
          placeholder={searchFocused ? t('common.searchExpanded') : t('common.search')}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const q = (e.target as HTMLInputElement).value.trim()
              if (q) router.push(`/clients?q=${encodeURIComponent(q)}`)
            }
          }}
          className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg pl-8 pr-7 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/10 transition-all"
        />
        <kbd className="hidden lg:inline-flex absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono text-on-surface-variant/25 border border-outline-variant/20 rounded px-1 py-0.5">
          ↵
        </kbd>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 md:gap-4">
        {/* Quick Action */}
        <div className="relative">
          <button
            onClick={() => setShowQuickAction(v => !v)}
            title={t('header.quickAction')}
            className={`inline-flex items-center gap-1.5 text-xs font-mono border px-2 py-1.5 rounded-lg transition-colors ${
              showQuickAction
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'text-primary border-primary/20 hover:bg-primary/5'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">bolt</span>
            <span className="hidden lg:inline">{t('header.action')}</span>
            <span className={`hidden md:inline material-symbols-outlined text-xs transition-transform duration-200 ${showQuickAction ? 'rotate-180' : ''}`}>expand_more</span>
          </button>

          {showQuickAction && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowQuickAction(false)} />
              <div className="absolute left-0 top-full mt-2 w-52 bg-surface-container-low border border-white/[0.06] rounded-xl shadow-xl z-50 overflow-hidden py-1">
                {QUICK_ACTIONS.filter(action => hasPermission(((user?.role || 'client').toUpperCase()) as UserRole, action.reqPermission)).map((action) => (
                  <Link key={action.href} href={action.href}
                    onClick={() => setShowQuickAction(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface-variant hover:text-on-surface hover:bg-white/[0.04] transition-colors">
                    <span className="material-symbols-outlined text-base text-primary/60">{action.icon}</span>
                    {action.label}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Run Report */}
        <Link href="/reports"
          className="hidden lg:inline-flex items-center gap-1.5 text-xs font-semibold bg-gradient-to-br from-primary to-primary-container text-on-primary px-3.5 py-1.5 rounded-lg hover:scale-[0.97] active:scale-95 transition-all duration-150">
          <span className="material-symbols-outlined text-[18px]">description</span>
          {t('nav.reports')}
        </Link>

        <div className="w-px h-6 bg-outline-variant/20 hidden md:block" />

        {/* Real-time clock */}
        <div className="hidden md:flex items-center gap-1.5 font-mono text-xs text-on-surface-variant/70 select-none">
          <span className="material-symbols-outlined text-sm">schedule</span>
          <span className="tabular-nums w-[58px]">{time}</span>
        </div>

        {/* Language switcher */}
        <button
          onClick={toggleLocale}
          title={`${t('header.language')}: ${locale.toUpperCase()}`}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-outline-variant/20 text-xs font-mono text-on-surface-variant hover:text-on-surface hover:border-primary/20 hover:bg-primary/5 transition-all duration-150"
        >
          <span className="material-symbols-outlined text-sm hidden md:inline">translate</span>
          <span>{locale.toUpperCase()}</span>
        </button>

        <div className="w-px h-6 bg-outline-variant/20 hidden md:block" />

        {/* Notifications */}
        <Link href="/notifications" className="relative text-[#8B95A3] hover:text-on-surface transition-colors p-1.5 rounded-lg hover:bg-surface-container" aria-label={t('nav.notifications')}>
          <span className="material-symbols-outlined text-xl">notifications</span>
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-error rounded-full border-2 border-background text-[9px] font-mono text-white flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Link>

        {/* User Avatar + Menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(v => !v)}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <div className="w-8 h-8 rounded-full bg-surface-container-high border border-outline-variant/30 flex items-center justify-center text-xs font-bold text-primary group-hover:border-primary/40 transition-colors">
              {initials}
            </div>
            <span className="hidden lg:flex items-center gap-1 text-[#8B95A3] group-hover:text-on-surface transition-colors">
              <span className="hidden lg:block text-xs font-medium text-on-surface-variant max-w-[80px] truncate">{user?.name?.split(' ')[0]}</span>
              <span className="material-symbols-outlined text-lg">keyboard_arrow_down</span>
            </span>
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 top-full mt-2 w-48 bg-surface-container-low border border-white/[0.06] rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.04]">
                  <p className="text-xs font-medium text-on-surface truncate">{user?.name}</p>
                  <p className="text-[10px] text-on-surface-variant truncate">{user?.email}</p>
                </div>
                <Link href="/profile" onClick={() => setShowUserMenu(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-on-surface-variant hover:text-on-surface hover:bg-white/[0.04] transition-colors">
                  <span className="material-symbols-outlined text-base">account_circle</span>
                  {t('nav.profile')}
                </Link>
                <Link href="/settings" onClick={() => setShowUserMenu(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-on-surface-variant hover:text-on-surface hover:bg-white/[0.04] transition-colors">
                  <span className="material-symbols-outlined text-base">settings</span>
                  {t('nav.settings')}
                </Link>
                <div className="border-t border-white/[0.04]" />
                <button onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-error/70 hover:text-error hover:bg-error/5 transition-colors">
                  <span className="material-symbols-outlined text-base">logout</span>
                  {t('nav.logout')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
