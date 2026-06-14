'use client'

/**
 * MarketDataPanel — компактная панель «Данные рынка» в шапке отдельных блоков
 * чек-листа. Тянет РЕАЛЬНЫЕ данные через authed-proxy /api/market/* (FastAPI
 * Mark-analytics). Никаких выдуманных чисел: при 503/ошибке — честное состояние
 * «Сервис рыночных данных недоступен», при пустом ответе — тихо скрывается.
 *
 *   Блок A (TAM/SAM/SOM) → analytics/overview: stat-strip + TAM/SAM/SOM плитки
 *                          из подтверждённых ответов A1–A3 (если есть).
 *   Блок B (Рост)        → analytics/industry-distribution: топ-отрасли по выручке.
 *   Блок E (Конкуренты)  → companies?limit=10: donut долей по выручке + топ-5.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

// ── Types for confirmed answers passed from the parent ───────────────────────

export interface ConfirmedAnswer {
  key: string
  text: string
}

type PanelState<T> =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'empty' }
  | { status: 'ready'; data: T }

// ── Proxy helpers ────────────────────────────────────────────────────────────

/**
 * Fetch a proxied market endpoint. Returns:
 *   - { ok: true, payload }   normal 2xx
 *   - { ok: false, kind: 'unavailable' }  503 / network (service down)
 *   - { ok: false, kind: 'empty' }        other non-2xx / not-found
 */
async function fetchMarket(
  path: string,
): Promise<{ ok: true; payload: unknown } | { ok: false; kind: 'unavailable' | 'empty' }> {
  try {
    const res = await fetch(`/api/market/${path}`, { cache: 'no-store' })
    if (res.status === 503) return { ok: false, kind: 'unavailable' }
    if (!res.ok) return { ok: false, kind: 'empty' }
    const payload = (await res.json().catch(() => null)) as unknown
    return { ok: true, payload }
  } catch {
    return { ok: false, kind: 'unavailable' }
  }
}

/** Upstream envelope is { data, meta, errors } — unwrap defensively. */
function unwrap(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: unknown }).data
  }
  return payload
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') {
    for (const k of ['items', 'results', 'companies', 'rows', 'list']) {
      const inner = (v as Record<string, unknown>)[k]
      if (Array.isArray(inner)) return inner
    }
  }
  return []
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function pick(obj: unknown, keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined
  const rec = obj as Record<string, unknown>
  for (const k of keys) if (k in rec) return rec[k]
  return undefined
}

