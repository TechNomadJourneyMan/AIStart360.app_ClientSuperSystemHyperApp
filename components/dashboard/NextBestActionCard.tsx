'use client'

/**
 * components/dashboard/NextBestActionCard.tsx — «1 действие сейчас» (Фаза 5, №2).
 * Тянет /api/v1/next-best-action и показывает одно приоритетное действие с
 * рабочей кнопкой. Тихо исчезает, если данных нет.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { NextBestAction } from '@/lib/dashboard/next-best-action'

export function NextBestActionCard() {
  const [action, setAction] = useState<NextBestAction | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch('/api/v1/next-best-action', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => {
        if (alive && j?.ok) setAction(j.action)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  if (loading) return <div className="h-24 rounded-2xl bg-white/[0.03] animate-pulse" />
  if (!action) return null

  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/[0.08] to-transparent p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-mono uppercase tracking-widest text-primary/80 mb-1">
          Следующее действие
        </p>
        <p className="text-base font-bold text-on-surface">{action.title}</p>
        <p className="text-sm text-on-surface-variant mt-0.5">{action.detail}</p>
      </div>
      <Link
        href={action.href}
        className="shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:bg-primary/90 transition-colors"
      >
        {action.ctaLabel}
        <span className="material-symbols-outlined text-base">arrow_forward</span>
      </Link>
    </div>
  )
}
