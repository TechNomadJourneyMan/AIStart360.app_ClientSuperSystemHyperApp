'use client'

// ============================================================
// KPI tiles that open a provenance panel.
//
// Why not `components/dashboard/useMetricDrillDown`: that modal explains
// metrics from `lib/metrics/registry.ts` — a single company's biz/kpi/gri/goal
// catalogue — and fetches /api/v1/metrics/:id/{value,timeseries}. The four
// numbers on this screen are portfolio-wide aggregates over the `clients` /
// `gri_reports` tables; none of them has a registry id, so the shared modal
// would render an empty chart under a real-looking header. Instead every tile
// carries the facts the server already computed in `analytics-detail.ts`.
// ============================================================

import Link from 'next/link'
import { useId, useState } from 'react'

export type KpiFact = {
  label: string
  value: string
  /** Optional link — used for "which clients are missing data" rows. */
  href?: string
}

export type KpiLink = { label: string; href: string }

export type KpiTile = {
  id: string
  label: string
  value: string
  /** Short scope note under the value: «за 30 дней» / «срез на сейчас». */
  scope: string
  /** Real period-over-period delta. Absent when there is nothing to compare. */
  delta?: { percent: number; text: string } | null
  /** One-line honest definition shown at the top of the panel. */
  definition: string
  /** Table of provenance rows. */
  facts: KpiFact[]
  /** Shown instead of facts when the number could not be computed. */
  missing?: string
  links: KpiLink[]
}

function formatDelta(percent: number): string {
  const sign = percent > 0 ? '+' : ''
  return `${sign}${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(percent)}%`
}

export function AnalyticsKpiGrid({ tiles }: { tiles: KpiTile[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const panelId = useId()
  const open = tiles.find((tile) => tile.id === openId) ?? null

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map((tile) => {
          const isOpen = tile.id === openId
          return (
            <button
              key={tile.id}
              type="button"
              onClick={() => setOpenId(isOpen ? null : tile.id)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              aria-label={`${tile.label}: ${tile.value}. Показать, из чего считается`}
              className={`text-left bg-surface-container-low p-5 rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                isOpen
                  ? 'border-primary/40 bg-surface-container'
                  : 'border-transparent hover:bg-surface-container'
              }`}
            >
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">
                {tile.label}
              </p>
              <p className="text-3xl font-mono font-bold text-on-surface">{tile.value}</p>
              <p className="text-xs font-mono text-on-surface-variant mt-2">{tile.scope}</p>
              {tile.delta ? (
                <p
                  className={`text-xs font-mono mt-1 flex items-center gap-1 ${
                    tile.delta.percent >= 0 ? 'text-primary' : 'text-error'
                  }`}
                >
                  <span className="material-symbols-outlined text-sm" aria-hidden="true">
                    {tile.delta.percent >= 0 ? 'trending_up' : 'trending_down'}
                  </span>
                  <span>
                    {formatDelta(tile.delta.percent)} {tile.delta.text}
                  </span>
                </p>
              ) : null}
              <p className="text-[10px] font-mono text-primary/80 mt-3 flex items-center gap-1">
                <span className="material-symbols-outlined text-xs" aria-hidden="true">
                  {isOpen ? 'expand_less' : 'expand_more'}
                </span>
                {isOpen ? 'Свернуть разбор' : 'Из чего считается'}
              </p>
            </button>
          )
        })}
      </div>

      <div id={panelId} role="region" aria-label="Разбор показателя">
        {open ? (
          <div className="bg-surface-container rounded-xl p-6 border border-outline-variant/20">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="font-headline text-lg font-bold text-on-surface">{open.label}</h3>
                <p className="text-sm text-on-surface-variant mt-1 max-w-2xl">{open.definition}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                aria-label="Закрыть разбор показателя"
                className="flex-shrink-0 w-8 h-8 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <span className="material-symbols-outlined text-lg" aria-hidden="true">
                  close
                </span>
              </button>
            </div>

            {open.missing ? (
              <p className="text-sm text-on-surface-variant bg-surface-container-high rounded-lg px-4 py-3">
                {open.missing}
              </p>
            ) : (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                {open.facts.map((fact, index) => (
                  <div
                    key={`${fact.label}-${index}`}
                    className="flex items-baseline justify-between gap-4 border-b border-outline-variant/10 py-1.5"
                  >
                    <dt className="text-on-surface-variant">{fact.label}</dt>
                    <dd className="font-mono text-on-surface text-right">
                      {fact.href ? (
                        <Link
                          href={fact.href}
                          className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
                        >
                          {fact.value}
                        </Link>
                      ) : (
                        fact.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {open.links.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-5">
                {open.links.map((link) => (
                  <Link
                    key={link.href + link.label}
                    href={link.href}
                    className="inline-flex items-center gap-1.5 text-xs font-mono text-primary border border-primary/25 rounded-lg px-3 py-2 hover:bg-primary/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <span className="material-symbols-outlined text-sm" aria-hidden="true">
                      arrow_forward
                    </span>
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
