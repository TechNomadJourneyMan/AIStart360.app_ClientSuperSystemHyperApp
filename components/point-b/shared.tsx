'use client'

import { useId, useState, type ReactNode } from 'react'

// ─── Domain constants ────────────────────────────────────────────────────────

export const BLOCK_LABELS: Record<string, string> = {
  finance: 'Финансы',
  sales: 'Продажи',
  operations: 'Операции',
  marketing: 'Маркетинг',
  strategy: 'Стратегия',
}

export function blockLabel(key: string): string {
  return BLOCK_LABELS[key] ?? key
}

// Realism level → visual styling + Russian label.
export const REALISM_STYLE: Record<
  string,
  { label: string; text: string; bg: string; border: string; dot: string; icon: string }
> = {
  realistic: {
    label: 'Реалистично',
    text: 'text-primary',
    bg: 'bg-primary/[0.08]',
    border: 'border-primary/30',
    dot: 'bg-primary',
    icon: 'verified',
  },
  ambitious: {
    label: 'Амбициозно',
    text: 'text-[#7dd3fc]',
    bg: 'bg-[#7dd3fc]/[0.08]',
    border: 'border-[#7dd3fc]/30',
    dot: 'bg-[#7dd3fc]',
    icon: 'rocket_launch',
  },
  aggressive: {
    label: 'Агрессивно',
    text: 'text-amber-400',
    bg: 'bg-amber-400/[0.08]',
    border: 'border-amber-400/30',
    dot: 'bg-amber-400',
    icon: 'bolt',
  },
  unrealistic: {
    label: 'Нереалистично',
    text: 'text-error',
    bg: 'bg-error/[0.08]',
    border: 'border-error/30',
    dot: 'bg-error',
    icon: 'warning',
  },
  unknown: {
    label: 'Недостаточно данных',
    text: 'text-on-surface-variant',
    bg: 'bg-white/[0.04]',
    border: 'border-white/[0.08]',
    dot: 'bg-on-surface-variant',
    icon: 'help',
  },
}

export function realismStyle(level: string) {
  return REALISM_STYLE[level] ?? REALISM_STYLE.unknown
}

// Severity / priority → styling. Shared by GAP priority, TOP-5 severity, levers.
export const SEVERITY_STYLE: Record<string, { label: string; text: string; border: string; bg: string }> = {
  critical: { label: 'Критично', text: 'text-error', border: 'border-error/40', bg: 'bg-error/[0.06]' },
  high: { label: 'Высокий', text: 'text-amber-400', border: 'border-amber-400/40', bg: 'bg-amber-400/[0.06]' },
  medium: { label: 'Средний', text: 'text-[#7dd3fc]', border: 'border-[#7dd3fc]/30', bg: 'bg-[#7dd3fc]/[0.06]' },
  low: { label: 'Низкий', text: 'text-primary', border: 'border-primary/30', bg: 'bg-primary/[0.06]' },
}

export function severityStyle(key: string) {
  return SEVERITY_STYLE[key] ?? SEVERITY_STYLE.medium
}

export const DIFFICULTY_LABEL: Record<string, { label: string; text: string }> = {
  low: { label: 'Низкая сложность', text: 'text-primary' },
  medium: { label: 'Средняя сложность', text: 'text-amber-400' },
  high: { label: 'Высокая сложность', text: 'text-error' },
}

export const CONFIDENCE_LABEL: Record<string, { label: string; text: string; bg: string }> = {
  low: { label: 'Низкая уверенность', text: 'text-error', bg: 'bg-error/[0.08]' },
  medium: { label: 'Средняя уверенность', text: 'text-amber-400', bg: 'bg-amber-400/[0.08]' },
  high: { label: 'Высокая уверенность', text: 'text-primary', bg: 'bg-primary/[0.08]' },
}

// ─── Formatters ──────────────────────────────────────────────────────────────

export const DASH = '—'

/** Money in ₸. Large numbers compacted to млрд/млн. Null → "—". */
export function formatMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH
  const abs = Math.abs(v)
  if (abs >= 1_000_000_000) {
    return `${(v / 1_000_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млрд ₸`
  }
  if (abs >= 1_000_000) {
    return `${(v / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} млн ₸`
  }
  return `${Math.round(v).toLocaleString('ru-RU')} ₸`
}

/** Full money — no compaction, always grouped. Null → "—". */
export function formatMoneyFull(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH
  return `${Math.round(v).toLocaleString('ru-RU')} ₸`
}