function formatMoney(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)} млрд`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)} млн`
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)} тыс`
  return `$${v.toFixed(0)}`
}

function formatInt(v: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.round(v))
}

// ── Shared shell pieces ──────────────────────────────────────────────────────

function PanelShell({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl border p-4 mb-3"
      style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-sm" style={{ color: accent }}>
          monitoring
        </span>
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant">
          Данные рынка · live
        </span>
      </div>
      {children}
    </div>
  )
}

function Unavailable() {
  return (
    <div className="flex items-center gap-2 text-xs text-on-surface-variant/70">
      <span className="material-symbols-outlined text-sm">cloud_off</span>
      Сервис рыночных данных недоступен
    </div>
  )
}

function LoadingRow() {
  return (
    <div className="flex gap-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-14 flex-1 rounded-lg bg-surface-container animate-pulse" />
      ))}
    </div>
  )
}

// ── Block A: overview stat strip + TAM/SAM/SOM tiles ─────────────────────────

interface OverviewData {
  totalRevenue: number | null
  companies: number | null
  industries: number | null
}

function BlockAPanel({ accent, confirmed }: { accent: string; confirmed: ConfirmedAnswer[] }) {
  const [state, setState] = useState<PanelState<OverviewData>>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await fetchMarket('analytics/overview')
      if (cancelled) return
      if (!r.ok) {
        setState({ status: r.kind })
        return
      }
      const d = unwrap(r.payload)
      const totalRevenue = num(
        pick(d, ['total_revenue', 'totalRevenue', 'catalog_revenue', 'revenue_total', 'revenue']),
      )
      const companies = num(pick(d, ['companies', 'total_companies', 'company_count', 'companies_count']))
      const industries = num(
        pick(d, ['industries', 'total_industries', 'industry_count', 'industries_count', 'sectors']),
      )
      if (totalRevenue == null && companies == null && industries == null) {
        setState({ status: 'empty' })
        return
      }
      setState({ status: 'ready', data: { totalRevenue, companies, industries } })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const tamSamSom = useMemo(() => {
    const byKey = new Map(confirmed.map((c) => [c.key, c.text]))
    const tiles = [
      { label: 'TAM', key: 'A1' },
      { label: 'SAM', key: 'A2' },
      { label: 'SOM', key: 'A3' },
    ]
      .map((t) => ({ ...t, value: byKey.get(t.key) ?? null }))
      .filter((t) => t.value != null)
    return tiles
  }, [confirmed])

  if (state.status === 'loading')
    return (
      <PanelShell accent={accent}>
        <LoadingRow />
      </PanelShell>
    )
  if (state.status === 'unavailable')
    return (
      <PanelShell accent={accent}>
        <Unavailable />
      </PanelShell>
    )
  if (state.status === 'empty' && tamSamSom.length === 0) return null

  const overview = state.status === 'ready' ? state.data : null

  return (
    <PanelShell accent={accent}>
      {overview && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          <StatTile
            icon="payments"
            label="Выручка каталога"
            value={overview.totalRevenue != null ? formatMoney(overview.totalRevenue) : '—'}
            accent={accent}
          />
          <StatTile
            icon="apartment"
            label="Компаний"
            value={overview.companies != null ? formatInt(overview.companies) : '—'}
            accent={accent}
          />
          <StatTile
            icon="category"
            label="Отраслей"
            value={overview.industries != null ? formatInt(overview.industries) : '—'}
            accent={accent}
          />
        </div>
      )}
      {tamSamSom.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {tamSamSom.map((t) => (
            <div
              key={t.key}
              className="rounded-lg border px-3 py-2"
              style={{ borderColor: 'rgba(110,255,192,0.25)', background: 'rgba(110,255,192,0.06)' }}
            >
              <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: accent }}>
                {t.label}
              </p>
              <p className="text-xs text-on-surface mt-1 leading-snug line-clamp-3">{t.value}</p>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  )
}

function StatTile({
  icon,
  label,
  value,
  accent,
}: {
  icon: string
  label: string
  value: string
  accent: string
}) {
  return (
    <div className="rounded-lg bg-surface-container px-3 py-2.5 border border-white/[0.04]">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="material-symbols-outlined text-[13px]" style={{ color: accent }}>
          {icon}
        </span>
        <span className="text-[9px] font-mono uppercase tracking-wider text-on-surface-variant truncate">
          {label}
        </span>
      </div>
      <p className="text-base font-mono font-black text-on-surface tabular-nums leading-none">
        {value}
      </p>
    </div>
  )
}

// ── Block B: top industries by revenue (horizontal bars) ─────────────────────

interface IndustryRow {
  name: string
  revenue: number
}

function BlockBPanel({ accent }: { accent: string }) {
  const [state, setState] = useState<PanelState<IndustryRow[]>>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await fetchMarket('analytics/industry-distribution')
      if (cancelled) return
      if (!r.ok) {
        setState({ status: r.kind })
        return
      }
      const arr = asArray(unwrap(r.payload))
      const rows: IndustryRow[] = arr
        .map((item) => {
          const name = str(pick(item, ['industry', 'name', 'sector', 'label', 'code']))
          const revenue = num(pick(item, ['revenue', 'total_revenue', 'value', 'sum', 'amount']))
          return name && revenue != null ? { name, revenue } : null
        })
        .filter((x): x is IndustryRow => x != null)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 6)
      setState(rows.length ? { status: 'ready', data: rows } : { status: 'empty' })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading')
    return (
      <PanelShell accent={accent}>
        <LoadingRow />
      </PanelShell>
    )
  if (state.status === 'unavailable')
    return (
      <PanelShell accent={accent}>
        <Unavailable />
      </PanelShell>
    )
  if (state.status === 'empty') return null

  return (
    <PanelShell accent={accent}>
      <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant mb-2">
        Топ-отрасли по выручке
      </p>
      <div style={{ width: '100%', height: Math.max(120, state.data.length * 34) }}>
        <ResponsiveContainer>
          <BarChart
            data={state.data}
            layout="vertical"
            margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={120}
              tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              contentStyle={{
                background: '#12151c',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
                fontSize: 12,
              }}
              formatter={(v: number | string) => [formatMoney(Number(v)), 'Выручка']}
            />
            <Bar dataKey="revenue" radius={[0, 6, 6, 0]} fill={accent} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </PanelShell>
  )
}

// ── Block E: revenue share donut + top-5 list ────────────────────────────────

interface CompanyRow {
  name: string
  revenue: number
}

const DONUT_COLORS = ['#fca5a5', '#f0abfc', '#c4b5fd', '#7dd3fc', '#6effc0', '#fcd34d']

function BlockEPanel({ accent }: { accent: string }) {
  const [state, setState] = useState<PanelState<CompanyRow[]>>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await fetchMarket('companies?limit=10')
      if (cancelled) return
      if (!r.ok) {
        setState({ status: r.kind })
        return
      }
      const arr = asArray(unwrap(r.payload))
      const rows: CompanyRow[] = arr
        .map((item) => {
          const name = str(pick(item, ['name', 'company_name', 'title', 'bin_name']))
          const revenue = num(pick(item, ['revenue', 'total_revenue', 'revenue_total', 'turnover']))
          return name && revenue != null && revenue > 0 ? { name, revenue } : null
        })
        .filter((x): x is CompanyRow => x != null)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5)
      setState(rows.length ? { status: 'ready', data: rows } : { status: 'empty' })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading')
    return (
      <PanelShell accent={accent}>
        <LoadingRow />
      </PanelShell>
    )
  if (state.status === 'unavailable')
    return (
      <PanelShell accent={accent}>
        <Unavailable />
      </PanelShell>
    )
  if (state.status === 'empty') return null

  const total = state.data.reduce((s, r) => s + r.revenue, 0)

  return (
    <PanelShell accent={accent}>
      <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant mb-2">
        Доли по выручке · топ-5
      </p>
      <div className="flex items-center gap-4 flex-wrap">
        <div style={{ width: 140, height: 140 }} className="shrink-0">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={state.data}
                dataKey="revenue"
                nameKey="name"
                innerRadius={42}
                outerRadius={66}
                paddingAngle={2}
                stroke="none"
              >
                {state.data.map((_, i) => (
                  <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: '#12151c',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12,
                  fontSize: 12,
                }}
                formatter={(v: number | string) => [formatMoney(Number(v)), 'Выручка']}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="flex-1 min-w-[180px] space-y-1.5">
          {state.data.map((r, i) => (
            <li key={r.name} className="flex items-center gap-2 text-xs">
              <span
                className="h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
              />
              <span className="text-on-surface truncate flex-1">{r.name}</span>
              <span className="font-mono tabular-nums text-on-surface-variant shrink-0">
                {formatMoney(r.revenue)}
              </span>
              <span className="font-mono tabular-nums text-on-surface-variant/60 w-9 text-right shrink-0">
                {total > 0 ? Math.round((r.revenue / total) * 100) : 0}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </PanelShell>
  )
}

// ── Public dispatcher ────────────────────────────────────────────────────────

export function MarketDataPanel({
  blockId,
  accent,
  confirmed,
}: {
  blockId: string
  accent: string
  confirmed: ConfirmedAnswer[]
}) {
  if (blockId === 'A') return <BlockAPanel accent={accent} confirmed={confirmed} />
  if (blockId === 'B') return <BlockBPanel accent={accent} />
  if (blockId === 'E') return <BlockEPanel accent={accent} />
  return null
}
