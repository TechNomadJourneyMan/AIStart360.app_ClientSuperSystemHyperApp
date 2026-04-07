'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { getNavForRole } from '@/lib/navigation'
import type { UserRole } from '@/types'

// ── Bottom bar — 4 primary tabs ─────────────────────────────────────────────
const BOTTOM_TABS = [
  { label: 'Дэшборд',  href: '/dashboard', icon: 'dashboard'       },
  { label: 'GRI Pulse',href: '/pulse',      icon: 'cell_tower'      },
  { label: 'Клиенты',  href: '/clients',    icon: 'business_center' },
  { label: 'Метрики',  href: '/metrics',    icon: 'monitoring'      },
]

// ── All sections shown in the "More" drawer ──────────────────────────────────
const DRAWER_SECTIONS = [
  {
    title: 'Основное',
    items: [
      { label: 'Дэшборд',    href: '/dashboard',  icon: 'dashboard'        },
      { label: 'GRI',        href: '/gri',         icon: 'radar'            },
      { label: 'GRI Pulse',  href: '/pulse',       icon: 'cell_tower'       },
      { label: 'Метрики',    href: '/metrics',     icon: 'monitoring'       },
      { label: 'Инсайты',    href: '/insights',    icon: 'lightbulb'        },
    ],
  },
  {
    title: 'Анализ',
    items: [
      { label: 'Рынок',      href: '/market',      icon: 'public'           },
      { label: 'Точка А',    href: '/point-a',     icon: 'my_location'      },
      { label: 'Точка Б',    href: '/point-b',     icon: 'flag'             },
      { label: 'Конкуренты', href: '/competitors', icon: 'compare_arrows'   },
      { label: 'Разведка',   href: '/intelligence',icon: 'hub'              },
    ],
  },
  {
    title: 'Работа',
    items: [
      { label: 'Клиенты',    href: '/clients',      icon: 'business_center' },
      { label: 'Отчёты',     href: '/reports',      icon: 'description'     },
      { label: 'Аналитика',  href: '/analytics',    icon: 'bar_chart'       },
      { label: 'Команда',    href: '/team',         icon: 'group'           },
    ],
  },
  {
    title: 'Система',
    items: [
      { label: 'Уведомления',href: '/notifications',icon: 'notifications'   },
      { label: 'Пользователи',href: '/users',       icon: 'manage_accounts' },
      { label: 'Профиль',    href: '/profile',      icon: 'account_circle'  },
      { label: 'Настройки',  href: '/settings',     icon: 'settings'        },
      { label: 'Админ',      href: '/admin',        icon: 'admin_panel_settings'},
    ],
  },
]

const PREMIUM_FEATURE_LABELS: Record<string, string> = {
  '/metrics':  'Метрики',
  '/market':   'Рынок',
  '/point-b':  'Точка Б',
}

export function MobileNav() {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [premiumItem, setPremiumItem] = useState<string | null>(null)
  const { user } = useAuthStore()

  const role = ((user?.role || 'client').toUpperCase()) as UserRole
  const allowedNav = getNavForRole(role).map(item => item.href)

  // Items locked behind a paid plan for CLIENT role
  const PREMIUM_LOCKED = ['/metrics', '/market', '/point-b']
  const isLocked = (href: string) =>
    role === 'CLIENT' && PREMIUM_LOCKED.some((p) => href === p || href.startsWith(p + '/'))

  const getLockedKey = (href: string) =>
    PREMIUM_LOCKED.find((p) => href === p || href.startsWith(p + '/')) ?? href

  // Filter out sections
  const filteredDrawer = DRAWER_SECTIONS.map(sec => ({
    ...sec,
    items: sec.items.filter(item => allowedNav.includes(item.href))
  })).filter(sec => sec.items.length > 0)

  const filteredTabs = BOTTOM_TABS.filter(item => allowedNav.includes(item.href))

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  // Prevent body scroll when drawer or premium modal is open
  useEffect(() => {
    document.body.style.overflow = (drawerOpen || premiumItem) ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen, premiumItem])

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
            const locked = isLocked(item.href)
            if (locked) {
              return (
                <button
                  key={item.href}
                  onClick={() => setPremiumItem(getLockedKey(item.href))}
                  className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-[10px] font-medium cursor-pointer select-none relative"
                >
                  <span className="material-symbols-outlined text-2xl text-[#8B95A3] opacity-40 blur-[1px]">
                    {item.icon}
                  </span>
                  <span className="text-[#8B95A3] opacity-40 blur-[1px]">{item.label}</span>
                  <span className="absolute top-2 right-[calc(50%-18px)] flex items-center px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[7px] font-mono">
                    Pro
                  </span>
                </button>
              )
            }
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
            <span>Ещё</span>
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
              <p className="text-sm font-semibold text-on-surface">Все разделы</p>
              <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wider mt-0.5">AIStart360 Portal</p>
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
                    const locked = isLocked(item.href)
                    if (locked) {
                      return (
                        <button
                          key={item.href}
                          onClick={() => { setPremiumItem(getLockedKey(item.href)); setDrawerOpen(false) }}
                          className="relative flex flex-col items-center gap-2 rounded-2xl p-3 bg-surface-container border border-amber-500/10 cursor-pointer select-none overflow-hidden w-full active:scale-95 transition-transform"
                        >
                          <span className="material-symbols-outlined text-2xl text-on-surface-variant opacity-30 blur-[1.5px]">
                            {item.icon}
                          </span>
                          <span className="text-[10px] font-medium text-center leading-tight text-on-surface-variant opacity-30 blur-[1.5px]">
                            {item.label}
                          </span>
                          {/* Pro overlay */}
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="flex items-center px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/25 text-amber-400 text-[8px] font-mono tracking-wide">
                              Pro
                            </span>
                          </div>
                        </button>
                      )
                    }
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

      {/* ── Premium upgrade modal ── */}
      {premiumItem && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
            onClick={() => setPremiumItem(null)}
          />
          {/* Sheet */}
          <div className="fixed left-4 right-4 bottom-24 z-50 rounded-3xl bg-[#13151c] border border-amber-500/20 shadow-2xl overflow-hidden">
            {/* Amber glow top */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />

            <div className="p-6">
              {/* Icon + badge */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-2xl text-amber-400">lock</span>
                </div>
                <div>
                  <p className="text-[10px] font-mono text-amber-400/70 uppercase tracking-[0.15em] mb-0.5">Pro тариф</p>
                  <p className="text-base font-bold text-on-surface">
                    {PREMIUM_FEATURE_LABELS[premiumItem] ?? premiumItem}
                  </p>
                </div>
              </div>

              <p className="text-sm text-on-surface-variant leading-relaxed mb-5">
                Этот раздел доступен в тарифе <span className="text-amber-400 font-medium">Pro</span>.
                Получите полный доступ к аналитике, рыночным данным и расширенным инструментам роста вашего бизнеса.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setPremiumItem(null)}
                  className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-on-surface-variant text-sm transition-colors hover:bg-white/[0.04]"
                >
                  Закрыть
                </button>
                <button
                  onClick={() => setPremiumItem(null)}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500/90 hover:bg-amber-400 text-black font-semibold text-sm transition-colors"
                >
                  Узнать подробнее
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
