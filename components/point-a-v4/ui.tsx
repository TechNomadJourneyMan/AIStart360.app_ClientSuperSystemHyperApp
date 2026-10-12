'use client'

/** Shared look of the Point A v4 page (premium dark glass, teal #6effc0, Russian copy). */
import { cn } from '@/lib/utils'
import { SCORE_TONE_COLOR, scoreTone } from '@/components/point-a/executive-overview-model'

export const CARD = 'rounded-2xl border border-white/[0.06] bg-surface-container/80 backdrop-blur-sm p-4 sm:p-5'
export const CARD_TITLE = 'text-[11px] font-mono text-on-surface-variant uppercase tracking-[0.18em]'
export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-primary text-on-primary text-xs font-semibold px-3.5 py-2 min-h-[36px] transition-colors hover:bg-primary/90 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
export const BTN_GHOST =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-white/10 text-on-surface-variant text-xs font-medium px-3.5 py-2 min-h-[36px] transition-colors hover:text-on-surface hover:border-white/20 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
export const CHIP = 'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider'

export function Icon({ name, className }: { name: string; className?: string }) {
  return <span className={cn('material-symbols-outlined', className)} aria-hidden="true">{name}</span>
}

export function toneColor(score: number | null | undefined): string {
  return SCORE_TONE_COLOR[scoreTone(score)]
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`
}

const UNIT_RU: Record<string, string> = { days: 'дн', count: '', '': '' }

export function fmtValue(n: number | null | undefined, rawUnit = ''): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const unit = UNIT_RU[rawUnit] ?? rawUnit
  const a = Math.abs(n)
  const v = a >= 1_000_000_000 ? `${(n / 1e9).toFixed(1).replace('.', ',')} млрд`
    : a >= 1_000_000 ? `${(n / 1e6).toFixed(1).replace('.', ',')} млн`
    : a >= 10_000 ? `${Math.round(n / 1000)} тыс.`
    : String(Math.round(n * 100) / 100).replace('.', ',')
  if (unit === '%') return `${v}%`
  return unit ? `${v} ${unit}` : v
}

export function ConfidenceBar({ value, label = 'Достоверность' }: { value: number | null; label?: string }) {
  const v = value === null ? 0 : Math.max(0, Math.min(1, value))
  const tone = v >= 0.7 ? 'bg-primary' : v >= 0.4 ? 'bg-amber-300' : 'bg-red-300'
  return (
    <div className="w-full" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <div className="flex items-center justify-between text-[10px] font-mono text-on-surface-variant mb-1">
        <span>{label}</span>
        <span>{pct(value)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${v * 100}%` }} />
      </div>
    </div>
  )
}

export const STAGE_RU: Record<string, string> = { seed: 'Старт', early: 'Ранний рост', growth: 'Рост', scale: 'Масштаб', mature: 'Зрелость' }

export function SectionTitle({ icon, children, aside }: { icon: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="flex items-center gap-2 font-headline text-base font-bold text-on-surface">
        <Icon name={icon} className="text-[18px] text-primary/80" />
        {children}
      </h2>
      {aside}
    </div>
  )
}
