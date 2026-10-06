// Pure helpers for <ExecutiveOverview /> — no JSX, no React, so they are
// unit-testable in the node vitest environment and reusable elsewhere.

import type {
  DiagnosticStatus,
  FindingSeverity,
  OverviewProblemZone,
  OverviewSourceCounts,
  PointAOverview,
} from '@/types/point-a-overview'

// ─── Diagnostic status ──────────────────────────────────────────────────────

export type StatusCtaKind = 'link' | 'recalculate' | 'none'

export interface StatusMeta {
  label: string
  hint: string
  icon: string
  /** Tailwind classes for the badge (text + border + bg). */
  badge: string
  cta: { kind: StatusCtaKind; label: string; href?: string; icon: string }
}

export const DIAGNOSTIC_STATUS_META: Record<DiagnosticStatus, StatusMeta> = {
  not_started: {
    label: 'Не начата',
    hint: 'Ответов анкеты пока нет — с неё начинается Точка А.',
    icon: 'radio_button_unchecked',
    badge: 'text-on-surface-variant border-white/10 bg-surface-container-high',
    cta: { kind: 'link', label: 'Пройти анкету', href: '/client/onboarding', icon: 'play_arrow' },
  },
  collecting: {
    label: 'Сбор данных',
    hint: 'Анкета заполняется. Рассчитайте Точку А, когда ответите на ключевые шаги.',
    icon: 'edit_note',
    badge: 'text-tertiary-container border-tertiary-container/30 bg-tertiary-container/10',
    cta: { kind: 'recalculate', label: 'Рассчитать Точку А', icon: 'calculate' },
  },
  processing: {
    label: 'Обработка',
    hint: 'Идёт расчёт или разбор документов — обзор обновится автоматически.',
    icon: 'progress_activity',
    badge: 'text-secondary border-secondary/30 bg-secondary/10',
    cta: { kind: 'none', label: '', icon: '' },
  },
  ready: {
    label: 'Актуальна',
    hint: 'Диагностика рассчитана по последним данным.',
    icon: 'check_circle',
    badge: 'text-primary border-primary/30 bg-primary/10',
    cta: { kind: 'link', label: 'Загрузить документы', href: '/client/onboarding/documents', icon: 'upload_file' },
  },
  stale: {
    label: 'Устарела',
    hint: 'После последнего расчёта появились новые данные.',
    icon: 'update',
    badge: 'text-tertiary-container border-tertiary-container/30 bg-tertiary-container/10',
    cta: { kind: 'recalculate', label: 'Пересчитать', icon: 'refresh' },
  },
}

export function statusMeta(status: DiagnosticStatus | string | null | undefined): StatusMeta {
  return (DIAGNOSTIC_STATUS_META as Record<string, StatusMeta>)[status ?? ''] ?? DIAGNOSTIC_STATUS_META.collecting
}

// ─── Severity ───────────────────────────────────────────────────────────────

export const SEVERITY_META: Record<FindingSeverity, { label: string; chip: string; rank: number }> = {
  critical: { label: 'Критично', chip: 'text-error border-error/40 bg-error/10', rank: 0 },
  high: { label: 'Высокий', chip: 'text-error border-error/25 bg-error/[0.06]', rank: 1 },
  medium: { label: 'Средний', chip: 'text-tertiary-container border-tertiary-container/30 bg-tertiary-container/10', rank: 2 },
  low: { label: 'Низкий', chip: 'text-secondary border-secondary/25 bg-secondary/10', rank: 3 },
  info: { label: 'Инфо', chip: 'text-on-surface-variant border-white/10 bg-surface-container-high', rank: 4 },
}

export function severityMeta(sev: FindingSeverity | string | null | undefined) {
  return (SEVERITY_META as Record<string, (typeof SEVERITY_META)[FindingSeverity]>)[sev ?? ''] ?? SEVERITY_META.info
}

// ─── Problem zones ──────────────────────────────────────────────────────────

export const ZONE_STATUS_META: Record<
  OverviewProblemZone['status'],
  { label: string; text: string; bar: string; dot: string; border: string }
> = {
  critical: { label: 'Критично', text: 'text-error', bar: 'bg-error', dot: 'bg-error', border: 'border-error/25' },
  weak: { label: 'Слабо', text: 'text-tertiary-container', bar: 'bg-tertiary-container', dot: 'bg-tertiary-container', border: 'border-tertiary-container/25' },
  medium: { label: 'Средне', text: 'text-tertiary', bar: 'bg-tertiary', dot: 'bg-tertiary', border: 'border-tertiary/20' },
  strong: { label: 'Сильно', text: 'text-primary', bar: 'bg-primary', dot: 'bg-primary', border: 'border-primary/25' },
  unknown: { label: 'Нет данных', text: 'text-on-surface-variant', bar: 'bg-on-surface-variant/40', dot: 'bg-on-surface-variant/40', border: 'border-white/[0.06]' },
}

export function zoneMeta(status: string | null | undefined) {
  return (ZONE_STATUS_META as Record<string, (typeof ZONE_STATUS_META)['unknown']>)[status ?? ''] ?? ZONE_STATUS_META.unknown
}

// ─── Score / completeness ───────────────────────────────────────────────────

/** Colour tone of the 0–100 overall score gauge. */
export function scoreTone(score: number | null | undefined): 'good' | 'mid' | 'bad' | 'none' {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'none'
  if (score >= 70) return 'good'
  if (score >= 45) return 'mid'
  return 'bad'
}

