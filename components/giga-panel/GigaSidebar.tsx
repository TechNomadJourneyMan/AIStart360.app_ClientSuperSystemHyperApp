'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity, Bell, Bot, Building2, ClipboardList, Coins, CopyCheck, Eye, FileBarChart, FileText, InboxIcon, KeyRound, LayoutDashboard, LayoutGrid,
  Lightbulb, ListChecks, LogOut, Mail, MessagesSquare, Radar, Route, ScanSearch, ScrollText, Settings, Shield, ShieldCheck, Sparkles, Stamp,
  Users2, X, Zap, type LucideIcon,
} from 'lucide-react'
import { activeNavHref, visibleNav, type GigaNavBadge, type GigaNavGroup } from '@/lib/admin/nav'
import { useWorkspace } from './WorkspaceContext'
import { createClient } from '@/lib/supabase/client'
import { useStaff } from './StaffContext'
import { cx, gigaFetch } from './kit'
import { CommandPalette } from './CommandPalette'
import { NAV_BADGES_CHANGED } from './agents/model'

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, users: Users2, inbox: InboxIcon, building: Building2, sparkles: Sparkles,
  clipboard: ClipboardList, radar: Radar, activity: Activity, route: Route, messages: MessagesSquare,
  lightbulb: Lightbulb, shieldcheck: ShieldCheck, file: FileText, layout: LayoutGrid, settings: Settings,
  key: KeyRound, eye: Eye, scroll: ScrollText, mail: Mail, copy: CopyCheck,
  bell: Bell, bot: Bot, listchecks: ListChecks, stamp: Stamp, coins: Coins, zap: Zap,
  reports: FileBarChart, review: ScanSearch,
}

const BADGE_REFRESH_MS = 60_000

/**
 * Live counters next to menu items. Fetched only for badges whose item the
 * actor can see; a failure (e.g. migrations not applied) just hides the badge.
 */
function useNavBadges(groups: GigaNavGroup[], pathname: string): Partial<Record<GigaNavBadge, number>> {
  const wantsApprovals = groups.some((g) => g.items.some((i) => i.badge === 'pendingApprovals'))
  const [counts, setCounts] = useState<Partial<Record<GigaNavBadge, number>>>({})
  useEffect(() => {
    if (!wantsApprovals) { setCounts({}); return }
    let alive = true
    const load = () => {
      gigaFetch<{ items: unknown[] }>('/api/giga-admin/agents/approvals?scope=pending')
        .then((r) => { if (alive) setCounts({ pendingApprovals: Array.isArray(r.items) ? r.items.length : 0 }) })
        .catch(() => { if (alive) setCounts({}) })
    }
    load()
    const id = setInterval(load, BADGE_REFRESH_MS)
    window.addEventListener(NAV_BADGES_CHANGED, load)
    return () => { alive = false; clearInterval(id); window.removeEventListener(NAV_BADGES_CHANGED, load) }
    // Re-count after navigation: deciding on the approvals page changes the number.
  }, [wantsApprovals, pathname])
  return counts
}

interface GigaSidebarProps { isOpen?: boolean; onClose?: () => void }

export function GigaSidebar({ isOpen = false, onClose }: GigaSidebarProps) {
  const pathname = usePathname() ?? ''
  const { me, can, loading } = useStaff()
  const { base, label, sublabel, nav, loginPath } = useWorkspace()
  const groups = loading ? [] : visibleNav(nav, can)
  const activeHref = activeNavHref(groups, pathname)
  const badges = useNavBadges(groups, pathname)

  // The menu is longer than a laptop screen: keep the current section in view.
  useEffect(() => {
    if (!activeHref) return
    document.querySelectorAll<HTMLElement>('aside nav a[aria-current="page"]').forEach((el) => el.scrollIntoView({ block: 'nearest' }))
  }, [activeHref, isOpen])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.() }
    if (isOpen) window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  const logout = async () => {
    try {
      await fetch('/api/giga-admin/auth', { method: 'DELETE' })
      if (me?.kind === 'session') await createClient().auth.signOut()
    } finally {
      window.location.href = me?.kind === 'break_glass' ? '/giga-login' : loginPath
    }
  }

  const content = (
    <>
      <div className="flex items-center justify-between px-5 pb-4 pt-6">
        <Link href={base} className="flex items-center gap-3" onClick={onClose}>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-blue-500/30 bg-blue-500/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon-blue.svg" alt="AIStart360" className="h-7 w-7 object-contain" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-400">{label}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">{sublabel}</p>
          </div>
        </Link>
        <button onClick={onClose} aria-label="Закрыть меню" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-white/[0.05] hover:text-slate-300 md:hidden">
          <X size={18} />
        </button>
      </div>

      <div className="px-3 pb-3">
        <CommandPalette />
      </div>

      <nav aria-label={`Разделы: ${label}`} className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {loading && <div className="space-y-2 px-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-7 animate-pulse rounded-lg bg-white/[0.04]" />)}</div>}
        {groups.map((group) => {
          return (
            <div key={group.label}>
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600">{group.label}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = ICONS[item.icon] ?? LayoutDashboard
                  const active = item.href === activeHref
                  const count = item.badge ? badges[item.badge] ?? 0 : 0
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        aria-current={active ? 'page' : undefined}
                        className={cx(
                          'flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all',
                          active ? 'border border-blue-500/20 bg-blue-500/15 text-blue-200' : 'border border-transparent text-slate-400 hover:bg-white/[0.05] hover:text-slate-200',
                        )}
                      >
                        <Icon size={16} />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {count > 0 && (
                          <span
                            className="ml-auto rounded-full border border-amber-500/30 bg-amber-500/20 px-1.5 text-[10px] font-semibold tabular-nums text-amber-200"
                            aria-label={`ожидают решения: ${count}`}
                          >
                            {count > 99 ? '99+' : count}
                          </span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      <div className="px-3 pb-5">
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2.5">
          <div className={cx('flex h-7 w-7 items-center justify-center rounded-lg', me?.kind === 'break_glass' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-300')}>
            <Shield size={13} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-slate-300">{me?.roleLabel ?? '…'}</p>
            <p className="truncate text-[10px] text-slate-600" title={me?.email ?? undefined}>
              {me?.kind === 'break_glass' ? 'Аварийный вход (общий пароль)' : me?.email ?? ''}
            </p>
          </div>
          <button onClick={logout} title="Выйти из панели" aria-label="Выйти из панели" className="text-slate-600 transition-colors hover:text-red-400">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </>
  )

  return (
    <>
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col border-r border-white/[0.07] bg-slate-950/80 backdrop-blur-xl md:flex">
        {content}
      </aside>
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm md:hidden" />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="fixed left-0 top-0 z-50 flex h-screen w-72 flex-col border-r border-white/[0.07] bg-slate-950 md:hidden"
            >
              {content}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
