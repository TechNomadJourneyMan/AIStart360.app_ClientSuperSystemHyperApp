'use client'

// Client performance table: sortable, row → client card, and a CSV export that
// really writes a file (same recipe as components/activity/ActivityLogClient).

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { AnalyticsData } from '@/lib/analytics-data'
import {
  PERFORMANCE_STATUS_LABELS,
  formatAmount,
  formatScore,
  formatSignedPercent,
} from './format'

type Row = AnalyticsData['clientPerformance'][number]
type SortKey = 'name' | 'industry' | 'gri' | 'gmv' | 'growth' | 'status'
type SortDirection = 'asc' | 'desc'

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: 'name', label: 'Клиент' },
  { key: 'industry', label: 'Отрасль' },
  { key: 'gri', label: 'GRI (0–1000)', numeric: true },
  { key: 'gmv', label: 'Средний чек', numeric: true },
  { key: 'growth', label: 'Изменение GRI', numeric: true },
  { key: 'status', label: 'Статус' },
]

function compare(a: Row, b: Row, key: SortKey): number {
  const left = a[key]
  const right = b[key]
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), 'ru')
}

export function ClientPerformanceTable({
  rows,
  griReportCounts,
}: {
  rows: Row[]
  /** Reports per client id — see `getGriReportCounts` in ./analytics-detail. */
  griReportCounts: Record<string, number>
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'gri',
    direction: 'desc',
  })

  // `gri`, `growth` and `status` are only real once a report exists: an
  // unmeasured client arrives here as 0 / +0,0% / Critical.
  const reportsOf = (row: Row) => griReportCounts[row.id] ?? 0

  const sorted = useMemo(() => {
    const copy = rows.slice()
    copy.sort((a, b) => (sort.direction === 'asc' ? compare(a, b, sort.key) : compare(b, a, sort.key)))
    return copy
  }, [rows, sort])

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'name' || key === 'industry' || key === 'status' ? 'asc' : 'desc' },
    )
  }

  const exportCsv = () => {
    if (!sorted.length) return
    const head = [
      'Клиент',
      'Отрасль',
      'GRI (0–1000)',
      'Средний чек (валюта в базе не задана)',
      'Изменение GRI к прошлому отчёту, %',
      'Статус',
    ]
    const esc = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
    // Numbers go out raw, not formatted: ru-RU grouping uses NBSP and would land
    // in a spreadsheet as text.
    const body = sorted.map((row) => {
      const reports = reportsOf(row)
      return [
        row.name,
        row.industry,
        reports === 0 ? 'нет GRI-отчёта' : row.gri,
        row.gmv > 0 ? Math.round(row.gmv) : 'не заполнен',
        reports >= 2 ? row.growth : 'нет второго отчёта',
        reports === 0 ? 'нет GRI-отчёта' : (PERFORMANCE_STATUS_LABELS[row.status] ?? row.status),
      ]
        .map(esc)
        .join(',')
    })
    const csv = [head.join(','), ...body].join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `clients-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bg-surface-container rounded-xl overflow-hidden">
      <div className="px-6 py-5 border-b border-outline-variant/10 flex flex-wrap justify-between items-center gap-3">
        <div>
          <h3 className="font-headline text-lg font-bold text-on-surface">Клиенты</h3>
          <p className="text-xs text-on-surface-variant mt-1">
            Топ-10 по GRI, срез на сейчас.{' '}
            <Link
              href="/clients"
              className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
            >
              Все клиенты
            </Link>
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!sorted.length}
          aria-label="Скачать таблицу клиентов в формате CSV"
          className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-on-surface border border-outline-variant/30 px-3 py-2 rounded-lg hover:bg-surface-container-high transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            download
          </span>
          Экспорт CSV
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">
            Клиенты портфеля: GRI, средний чек, изменение GRI и статус. Заголовки колонок сортируют таблицу.
          </caption>
          <thead>
            <tr className="bg-surface-container-high">
              {COLUMNS.map((column) => {
                const isActive = sort.key === column.key
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className="px-5 py-3 text-left text-[10px] font-mono uppercase tracking-widest text-on-surface-variant whitespace-nowrap"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      aria-label={`Сортировать по колонке «${column.label}»`}
                      className={`inline-flex items-center gap-1 uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded ${
                        isActive ? 'text-on-surface' : 'hover:text-on-surface'
                      }`}
                    >
                      {column.label}
                      <span className="material-symbols-outlined text-sm" aria-hidden="true">
                        {isActive ? (sort.direction === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
                      </span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-5 py-10 text-center">
                  <p className="text-sm text-on-surface-variant">
                    В базе нет ни одного клиента, поэтому таблицу строить не из чего.
                  </p>
                  <Link
                    href="/clients"
                    className="mt-4 inline-flex items-center gap-1.5 text-xs font-mono text-primary border border-primary/25 rounded-lg px-3 py-2 hover:bg-primary/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <span className="material-symbols-outlined text-sm" aria-hidden="true">
                      group_add
                    </span>
                    Перейти к клиентам
                  </Link>
                </td>
              </tr>
            ) : (
              sorted.map((row) => {
                const reports = reportsOf(row)
                const measured = reports > 0
                const comparable = reports >= 2

                return (
                  <tr key={row.id} className="border-b border-outline-variant/10 table-row-hover">
                    <td className="px-5 py-3.5 text-sm font-medium">
                      <Link
                        href={`/clients/${row.id}`}
                        aria-label={`Открыть карточку клиента ${row.name}`}
                        className="text-on-surface hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-on-surface-variant">{row.industry}</td>
                    <td className="px-5 py-3.5">
                      {measured ? (
                        <span
                          className={`font-mono text-sm font-bold ${
                            row.gri >= 800
                              ? 'text-primary'
                              : row.gri >= 700
                                ? 'text-primary-fixed-dim'
                                : row.gri >= 600
                                  ? 'text-tertiary-container'
                                  : 'text-error'
                          }`}
                        >
                          {formatScore(row.gri)}
                        </span>
                      ) : (
                        <Link
                          href="/gri"
                          aria-label={`У клиента ${row.name} нет GRI-отчёта — перейти к диагностике`}
                          className="text-sm text-on-surface-variant hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
                        >
                          нет отчёта
                        </Link>
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-sm text-on-surface">
                      {row.gmv > 0 ? (
                        formatAmount(row.gmv)
                      ) : (
                        <span className="text-on-surface-variant">не заполнен</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-sm">
                      {comparable ? (
                        <span className={row.growth >= 0 ? 'text-primary' : 'text-error'}>
                          {formatSignedPercent(row.growth)}
                        </span>
                      ) : (
                        <span
                          className="text-on-surface-variant"
                          title={
                            measured
                              ? 'У клиента один GRI-отчёт — сравнивать не с чем'
                              : 'У клиента нет ни одного GRI-отчёта'
                          }
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`text-[10px] font-mono px-2.5 py-1 rounded-full border ${
                          !measured
                            ? 'text-on-surface-variant bg-surface-container-high border-outline-variant/30'
                            : row.status === 'Strong' || row.status === 'Active'
                              ? 'text-primary bg-primary/10 border-primary/20'
                              : row.status === 'Developing'
                                ? 'text-tertiary-container bg-tertiary-container/10 border-tertiary-container/20'
                                : 'text-error bg-error/10 border-error/20'
                        }`}
                      >
                        {measured ? (PERFORMANCE_STATUS_LABELS[row.status] ?? row.status) : 'нет данных'}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="px-6 py-4 text-xs text-on-surface-variant border-t border-outline-variant/10">
        «Изменение GRI» — разница между двумя последними GRI-отчётами клиента, а не рост выручки; при одном отчёте
        сравнивать не с чем и стоит «—». «нет отчёта» означает, что диагностику по клиенту ещё не проводили — это не
        нулевой балл. «Средний чек» — поле <code className="font-mono">pulse_metrics.avg_check</code>; валюта в базе не
        хранится, поэтому знак валюты не выводится.
      </p>
    </div>
  )
}
