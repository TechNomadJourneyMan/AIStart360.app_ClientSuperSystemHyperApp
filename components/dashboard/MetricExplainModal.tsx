'use client'

// ============================================================
// MetricExplainModal — «откуда взялась эта цифра»
//
// A small, data-shaped disclosure used by the hero tiles and the
// GRI block bars. Unlike `MetricDrillDownModalV2` it does NOT
// require a timeseries — it explains a single computed number:
//   • откуда взято (provenance rows straight off the resolver)
//   • из чего сложилось (formula terms / criteria rows)
//   • чего не хватает (honest gaps)
//   • что сделать (real links, never a dead end)
//
// It never invents numbers: every field is supplied by the caller
// from a real API payload. A missing field simply is not rendered.
// ============================================================

import * as Dialog from '@radix-ui/react-dialog'
import Link from 'next/link'
import { formatRuRelativeTime, sourceTypeLabel } from './_utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExplainSourceType =
  | 'survey'
  | 'document'
  | 'prisma'
  | 'external'
  | 'manual'
  | 'missing'

export interface ExplainSource {
  type: ExplainSourceType
  /** Human label, e.g. «Выручка 2025 (₸)». */
  label: string
  /** Where exactly, e.g. «анкета · шаг 2 · s2_revenue_2025». */
  detail?: string
  /** Did the resolver actually find a value here? */
  status: 'hit' | 'miss' | 'error'
  /** Was this the source the number was finally taken from? */
  picked?: boolean
  /** 0..1 */
  confidence?: number
  /** Already-formatted value string (never re-derived here). */
  value?: string
  /** Why it missed, straight from the resolver. */
  reason?: string
}

export type ExplainTone = 'good' | 'warn' | 'bad' | 'muted'

export interface ExplainRow {
  label: string
  value: string
  note?: string
  tone?: ExplainTone
}

export interface ExplainSection {
  heading: string
  rows: ExplainRow[]
  caption?: string
}

export interface ExplainAction {
  label: string
  href?: string
  onClick?: () => void
  icon?: string
  primary?: boolean
  /** Opens in a new tab (external). */
  external?: boolean
}

export interface MetricExplainModalProps {
  open: boolean
  onClose: () => void
  /** Metric name shown as the dialog title. */
  title: string
  /** Small caption above the title, e.g. «Точка А · Снимок». */
  eyebrow?: string
  /** Already-formatted headline value, or `null` for «нет данных». */
  value: string | null
  /** Sub-caption under the value, e.g. «выручка / мес · август». */
  valueHint?: string
  /** Plain-language «что это». */
  what?: string
  /** Plain-language «почему важно». */
  why?: string
  /** Arithmetic that produced the number. */
  formula?: ExplainRow[]
  /** Free-form breakdown blocks (criteria, sub-scores, …). */
  sections?: ExplainSection[]
  /** Resolver provenance. */
  sources?: ExplainSource[]
  /** ISO timestamp of the computation. */
  computedAt?: string | null
  /** Was the value computed within the freshness window? */
  fresh?: boolean
  /** Honest list of what is missing before the number can appear. */
  missing?: string[]
  /** Always at least one — an empty state must lead somewhere. */
  actions?: ExplainAction[]
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

const TONE_CLASS: Record<ExplainTone, string> = {
  good: 'text-primary',
  warn: 'text-[#e87a35]',
  bad: 'text-error',
  muted: 'text-on-surface-variant',
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">
      {children}
    </p>
  )
}

function RowLine({ row }: { row: ExplainRow }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5 border-b border-white/[0.04] last:border-0">
      <span className="text-xs text-on-surface-variant min-w-0">
        {row.label}
        {row.note && (
          <span className="block text-[10px] text-on-surface-variant/60 leading-snug mt-0.5">
            {row.note}
          </span>
        )}
      </span>
      <span
        className={`text-xs font-mono font-bold flex-shrink-0 ${
          TONE_CLASS[row.tone ?? 'muted']
        }`}
      >
        {row.value}
      </span>
    </li>
  )
}

