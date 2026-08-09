'use client'

import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { PointAPeriod } from '@/types/point-a-dashboard'

const PERIODS: readonly { value: PointAPeriod; label: string }[] = [
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'quarter', label: 'Квартал' },
  { value: 'year', label: 'Год' },
] as const

export interface PointAFilterBarProps {
  products?: Array<{ id: string; name: string }>
  managers?: Array<{ id: string; name: string }>
  /** Optional className for wrapping section. */
  className?: string
}

/**
 * PointAFilterBar — URL-driven filter strip for the new top-of-cabinet widgets.
 * Drives ?period=month&product=...&manager=... — every widget on the page
 * reads from useSearchParams() and refetches when these change.
 *
 * Visual language matches NamespaceTabs.tsx (teal active chip on dark pill).
 */
export function PointAFilterBar({
  products,
  managers,
  className,
}: PointAFilterBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const period = useMemo<PointAPeriod>(() => {
    const raw = params.get('period') ?? 'month'
    return (
      (PERIODS.find((p) => p.value === raw)?.value as PointAPeriod | undefined) ??
      'month'
    )
  }, [params])

  const product = params.get('product') ?? ''
  const manager = params.get('manager') ?? ''

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString())
      if (value && value !== '') next.set(key, value)
      else next.delete(key)
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [params, pathname, router],
  )

  const reset = () => {
    router.replace(pathname, { scroll: false })
  }

  const hasAnyFilter =
    params.get('period') ||
    params.get('product') ||
    params.get('manager')

  return (
    <div
      className={`flex flex-wrap items-center gap-3 ${className ?? ''}`}
      role="region"
      aria-label="Фильтры дашборда"
    >
      {/* Period chips */}
      <div className="inline-flex gap-1 bg-surface-container-low p-1 rounded-xl border border-white/[0.04]">
        {PERIODS.map((p) => {
          const active = p.value === period
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => updateParam('period', p.value)}
              className={
                active
                  ? 'px-3 py-1.5 rounded-lg text-xs font-mono uppercase tracking-wide transition-colors bg-primary/15 text-primary border border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/40'
                  : 'px-3 py-1.5 rounded-lg text-xs font-mono uppercase tracking-wide transition-colors text-on-surface-variant hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40'
              }
              aria-pressed={active}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {/* Product select */}
      <label className="inline-flex items-center gap-2 bg-surface-container-low border border-white/[0.04] rounded-xl px-3 py-2 hover:border-primary/30 transition-colors">
        <span
          className="material-symbols-outlined text-base text-on-surface-variant"
          aria-hidden="true"
        >
          inventory_2
        </span>
        <select
          value={product}
          onChange={(e) => updateParam('product', e.target.value || null)}
          className="bg-transparent text-xs font-mono text-on-surface outline-none pr-1"
          aria-label="Фильтр по продукту"
        >
          <option value="" className="bg-surface-container text-on-surface">
            Все продукты
          </option>
          {(products ?? []).map((p) => (
            <option
              key={p.id}
              value={p.id}
              className="bg-surface-container text-on-surface"
            >
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {/* Manager select */}
      <label className="inline-flex items-center gap-2 bg-surface-container-low border border-white/[0.04] rounded-xl px-3 py-2 hover:border-primary/30 transition-colors">
        <span
          className="material-symbols-outlined text-base text-on-surface-variant"
          aria-hidden="true"
        >
          badge
        </span>
        <select
          value={manager}
          onChange={(e) => updateParam('manager', e.target.value || null)}
          className="bg-transparent text-xs font-mono text-on-surface outline-none pr-1"
          aria-label="Фильтр по менеджеру"
        >
          <option value="" className="bg-surface-container text-on-surface">
            Все менеджеры
          </option>
          {(managers ?? []).map((m) => (
            <option
              key={m.id}
              value={m.id}
              className="bg-surface-container text-on-surface"
            >
              {m.name}
            </option>
          ))}
        </select>
      </label>

      {/* Reset */}
      <button
        type="button"
        onClick={reset}
        disabled={!hasAnyFilter}
        className="ml-auto text-xs font-mono text-on-surface-variant hover:text-primary disabled:opacity-40 disabled:hover:text-on-surface-variant border border-white/[0.08] rounded-lg px-3 py-1.5 transition-all flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <span className="material-symbols-outlined text-sm" aria-hidden="true">
          restart_alt
        </span>
        Сбросить
      </button>
    </div>
  )
}

export default PointAFilterBar
