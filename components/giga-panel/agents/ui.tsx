'use client'

/**
 * Small building blocks shared by the «ИИ-агенты» pages. Same visual language
 * as the GIGA kit (dark glass, slate text, blue accent, lucide icons).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, Lock } from 'lucide-react'
import { Badge, cx } from '../kit'
import { prettyJson, type StatusMeta } from './model'

export function StatusChip({ meta, className }: { meta: StatusMeta; className?: string }) {
  return <Badge tone={meta.tone} title={meta.hint} className={className}>{meta.label}</Badge>
}

export function Toggle({ checked, onChange, disabled, label, title }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; title?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-emerald-400/40 bg-emerald-500/60' : 'border-white/[0.12] bg-white/[0.08]',
      )}
    >
      <span className={cx('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange, disabled, label }: {
  value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (v: T) => void; disabled?: boolean; label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-50',
            o.value === value ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Filter chips (status quick filters). */
export function ChipFilter<T extends string>({ value, options, onChange, label }: {
  value: T; options: ReadonlyArray<{ value: T; label: string; tone?: StatusMeta['tone'] }>; onChange: (v: T) => void; label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value || 'all'}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
              active ? 'border-blue-500/40 bg-blue-500/20 text-blue-100' : 'border-white/[0.08] bg-white/[0.03] text-slate-400 hover:text-slate-200',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Collapsible pretty JSON (redacted args, payloads, results). */
export function JsonDetails({ value, label = 'Показать JSON', defaultOpen = false }: { value: unknown; label?: string; defaultOpen?: boolean }) {
  const text = prettyJson(value)
  if (text === '—') return <span className="text-slate-600">—</span>
  return (
    <details className="group" open={defaultOpen}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-[11px] text-blue-300 hover:text-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
        <ChevronDown size={11} className="transition-transform group-open:rotate-180" /> {label}
      </summary>
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/[0.05] bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-slate-300">{text}</pre>
    </details>
  )
}

/** Label → value list. Falsy entries (conditional rows written as `cond && [k, v]`) are skipped. */
export function KV({ items, className }: { items: Array<[ReactNode, ReactNode] | null | undefined | false | '' | 0>; className?: string }) {
  return (
    <dl className={cx('grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs', className)}>
      {items.filter((x): x is [ReactNode, ReactNode] => !!x).map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="min-w-0 break-words text-slate-200">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Compact metric: caption + mono value. */
export function Metric({ label, value, hint, tone, className }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'red' | 'amber' | 'green'; className?: string }) {
  const title = [label, typeof value === 'string' || typeof value === 'number' ? String(value) : null, typeof hint === 'string' ? hint : null]
    .filter(Boolean).join(' — ')
  return (
    <div className={cx('min-w-0 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2', className)} title={title}>
      <p className="truncate text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cx(
        'mt-0.5 truncate font-mono text-sm font-semibold tabular-nums',
        tone === 'red' ? 'text-red-300' : tone === 'amber' ? 'text-amber-300' : tone === 'green' ? 'text-emerald-300' : 'text-slate-100',
      )}>{value}</p>
      {hint && <p className="truncate text-[10px] text-slate-600">{hint}</p>}
    </div>
  )
}

/** Inline explanation why an action is unavailable for this role. */
export function NoRightHint({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
      <Lock size={11} className="shrink-0" /> {children}
    </p>
  )
}

/** Re-render every `ms` (countdowns, «… назад»). */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-mono text-[11px] text-slate-400', className)}>{children}</span>
}
