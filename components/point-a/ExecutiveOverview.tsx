'use client'

/**
 * ExecutiveOverview — level 1 of Point A (docs/platform/04-point-a.md §2.2).
 *
 * Only the key items: overall score + maturity, GRI index, diagnostic status
 * with the next step, data completeness + gaps, top problem zones, key risks,
 * critical gaps, strengths, «Обновлено» and the processed-sources breakdown.
 * Everything comes from GET /api/v1/point-a/overview; nothing is synthesised —
 * missing inputs render as honest empty states that say what to do next.
 *
 * Split:
 *   • <ExecutiveOverview/>      — container (React Query + recalc mutation)
 *   • <ExecutiveOverviewView/>  — stateless view (no hooks at the top level),
 *                                 unit-tested by calling it as a function.
 */

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { ProvenanceBadge } from '@/components/common/ProvenanceBadge'
import {
  usePointAOverview,
  useRecalculateDiagnostics,
  type PointAOverviewResult,
} from '@/hooks/usePointAOverview'
import type {
  OverviewFinding,
  OverviewProblemZone,
  OverviewSourceCounts,
  PointAOverview,
} from '@/types/point-a-overview'
import {
  COMPLETENESS_LABEL,
  SCORE_TONE_COLOR,
  completenessPct,
  formatExactRu,
  formatRelativeRuLong,
  gapAction,
  overviewViewState,
  pluralSources,
  scoreTone,
  severityMeta,
  sourceRows,
  statusMeta,
  zoneMeta,
  type OverviewViewState,
} from './executive-overview-model'

// ─── Shared bits ────────────────────────────────────────────────────────────

const CARD = 'rounded-2xl border border-white/[0.04] bg-surface-container p-4 sm:p-5'
const EYEBROW = 'text-xs font-mono text-primary/70 uppercase tracking-[0.2em]'
const CARD_TITLE = 'text-[11px] font-mono text-on-surface-variant uppercase tracking-[0.18em]'
const BTN_PRIMARY =
  'inline-flex items-center gap-1.5 rounded-xl bg-primary text-on-primary text-xs font-semibold px-3.5 py-2 transition-colors hover:bg-primary/90 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary/40'
const BTN_GHOST =
  'inline-flex items-center gap-1.5 rounded-xl border border-white/10 text-on-surface-variant text-xs font-medium px-3.5 py-2 transition-colors hover:text-on-surface hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-primary/40'

function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('material-symbols-outlined', className)} aria-hidden="true">
      {name}
    </span>
  )
}

// ─── Score gauge ────────────────────────────────────────────────────────────

export function ScoreGauge({ score, size = 128 }: { score: number | null; size?: number }) {
  const tone = scoreTone(score)
  const color = SCORE_TONE_COLOR[tone]
  const r = size / 2 - 10
  const circ = 2 * Math.PI * r
  const arc = circ * 0.75
  const value = score === null ? 0 : Math.max(0, Math.min(100, score))
  const dash = (value / 100) * arc
  const offset = circ * 0.125
  return (
    <div
      className="relative flex-shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={score === null ? 'Общий балл ещё не рассчитан' : `Общий балл ${Math.round(value)} из 100`}
    >
      <svg width={size} height={size} className="rotate-[135deg]" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={9}
          strokeDasharray={`${arc} ${circ - arc}`}
          strokeDashoffset={-offset}
          strokeLinecap="round"
        />
        {score !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={9}
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={-offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.8s ease' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
        <span className="font-mono text-4xl font-bold text-on-surface leading-none">
          {score === null ? '—' : Math.round(value)}
        </span>
        <span className="mt-1 font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">из 100</span>
      </div>
    </div>
  )
}

// ─── Status badge + CTA ─────────────────────────────────────────────────────

export function DiagnosticStatusBadge({ status }: { status: PointAOverview['status'] }) {
  const meta = statusMeta(status)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.12em]',
        meta.badge,
      )}
      data-status={status}
    >
      <span className="sr-only">Статус диагностики: </span>
      <Icon name={meta.icon} className={cn('text-[14px]', status === 'processing' && 'animate-spin')} />
      {meta.label}
    </span>
  )
}

