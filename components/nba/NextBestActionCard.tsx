'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'

interface NbaAction {
  key: string
  actionKey: string
  title: string
  reason: string
  cta: { label: string; href: string }
  source: string
  score: number
}

type NbaEvent = 'done' | 'dismissed' | 'why_opened'

/**
 * NextBestActionCard — «Главное действие сейчас».
 *
 * Fetches the single Next Best Action from GET /api/v1/nba and renders it as a
 * prominent, teal-accented card. «Выполнено» optimistically hides the action and
 * refetches the next one; «Почему это важно?» reveals the reason (and logs the
 * why_opened event once); «Открыть» links to the action CTA. A null action shows
 * a calm empty state. Session is cookie-based (same-origin), so this works before
 * the surrounding page has resolved the user.
 */
export default function NextBestActionCard() {
  const [action, setAction] = useState<NbaAction | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reasonOpen, setReasonOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [whyLogged, setWhyLogged] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    setReasonOpen(false)
    setWhyLogged(false)
    try {
      const res = await fetch('/api/v1/nba', { credentials: 'same-origin' })
      if (!res.ok) throw new Error('nba failed')
      const data = await res.json()
      if (!data?.ok) throw new Error('nba not ok')
      setAction((data.action as NbaAction | null) ?? null)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const logEvent = useCallback(async (event: NbaEvent) => {
    if (!action) return
    try {
      await fetch('/api/v1/nba/event', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: action.actionKey, event }),
      })
    } catch {
      /* telemetry is best-effort — never block the UI */
    }
  }, [action])

  const handleDone = useCallback(async () => {
    if (!action || busy) return
    setBusy(true)
    await logEvent('done')
    setAction(null) // optimistic hide
    await load() // refetch the next best action
    setBusy(false)
  }, [action, busy, logEvent, load])

  const handleWhy = useCallback(() => {
    setReasonOpen((v) => {
      const next = !v
      if (next && !whyLogged) {
        setWhyLogged(true)
        void logEvent('why_opened')
      }
      return next
    })
  }, [whyLogged, logEvent])

  // ── Loading ────────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-5 md:p-6 shadow-card">
        <Skeleton variant="line" className="h-3 w-40 mb-4" />
        <Skeleton variant="line" className="h-6 w-2/3 mb-3" />
        <Skeleton variant="line" className="h-4 w-1/2" />
      </div>
    )
  }

  // ── Error (kept calm, never crashes the page) ────────────────────────────────
  if (status === 'error') {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-5 md:p-6 shadow-card flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-on-surface-variant">
          <span className="material-symbols-outlined text-lg">cloud_off</span>
          <p className="text-sm">Не удалось загрузить главное действие</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} leftIcon="refresh">
          Повторить
        </Button>
      </div>
    )
  }

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (!action) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-6 shadow-card flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-primary">task_alt</span>
        </div>
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1">
            Главное действие сейчас
          </p>
          <p className="text-sm font-medium text-on-surface">Всё под контролем 🐾</p>
          <p className="text-xs text-on-surface-variant mt-0.5">
            Срочных шагов нет — можно спокойно работать над ростом.
          </p>
        </div>
      </div>
    )
  }

  // ── Active action ────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        'relative overflow-hidden rounded-2xl border border-primary/25 shadow-card',
        'bg-surface-container-low p-5 md:p-6',
      )}
    >
      {/* soft teal glow accent */}
      <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative flex flex-col md:flex-row md:items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-primary">bolt</span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1.5">
            Главное действие сейчас
          </p>
          <h3 className="font-headline text-lg md:text-xl font-bold text-on-surface leading-snug">
            {action.title}
          </h3>

          <AnimatePresence initial={false}>
            {reasonOpen && (
              <motion.div
                key="reason"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <p className="text-sm text-on-surface-variant mt-3 pl-3 border-l-2 border-primary/30">
                  {action.reason}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-wrap items-center gap-2 mt-4">
            <Button variant="primary" size="sm" onClick={() => void handleDone()} loading={busy} leftIcon="check">
              Выполнено
            </Button>

            {action.cta?.href && (
              <Link
                href={action.cta.href}
                className="inline-flex items-center gap-2 font-semibold text-sm rounded-lg px-3 py-1.5 text-xs border border-primary/20 text-primary bg-transparent hover:bg-primary/5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <span className="material-symbols-outlined text-[1.1em]">open_in_new</span>
                {action.cta.label || 'Открыть'}
              </Link>
            )}

            <button
              type="button"
              onClick={handleWhy}
              aria-expanded={reasonOpen}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors rounded-lg px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <span className="material-symbols-outlined text-[1.1em]">
                {reasonOpen ? 'expand_less' : 'help'}
              </span>
              {reasonOpen ? 'Свернуть' : 'Почему это важно?'}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
