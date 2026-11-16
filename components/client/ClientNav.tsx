'use client'

/**
 * The single navigation bar of the client cabinet (PO 2026-10-22, п. 2 and
 * п. 8). Mounted once in app/client/layout.tsx, so Точка А, Точка Б, the home
 * page, messages and documents all keep the same menu instead of opening an
 * isolated screen.
 *
 * Desktop: logo · sections · «Вернуться в панель» (staff only) · bell ·
 * profile menu. Phone: the same single row — the sections scroll sideways (the
 * active one is scrolled into view), the panel button moves into the profile
 * menu. R-096: the bell opens the notification feed («Доступ открыт», replies,
 * reminders) with the unread count; R-028: the old (dashboard) shell draws this
 * same bar for a client (app/(dashboard)/layout.tsx). The bar
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
import { signOutThisBrowser } from '@/lib/auth/sign-out-client'
import { trackLogout } from '@/lib/events/client'
import {
  activeClientMoreKey,
  activeClientNavKey,
  bellUnreadCount,
  clientShellMode,
  type ClientMoreItem,
  type ClientNavItem,
  type ClientNotificationsLink,
} from '@/lib/client-shell/nav'
import type { PanelLink } from '@/lib/client-shell/staff-links'
import { cn } from '@/lib/utils'
import { NotificationsBellSync } from '@/components/notifications/NotificationsBellSync'
import { useNotificationsStore } from '@/stores/notifications.store'

export interface ClientNavProps {
  items: ClientNavItem[]
  panel: PanelLink | null
  email: string | null
  /** R-096: the bell — null when the account cannot open the feed (an expert profile). */
  notifications?: ClientNotificationsLink | null
  /** WA-1: «Ещё» — the other sections visible to the account; nothing is drawn when empty. */
  more?: ClientMoreItem[]
}

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60'

/** A drop-down of the bar: closes on navigation, an outside click and Escape (focus back to its button). */
function usePopover() {
  const [open, setOpen] = useState(false)
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

  return { open, setOpen, pathname: pathname ?? '', menuId, wrap, button }
}

const MENU_ROW = cn('flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-on-surface hover:bg-white/[0.05]', FOCUS)

/**
 * WA-1: «Ещё» — the sections of the old menus the bar has no item for
 * (Клиенты (CRM), Симулятор, Метрики, Психопрофиль), only those visible to the
 * account (the server builds the list). Outside the sideways-scrolling row so
 * the drop-down is not clipped on a phone. The list is in the markup and
 * `hidden` while closed.
 */
function MoreMenu({ items }: { items: ClientMoreItem[] }) {
  const { open, setOpen, pathname, menuId, wrap, button } = usePopover()
  const active = activeClientMoreKey(pathname, items)
  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Ещё разделы"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-10 items-center gap-1 rounded-xl px-2 text-xs font-medium',
          active || open ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-white/[0.05] hover:text-on-surface',
          FOCUS,
        )}
      >
        <span className="material-symbols-outlined text-[20px]" aria-hidden>more_horiz</span>
        <span className="hidden sm:inline">Ещё</span>
      </button>
      <div
        id={menuId}
        hidden={!open}
        className="absolute right-0 top-full mt-2 w-60 rounded-2xl border border-white/[0.08] bg-surface-container p-1.5 shadow-xl shadow-black/40"
      >
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={item.key === active ? 'page' : undefined}
                className={cn(MENU_ROW, item.key === active && 'text-primary')}
              >
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant" aria-hidden>{item.icon}</span>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function ProfileMenu({ panel, email }: { panel: PanelLink | null; email: string | null }) {
  const { open, setOpen, menuId, wrap, button } = usePopover()
  const [leaving, setLeaving] = useState(false)

  const logout = async () => {
    setLeaving(true)
    trackLogout()
    // SR-06: the server decides — during an impersonation only that session
    // ends (the client stays signed in on their devices); a client's own
    // sign-out is global as before (lib/auth/sign-out-client.ts).
    let next = '/login'
    try {
      next = await signOutThisBrowser()
    } finally {
      // Legacy cookies some older pages still clear on sign-out.
      document.cookie = 'aistart360_role=; path=/; max-age=0'
      document.cookie = 'aistart360_user_id=; path=/; max-age=0'
      window.location.href = next
    }
  }

  const row = MENU_ROW

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

/**
 * R-096: the bell. First paint shows the server count; NotificationsBellSync
 * then keeps it fresh (a light count request, WA-5; refetch when the tab is
 * back) — the layout itself is not re-rendered on client navigation. The feed
 * page writes the same store, so «Прочитать все» or opening an entry changes
 * the number at once (WA-4). On the feed page itself the number is not repeated.
 */
function NotificationsBell({ link, pathname }: { link: ClientNotificationsLink; pathname: string }) {
  const live = useNotificationsStore((s) => s.unreadCount)
  // The store holds a real count only after the first sync; until then — the server's.
  const synced = useNotificationsStore((s) => s.synced)
  const current = pathname === link.href || pathname.startsWith(`${link.href}/`)
  const unread = bellUnreadCount({ onFeed: current, synced, live, server: link.unread })
  return (
    <>
      <NotificationsBellSync />
      <Link
        href={link.href}
        aria-current={current ? 'page' : undefined}
        aria-label={unread > 0 ? `Уведомления, непрочитанных: ${unread}` : 'Уведомления'}
        title="Уведомления"
        className={cn(
          'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
          current ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-white/[0.05] hover:text-on-surface',
          FOCUS,
        )}
      >
        <span className="material-symbols-outlined text-[22px]" aria-hidden>notifications</span>
        {unread > 0 && (
          <span aria-hidden className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-bold leading-4 text-on-primary tabular-nums">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
    </>
  )
}

export function ClientNav({ items, panel, email, notifications = null, more = [] }: ClientNavProps) {
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
                    {item.locked && (
                      <>
                        <span className="material-symbols-outlined text-[14px] text-on-surface-variant/70" aria-hidden>lock</span>
                        <span className="sr-only">, платный доступ</span>
                      </>
                    )}
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

        {more.length > 0 && <MoreMenu items={more} />}

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

        {notifications && <NotificationsBell link={notifications} pathname={pathname} />}

        <ProfileMenu panel={panel} email={email} />
      </div>
    </header>
  )
}