export interface RecalcControl {
  run: () => void
  pending: boolean
  error: string | null
}

function StatusCta({ overview, recalc }: { overview: PointAOverview; recalc: RecalcControl }) {
  const meta = statusMeta(overview.status)
  const cta = meta.cta
  const showReadyCta = overview.status !== 'ready' || overview.completenessLevel !== 'high'
  return (
    <>
      {cta.kind === 'recalculate' && (
        <button
          type="button"
          onClick={recalc.run}
          disabled={recalc.pending}
          className={BTN_PRIMARY}
          aria-busy={recalc.pending}
        >
          <Icon name={recalc.pending ? 'progress_activity' : cta.icon} className={cn('text-[16px]', recalc.pending && 'animate-spin')} />
          {recalc.pending ? 'Считаем…' : cta.label}
        </button>
      )}
      {overview.status === 'collecting' && (
        <Link href="/client/onboarding" className={BTN_GHOST}>
          <Icon name="edit_note" className="text-[16px]" />
          Продолжить анкету
        </Link>
      )}
      {cta.kind === 'link' && cta.href && showReadyCta && (
        <Link href={cta.href} className={overview.status === 'ready' ? BTN_GHOST : BTN_PRIMARY}>
          <Icon name={cta.icon} className="text-[16px]" />
          {cta.label}
        </Link>
      )}
    </>
  )
}

// ─── Sources popover ────────────────────────────────────────────────────────

