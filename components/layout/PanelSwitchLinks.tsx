'use client'

import Link from 'next/link'
import { useAuthStore } from '@/stores/auth.store'
import { panelLinksFor, type PanelLink } from '@/lib/panel-links'

/**
 * «Админ-панель» / «Панель эксперта» в клиентском кабинете.
 *
 * Видны только администраторам и экспертам (правила — lib/panel-links.ts);
 * обычный клиент не видит ничего. Во время impersonation сессия в браузере —
 * клиентская, поэтому кнопок тоже нет.
 */
export function usePanelLinks(): PanelLink[] {
  const user = useAuthStore((s) => s.user)
  if (!user) return []
  return panelLinksFor({ role: user.role, staffRole: user.staffRole, status: user.status })
}

type Variant = 'sidebar' | 'menu' | 'drawer' | 'topbar'

export function PanelSwitchLinks({
  variant,
  collapsed = false,
  onNavigate,
}: {
  variant: Variant
  /** Свёрнутая боковая панель: только иконки. */
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const links = usePanelLinks()
  if (!links.length) return null

  if (variant === 'sidebar') {
    return (
      <>
        {links.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            onClick={onNavigate}
            title={collapsed ? l.label : undefined}
            className={`
              group flex items-center rounded-xl border border-primary/20 bg-primary/[0.06] text-primary
              transition-all duration-150 hover:bg-primary/10
              ${collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'}
            `}
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden>{l.icon}</span>
            {collapsed ? <span className="sr-only">{l.label}</span> : <span className="text-sm font-medium">{l.label}</span>}
          </Link>
        ))}
      </>
    )
  }

  if (variant === 'menu') {
    return (
      <>
        {links.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            onClick={onNavigate}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-primary hover:bg-primary/[0.06] transition-colors"
          >
            <span className="material-symbols-outlined text-base" aria-hidden>{l.icon}</span>
            {l.label}
          </Link>
        ))}
        <div className="border-t border-white/[0.04]" />
      </>
    )
  }

  if (variant === 'drawer') {
    return (
      <div>
        <p className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.15em] mb-2 px-1">
          Рабочие кабинеты
        </p>
        <div className="grid grid-cols-2 gap-2">
          {links.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              onClick={onNavigate}
              className="flex items-center gap-2 rounded-2xl border border-primary/20 bg-primary/[0.06] p-3 text-primary active:scale-95 transition-transform"
            >
              <span className="material-symbols-outlined text-xl" aria-hidden>{l.icon}</span>
              <span className="text-xs font-semibold leading-tight">{l.label}</span>
            </Link>
          ))}
        </div>
      </div>
    )
  }

  // topbar — компактные кнопки в шапке (/client/home)
  return (
    <>
      {links.map((l) => (
        <Link
          key={l.key}
          href={l.href}
          onClick={onNavigate}
          title={l.label}
          className="flex items-center gap-1 rounded-lg border border-primary/25 bg-primary/[0.07] px-2.5 py-1.5 text-primary hover:bg-primary/15"
        >
          <span className="material-symbols-outlined text-sm" aria-hidden>{l.icon}</span>
          <span className="hidden sm:inline">{l.label}</span>
          <span className="sr-only sm:hidden">{l.label}</span>
        </Link>
      ))}
    </>
  )
}
