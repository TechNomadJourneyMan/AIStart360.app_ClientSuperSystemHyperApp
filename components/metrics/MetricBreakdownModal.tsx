'use client'

import * as Dialog from '@radix-ui/react-dialog'
import Link from 'next/link'
import { formatSource, type MetricSource } from '@/lib/metrics/format'

// ============================================================
// MetricBreakdownModal
//
// The "разбор" behind every clickable number on /metrics that is NOT a
// registry metric with a timeseries (those open MetricDrillDownModalV2).
// Answers the four questions the owner asked for: сколько, откуда, по какой
// формуле, что было раньше.
//
// Built on @radix-ui/react-dialog, so focus trap, focus restore to the
// trigger, Esc, body scroll lock and aria-modal/labelledby come for free —
// the hand-rolled overlay it replaces had none of those.
// ============================================================

export type BreakdownTone = 'primary' | 'neutral' | 'error' | 'warning'

export interface BreakdownChip {
  label: string
  tone?: BreakdownTone
}

export interface BreakdownHistoryPoint {
  /** Period / date label, e.g. «12 мая 2026». */
  label: string
  /** Already-formatted value. */
  value: string
  hint?: string
}

export interface BreakdownSection {
  title: string
  body: string
  tone?: BreakdownTone
}

export interface BreakdownLink {
  label: string
  href: string
  icon?: string
}

export interface MetricBreakdownModalProps {
  open: boolean
  onClose: () => void
  title: string
  /** Big number at the top. `null` renders the honest "нет значения" block. */
  value: string | null
  /** Caption above the big number, e.g. «Балл блока» / «Целевое значение». */
  valueCaption?: string
  /** Shown instead of the number when `value` is null — what exactly is missing. */
  missingReason?: string
  chips?: BreakdownChip[]
  what?: string
  why?: string
  how?: string
  formula?: string
  /** Free-form blocks rendered after «Как считается». */
  sections?: BreakdownSection[]
  /** Named label/value lists — e.g. the criteria a GRI block score is made of. */
  lists?: Array<{ title: string; rows: BreakdownHistoryPoint[]; emptyText?: string }>
  sources?: MetricSource[]
  /** `null` = no history exists yet; `[]` is treated the same way. */
  history?: BreakdownHistoryPoint[] | null
  /** Explains why history is empty and what produces it. */
  historyEmptyText?: string
  links?: BreakdownLink[]
}

const CHIP_TONE: Record<BreakdownTone, string> = {
  primary: 'bg-primary/10 border-primary/20 text-primary',
  neutral: 'bg-surface-container border-white/[0.06] text-on-surface-variant',
  error: 'bg-error/10 border-error/20 text-error',
  warning: 'bg-tertiary-container/10 border-tertiary-container/20 text-tertiary-container',
}

const SECTION_TONE: Record<BreakdownTone, string> = {
  primary: 'bg-primary/5 border-primary/20',
  neutral: 'bg-surface-container border-white/[0.06]',
  error: 'bg-error/5 border-error/20',
  warning: 'bg-tertiary-container/5 border-tertiary-container/20',
}

function sourceIcon(type: MetricSource['type']): { icon: string; cls: string } {
  switch (type) {
    case 'survey':   return { icon: 'quiz',        cls: 'text-primary' }
    case 'document': return { icon: 'description', cls: 'text-secondary' }
    case 'prisma':   return { icon: 'database',    cls: 'text-tertiary-container' }
    case 'external': return { icon: 'cloud',       cls: 'text-primary' }
    case 'manual':   return { icon: 'edit',        cls: 'text-on-surface-variant' }
    case 'missing':  return { icon: 'warning',     cls: 'text-error' }
    default:         return { icon: 'help',        cls: 'text-on-surface-variant' }
  }
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">
      {children}
    </p>
  )
}