const STATUS_LABEL: Record<ExplainSource['status'], string> = {
  hit: 'есть',
  miss: 'не заполнено',
  error: 'ошибка',
}

function SourceLine({ src }: { src: ExplainSource }) {
  const picked = Boolean(src.picked)
  return (
    <li
      data-picked={picked ? 'true' : 'false'}
      className={`flex items-start gap-2 py-1.5 border-b border-white/[0.04] last:border-0 ${
        picked ? 'text-on-surface' : 'text-on-surface-variant'
      }`}
    >
      <span
        className={`inline-flex items-center text-[9px] font-mono uppercase tracking-[0.15em] px-1.5 py-0.5 rounded-md flex-shrink-0 mt-0.5 ${
          picked
            ? 'bg-primary/15 text-primary'
            : 'bg-surface-container text-on-surface-variant'
        }`}
      >
        {sourceTypeLabel(src.type)}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs leading-snug">{src.label}</span>
        {src.detail && (
          <span className="block text-[10px] font-mono text-on-surface-variant/60 leading-snug mt-0.5">
            {src.detail}
          </span>
        )}
        {src.status !== 'hit' && src.reason && (
          <span className="block text-[10px] text-on-surface-variant/60 leading-snug mt-0.5">
            {src.reason}
          </span>
        )}
      </span>
      <span className="flex-shrink-0 text-right">
        <span
          className={`block text-[11px] font-mono ${
            src.status === 'hit' ? 'text-on-surface' : 'text-on-surface-variant/60'
          }`}
        >
          {src.value ?? STATUS_LABEL[src.status]}
        </span>
        {typeof src.confidence === 'number' && src.status === 'hit' && (
          <span className="block text-[10px] font-mono text-on-surface-variant/50">
            точность {Math.round(src.confidence * 100)}%
          </span>
        )}
      </span>
      {picked && (
        <span
          className="material-symbols-outlined text-primary text-base leading-none flex-shrink-0"
          aria-label="Значение взято отсюда"
        >
          check
        </span>
      )}
    </li>
  )
}

