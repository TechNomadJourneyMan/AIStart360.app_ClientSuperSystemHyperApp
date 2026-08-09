'use client'

import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import type {
  PointAPeriod,
  TopTableResponse,
  TopTableRow,
} from '@/types/point-a-dashboard'

const h = React.createElement

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatValue(value: number | null, unit: TopTableRow['unit']): string {
  if (value === null || Number.isNaN(value)) return '—'
  if (unit === '₸') {
    if (Math.abs(value) >= 1_000_000)
      return `${(value / 1_000_000).toFixed(1)} млн ₸`
    if (Math.abs(value) >= 1_000)
      return `${(value / 1_000).toFixed(0)} тыс ₸`
    return `${value.toLocaleString('ru-RU')} ₸`
  }
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)} тыс`
  return value.toLocaleString('ru-RU')
}

function formatPct(value: number | null): string {
  if (value === null) return '—'
  return `${value}%`
}

function pctColor(value: number | null): string {
  if (value === null) return 'text-on-surface-variant'
  if (value >= 100) return 'text-primary'
  if (value >= 70) return 'text-amber-400'
  if (value >= 40) return 'text-orange-400'
  return 'text-error'
}

// ─── Presentational View (testable) ────────────────────────────────────────

export interface TopSalesTableViewProps {
  rows: TopTableRow[]
  isLoading?: boolean
  isError?: boolean
  isEmpty?: boolean
}

export function TopSalesTableView(props: TopSalesTableViewProps) {
  const { rows, isLoading, isError, isEmpty } = props

  if (isLoading) {
    return h(
      'div',
      {
        'data-testid': 'top-sales-skeleton',
        className:
          'rounded-2xl border border-white/[0.04] bg-surface-container-low overflow-hidden',
      },
      h(
        'div',
        {
          className: 'grid grid-cols-7 gap-px bg-white/[0.04] text-xs',
        },
        ...Array.from({ length: 7 * 9 }).map((_, i) =>
          h('div', {
            key: i,
            className: 'bg-surface-container-low h-10 animate-pulse',
          }),
        ),
      ),
    )
  }

  if (isError) {
    return h(
      'div',
      {
        'data-testid': 'top-sales-error',
        className:
          'rounded-2xl border border-error/20 bg-error/5 p-5 text-sm text-on-surface-variant',
      },
      h(
        'div',
        { className: 'flex items-center gap-2' },
        h(
          'span',
          {
            className: 'material-symbols-outlined text-base text-error',
            'aria-hidden': 'true',
          },
          'error',
        ),
        'Не удалось загрузить таблицу продаж. Попробуйте обновить страницу.',
      ),
    )
  }

  if (isEmpty || rows.length === 0) {
    return h(
      'div',
      {
        'data-testid': 'top-sales-empty',
        className:
          'rounded-2xl border border-dashed border-white/10 bg-surface-container-low p-8 text-center',
      },
      h(
        'span',
        {
          className:
            'material-symbols-outlined text-3xl text-on-surface-variant/40 mb-3 block',
          'aria-hidden': 'true',
        },
        'table_view',
      ),
      h(
        'p',
        { className: 'text-sm font-medium text-on-surface' },
        'Нет данных по продажам',
      ),
      h(
        'p',
        { className: 'text-xs text-on-surface-variant mt-1 mb-4' },
        'Загрузите базу клиентов и отчёт по продажам, чтобы увидеть таблицу',
      ),
      h(
        'a',
        {
          href: '/client/onboarding',
          className:
            'inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary/10 text-primary text-xs font-mono hover:bg-primary/20 transition-colors',
        },
        h(
          'span',
          {
            className: 'material-symbols-outlined text-sm',
            'aria-hidden': 'true',
          },
          'upload_file',
        ),
        'Загрузить базу клиентов',
      ),
    )
  }

  // Desktop table
  const headerCells = [
    'Показатель',
    'План год',
    'Факт год',
    'План мес',
    'Факт мес',
    '% год',
    '% 3 года',
  ]
  const desktopHeader = h(
    'thead',
    {
      className: 'sticky top-0 bg-surface-container-high backdrop-blur z-10',
    },
    h(
      'tr',
      {
        className:
          'text-[10px] font-mono uppercase tracking-widest text-on-surface-variant',
      },
      ...headerCells.map((label, i) =>
        h(
          'th',
          {
            key: label,
            scope: 'col',
            className:
              i === 0
                ? 'text-left px-4 py-3 border-b border-white/[0.04] sticky left-0 bg-surface-container-high'
                : 'text-right px-3 py-3 border-b border-white/[0.04]',
          },
          label,
        ),
      ),
    ),
  )

  const desktopBody = h(
    'tbody',
    null,
    ...rows.map((row, i) =>
      h(
        motion.tr,
        {
          key: row.key,
          initial: { opacity: 0, y: 4 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.25, delay: i * 0.03 },
          className:
            'border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors',
        },
        h(
          'th',
          {
            scope: 'row',
            className:
              'text-left px-4 py-3 text-xs font-medium text-on-surface sticky left-0 bg-surface-container-low',
          },
          row.label_ru,
        ),
        h(
          'td',
          {
            className:
              'text-right px-3 py-3 font-mono text-xs text-on-surface-variant',
          },
          formatValue(row.plan_year, row.unit),
        ),
        h(
          'td',
          {
            className: 'text-right px-3 py-3 font-mono text-xs text-on-surface',
          },
          formatValue(row.fact_year, row.unit),
        ),
        h(
          'td',
          {
            className:
              'text-right px-3 py-3 font-mono text-xs text-on-surface-variant',
          },
          formatValue(row.plan_month, row.unit),
        ),
        h(
          'td',
          {
            className: 'text-right px-3 py-3 font-mono text-xs text-on-surface',
          },
          formatValue(row.fact_month, row.unit),
        ),
        h(
          'td',
          {
            className: `text-right px-3 py-3 font-mono text-xs font-bold ${pctColor(row.pct_year)}`,
          },
          formatPct(row.pct_year),
        ),
        h(
          'td',
          {
            className: `text-right px-3 py-3 font-mono text-xs ${pctColor(row.pct_3y)}`,
          },
          formatPct(row.pct_3y),
        ),
      ),
    ),
  )

  const desktop = h(
    'div',
    {
      className:
        'hidden md:block rounded-2xl border border-white/[0.04] bg-surface-container-low overflow-hidden',
    },
    h(
      'div',
      { className: 'overflow-x-auto' },
      h('table', { className: 'min-w-full text-sm' }, desktopHeader, desktopBody),
    ),
  )

  // Mobile cards
  const mobile = h(
    'div',
    { className: 'md:hidden space-y-2' },
    ...rows.map((row) =>
      h(
        'div',
        {
          key: row.key,
          className:
            'bg-surface-container-low rounded-2xl border border-white/[0.04] p-4',
        },
        h(
          'div',
          { className: 'flex items-center justify-between mb-3' },
          h(
            'p',
            { className: 'text-sm font-medium text-on-surface' },
            row.label_ru,
          ),
          h(
            'span',
            {
              className: `text-xs font-mono font-bold ${pctColor(row.pct_year)}`,
            },
            formatPct(row.pct_year),
          ),
        ),
        h(
          'dl',
          { className: 'grid grid-cols-2 gap-2 text-xs' },
          h(
            'div',
            null,
            h(
              'dt',
              {
                className:
                  'text-[10px] font-mono text-on-surface-variant uppercase tracking-widest',
              },
              'План год',
            ),
            h(
              'dd',
              { className: 'font-mono text-on-surface mt-0.5' },
              formatValue(row.plan_year, row.unit),
            ),
          ),
          h(
            'div',
            null,
            h(
              'dt',
              {
                className:
                  'text-[10px] font-mono text-on-surface-variant uppercase tracking-widest',
              },
              'Факт год',
            ),
            h(
              'dd',
              { className: 'font-mono text-on-surface mt-0.5' },
              formatValue(row.fact_year, row.unit),
            ),
          ),
          h(
            'div',
            null,
            h(
              'dt',
              {
                className:
                  'text-[10px] font-mono text-on-surface-variant uppercase tracking-widest',
              },
              'План мес',
            ),
            h(
              'dd',
              { className: 'font-mono text-on-surface mt-0.5' },
              formatValue(row.plan_month, row.unit),
            ),
          ),
          h(
            'div',
            null,
            h(
              'dt',
              {
                className:
                  'text-[10px] font-mono text-on-surface-variant uppercase tracking-widest',
              },
              'Факт мес',
            ),
            h(
              'dd',
              { className: 'font-mono text-on-surface mt-0.5' },
              formatValue(row.fact_month, row.unit),
            ),
          ),
        ),
      ),
    ),
  )

  return h(React.Fragment, null, desktop, mobile)
}

// ─── Container (handles URL state + fetch) ────────────────────────────────

export interface TopSalesTableProps {
  initialData?: TopTableRow[]
  onFilterOptions?: (opts: { products: string[]; managers: string[] }) => void
}

export function TopSalesTable(props: TopSalesTableProps) {
  const { initialData, onFilterOptions } = props
  const params = useSearchParams()
  const period = (params.get('period') ?? 'month') as PointAPeriod
  const product = params.get('product') ?? ''
  const manager = params.get('manager') ?? ''

  const [rows, setRows] = useState<TopTableRow[]>(initialData ?? [])
  const [isLoading, setIsLoading] = useState<boolean>(!initialData)
  const [isError, setIsError] = useState<boolean>(false)

  const qs = useMemo(() => {
    const q = new URLSearchParams()
    q.set('period', period)
    if (product) q.set('product', product)
    if (manager) q.set('manager', manager)
    return q.toString()
  }, [period, product, manager])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setIsError(false)
    fetch(`/api/v1/point-a/top-table?${qs}`, { cache: 'no-store' })
      .then((r) => r.json() as Promise<TopTableResponse>)
      .then((res) => {
        if (cancelled) return
        if (res.ok) {
          setRows(res.data.rows)
          if (onFilterOptions) {
            onFilterOptions({
              products: res.data.available_products,
              managers: res.data.available_managers,
            })
          }
        } else {
          setIsError(true)
        }
      })
      .catch(() => {
        if (!cancelled) setIsError(true)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [qs, onFilterOptions])

  return h(TopSalesTableView, {
    rows,
    isLoading,
    isError,
  })
}

export default TopSalesTable
