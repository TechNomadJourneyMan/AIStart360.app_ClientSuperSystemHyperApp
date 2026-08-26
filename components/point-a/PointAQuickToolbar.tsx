'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

/**
 * PointAQuickToolbar — sticky multifunction action bar at the top of Точка А.
 *
 * Quick actions (left → right, horizontally scrollable on mobile):
 *   • Отчёт магазина — opens the verified Store preview → publish flow. Monthly
 *                      Store data must never be sent through the annual Point A
 *                      document resolver: doing so destroys the month grain.
 *   • Заполнить анкету — link to onboarding wizard
 *   • Документы       — link to documents page
 *   • Точка Б         — link to target state
 *   • Метрики         — link to metrics catalog
 *   • Диагностику     — POST /api/v1/diagnostics/recalculate then router.refresh()
 *
 * Premium glassmorphism aesthetic — matches existing dashboard tokens.
 */
export default function PointAQuickToolbar({ userId }: { userId: string | null }) {
  const router = useRouter()
  const [recalcState, setRecalcState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')

  // ─── Recalculate ────────────────────────────────────────────────────────
  const recalculate = useCallback(async () => {
    setRecalcState('pending')
    try {
      const res = await fetch('/api/v1/diagnostics/recalculate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error('recalc failed')
      setRecalcState('success')
      router.refresh()
      setTimeout(() => setRecalcState('idle'), 2500)
    } catch {
      setRecalcState('error')
      setTimeout(() => setRecalcState('idle'), 3500)
    }
  }, [router])

  // ─── Render ─────────────────────────────────────────────────────────────
  const recalcLabel =
    recalcState === 'pending' ? 'Считаем…' :
    recalcState === 'success' ? 'Готово' :
    recalcState === 'error' ? 'Ошибка' :
    'Диагностику'

  return (
    <div className="sticky top-0 z-30 -mx-4 md:-mx-6 lg:-mx-8 px-4 md:px-6 lg:px-8 py-3 mb-2 bg-surface/80 backdrop-blur-xl border-b border-white/[0.04]">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1 scrollbar-thin scrollbar-thumb-white/10"
           role="toolbar" aria-label="Быстрые действия">

        {/* Monthly Store reports use their own period-aware, atomic importer. */}
        <Link
          href="/store/imports"
          aria-label="Загрузить отчёт магазина и обновить статистику"
          className="group flex-shrink-0 inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-gradient-to-r from-primary to-[#00e29e] px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wide text-[#003824] transition-all hover:shadow-[0_0_20px_rgba(110,255,192,0.35)]"
        >
          <span className="material-symbols-outlined text-base">upload_file</span>
          <span className="whitespace-nowrap">Отчёт магазина</span>
        </Link>

        {/* Divider */}
        <div className="flex-shrink-0 h-6 w-px bg-white/[0.08] mx-1" />

        {/* Quick links */}
        <ToolbarLink href="/client/onboarding" icon="edit_note" label="Анкета" />
        <ToolbarLink href="/client/onboarding/documents" icon="folder_open" label="P&L / документы" />
        <ToolbarLink href="/store" icon="monitoring" label="Статистика магазина" />
        <ToolbarLink href="/point-b" icon="flag" label="Точка Б" />
        <ToolbarLink href="/metrics" icon="bar_chart" label="Метрики" />

        {/* Divider */}
        <div className="flex-shrink-0 h-6 w-px bg-white/[0.08] mx-1" />

        {/* Recalculate */}
        <button
          type="button"
          onClick={recalculate}
          disabled={recalcState === 'pending'}
          aria-label={recalcLabel}
          className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl font-mono text-xs uppercase tracking-wide transition-all border ${
            recalcState === 'success'
              ? 'bg-primary/15 border-primary/40 text-primary'
              : recalcState === 'error'
              ? 'bg-error/10 border-error/30 text-error'
              : 'bg-surface-container-low border-white/[0.06] text-on-surface hover:border-primary/30 hover:text-primary disabled:opacity-60'
          }`}
        >
          <span className={`material-symbols-outlined text-base ${recalcState === 'pending' ? 'animate-spin' : ''}`}>
            {recalcState === 'pending' ? 'progress_activity' :
             recalcState === 'success' ? 'check_circle' :
             recalcState === 'error' ? 'error' : 'refresh'}
          </span>
          <span className="whitespace-nowrap hidden sm:inline">{recalcLabel}</span>
        </button>

        {/* Spacer pushes status hint to the right on desktop */}
        <div className="flex-1 hidden md:block" />

        <span className="hidden lg:inline text-[10px] font-mono text-on-surface-variant/60 whitespace-nowrap pr-1">
          {userId ? 'данные синхронизированы' : 'не авторизован'}
        </span>
      </div>
    </div>
  )
}

function ToolbarLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl font-mono text-xs uppercase tracking-wide border border-white/[0.06] bg-surface-container-low text-on-surface hover:text-primary hover:border-primary/30 transition-all"
    >
      <span className="material-symbols-outlined text-base">{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
    </Link>
  )
}
