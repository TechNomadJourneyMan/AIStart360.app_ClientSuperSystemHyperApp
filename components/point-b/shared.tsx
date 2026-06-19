'use client'

import type { ReactNode } from 'react'

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

/** Empty-state block (used when an array is empty but section is rendered). */
export function EmptyState({ icon = 'inbox', text }: { icon?: string; text: string }) {
  return (
    <div className="bg-surface-container-low border border-dashed border-white/[0.08] rounded-2xl p-8 text-center">
      <span className="material-symbols-outlined text-3xl text-on-surface-variant/40 mb-2 block" aria-hidden>
        {icon}
      </span>
      <p className="text-sm text-on-surface-variant">{text}</p>
    </div>
  )
}