function ActionButton({ action }: { action: ExplainAction }) {
  const cls = action.primary
    ? 'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-mono font-bold bg-primary text-on-primary hover:bg-primary/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60'
    : 'inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-mono border border-white/10 text-on-surface-variant hover:text-on-surface hover:border-primary/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60'

  const body = (
    <>
      {action.icon && (
        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
          {action.icon}
        </span>
      )}
      {action.label}
      {action.external && (
        <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
          open_in_new
        </span>
      )}
    </>
  )

  if (action.href && action.external) {
    return (
      <a href={action.href} target="_blank" rel="noopener noreferrer" className={cls}>
        {body}
      </a>
    )
  }
  if (action.href) {
    return (
      <Link href={action.href} className={cls}>
        {body}
      </Link>
    )
  }
  return (
    <button type="button" onClick={action.onClick} className={cls}>
      {body}
    </button>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MetricExplainModal({
  open,
  onClose,
  title,
  eyebrow,
  value,
  valueHint,
  what,
  why,
  formula,
  sections,
  sources,
  computedAt,
  fresh,
  missing,
  actions,
}: MetricExplainModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed inset-0 z-[101] flex items-end sm:items-center justify-center p-0 sm:p-6 overflow-y-auto"
          data-testid="metric-explain-modal"
        >
          <div className="relative bg-surface-container border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-modal w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 sm:p-6 my-auto">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="min-w-0">
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.2em] mb-1">
                  {eyebrow ?? 'Разбор показателя'}
                </p>
                <Dialog.Title asChild>
                  <h2 className="text-lg sm:text-xl font-headline font-bold text-on-surface leading-tight">
                    {title}
                  </h2>
                </Dialog.Title>
                <Dialog.Description className="sr-only">
                  Откуда взята цифра «{title}», из чего она сложилась и что сделать
                  для улучшения.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Закрыть"
                  className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-on-surface-variant/60 hover:text-on-surface hover:bg-white/[0.06] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <span className="material-symbols-outlined text-xl" aria-hidden="true">
                    close
                  </span>
                </button>
              </Dialog.Close>
            </div>

            {/* Value */}
            <div className="bg-surface-container-low rounded-xl border border-white/[0.05] p-4 mb-4">
              <p className="font-mono text-3xl font-black text-on-surface leading-none tracking-tight">
                {value ?? '—'}
              </p>
              {valueHint && (
                <p className="text-[11px] font-mono text-on-surface-variant mt-2">
                  {valueHint}
                </p>
              )}
              {computedAt && (
                <p className="text-[10px] font-mono text-on-surface-variant/60 mt-1">
                  рассчитано {formatRuRelativeTime(computedAt)}
                  {fresh === false && ' · данные могли устареть'}
                </p>
              )}
            </div>

            {/* What / why */}
            {(what || why) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                {what && (
                  <div>
                    <SectionHeading>Что это</SectionHeading>
                    <p className="text-xs text-on-surface-variant leading-relaxed">{what}</p>
                  </div>
                )}
                {why && (
                  <div>
                    <SectionHeading>Почему важно</SectionHeading>
                    <p className="text-xs text-on-surface-variant leading-relaxed">{why}</p>
                  </div>
                )}
              </div>
            )}

            {/* Formula */}
            {formula && formula.length > 0 && (
              <div className="mb-5">
                <SectionHeading>Как получилась цифра</SectionHeading>
                <ul className="bg-surface-container-low rounded-xl border border-white/[0.05] px-3 py-1">
                  {formula.map((r, i) => (
                    <RowLine key={`${r.label}-${i}`} row={r} />
                  ))}
                </ul>
              </div>
            )}

            {/* Free-form sections */}
            {sections?.map((s, si) => (
              <div key={`${s.heading}-${si}`} className="mb-5">
                <SectionHeading>{s.heading}</SectionHeading>
                <ul className="bg-surface-container-low rounded-xl border border-white/[0.05] px-3 py-1">
                  {s.rows.map((r, i) => (
                    <RowLine key={`${r.label}-${i}`} row={r} />
                  ))}
                </ul>
                {s.caption && (
                  <p className="text-[10px] font-mono text-on-surface-variant/60 mt-1.5">
                    {s.caption}
                  </p>
                )}
              </div>
            ))}

            {/* Provenance */}
            {sources && sources.length > 0 && (
              <div className="mb-5">
                <SectionHeading>Откуда взяты данные</SectionHeading>
                <ul className="bg-surface-container-low rounded-xl border border-white/[0.05] px-3 py-1">
                  {sources.map((s, i) => (
                    <SourceLine key={`${s.type}-${s.label}-${i}`} src={s} />
                  ))}
                </ul>
              </div>
            )}

            {/* Missing data — honest gap list */}
            {missing && missing.length > 0 && (
              <div className="mb-5">
                <SectionHeading>Каких данных не хватает</SectionHeading>
                <ul className="space-y-1.5">
                  {missing.map((m, i) => (
                    <li
                      key={`${m}-${i}`}
                      className="flex items-start gap-2 text-xs text-on-surface-variant leading-relaxed"
                    >
                      <span
                        className="material-symbols-outlined text-[14px] text-[#e87a35] flex-shrink-0 mt-0.5"
                        aria-hidden="true"
                      >
                        error_outline
                      </span>
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Actions */}
            {actions && actions.length > 0 && (
              <div className="pt-3 border-t border-white/[0.06]">
                <SectionHeading>Что сделать</SectionHeading>
                <div className="flex flex-wrap gap-2">
                  {actions.map((a, i) => (
                    <ActionButton key={`${a.label}-${i}`} action={a} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
