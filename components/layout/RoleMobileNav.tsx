'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

type PortalRole = 'owner' | 'expert'

interface MobileNavItem {
  label: string
  href: string
  icon: string
}

interface MobileNavSection {
  title: string
  items: MobileNavItem[]
}

interface MobileNavConfig {
  homePath: string
  portalLabel: string
  tabs: MobileNavItem[]
  sections: MobileNavSection[]
}

const NAV_CONFIG: Record<PortalRole, MobileNavConfig> = {
  owner: {
    homePath: '/owner/dashboard',
    portalLabel: 'Owner Portal',
    tabs: [
      { label: 'Дашборд', href: '/owner/dashboard', icon: 'dashboard' },
      { label: 'Точка А', href: '/owner/point-a', icon: 'my_location' },
      { label: 'Советы', href: '/owner/recommendations', icon: 'auto_awesome' },
      { label: 'Документы', href: '/owner/documents', icon: 'description' },
    ],
    sections: [
      {
        title: 'Рабочие разделы',
        items: [
          { label: 'Дашборд', href: '/owner/dashboard', icon: 'dashboard' },
          { label: 'Анкета', href: '/owner/onboarding', icon: 'edit_note' },
          { label: 'Документы', href: '/owner/documents', icon: 'description' },
          { label: 'Точка А', href: '/owner/point-a', icon: 'my_location' },
          { label: 'Рекомендации', href: '/owner/recommendations', icon: 'auto_awesome' },
          { label: 'Профиль', href: '/owner/profile', icon: 'account_circle' },
        ],
      },
      {
        title: 'Следующие релизы',
        items: [
          { label: 'Карта развития', href: '/owner/roadmap', icon: 'route' },
        ],
      },
    ],
  },
  expert: {
    homePath: '/expert/dashboard',
    portalLabel: 'Expert Portal',
    tabs: [
      { label: 'Дэшборд', href: '/expert/dashboard', icon: 'dashboard' },
      { label: 'Продажи', href: '/expert/sales-monitoring', icon: 'point_of_sale' },
      { label: 'Отчёты', href: '/expert/reports', icon: 'description' },
      { label: 'GRI', href: '/expert/gri', icon: 'radar' },
    ],
    sections: [
      {
        title: 'Работа',
        items: [
          { label: 'Дэшборд', href: '/expert/dashboard', icon: 'dashboard' },
          { label: 'Продажи', href: '/expert/sales-monitoring', icon: 'point_of_sale' },
          { label: 'Отчёты', href: '/expert/reports', icon: 'description' },
          { label: 'GRI', href: '/expert/gri', icon: 'radar' },
          { label: 'Инсайты', href: '/expert/insights', icon: 'lightbulb' },
          { label: 'Профиль', href: '/expert/profile', icon: 'account_circle' },
        ],
      },
    ],
  },
}

export function RoleMobileNav({ role }: { role: PortalRole }) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const config = NAV_CONFIG[role]

  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawerOpen])

  const isActive = (href: string) =>
    href === config.homePath ? pathname === href : pathname.startsWith(href)

  const isAnyTabActive = config.tabs.some((item) => isActive(item.href))
  const isDrawerOnlyItemActive = !isAnyTabActive && config.sections
    .flatMap((section) => section.items)
    .some((item) => isActive(item.href))

  return (
    <>
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#111318]/95 backdrop-blur-xl border-t border-outline-variant/20 safe-area-bottom"
        aria-label={`Навигация ${config.portalLabel}`}
      >
        <div className="flex">
          {config.tabs.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
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

          <button
            type="button"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-expanded={drawerOpen}
            aria-controls={`${role}-mobile-navigation-drawer`}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 text-[10px] font-medium transition-colors ${
              drawerOpen || isDrawerOnlyItemActive ? 'text-primary' : 'text-[#8B95A3]'
            }`}
          >
            <span
              className="material-symbols-outlined text-2xl"
              style={drawerOpen || isDrawerOnlyItemActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {drawerOpen ? 'close' : 'menu'}
            </span>
            <span>Ещё</span>
          </button>
        </div>
      </nav>

      <button
        type="button"
        aria-label="Закрыть меню"
        tabIndex={drawerOpen ? 0 : -1}
        className={`lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setDrawerOpen(false)}
      />

      <div
        id={`${role}-mobile-navigation-drawer`}
        aria-hidden={!drawerOpen}
        className={`lg:hidden fixed left-0 right-0 bottom-[64px] z-40 transition-transform duration-300 ease-out ${
          drawerOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="bg-[#13151c] border border-white/[0.06] rounded-t-3xl shadow-2xl max-h-[75vh] overflow-y-auto">
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>

          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
            <div>
              <p className="text-sm font-semibold text-on-surface">Все разделы</p>
              <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wider mt-0.5">
                {config.portalLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Закрыть меню"
              tabIndex={drawerOpen ? 0 : -1}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-container hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-base text-on-surface-variant">close</span>
            </button>
          </div>

          <div className="px-4 py-4 space-y-5">
            {config.sections.map((section) => (
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
                        aria-current={active ? 'page' : undefined}
                        tabIndex={drawerOpen ? 0 : -1}
                        className={`flex flex-col items-center gap-2 rounded-2xl p-3 transition-all duration-150 ${
                          active
                            ? 'bg-primary/10 border border-primary/20'
                            : 'bg-surface-container border border-white/[0.04] hover:border-white/[0.10] active:scale-95'
                        }`}
                      >
                        <span
                          className={`material-symbols-outlined text-2xl ${
                            active ? 'text-primary' : 'text-on-surface-variant'
                          }`}
                          style={active ? { fontVariationSettings: "'FILL' 0.8" } : undefined}
                        >
                          {item.icon}
                        </span>
                        <span
                          className={`text-[10px] font-medium text-center leading-tight ${
                            active ? 'text-primary' : 'text-on-surface-variant'
                          }`}
                        >
                          {item.label}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="h-4" />
        </div>
      </div>
    </>
  )
}
