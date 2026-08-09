'use client'

// Industry bars used to be decoration: a `transition-all` div that reacted to
// nothing and printed a "$" the database never stored. Each row is now a button
// that opens the arithmetic behind its own bar.

import Link from 'next/link'
import { useId, useState } from 'react'
import { formatAmount, formatAmountFull, formatNumber, formatPercent } from './format'

export type IndustryRow = {
  name: string
  /** Sum of `pulse_metrics.avg_check` across the industry's clients. */
  value: number
  /** Clients in the industry, including those without a filled avg check. */
  clients: number
}

const BAR_COLORS = ['bg-primary', 'bg-primary-fixed-dim', 'bg-secondary', 'bg-tertiary-container', 'bg-outline']

export function IndustryBreakdown({ rows, total }: { rows: IndustryRow[]; total: number }) {
  const [openName, setOpenName] = useState<string | null>(null)
  const panelId = useId()

  return (
    <div className="space-y-4">
      {rows.map((row, index) => {
        const share = total > 0 ? (row.value / total) * 100 : 0
        const isOpen = row.name === openName
        const color = BAR_COLORS[index] ?? 'bg-primary'

        return (
          <div key={row.name}>
            <button
              type="button"
              onClick={() => setOpenName(isOpen ? null : row.name)}
              aria-expanded={isOpen}
              aria-controls={`${panelId}-${index}`}
              aria-label={`${row.name}: ${formatAmount(row.value)}. Показать, из чего складывается`}
              className="w-full text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-lg px-1 -mx-1 py-1"
            >
              <div className="flex justify-between text-sm mb-1.5 gap-4">
                <span className="text-on-surface-variant group-hover:text-on-surface transition-colors truncate">
                  {row.name}
                </span>
                <span className="font-mono text-on-surface whitespace-nowrap">{formatAmount(row.value)}</span>
              </div>
              <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
                <div
                  className={`h-full ${color} rounded-full transition-all ${isOpen ? '' : 'opacity-80 group-hover:opacity-100'}`}
                  style={{ width: `${share}%` }}
                />
              </div>
            </button>

            {isOpen && (
              <dl
                id={`${panelId}-${index}`}
                className="mt-2 ml-1 text-xs bg-surface-container-high rounded-lg px-3 py-2 space-y-1"
              >
                <div className="flex justify-between gap-4">
                  <dt className="text-on-surface-variant">Доля от суммы по портфелю</dt>
                  <dd className="font-mono text-on-surface">{formatPercent(share)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-on-surface-variant">Точная сумма средних чеков</dt>
                  <dd className="font-mono text-on-surface">{formatAmountFull(row.value)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-on-surface-variant">Клиентов в отрасли</dt>
                  <dd className="font-mono text-on-surface">{formatNumber(row.clients)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-on-surface-variant">В среднем на клиента</dt>
                  <dd className="font-mono text-on-surface">
                    {row.clients > 0 ? formatAmountFull(row.value / row.clients) : '—'}
                  </dd>
                </div>
                <Link
                  href="/clients"
                  className="inline-flex items-center gap-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded pt-1"
                >
                  <span className="material-symbols-outlined text-sm" aria-hidden="true">
                    arrow_forward
                  </span>
                  Клиенты отрасли — в списке клиентов
                </Link>
              </dl>
            )}
          </div>
        )
      })}
    </div>
  )
}
