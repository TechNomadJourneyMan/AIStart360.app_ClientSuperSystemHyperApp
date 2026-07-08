'use client'

import { CLIENT_STATUSES, type ClientStatus } from '@/lib/crm/client-validate'
import type { CrmClient } from '@/hooks/useCrm'

// ─── Shared status metadata (labels + fixed Tailwind classes) ────────────────
// Full class strings so the JIT keeps them (no dynamic interpolation).
export const CLIENT_STATUS_META: Record<
  ClientStatus,
  { label: string; dot: string; text: string; chip: string; bar: string }
> = {
  new:         { label: 'Новый',    dot: 'bg-sky-400',     text: 'text-sky-400',     chip: 'bg-sky-400/10 border-sky-400/30 text-sky-400',         bar: 'bg-sky-400' },
  in_progress: { label: 'В работе', dot: 'bg-primary',     text: 'text-primary',     chip: 'bg-primary/10 border-primary/30 text-primary',         bar: 'bg-primary' },
  waiting:     { label: 'Ожидание', dot: 'bg-violet-400',  text: 'text-violet-400',  chip: 'bg-violet-400/10 border-violet-400/30 text-violet-400', bar: 'bg-violet-400' },
  customer:    { label: 'Клиент',   dot: 'bg-emerald-400', text: 'text-emerald-400', chip: 'bg-emerald-400/10 border-emerald-400/30 text-emerald-400', bar: 'bg-emerald-400' },
  sleeping:    { label: 'Спящий',   dot: 'bg-amber-400',   text: 'text-amber-400',   chip: 'bg-amber-400/10 border-amber-400/30 text-amber-400',   bar: 'bg-amber-400' },
  lost:        { label: 'Потерян',  dot: 'bg-error',       text: 'text-error',       chip: 'bg-error/10 border-error/30 text-error',               bar: 'bg-error' },
}

export const CLIENT_STATUS_ORDER = CLIENT_STATUSES

/** Compact ₸ formatter (mirrors the pulse page `fmt`). */
export function fmtTenge(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}Млрд ₸`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}М ₸`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}К ₸`
  return `${Math.round(n)} ₸`
}

export function FunnelBar({
  clients,
  active,
  onSelect,
}: {
  clients: CrmClient[]
  active: ClientStatus | null
  onSelect: (status: ClientStatus | null) => void
}) {
  // Count + Σ avg_check per status.
  const agg = new Map<ClientStatus, { count: number; sum: number }>()
  for (const s of CLIENT_STATUS_ORDER) agg.set(s, { count: 0, sum: 0 })
  for (const c of clients) {
    const bucket = agg.get(c.status as ClientStatus)
    if (!bucket) continue
    bucket.count += 1
    bucket.sum += typeof c.avg_check === 'number' ? c.avg_check : 0
  }
  const maxCount = Math.max(1, ...CLIENT_STATUS_ORDER.map((s) => agg.get(s)!.count))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Воронка по статусам</p>
        {active && (
          <button
            onClick={() => onSelect(null)}
            className="text-[10px] font-mono text-primary/70 hover:text-primary transition-colors"
          >
            Сбросить фильтр
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {CLIENT_STATUS_ORDER.map((s) => {
          const meta = CLIENT_STATUS_META[s]
          const { count, sum } = agg.get(s)!
          const isActive = active === s
          const pct = Math.round((count / maxCount) * 100)
          return (
            <button
              key={s}
              onClick={() => onSelect(isActive ? null : s)}
              className={`text-left rounded-xl border p-3 transition-colors ${
                isActive
                  ? 'bg-surface-container-high border-white/[0.14]'
                  : 'bg-surface-container-low border-white/[0.04] hover:border-white/[0.10]'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                <span className="text-[11px] font-medium text-on-surface truncate">{meta.label}</span>
              </div>
              <p className={`text-xl font-mono font-bold leading-none ${meta.text}`}>{count}</p>
              <div className="mt-1.5 h-1 bg-surface-container rounded-full overflow-hidden">
                <div className={`h-full ${meta.bar} rounded-full`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[10px] font-mono text-on-surface-variant/70 mt-1.5">{fmtTenge(sum)}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
