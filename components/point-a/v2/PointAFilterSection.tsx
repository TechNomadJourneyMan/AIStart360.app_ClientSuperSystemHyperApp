'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PointAFilterBar } from '@/components/dashboard/PointAFilterBar'

interface FilterOption {
  id: string
  name: string
}

const PERIOD_LABEL: Record<string, string> = {
  day: 'День',
  week: 'Неделя',
  month: 'Месяц',
  quarter: 'Квартал',
  year: 'Год',
}

/**
 * PointAFilterSection — standalone wrapper that owns the title row and
 * sources product / manager options from `/api/v1/point-a/filters`.
 *
 * The actual control state lives in the URL (`useSearchParams`), so every
 * widget on the page that reads those params will reflect changes — no
 * prop-drilling, no shared store.
 */
export default function PointAFilterSection() {
  const params = useSearchParams()
  const [products, setProducts] = useState<FilterOption[]>([])
  const [managers, setManagers] = useState<FilterOption[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/point-a/filters', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.ok) return
        const ps = (j.data?.products ?? []) as FilterOption[]
        const ms = (j.data?.managers ?? []) as FilterOption[]
        setProducts(ps)
        setManagers(ms)
      })
      .catch(() => {
        /* silent — empty arrays are a fine fallback */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const period = params.get('period') ?? 'month'
  const product = params.get('product') ?? ''
  const manager = params.get('manager') ?? ''
  const productName = products.find((item) => item.id === product)?.name
  const managerName = managers.find((item) => item.id === manager)?.name
  const activeChips = [
    PERIOD_LABEL[period] ?? 'Месяц',
    product && `Продукт: ${productName ?? product}`,
    manager && `Менеджер: ${managerName ?? manager}`,
  ].filter(Boolean) as string[]

  return (
    <section
      id="point-a-filters"
      aria-label="Фильтры и срезы дашборда"
      className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-4"
    >
      <div className="flex items-end justify-between gap-4 mb-3 flex-wrap">
        <div>
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
            Фильтры
          </p>
          <h2 className="font-headline text-lg font-bold text-on-surface mt-1">
            Период и срезы · отчёт обновится ниже
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map((chip) => (
            <span
              key={chip}
              className="text-[10px] font-mono uppercase tracking-widest rounded-full px-2 py-1 border border-primary/30 bg-primary/10 text-primary"
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
      <PointAFilterBar products={products} managers={managers} />
    </section>
  )
}