export function MetricBreakdownModal({
  open,
  onClose,
  title,
  value,
  valueCaption,
  missingReason,
  chips,
  what,
  why,
  how,
  formula,
  sections,
  lists,
  sources,
  history,
  historyEmptyText,
  links,
}: MetricBreakdownModalProps) {
  const hasHistory = Array.isArray(history) && history.length > 0

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          data-testid="metric-breakdown-modal"
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-2xl max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/[0.04] bg-surface-container-low shadow-2xl focus:outline-none"
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/[0.04] bg-surface-container-low/95 px-6 py-4 backdrop-blur-sm">
            <Dialog.Title className="font-headline text-lg font-bold text-on-surface min-w-0 flex-1">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Закрыть разбор"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-white/[0.04] hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-lg">close</span>
              </button>
            </Dialog.Close>
          </div>

          <Dialog.Description className="sr-only">
            Разбор показателя: значение, источник, формула и история.
          </Dialog.Description>

          <div className="space-y-5 px-6 py-5">
            {/* Value */}
            <section className="rounded-xl border border-white/[0.06] bg-surface-container px-4 py-3">
              <p className="mb-1 text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/70">
                {valueCaption ?? 'Значение'}
              </p>
              {value !== null ? (
                <p className="font-mono text-2xl font-bold text-on-surface break-words">{value}</p>
              ) : (
                <>
                  <p className="font-mono text-2xl font-bold text-on-surface-variant/60">—</p>
                  <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                    {missingReason ?? 'Значение ещё не рассчитано — не хватает исходных данных.'}
                  </p>
                </>
              )}
            </section>

            {chips && chips.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {chips.map((chip, i) => (
                  <span
                    key={`${chip.label}-${i}`}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider ${CHIP_TONE[chip.tone ?? 'neutral']}`}
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
            )}

            {what && (
              <section>
                <Heading>Что это</Heading>
                <p className="text-sm leading-relaxed text-on-surface">{what}</p>
              </section>
            )}
            {why && (
              <section>
                <Heading>Зачем</Heading>
                <p className="text-sm leading-relaxed text-on-surface-variant">{why}</p>
              </section>
            )}
            {how && (
              <section>
                <Heading>Как считается</Heading>
                <p className="text-sm leading-relaxed text-on-surface-variant">{how}</p>
              </section>
            )}
            {formula && (
              <section>
                <Heading>Формула</Heading>
                <pre className="whitespace-pre-wrap break-words rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 font-mono text-xs text-primary">
                  {formula}
                </pre>
              </section>
            )}

            {sections?.map((sec, i) => (
              <section
                key={`${sec.title}-${i}`}
                className={`rounded-xl border px-4 py-3 ${SECTION_TONE[sec.tone ?? 'neutral']}`}
              >
                <Heading>{sec.title}</Heading>
                <p className="text-sm leading-relaxed text-on-surface">{sec.body}</p>
              </section>
            ))}

            {lists?.map((list, li) => (
              <section key={`${list.title}-${li}`}>
                <Heading>{list.title}</Heading>
                {list.rows.length > 0 ? (
                  <ul className="space-y-1.5">
                    {list.rows.map((row, i) => (
                      <li
                        key={`${row.label}-${i}`}
                        className="flex items-baseline justify-between gap-3 rounded-lg border border-white/[0.04] bg-surface-container px-3 py-2"
                      >
                        <span className="min-w-0 text-xs text-on-surface-variant">{row.label}</span>
                        <span className="flex-shrink-0 font-mono text-sm text-on-surface">{row.value}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed border-white/[0.08] px-3 py-2.5 text-xs text-on-surface-variant">
                    {list.emptyText ?? 'Данных нет.'}
                  </p>
                )}
              </section>
            ))}

            {/* History */}
            <section>
              <Heading>История</Heading>
              {hasHistory ? (
                <ul className="space-y-1.5">
                  {history!.map((point, i) => (
                    <li
                      key={`${point.label}-${i}`}
                      className="flex items-baseline justify-between gap-3 rounded-lg border border-white/[0.04] bg-surface-container px-3 py-2"
                    >
                      <span className="text-xs text-on-surface-variant">{point.label}</span>
                      <span className="font-mono text-sm text-on-surface">{point.value}</span>
                      {point.hint && (
                        <span className="text-[10px] font-mono text-on-surface-variant/60">{point.hint}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed border-white/[0.08] px-3 py-2.5 text-xs leading-relaxed text-on-surface-variant">
                  {historyEmptyText ??
                    'История пока пустая — она появится после второго замера этого показателя.'}
                </p>
              )}
            </section>

            {/* Sources */}
            <section>
              <Heading>Источники данных</Heading>
              {sources && sources.length > 0 ? (
                <ul className="space-y-1.5">
                  {sources.map((src, i) => {
                    const ico = sourceIcon(src.type)
                    return (
                      <li
                        key={`${src.type}-${i}`}
                        className="flex items-start gap-2.5 rounded-lg border border-white/[0.04] bg-surface-container px-3 py-2"
                      >
                        <span
                          aria-hidden="true"
                          className={`material-symbols-outlined mt-0.5 flex-shrink-0 text-sm ${ico.cls}`}
                        >
                          {ico.icon}
                        </span>
                        <span className="break-words text-xs leading-relaxed text-on-surface-variant">
                          {formatSource(src)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed border-white/[0.08] px-3 py-2.5 text-xs text-on-surface-variant">
                  Источник для этого показателя ещё не подключён.
                </p>
              )}
            </section>

            {links && links.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-white/[0.04] pt-4">
                {links.map((link) => (
                  <Link
                    key={link.href + link.label}
                    href={link.href}
                    onClick={onClose}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-base">
                      {link.icon ?? 'arrow_forward'}
                    </span>
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default MetricBreakdownModal
