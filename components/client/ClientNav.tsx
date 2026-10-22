'use client'

/**
 * The single navigation bar of the client cabinet (PO 2026-10-22, п. 2 and
 * п. 8). Mounted once in app/client/layout.tsx, so Точка А, Точка Б, the home
 * page, messages and documents all keep the same menu instead of opening an
 * isolated screen.
 *
 * Desktop: logo · sections · «Вернуться в панель» (staff only) · profile menu.
 * Phone: the same single row — the sections scroll sideways (the active one is
 * scrolled into view), the panel button moves into the profile menu. The bar
 * sits at the TOP on purpose: the bottom corners belong to «Гри» and the
 * expert pop-ups (components/popups/PopupLayer), which a bottom bar would cover.
 *
 * The items and the panel link come from the server (lib/client-shell/server):
 * this component never decides who is staff.
 */
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { trackLogout } from '@/lib/events/client'
import { activeClientNavKey, clientShellMode, type ClientNavItem } from '@/lib/client-shell/nav'
import type { PanelLink } from '@/lib/client-shell/staff-links'
import { cn } from '@/lib/utils'

export interface ClientNavProps {
  items: ClientNavItem[]
  panel: PanelLink | null
  email: string | null
}

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60'

function ProfileMenu({ panel, email }: { panel: PanelLink | null; email: string | null }) {
  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const pathname = usePathname()
  const menuId = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); button.current?.focus() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const logout = async () => {
    setLeaving(true)
    trackLogout()
    try {
      await createClient().auth.signOut()
    } catch {
      /* the redirect below still leaves the cabinet; middleware re-checks the session */
    } finally {
      // Legacy cookies some older pages still clear on sign-out.
      document.cookie = 'aistart360_role=; path=/; max-age=0'
      document.cookie = 'aistart360_user_id=; path=/; max-age=0'
      window.location.href = '/login'
    }
  }

  const row = cn('flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-on-surface hover:bg-white/[0.05]', FOCUS)

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Профиль и выход"
        onClick={() => setOpen((v) => !v)}
        className={cn('flex h-10 w-10 items-center justify-center rounded-xl text-on-surface-variant hover:bg-white/[0.05] hover:text-on-surface', open && 'bg-white/[0.05] text-on-surface', FOCUS)}
      >
        <span className="material-symbols-outlined text-[22px]" aria-hidden>account_circle</span>
      </button>
      {open && (
        <div
          id={menuId}
          className="absolute right-0 top-full mt-2 w-64 rounded-2xl border border-white/[0.08] bg-surface-container p-1.5 shadow-xl shadow-black/40"
        >
          {email && <p className="truncate px-3 pb-2 pt-1.5 text-xs text-on-surface-variant" title={email}>{email}</p>}
          <ul className="space-y-0.5">
            {panel && (
              <li>
                <Link href={panel.href} className={row} title={`${panel.label}: ${panel.panelName}`}>
                  <span className="material-symbols-outlined text-[18px] text-primary" aria-hidden>admin_panel_settings</span>
                  <span className="min-w-0 flex-1">
                    {panel.label}
                    <span className="block text-[11px] text-on-surface-variant">{panel.panelName}</span>
                  </span>
                </Link>
              </li>
            )}
            {panel?.panel !== 'expert' && (
              <li>
                <Link href="/settings" className={row}>
                  <span className="material-symbols-outlined text-[18px] text-on-surface-variant" aria-hidden>settings</span>
                  Настройки
                </Link>
              </li>
            )}
            <li>
              <button type="button" onClick={() => void logout()} disabled={leaving} className={cn(row, 'disabled:opacity-60')}>
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant" aria-hidden>logout</span>
                {leaving ? 'Выходим…' : 'Выйти'}
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}

export function ClientNav({ items, panel, email }: ClientNavProps) {
  const pathname = usePathname() ?? ''
  const mode = clientShellMode(pathname)
  const active = activeClientNavKey(pathname, items)
  const list = useRef<HTMLUListElement>(null)
  // The layout (and its server data) survives client navigation: once the user
  // opened «Сообщения» the counter is read, so stop showing the stale number.
  const [messagesSeen, setMessagesSeen] = useState(false)

  useEffect(() => {
    if (active === 'messages') setMessagesSeen(true)
    // Keep the current section visible in the sideways-scrolling phone row.
    list.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [active])

  if (mode === 'none') return null

  return (
    <header
      className={cn(
        'z-30 border-b border-white/[0.06] bg-background/90 backdrop-blur-xl',
        mode === 'sticky' ? 'sticky top-0' : 'relative',
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-3 sm:px-6">
        <Link href="/client/home" className={cn('flex shrink-0 items-center gap-2 rounded-lg', FOCUS)} aria-label="AIStart360 — главная кабинета">
          <Image src="/logo-icon.svg" alt="" width={28} height={28} priority />
          <span className="hidden text-sm font-bold text-on-surface/80 xl:block">AIStart360</span>
        </Link>

        <nav aria-label="Разделы кабинета" className="min-w-0 flex-1">
          <ul ref={list} className="no-scrollbar flex items-center gap-1 overflow-x-auto py-1">
            {items.map((item) => {
              const current = item.key === active
              const badge = item.key === 'messages' && !messagesSeen && !current ? item.badge ?? 0 : 0
              return (
                <li key={item.key} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-xs font-medium transition-colors',
                      current ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-white/[0.05] hover:text-on-surface',
                      FOCUS,
                    )}
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden>{item.icon}</span>
                    {item.label}
                    {badge > 0 && (
                      <>
                        <span aria-hidden className="rounded-full bg-primary px-1.5 text-[10px] font-bold leading-4 text-on-primary tabular-nums">
                          {badge > 99 ? '99+' : badge}
                        </span>
                        <span className="sr-only">, непрочитанных: {badge}</span>
                      </>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {panel && (
          <Link
            href={panel.href}
            title={`${panel.label}: ${panel.panelName}`}
            className={cn(
              'hidden shrink-0 items-center gap-1.5 rounded-xl border border-primary/25 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10 md:flex',
              FOCUS,
            )}
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden>admin_panel_settings</span>
            {panel.label}
          </Link>
        )}

        <ProfileMenu panel={panel} email={email} />
      </div>
    </header>
  )
}