export function SourcesPopover({ sources }: { sources: OverviewSourceCounts }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const rows = sourceRows(sources)

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1 rounded-lg px-1 -mx-1 text-on-surface-variant hover:text-on-surface underline decoration-dotted decoration-white/30 underline-offset-4 focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        Источников обработано:{' '}
        <span className="font-mono font-semibold text-on-surface">{sources.processedSources}</span>
        <Icon name={open ? 'expand_less' : 'expand_more'} className="text-[14px]" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            role="dialog"
            aria-label="Источники данных Точки А"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-full z-40 mt-2 w-[min(21rem,calc(100vw-2.5rem))] rounded-2xl border border-white/10 bg-surface-container-high p-4 shadow-modal"
          >
            <p className={cn(EYEBROW, 'mb-3')}>Источники данных</p>
            <ul className="space-y-2.5">
              {rows.map((row) => (
                <li key={row.key} className="flex items-start gap-2.5">
                  <Icon
                    name={row.icon}
                    className={cn('text-[18px] mt-0.5', row.active ? 'text-primary' : 'text-on-surface-variant/50')}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-on-surface">{row.label}</span>
                      <span className={cn('text-xs font-mono text-right', row.active ? 'text-on-surface' : 'text-on-surface-variant')}>
                        {row.value}
                      </span>
                    </div>
                    {row.detail && <p className="mt-0.5 text-[11px] font-mono text-tertiary-container">{row.detail}</p>}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-white/[0.06] pt-2 text-[11px] text-on-surface-variant">
              Учтено {sources.processedSources} {pluralSources(sources.processedSources)} данных из 5 возможных.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Cards ──────────────────────────────────────────────────────────────────

function ScoreCard({ overview }: { overview: PointAOverview }) {
  return (
    <div className={cn(CARD, 'flex flex-col gap-4 sm:flex-row sm:items-center lg:flex-col lg:items-start xl:flex-row xl:items-center')}>
      <ScoreGauge score={overview.overallScore} />
      <div className="min-w-0 space-y-2">
        <p className={CARD_TITLE}>Общий балл Точки А</p>
        {overview.overallScore === null ? (
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Балл появится после первого расчёта диагностики.
          </p>
        ) : (
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Оценка по пяти блокам: финансы, продажи, операции, маркетинг, стратегия.
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {overview.maturity && (
            <span className="inline-flex items-center gap-1 rounded-xl border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
              <Icon name="stairs" className="text-[14px]" />
              Стадия: {overview.maturity.label}
            </span>
          )}
          {overview.griIndex !== null && (
            <Link
              href="/gri"
              className="inline-flex items-center gap-1 rounded-xl border border-secondary/25 bg-secondary/10 px-2.5 py-1 text-[11px] font-mono text-secondary hover:border-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
              aria-label={`Индекс GRI ${overview.griIndex.toFixed(1)} из 10 — открыть GRI`}
            >
              <Icon name="radar" className="text-[14px]" />
              GRI {overview.griIndex.toFixed(1)} / 10
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

function CompletenessCard({ overview }: { overview: PointAOverview }) {
  const pct = completenessPct(overview.completeness)
  const level = overview.completenessLevel
  const bar = level === 'high' ? 'bg-primary' : level === 'medium' ? 'bg-tertiary-container' : 'bg-error'
  const gaps = overview.dataGaps.slice(0, 5)
  return (
    <div className={CARD}>
      <div className="flex items-baseline justify-between gap-2">
        <p className={CARD_TITLE}>Полнота данных</p>
        <p className="font-mono text-sm text-on-surface">
          {pct}% <span className="text-xs text-on-surface-variant">· {COMPLETENESS_LABEL[level] ?? '—'}</span>
        </p>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-container-high"
        role="progressbar"
        aria-label="Полнота данных"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className={cn('h-full rounded-full transition-all duration-700', bar)} style={{ width: `${pct}%` }} />
      </div>
      {gaps.length === 0 ? (
        <p className="mt-4 text-xs text-on-surface-variant">Данных достаточно для уверенного расчёта.</p>
      ) : (
        <>
          <p className="mt-4 mb-2 text-xs text-on-surface-variant">Что добавить, чтобы повысить точность:</p>
          <ul className="space-y-1.5">
            {gaps.map((gap, i) => {
              const action = gapAction(gap)
              return (
                <li key={`${i}-${gap}`}>
                  <Link
                    href={action.href}
                    className="group flex items-start gap-2 rounded-xl px-2 py-1.5 -mx-2 hover:bg-white/[0.03] focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <Icon name={action.icon} className="mt-0.5 text-[16px] text-primary/80" />
                    <span className="flex-1 text-xs leading-relaxed text-on-surface">{gap}</span>
                    <span className="flex-shrink-0 font-mono text-[10px] uppercase tracking-wider text-primary/70 group-hover:text-primary">
                      {action.label}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

function ProblemZonesCard({ zones }: { zones: OverviewProblemZone[] }) {
  const list = zones.slice(0, 5)
  return (
    <div className={CARD}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className={CARD_TITLE}>Проблемные зоны</p>
        <Link href="/metrics" className="font-mono text-[10px] uppercase tracking-wider text-primary/70 hover:text-primary">
          Все метрики
        </Link>
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-on-surface-variant">Проблемных зон не выявлено.</p>
      ) : (
        <ul className="space-y-3">
          {list.map((z) => {
            const meta = zoneMeta(z.status)
            const width = z.score === null ? 0 : Math.max(0, Math.min(100, z.score))
            return (
              <li key={z.area} data-zone-status={z.status}>
                <div className="flex items-center gap-2">
                  <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', meta.dot)} aria-hidden="true" />
                  <span className="flex-1 truncate text-sm text-on-surface">{z.label}</span>
                  <span className={cn('font-mono text-xs', meta.text)}>
                    {z.score === null ? meta.label : `${Math.round(z.score)}/100`}
                  </span>
                </div>
                <div className="mt-1.5 ml-4 h-1 overflow-hidden rounded-full bg-surface-container-high" aria-hidden="true">
                  <div className={cn('h-full rounded-full', meta.bar)} style={{ width: `${width}%` }} />
                </div>
                {z.topIssue && <p className="mt-1 ml-4 line-clamp-2 text-[11px] leading-snug text-on-surface-variant">{z.topIssue}</p>}
                <span className="sr-only">Статус: {meta.label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function FindingRow({ f, showSeverity }: { f: OverviewFinding; showSeverity: boolean }) {
  const sev = severityMeta(f.severity)
  return (
    <li className="rounded-xl border border-white/[0.04] bg-surface-container-low p-3" data-severity={f.severity}>
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {showSeverity && (
          <span className={cn('rounded-md border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]', sev.chip)}>
            {sev.label}
          </span>
        )}
        <ProvenanceBadge type={f.provenanceType} confidence={f.confidence} source={f.source} />
      </div>
      <p className="text-sm font-medium leading-snug text-on-surface">{f.title}</p>
      {f.body && <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-on-surface-variant">{f.body}</p>}
    </li>
  )
}

function FindingsCard({
  title,
  icon,
  iconClass,
  items,
  max,
  empty,
  showSeverity = true,
}: {
  title: string
  icon: string
  iconClass: string
  items: OverviewFinding[]
  max: number
  empty: string
  showSeverity?: boolean
}) {
  const list = items.slice(0, max)
  const headingId = `po-findings-${icon}`
  return (
    <section className={CARD} aria-labelledby={headingId}>
      <div className="mb-3 flex items-center gap-2">
        <Icon name={icon} className={cn('text-[18px]', iconClass)} />
        <h3 id={headingId} className="text-sm font-semibold text-on-surface">
          {title}
        </h3>
        <span className="ml-auto font-mono text-[11px] text-on-surface-variant">{list.length}</span>
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-on-surface-variant">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((f) => (
            <FindingRow key={f.id} f={f} showSeverity={showSeverity} />
          ))}
        </ul>
      )}
    </section>
  )
}

// ─── States ─────────────────────────────────────────────────────────────────

export function ExecutiveOverviewSkeleton() {
  return (
    <section
      aria-busy="true"
      aria-label="Загружаем обзор Точки А"
      data-state="loading"
      className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-5 sm:p-6 shadow-card"
    >
      <span className="sr-only">Загружаем обзор Точки А…</span>
      <div className="animate-pulse space-y-5" aria-hidden="true">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="h-3 w-40 rounded bg-white/[0.06]" />
            <div className="h-6 w-64 rounded bg-white/[0.08]" />
            <div className="h-3 w-52 rounded bg-white/[0.05]" />
          </div>
          <div className="h-8 w-36 rounded-xl bg-white/[0.06]" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-44 rounded-2xl bg-white/[0.03]" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-white/[0.03]" />
          ))}
        </div>
      </div>
    </section>
  )
}

function StateShell({
  state,
  icon,
  title,
  description,
  children,
  tone = 'neutral',
}: {
  state: OverviewViewState
  icon: string
  title: string
  description: string
  children?: React.ReactNode
  tone?: 'neutral' | 'error'
}) {
  return (
    <section
      data-state={state}
      role={tone === 'error' ? 'alert' : undefined}
      aria-label={title}
      className={cn(
        'rounded-2xl border p-6 sm:p-8 shadow-card',
        tone === 'error' ? 'border-error/30 bg-error/[0.04]' : 'border-white/[0.06] bg-surface-container-low',
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div
          className={cn(
            'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl',
            tone === 'error' ? 'bg-error/10' : 'bg-primary/10',
          )}
        >
          <Icon name={icon} className={cn('text-2xl', tone === 'error' ? 'text-error' : 'text-primary')} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn(EYEBROW, 'mb-1')}>Точка А · Обзор</p>
          <h2 className="font-headline text-xl font-bold text-on-surface">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-on-surface-variant">{description}</p>
          {children && <div className="mt-4">{children}</div>}
        </div>
      </div>
    </section>
  )
}

function NotStartedChecklist({ sources }: { sources: OverviewSourceCounts }) {
  const steps = [
    {
      key: 'survey',
      done: sources.surveyStepsCompleted > 0,
      title: 'Анкета компании',
      value: `${sources.surveyStepsCompleted} из ${sources.surveyStepsTotal} шагов`,
      href: '/client/onboarding',
      cta: 'Пройти анкету',
    },
    {
      key: 'documents',
      done: sources.documentsTotal > 0,
      title: 'Документы (P&L, выгрузка CRM)',
      value: sources.documentsTotal > 0 ? `загружено ${sources.documentsTotal}` : 'не загружены',
      href: '/client/onboarding/documents',
      cta: 'Загрузить',
    },
    {
      key: 'gri',
      done: sources.griAssessments > 0,
      title: 'GRI-оценка готовности к росту',
      value: sources.griAssessments > 0 ? 'пройдена' : 'не пройдена',
      href: '/gri',
      cta: 'Пройти GRI',
    },
  ]
  return (
    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {steps.map((s, i) => (
        <li key={s.key} className="rounded-xl border border-white/[0.04] bg-surface-container p-3">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px]',
                s.done ? 'bg-primary/15 text-primary' : 'bg-surface-container-high text-on-surface-variant',
              )}
              aria-hidden="true"
            >
              {s.done ? <Icon name="check" className="text-[14px]" /> : i + 1}
            </span>
            <span className="text-xs font-medium text-on-surface">{s.title}</span>
          </div>
          <p className="mt-1.5 ml-8 font-mono text-[11px] text-on-surface-variant">{s.value}</p>
          <Link
            href={s.href}
            className="mt-2 ml-8 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-primary/80 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
          >
            {s.cta}
            <Icon name="arrow_forward" className="text-[12px]" />
          </Link>
        </li>
      ))}
    </ol>
  )
}

// ─── View ───────────────────────────────────────────────────────────────────

export interface ExecutiveOverviewViewProps {
  state: OverviewViewState
  overview?: PointAOverview | null
  errorMessage?: string | null
  onRetry?: () => void
  recalc: RecalcControl
  signInHref?: string
  /** Inject «now» for deterministic tests. */
  now?: Date
}

export function ExecutiveOverviewView({
  state,
  overview,
  errorMessage,
  onRetry,
  recalc,
  signInHref = '/login',
  now,
}: ExecutiveOverviewViewProps) {
  if (state === 'loading') return <ExecutiveOverviewSkeleton />

  if (state === 'error') {
    return (
      <StateShell
        state="error"
        tone="error"
        icon="error"
        title="Не удалось загрузить обзор Точки А"
        description={errorMessage ?? 'Проверьте соединение и попробуйте ещё раз.'}
      >
        {onRetry && (
          <button type="button" onClick={onRetry} className={BTN_GHOST}>
            <Icon name="refresh" className="text-[16px]" />
            Повторить
          </button>
        )}
      </StateShell>
    )
  }

  if (state === 'unauthorized') {
    return (
      <StateShell
        state="unauthorized"
        icon="login"
        title="Войдите, чтобы увидеть Точку А"
        description="Обзор строится по данным вашей компании и доступен только после входа в кабинет."
      >
        <Link href={signInHref} className={BTN_PRIMARY}>
          <Icon name="login" className="text-[16px]" />
          Войти
        </Link>
      </StateShell>
    )
  }

  if (state === 'no_company') {
    return (
      <StateShell
        state="no_company"
        icon="domain_add"
        title="Профиль компании ещё не создан"
        description="Точка А строится по данным вашей компании. Первый шаг анкеты создаёт профиль — это займёт пару минут."
      >
        <Link href="/client/onboarding" className={BTN_PRIMARY}>
          <Icon name="play_arrow" className="text-[16px]" />
          Пройти анкету
        </Link>
      </StateShell>
    )
  }

  if (!overview) return <ExecutiveOverviewSkeleton />

  if (state === 'not_started') {
    return (
      <StateShell
        state="not_started"
        icon="flag"
        title="Диагностика ещё не начата"
        description="Ответьте на вопросы анкеты — по ним считается общий балл, стадия зрелости и проблемные зоны. Документы и GRI повышают точность."
      >
        <NotStartedChecklist sources={overview.sources} />
        <div className="mt-4">
          <Link href="/client/onboarding" className={BTN_PRIMARY}>
            <Icon name="play_arrow" className="text-[16px]" />
            Пройти анкету
          </Link>
        </div>
      </StateShell>
    )
  }

  // ── ready (any calculated / in-progress status) ──
  const meta = statusMeta(overview.status)
  const relative = formatRelativeRuLong(overview.calculatedAt, now)
  const exact = formatExactRu(overview.calculatedAt)
  const showHint = overview.status !== 'ready'

  return (
    <motion.section
      aria-labelledby="po-exec-title"
      data-state="ready"
      data-status={overview.status}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="relative rounded-2xl border border-white/[0.06] bg-surface-container-low p-5 sm:p-6 shadow-card"
    >
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className={cn(EYEBROW, 'mb-2')}>Точка А · Главное</p>
          <h2 id="po-exec-title" className="font-headline text-xl font-bold text-on-surface sm:text-2xl">
            Состояние бизнеса{overview.companyName ? ` · ${overview.companyName}` : ''}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
            {overview.calculatedAt ? (
              <span title={exact}>
                Обновлено:{' '}
                <time dateTime={overview.calculatedAt} className="text-on-surface">
                  {relative}
                </time>
                <span className="text-on-surface-variant/70"> · {exact}</span>
              </span>
            ) : (
              <span>Ещё не рассчитывалась</span>
            )}
            <span aria-hidden="true" className="text-on-surface-variant/40">
              ·
            </span>
            <SourcesPopover sources={overview.sources} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DiagnosticStatusBadge status={overview.status} />
          <StatusCta overview={overview} recalc={recalc} />
        </div>
      </div>

      {(showHint || recalc.error) && (
        <div className="mt-3 space-y-1">
          {showHint && (
            <p className="text-xs text-on-surface-variant" role="status">
              {meta.hint}
            </p>
          )}
          {recalc.error && (
            <p className="text-xs text-error" role="alert">
              {recalc.error}
            </p>
          )}
        </div>
      )}

      {/* Row 1 — score · completeness · zones */}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ScoreCard overview={overview} />
        <CompletenessCard overview={overview} />
        <ProblemZonesCard zones={overview.problemZones} />
      </div>

      {/* Row 2 — risks · critical gaps · strengths */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <FindingsCard
          title="Ключевые риски"
          icon="warning"
          iconClass="text-error"
          items={overview.keyRisks}
          max={5}
          empty="Существенных рисков по текущим данным не найдено."
        />
        <FindingsCard
          title="Критические пробелы"
          icon="report"
          iconClass="text-tertiary-container"
          items={overview.criticalGaps}
          max={3}
          empty="Критических пробелов не найдено."
        />
        <FindingsCard
          title="Сильные стороны"
          icon="trending_up"
          iconClass="text-primary"
          items={overview.strengths}
          max={3}
          showSeverity={false}
          empty="Сильные стороны появятся, когда по метрикам будет с чем сравнить."
        />
      </div>
    </motion.section>
  )
}

// ─── Container ──────────────────────────────────────────────────────────────

export interface ExecutiveOverviewProps {
  /** Supabase user id — enables realtime refresh. */
  userId?: string | null
  /** Called after a successful «Пересчитать» (e.g. reload page-level data). */
  onRecalculated?: () => void
  className?: string
}

export default function ExecutiveOverview({ userId = null, onRecalculated, className }: ExecutiveOverviewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const query = usePointAOverview({ userId })
  const recalc = useRecalculateDiagnostics(() => {
    router.refresh()
    onRecalculated?.()
  })

  const result: PointAOverviewResult | undefined = query.data
  const state = overviewViewState({ isLoading: query.isLoading, isError: query.isError, result })
  const overview = result?.kind === 'ready' ? result.data : null

  return (
    <div className={className} id="executive-overview">
      <ExecutiveOverviewView
        state={state}
        overview={overview}
        errorMessage={query.error instanceof Error ? query.error.message : null}
        onRetry={() => void query.refetch()}
        recalc={{
          run: () => recalc.mutate(),
          pending: recalc.isPending,
          error: recalc.error instanceof Error ? recalc.error.message : null,
        }}
        signInHref={`/login?from=${encodeURIComponent(pathname || '/point-a')}`}
      />
    </div>
  )
}