/** Percentage with one decimal, e.g. "115.4%". Null → "—". */
export function formatPercent(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH
  return `${v.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

/** Multiplier, e.g. "×3,2". Null → "—". */
export function formatMultiplier(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH
  return `×${v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}`
}

/** Generic number with grouping. Null → "—". */
export function formatNum(v: number | string | null | undefined, unit = ''): string {
  if (v == null) return DASH
  if (typeof v === 'string') {
    if (v.trim() === '') return DASH
    return unit ? `${v} ${unit}`.trim() : v
  }
  if (!Number.isFinite(v)) return DASH
  const base = v.toLocaleString('ru-RU')
  return unit ? `${base} ${unit}`.trim() : base
}

/** Score out of 100, e.g. "62/100". Null → "—". */
export function formatScore(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH
  return `${Math.round(v)}/100`
}

// ─── Presentational primitives ───────────────────────────────────────────────

/** Section wrapper: eyebrow tag + heading + content. Matches brand spacing. */
export function Section({
  eyebrow,
  title,
  description,
  icon,
  children,
}: {
  eyebrow?: string
  title: string
  description?: string
  icon?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-5">
      <div className="space-y-2">
        {eyebrow && (
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em]">{eyebrow}</p>
        )}
        <div className="flex items-center gap-2.5">
          {icon && (
            <span className="material-symbols-outlined text-xl text-primary/80" aria-hidden>
              {icon}
            </span>
          )}
          <h2 className="font-headline text-lg lg:text-xl font-bold text-on-surface">{title}</h2>
        </div>
        {description && <p className="text-sm text-on-surface-variant max-w-2xl">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/** Standard card surface. */
export function Card({
  children,
  className = '',
  hover = false,
}: {
  children: ReactNode
  className?: string
  hover?: boolean
}) {
  return (
    <div
      className={`bg-surface-container-low rounded-2xl border border-white/[0.06] shadow-card p-5 ${
        hover ? 'transition-colors hover:border-primary/20' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

/** Inline "—" placeholder with a tooltip-style hint for missing data. */
export function MissingValue({ hint }: { hint?: string }) {
  return (
    <span className="font-mono text-on-surface-variant/60" title={hint}>
      {DASH}
    </span>
  )
}

/** Pill badge for status / severity. */
export function Pill({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest border rounded-md px-2 py-0.5 ${className}`}
    >
      {children}
    </span>
  )
}

/**
 * Empty-state block (used when an array is empty but section is rendered).
 * `action` is the way out of the dead end — a link/button that leads to where
 * the missing data is filled in. Optional, so existing call sites still work.
 */
export function EmptyState({
  icon = 'inbox',
  text,
  hint,
  action,
}: {
  icon?: string
  text: string
  /** What exactly is missing / where it comes from. */
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="bg-surface-container-low border border-dashed border-white/[0.08] rounded-2xl p-8 text-center">
      <span className="material-symbols-outlined text-3xl text-on-surface-variant/40 mb-2 block" aria-hidden>
        {icon}
      </span>
      <p className="text-sm text-on-surface-variant">{text}</p>
      {hint && <p className="text-xs text-on-surface-variant/70 mt-1.5 max-w-md mx-auto">{hint}</p>}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  )
}

// ─── Interactive primitives ──────────────────────────────────────────────────

/**
 * Accessible expand/collapse: a real `<button aria-expanded aria-controls>` and
 * a labelled region. Every "раскрыть разбор" on Точка Б goes through this so
 * keyboard + screen-reader behaviour is identical everywhere.
 *
 * `summary` may be a render function receiving the open state (for chevrons).
 * Can be used uncontrolled (`defaultOpen`) or controlled (`open`/`onOpenChange`).
 */
export function Expandable({
  summary,
  children,
  ariaLabel,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  className = '',
  triggerClassName = '',
  panelClassName = '',
}: {
  summary: ReactNode | ((open: boolean) => ReactNode)
  children: ReactNode
  ariaLabel?: string
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  triggerClassName?: string
  panelClassName?: string
}) {
  const uid = useId()
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const open = openProp ?? internalOpen

  const toggle = () => {
    const next = !open
    if (openProp === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div className={className}>
      <button
        type="button"
        id={`${uid}-trigger`}
        aria-expanded={open}
        aria-controls={`${uid}-panel`}
        aria-label={ariaLabel}
        onClick={toggle}
        className={`w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xl ${triggerClassName}`}
      >
        {typeof summary === 'function' ? summary(open) : summary}
      </button>
      <div
        id={`${uid}-panel`}
        role="region"
        aria-labelledby={`${uid}-trigger`}
        hidden={!open}
        className={panelClassName}
      >
        {open ? children : null}
      </div>
    </div>
  )
}

/** Chevron that rotates with the disclosure state. */
export function Chevron({ open, className = '' }: { open: boolean; className?: string }) {
  return (
    <span
      className={`material-symbols-outlined text-base transition-transform ${open ? 'rotate-180' : ''} ${className}`}
      aria-hidden
    >
      expand_more
    </span>
  )
}

/** Progress bar with real ARIA semantics (the bare <div> version was mute). */
export function ProgressBar({
  value,
  max = 100,
  label,
  className = '',
}: {
  value: number
  max?: number
  label: string
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(max, 1)) * 100))
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={`h-2 bg-surface-container-high rounded-full overflow-hidden ${className}`}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-primary to-primary-fixed-dim transition-all duration-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/** A single "формула → подстановка → результат" line inside a разбор panel. */
export function FormulaLine({
  title,
  formula,
  substitution,
  result,
}: {
  title?: string
  formula: string
  substitution?: string
  result?: string
}) {
  return (
    <div className="rounded-xl bg-surface-container/60 border border-white/[0.06] px-3.5 py-3 space-y-1">
      {title && (
        <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{title}</p>
      )}
      <p className="text-xs font-mono text-on-surface break-words">{formula}</p>
      {substitution && (
        <p className="text-xs font-mono text-on-surface-variant break-words">= {substitution}</p>
      )}
      {result && <p className="text-sm font-mono font-bold text-primary break-words">= {result}</p>}
    </div>
  )
}