export const SCORE_TONE_COLOR: Record<ReturnType<typeof scoreTone>, string> = {
  good: '#6effc0',
  mid: '#ffbd60',
  bad: '#ffb4ab',
  none: 'rgba(255,255,255,0.12)',
}

export const COMPLETENESS_LABEL: Record<PointAOverview['completenessLevel'], string> = {
  low: 'Низкая',
  medium: 'Средняя',
  high: 'Высокая',
}

export function completenessPct(completeness: number | null | undefined): number {
  if (completeness === null || completeness === undefined || !Number.isFinite(completeness)) return 0
  return Math.round(Math.max(0, Math.min(1, completeness)) * 100)
}

// ─── Data gaps → action ─────────────────────────────────────────────────────

export interface GapAction {
  href: string
  label: string
  icon: string
}

/**
 * Data gaps arrive as Russian sentences («Загрузите отчёт P&L за 2025»).
 * Pick the screen where the user can close the gap. Falls back to the survey.
 */
export function gapAction(text: string): GapAction {
  const t = text.toLowerCase()
  if (/gri|готовност/.test(t)) return { href: '/gri', label: 'Пройти GRI', icon: 'radar' }
  if (/crm|интеграц|amo|битрикс|bitrix|1с|1c/.test(t)) return { href: '/pulse', label: 'Подключить', icon: 'hub' }
  if (/документ|p&l|отч[её]т|файл|баланс|выписк|выгрузк|загруз/.test(t)) {
    return { href: '/client/onboarding/documents', label: 'Загрузить', icon: 'upload_file' }
  }
  if (/метрик|показател/.test(t)) return { href: '/metrics', label: 'Открыть', icon: 'bar_chart' }
  return { href: '/client/onboarding', label: 'Заполнить', icon: 'edit_note' }
}

// ─── Sources breakdown ──────────────────────────────────────────────────────

export interface SourceRow {
  key: string
  icon: string
  label: string
  value: string
  /** true when this source contributed at least one input. */
  active: boolean
  detail?: string
}

export function sourceRows(s: OverviewSourceCounts): SourceRow[] {
  const docDetail: string[] = []
  if (s.documentsPending > 0) docDetail.push(`в обработке ${s.documentsPending}`)
  if (s.documentsFailed > 0) docDetail.push(`с ошибкой ${s.documentsFailed}`)
  return [
    {
      key: 'survey',
      icon: 'quiz',
      label: 'Анкета',
      value: `${s.surveyStepsCompleted} из ${s.surveyStepsTotal} шагов`,
      active: s.surveyStepsCompleted > 0,
    },
    {
      key: 'documents',
      icon: 'description',
      label: 'Документы',
      value: s.documentsTotal > 0 ? `${s.documentsProcessed} из ${s.documentsTotal} обработано` : 'не загружены',
      active: s.documentsProcessed > 0,
      detail: docDetail.length ? docDetail.join(' · ') : undefined,
    },
    {
      key: 'gri',
      icon: 'radar',
      label: 'GRI-оценка',
      value: s.griAssessments > 0 ? (s.griAssessments === 1 ? 'пройдена' : `пройдена (${s.griAssessments})`) : 'не пройдена',
      active: s.griAssessments > 0,
    },
    {
      key: 'integrations',
      icon: 'hub',
      label: 'Интеграции',
      value: s.integrationsConnected > 0 ? `подключено: ${s.integrationsConnected}` : 'не подключены',
      active: s.integrationsConnected > 0,
    },
    {
      key: 'metrics',
      icon: 'bar_chart',
      label: 'Метрики со значением',
      value: `${s.metricsWithValue} из ${s.metricsTotal}`,
      active: s.metricsWithValue > 0,
    },
  ]
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const RU_DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** «6 октября 2026 г., 14:20» — empty string for invalid input. */
export function formatExactRu(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return RU_DATE_TIME.format(d)
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

/** «только что» / «12 минут назад» / «вчера» / «5 дней назад» / «3 месяца назад». */
export function formatRelativeRuLong(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, now.getTime() - t)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ${plural(hr, 'час', 'часа', 'часов')} назад`
  const days = Math.floor(hr / 24)
  if (days === 1) return 'вчера'
  if (days < 30) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} ${plural(months, 'месяц', 'месяца', 'месяцев')} назад`
  const years = Math.floor(days / 365)
  return `${years} ${plural(years, 'год', 'года', 'лет')} назад`
}

export function pluralSources(n: number): string {
  return plural(n, 'источник', 'источника', 'источников')
}

// ─── Overall view state ─────────────────────────────────────────────────────

export type OverviewViewState =
  | 'loading'
  | 'error'
  | 'unauthorized'
  | 'no_company'
  | 'not_started'
  | 'ready'

/**
 * Which top-level layout to render. `not_started` collapses to an onboarding
 * empty state; every other diagnostic status renders the full overview (with
 * the status badge + CTA explaining what to do next).
 */
export function overviewViewState(input: {
  isLoading: boolean
  isError: boolean
  result: { kind: 'ready'; data: PointAOverview } | { kind: 'no_company' } | { kind: 'unauthorized' } | undefined
}): OverviewViewState {
  if (input.isLoading && !input.result) return 'loading'
  if (input.isError && !input.result) return 'error'
  const r = input.result
  if (!r) return 'loading'
  if (r.kind === 'unauthorized') return 'unauthorized'
  if (r.kind === 'no_company') return 'no_company'
  if (r.data.status === 'not_started' && r.data.overallScore === null) return 'not_started'
  return 'ready'
}
