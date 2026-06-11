'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Search, ExternalLink, Radar, Building2, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { COMPETITOR_CATEGORIES, formatKZT } from './mock-data'
import {
  getCompetitors,
  statusLineFor,
  type MarketApiError,
  type MarketCompetitor,
} from '@/lib/market-api'

/** Format a money value honestly with its own currency (USD passthrough, else KZT). */
function formatMoney(value: number, currency: string): string {
  if (currency === 'KZT') return formatKZT(value)
  if (currency === 'USD') {
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
    return `$${value.toLocaleString()}`
  }
  return `${value.toLocaleString()} ${currency}`
}

/**
 * Competitor Directory view — searchable + filterable card grid.
 *
 * Reads the company directory (GET /companies) via the Mark-analytics proxy
 * (lib/market-api.ts). When the backend is unconfigured/unavailable it keeps the
 * honest empty state with a subtle status line. The Sync button refetches.
 */
export function Competitors() {
  const [competitors, setCompetitors] = useState<MarketCompetitor[]>([])
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<(typeof COMPETITOR_CATEGORIES)[number]>('All')
  const [syncing, setSyncing] = useState(false)
  const [statusLine, setStatusLine] = useState<string | null>(null)

  const load = useCallback(async (query?: string) => {
    setSyncing(true)
    try {
      // No region filter: upstream `region` expects a KZ oblast (KATO), not a
      // country — passing "Kazakhstan" silently matches nothing.
      const res = await getCompetitors({ query })
      if (res.ok) {
        setCompetitors(res.data)
        setStatusLine(null)
      } else {
        setCompetitors([])
        setStatusLine(statusLineFor(res.error as MarketApiError))
      }
    } finally {
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleSync = () => load(search || undefined)

  const toggleTracked = (id: string) => {
    setCompetitors((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isTracked: !c.isTracked } : c)),
    )
  }

  const filtered = competitors.filter((c) => {
    const lowerSearch = search.toLowerCase()
    const matchesSearch =
      !search ||
      c.name.toLowerCase().includes(lowerSearch) ||
      c.tags?.some((t) => t.toLowerCase().includes(lowerSearch))
    const matchesCategory = activeCategory === 'All' || c.category === activeCategory
    return matchesSearch && matchesCategory
  })

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div className="flex flex-col gap-2">
          <h2 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface">
            Competitor Directory
          </h2>
          <p className="text-on-surface-variant text-sm">
            Registry of market participants and financial profiles
          </p>
        </div>
        <Button variant="outline" onClick={handleSync} disabled={syncing} className="shrink-0">
          {syncing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Sync Directory
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-on-surface-variant/60 pointer-events-none z-10" />
          <Input
            placeholder="Search companies, tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {COMPETITOR_CATEGORIES.map((cat) => {
            const active = activeCategory === cat
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-mono uppercase tracking-wider transition-colors ${
                  active
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline-variant/60'
                }`}
              >
                {cat}
              </button>
            )
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center p-12 border border-dashed border-white/10 rounded-2xl bg-surface-container-low/50">
          <Building2 className="h-12 w-12 text-on-surface-variant/40 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-on-surface mb-2">Конкуренты не добавлены</h3>
          <p className="text-on-surface-variant mb-4">
            Добавьте конкурентов в анкете (блок «Продукт») — они появятся здесь.
          </p>
          {statusLine && (
            <p className="text-xs text-on-surface-variant/60">{statusLine}</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((comp) => (
            <CompetitorCard key={comp.id} comp={comp} onToggleTracked={toggleTracked} />
          ))}
        </div>
      )}
    </div>
  )
}

interface CompetitorCardProps {
  comp: MarketCompetitor
  onToggleTracked: (id: string) => void
}

function CompetitorCard({ comp, onToggleTracked }: CompetitorCardProps) {
  const b2g = comp.b2gDependency || 0
  const b2gHigh = b2g > 50
  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 transition-colors flex flex-col p-5">
      <div className="pb-4">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center border border-white/[0.05]">
              <Building2 className="h-5 w-5 text-on-surface-variant" />
            </div>
            <div>
              <div className="text-base font-medium text-on-surface flex items-center gap-2">
                {comp.name}
                {comp.url && (
                  <a
                    href={comp.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-on-surface-variant/60 hover:text-primary transition-colors"
                    aria-label={`Open ${comp.name} website`}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <p className="text-xs text-on-surface-variant/70 font-mono mt-1">
                BIN: {comp.bin_iin}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 mt-3">
          <Badge variant="secondary">{comp.category}</Badge>
          {comp.tags?.map((tag) => (
            <Badge key={tag} variant="default">
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-between gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] text-on-surface-variant/70 mb-1 uppercase tracking-wider font-mono">
              Est. Revenue
            </p>
            <p className="text-sm font-medium text-on-surface tabular-nums">
              {formatMoney(comp.estRevenue || 0, comp.currency)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-on-surface-variant/70 mb-1 uppercase tracking-wider font-mono">
              Taxes Paid
            </p>
            <p className="text-sm font-medium text-on-surface tabular-nums">
              {formatMoney(comp.taxesPaid || 0, comp.currency)}
            </p>
          </div>
        </div>

        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-on-surface-variant/70">B2G Dependency</span>
            <span className={b2gHigh ? 'text-error' : 'text-primary'}>{b2g}%</span>
          </div>
          <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                b2gHigh ? 'bg-error' : 'bg-primary'
              }`}
              style={{ width: `${Math.min(b2g, 100)}%` }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => onToggleTracked(comp.id)}
          className={`w-full inline-flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-colors border ${
            comp.isTracked
              ? 'border-primary/30 text-primary bg-primary/5 hover:bg-primary/10'
              : 'border-white/[0.06] text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
          }`}
        >
          <Radar className="h-4 w-4" />
          {comp.isTracked ? 'Tracking Active' : 'Start Monitoring'}
        </button>
      </div>
    </div>
  )
}
