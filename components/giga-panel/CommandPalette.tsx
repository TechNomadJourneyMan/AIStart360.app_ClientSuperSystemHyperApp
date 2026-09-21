'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { ClipboardList, Clock, CornerDownLeft, Loader2, Search, User, X } from 'lucide-react'
import { useStaff } from './StaffContext'
import { useWorkspace } from './WorkspaceContext'
import { cx, gigaFetch, useDebounced } from './kit'

/**
 * Panel-wide quick search (⌘K / Ctrl+K, or «/»): jump to any section or user
 * without leaving the keyboard. A user row opens User 360; «Анкета» opens the
 * questionnaire drawer for that user. The last opened people are remembered
 * per browser so the common «back to the person I just worked on» is one key.
 */

const RECENT_KEY = 'aistart360.giga.recentUsers'
const RECENT_MAX = 6

export interface RecentUser { id: string; label: string; hint?: string | null }

export function rememberUser(u: RecentUser): void {
  try {
    const prev = readRecent().filter((x) => x.id !== u.id)
    localStorage.setItem(RECENT_KEY, JSON.stringify([u, ...prev].slice(0, RECENT_MAX)))
  } catch {
    /* storage unavailable — recents are a convenience only */
  }
}

function readRecent(): RecentUser[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x) => x && typeof x.id === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

interface UserHit {
  id: string; email: string | null; full_name: string | null; company_name: string | null
  organization: string | null; survey_steps: number; status: string
}
type Item =
  | { kind: 'nav'; key: string; label: string; hint: string; href: string }
  | { kind: 'user'; key: string; label: string; hint: string; id: string }

export function CommandPalette() {
  const router = useRouter()
  const { can, me } = useStaff()
  const { base, nav: workspaceNav } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 250)
  const [hits, setHits] = useState<UserHit[]>([])
  const [loading, setLoading] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [recent, setRecent] = useState<RecentUser[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // ⌘K / Ctrl+K anywhere; «/» only outside inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if ((e.key === 'k' || e.key === 'K' || e.key === 'л' || e.key === 'Л') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    setRecent(readRecent())
    setCursor(0)
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open || !can('users.view') || dq.length < 2) { setHits([]); return }
    let alive = true
    setLoading(true)
    gigaFetch<{ data: UserHit[] }>(`/api/giga-admin/users?q=${encodeURIComponent(dq)}&pageSize=6&sort=survey_updated&dir=desc`)
      .then((r) => { if (alive) setHits(r.data ?? []) })
      .catch(() => { if (alive) setHits([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [dq, open, can])

  const items = useMemo<Item[]>(() => {
    const needle = dq.toLowerCase()
    const nav = workspaceNav.flatMap((g) => g.items.filter((i) => can(i.permission)).map((i) => ({ group: g.label, ...i })))
      .filter((i) => !needle || i.label.toLowerCase().includes(needle) || i.group.toLowerCase().includes(needle))
      .map((i) => ({ kind: 'nav' as const, key: `nav:${i.href}`, label: i.label, hint: i.group, href: i.href }))

    const users = hits.map((u) => ({
      kind: 'user' as const,
      key: `user:${u.id}`,
      id: u.id,
      label: u.company_name || u.organization || u.full_name || u.email || u.id.slice(0, 8),
      hint: [u.full_name, u.email].filter(Boolean).join(' · ') || 'без имени',
    }))

    const recents = !needle
      ? recent.map((r) => ({ kind: 'user' as const, key: `recent:${r.id}`, id: r.id, label: r.label, hint: r.hint || 'недавно открывали' }))
      : []

    return [...recents, ...users, ...nav]
  }, [dq, hits, recent, can, workspaceNav])

  useEffect(() => { setCursor((c) => Math.min(c, Math.max(items.length - 1, 0))) }, [items.length])

  const go = useCallback((item: Item, target: 'default' | 'survey' = 'default') => {
    setOpen(false)
    setQ('')
    if (item.kind === 'nav') { router.push(item.href); return }
    rememberUser({ id: item.id, label: item.label, hint: item.hint })
    router.push(target === 'survey' ? `${base}/surveys?user=${item.id}` : `${base}/users/${item.id}`)
  }, [router, base])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (items.length ? (c + 1) % items.length : 0)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (items.length ? (c - 1 + items.length) % items.length : 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[cursor]; if (it) go(it, e.shiftKey ? 'survey' : 'default') }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  if (!me) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Поиск по панели (⌘K)"
        className="flex w-full items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] text-slate-500 transition-colors hover:border-blue-500/30 hover:text-slate-300"
      >
        <Search size={13} />
        <span className="flex-1 text-left">Поиск и переходы…</span>
        <kbd className="rounded border border-white/[0.12] px-1 py-0.5 font-sans text-[9px] text-slate-500">⌘K</kbd>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
          >
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.98 }}
              role="dialog" aria-modal="true" aria-label="Поиск по панели"
              className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/[0.1] bg-[#070c1e] shadow-2xl"
            >
              <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
                <Search size={15} className="text-slate-500" />
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setCursor(0) }}
                  onKeyDown={onKeyDown}
                  placeholder="Имя, email, компания или раздел…"
                  aria-label="Поиск по панели"
                  className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
                />
                {loading && <Loader2 size={14} className="animate-spin text-slate-500" />}
                <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть" className="text-slate-600 hover:text-slate-300"><X size={15} /></button>
              </div>

              <div className="max-h-[52vh] overflow-y-auto py-1">
                {items.length === 0 && (
                  <p className="px-4 py-6 text-center text-xs text-slate-600">
                    {dq.length === 1 ? 'Введите ещё символ…' : 'Ничего не найдено'}
                  </p>
                )}
                {items.map((it, i) => (
                  <div
                    key={it.key}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(it)}
                    className={cx('flex cursor-pointer items-center gap-3 px-4 py-2', i === cursor ? 'bg-blue-500/15' : 'hover:bg-white/[0.04]')}
                  >
                    <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border', it.kind === 'user' ? 'border-blue-500/25 bg-blue-500/10 text-blue-300' : 'border-white/[0.08] bg-white/[0.04] text-slate-400')}>
                      {it.kind === 'user' ? (it.key.startsWith('recent:') ? <Clock size={13} /> : <User size={13} />) : <CornerDownLeft size={13} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-slate-100">{it.label}</span>
                      <span className="block truncate text-[10px] text-slate-500">{it.hint}</span>
                    </span>
                    {it.kind === 'user' && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); go(it, 'survey') }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.1] px-2 py-1 text-[10px] text-slate-300 hover:border-blue-500/40 hover:text-blue-200"
                      >
                        <ClipboardList size={11} /> Анкета
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.07] px-4 py-2 text-[10px] text-slate-600">
                <span>↑↓ — выбор</span>
                <span>Enter — открыть</span>
                <span>Shift+Enter — анкета</span>
                <span>Esc — закрыть</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
