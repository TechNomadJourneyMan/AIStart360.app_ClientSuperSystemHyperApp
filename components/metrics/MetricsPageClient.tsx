'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
// formatSource + types come from the light ./format module; the heavy
// descriptions catalog (getGriDescription) is imported dynamically on demand
// to keep it out of the /metrics first-load bundle.
import { type MetricSource } from '@/lib/metrics/format'
import MetricsLiveCatalog from '@/components/metrics/MetricsLiveCatalog'
import MetricsCoveragePanel from '@/components/metrics/MetricsCoveragePanel'
import MetricBreakdownModal, {
  type MetricBreakdownModalProps,
} from '@/components/metrics/MetricBreakdownModal'
import { useFullMetricCatalog } from '@/components/metrics/useFullMetricCatalog'
import {
  DEFAULT_CATALOG_FILTERS,
  USABLE_SORT_MODES,
  formatUpdatedRu,
  type CatalogFilters,
  type CatalogView,
  type DataFilter,
  type Namespace,
  type SortMode,
} from '@/components/metrics/_utils'
import { formatRuMetricWithUnit } from '@/components/dashboard/_utils'
import { useRealtimeSync, type RealtimeSyncBinding } from '@/hooks/useRealtimeSync'
import { GRI_SECTIONS, type SectionId } from '@/lib/gri-assessment/sections'
import type { GriAssessmentRow, CompanyRow } from '@/lib/metrics/page-data'

// ─── Section meta (icon + ru label) ───────────────────────────────────────────
const SECTION_META: Record<SectionId, { label: string; icon: string }> = {
  'product-demand':    { label: 'Продукт и спрос',       icon: 'inventory_2'     },
  'trust-positioning': { label: 'Доверие и позиция',     icon: 'verified'        },
  'business-model':    { label: 'Бизнес-модель',         icon: 'account_tree'    },
  'cash-stability':    { label: 'Стабильность кассы',    icon: 'account_balance' },
  'operations':        { label: 'Операции',              icon: 'settings'        },
  'team':              { label: 'Команда',               icon: 'group'           },
  'owner-readiness':   { label: 'Готовность основателя', icon: 'person'          },
}

type GriStatus = 'critical' | 'weak' | 'ok'

function griTone(score: number): {
  status: GriStatus
  bar: string
  text: string
  badge: string
  bg: string
} {
  if (score >= 7) {
    return {
      status: 'ok',
      bar:   'bg-primary',
      text:  'text-primary',
      badge: 'bg-primary/10 border-primary/20 text-primary',
      bg:    'bg-primary/10',
    }
  }
  if (score >= 4) {
    return {
      status: 'weak',
      bar:   'bg-tertiary-container',
      text:  'text-tertiary-container',
      badge: 'bg-tertiary-container/10 border-tertiary-container/20 text-tertiary-container',
      bg:    'bg-tertiary-container/10',
    }
  }
  return {
    status: 'critical',
    bar:   'bg-error',
    text:  'text-error',
    badge: 'bg-error/10 border-error/20 text-error',
    bg:    'bg-error/10',
  }
}

const GRI_STATUS_LABEL: Record<GriStatus, string> = {
  ok: 'Достаточный уровень',
  weak: 'Слабое место',
  critical: 'КРИТИЧЕСКИЙ БЛОК',
}

interface CriterionRow {
  id: string
  text: string
  description: string
  whatToImprove: string
  businessLoss: string
  score: number | null
}

interface SectionRow {
  id: SectionId
  label: string
  icon: string
  score: number
  /** How many criteria of the block actually carry a score. */
  answered: number
  criteriaTotal: number
  criteria: CriterionRow[]
  tone: ReturnType<typeof griTone>
}

interface Top5Row {
  sectionId: SectionId
  block: string
  criterion: CriterionRow
}

function criterionScore(
  assessment: GriAssessmentRow,
  sectionId: SectionId,
  criterionId: string,
): number | null {
  const raw = assessment.scores?.[sectionId]?.[criterionId]
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function deriveSectionRows(assessment: GriAssessmentRow): SectionRow[] {
  const out: SectionRow[] = []
  for (const sec of GRI_SECTIONS) {
    const meta = SECTION_META[sec.id]
    const criteria: CriterionRow[] = sec.criteria.map((c) => ({
      id: c.id,
      text: c.text,
      description: c.description,
      whatToImprove: c.whatToImprove,
      businessLoss: c.businessLoss,
      score: criterionScore(assessment, sec.id, c.id),
    }))
    const answered = criteria.filter((c) => c.score !== null)
    const fromAvgs = assessment.section_avgs?.[sec.id]
    let score = typeof fromAvgs === 'number' ? fromAvgs : 0
    // Fallback mirrors computeSectionAvgs() in app/api/v1/gri/assessment/route.ts:
    // mean of criteria with a score greater than zero.
    if (!score && answered.length) {
      score = answered.reduce((a, c) => a + (c.score ?? 0), 0) / answered.length
    }
    out.push({
      id: sec.id,
      label: meta.label,
      icon: meta.icon,
      score: Number(score.toFixed(2)),
      answered: answered.length,
      criteriaTotal: sec.criteria.length,
      criteria,
      tone: griTone(score),
    })
  }
  return out
}

function deriveTop5(rows: SectionRow[]): Top5Row[] {
  const flat: Top5Row[] = []
  for (const row of rows) {
    for (const crit of row.criteria) {
      if (crit.score === null) continue
      flat.push({ sectionId: row.id, block: row.label, criterion: crit })
    }
  }
  return flat
    .sort((a, b) => (a.criterion.score ?? 0) - (b.criterion.score ?? 0))
    .slice(0, 5)
}

interface Insight {
  severity: 'critical' | 'warning' | 'positive'
  sectionId: SectionId | null
  section: string
  problem: string
  recommendation: string
  loss: string
}

function deriveInsights(rows: SectionRow[]): Insight[] {
  const weak = rows
    .filter((r) => r.score > 0 && r.score < 6)
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)

  if (weak.length === 0) {
    return [
      {
        severity: 'positive',
        sectionId: null,
        section: 'Все блоки',
        problem: 'Сильная база — фокус на масштабирование',
        recommendation:
          'Удерживайте текущий уровень и сосредоточьтесь на росте: премиум-сегменты, новые гео, апселлы.',
        loss: 'Без масштабирования вы оставляете рост на столе.',
      },
    ]
  }

  const insights: Insight[] = []
  for (const row of weak) {
    let lowest: CriterionRow | null = null
    for (const c of row.criteria) {
      if (c.score === null) continue
      if (!lowest || c.score < (lowest.score ?? Number.POSITIVE_INFINITY)) lowest = c
    }
    if (!lowest) continue
    insights.push({
      severity: row.score < 4 ? 'critical' : 'warning',
      sectionId: row.id,
      section: row.label,
      problem: lowest.text,
      recommendation: lowest.whatToImprove,
      loss: lowest.businessLoss,
    })
  }
  return insights
}

// ─── Money formatting ────────────────────────────────────────────────────────
function fmtKzt(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} млрд ₸`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн ₸`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} тыс ₸`
  return `${Math.round(n)} ₸`
}

// ─── KPI cards ───────────────────────────────────────────────────────────────
interface KpiCard {
  id: string
  label: string
  target: string
  icon: string
  category: string
  method: string
  owner: string
  /** Human-readable location of the answer this card is built from. */
  sourceField: string
  sources: MetricSource[]
  /** Catalog label whose resolved value is the fact for this target, if any. */
  factLabel?: string
}

/**
 * KPI list from real survey answers / company targets. A card is emitted only
 * when the underlying answer exists — there are no placeholder cards, and no
 * placeholder "current" values: the fact side is resolved from the metric
 * catalog at render time, or honestly reported as missing.
 */
function deriveKpis(survey: Record<string, unknown>, company: CompanyRow | null): KpiCard[] {
  const cards: KpiCard[] = []

  if (company?.target_revenue_12m_kzt && company.target_revenue_12m_kzt > 0) {
    cards.push({
      id: 'kpi-rev-12m',
      label: 'План выручки (12 мес)',
      target: fmtKzt(company.target_revenue_12m_kzt),
      icon: 'payments',
      category: 'Финансы',
      method: 'Из анкеты собственника',
      owner: 'Собственник',
      sourceField: 'companies.target_revenue_12m_kzt',
      sources: [{ type: 'prisma', model: 'companies', field: 'target_revenue_12m_kzt' }],
      factLabel: 'Выручка (год)',
    })
  }
  if (company?.target_revenue_3y_kzt && company.target_revenue_3y_kzt > 0) {
    cards.push({
      id: 'kpi-rev-3y',
      label: 'План выручки (3 года)',
      target: fmtKzt(company.target_revenue_3y_kzt),
      icon: 'rocket_launch',
      category: 'Финансы',
      method: 'Из анкеты собственника',
      owner: 'Собственник',
      sourceField: 'companies.target_revenue_3y_kzt',
      sources: [{ type: 'prisma', model: 'companies', field: 'target_revenue_3y_kzt' }],
    })
  }

  const g12 = survey['s6_goal_12months']
  if (
    typeof g12 === 'string' &&
    g12.trim().length > 0 &&
    !(company?.target_revenue_12m_kzt && company.target_revenue_12m_kzt > 0)
  ) {
    cards.push({
      id: 'kpi-goal-12m',
      label: 'Цель на 12 месяцев',
      target: g12.trim(),
      icon: 'flag',
      category: 'Рост',
      method: 'Анкета: s6_goal_12months',
      owner: 'Собственник',
      sourceField: 'анкета Точки А · s6_goal_12months',
      sources: [{ type: 'survey', step: 6, key: 's6_goal_12months', label: 'Цель на 12 месяцев' }],
    })
  }
  const g3y = survey['s6_goal_3years']
  if (
    typeof g3y === 'string' &&
    g3y.trim().length > 0 &&
    !(company?.target_revenue_3y_kzt && company.target_revenue_3y_kzt > 0)
  ) {
    cards.push({
      id: 'kpi-goal-3y',
      label: 'Цель на 3 года',
      target: g3y.trim(),
      icon: 'rocket_launch',
      category: 'Рост',
      method: 'Анкета: s6_goal_3years',
      owner: 'Собственник',
      sourceField: 'анкета Точки А · s6_goal_3years',
      sources: [{ type: 'survey', step: 6, key: 's6_goal_3years', label: 'Цель на 3 года' }],
    })
  }

  return cards
}

// ─── Goals tab ───────────────────────────────────────────────────────────────
interface GoalRow {
  id: string
  label: string
  icon: string
  value: string
  sourceField: string
  sources: MetricSource[]
  what: string
}

function deriveGoals(survey: Record<string, unknown>, company: CompanyRow | null): GoalRow[] {
  const rows: GoalRow[] = []

  if (company?.target_revenue_12m_kzt && company.target_revenue_12m_kzt > 0) {
    rows.push({
      id: 'rev-12m',
      label: 'План выручки на 12 месяцев',
      icon: 'payments',
      value: fmtKzt(company.target_revenue_12m_kzt),
      sourceField: 'companies.target_revenue_12m_kzt',
      sources: [{ type: 'prisma', model: 'companies', field: 'target_revenue_12m_kzt' }],
      what: 'Выручка, которую вы планируете получить за ближайшие 12 месяцев. Значение вы задали сами в анкете Точки А.',
    })
  }
  if (company?.target_revenue_3y_kzt && company.target_revenue_3y_kzt > 0) {
    rows.push({
      id: 'rev-3y',
      label: 'План выручки на 3 года',
      icon: 'rocket_launch',
      value: fmtKzt(company.target_revenue_3y_kzt),
      sourceField: 'companies.target_revenue_3y_kzt',
      sources: [{ type: 'prisma', model: 'companies', field: 'target_revenue_3y_kzt' }],
      what: 'Выручка на горизонте трёх лет. Значение вы задали сами в анкете Точки А.',
    })
  }
  const g12 = survey['s6_goal_12months']
  if (typeof g12 === 'string' && g12.trim().length > 0) {
    rows.push({
      id: 'goal-12m',
      label: 'Цель на 12 месяцев (текст)',
      icon: 'flag',
      value: g12.trim(),
      sourceField: 'анкета Точки А · s6_goal_12months',
      sources: [{ type: 'survey', step: 6, key: 's6_goal_12months', label: 'Цель на 12 месяцев' }],
      what: 'Ваша формулировка цели на год — как вы описали её в анкете. Это текст, а не число: по нему нельзя посчитать выполнение плана.',
    })
  }
  const g3y = survey['s6_goal_3years']
  if (typeof g3y === 'string' && g3y.trim().length > 0) {
    rows.push({
      id: 'goal-3y',
      label: 'Цель на 3 года (текст)',
      icon: 'flag',
      value: g3y.trim(),
      sourceField: 'анкета Точки А · s6_goal_3years',
      sources: [{ type: 'survey', step: 6, key: 's6_goal_3years', label: 'Цель на 3 года' }],
      what: 'Ваша формулировка цели на три года — как вы описали её в анкете.',
    })
  }
  return rows
}

// ─── Empty state card ─────────────────────────────────────────────────────────
function EmptyState({
  icon,
  title,
  description,
  missing,
  ctaLabel,
  ctaHref,
  secondary,
}: {
  icon: string
  title: string
  description: string
  /** What exactly has to be filled in for this block to come alive. */
  missing: string
  ctaLabel: string
  ctaHref: string
  secondary?: { label: string; href: string }
}) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-surface-container-low p-10 text-center">
      <span aria-hidden="true" className="mb-3 block text-4xl text-on-surface-variant/30 material-symbols-outlined">
        {icon}
      </span>
      <p className="mb-1 text-sm font-medium text-on-surface">{title}</p>
      <p className="mx-auto mb-3 max-w-md text-xs leading-relaxed text-on-surface-variant/80">
        {description}
      </p>
      <p className="mx-auto mb-5 max-w-md rounded-lg border border-white/[0.06] bg-surface-container px-3 py-2 text-left font-mono text-[11px] leading-relaxed text-on-surface-variant">
        Не хватает: {missing}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link
          href={ctaHref}
          className="inline-flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-5 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-base">play_arrow</span>
          {ctaLabel}
        </Link>
        {secondary && (
          <Link
            href={secondary.href}
            className="inline-flex items-center gap-2 rounded-xl border border-white/[0.06] px-4 py-2.5 font-mono text-xs text-on-surface-variant transition-colors hover:border-white/15 hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {secondary.label}
          </Link>
        )}
      </div>
    </div>
  )
}

// ─── Tabs ────────────────────────────────────────────────────────────────────
type TabKey = 'goals' | 'kpi' | 'biz' | 'gri'

const TABS: ReadonlyArray<{ key: TabKey; label: string; icon: string }> = [
  { key: 'goals', label: 'Цели роста',      icon: 'track_changes' },
  { key: 'kpi',   label: 'KPI компании',    icon: 'monitoring'    },
  { key: 'biz',   label: 'Все метрики',     icon: 'bar_chart'     },
  { key: 'gri',   label: 'GRI диагностика', icon: 'radar'         },
]

type GriSortMode = 'score_asc' | 'score_desc' | 'label_asc'

const GRI_SORTS: ReadonlyArray<{ value: GriSortMode; label: string }> = [
  { value: 'score_asc',  label: 'Сначала слабые' },
  { value: 'score_desc', label: 'Сначала сильные' },
  { value: 'label_asc',  label: 'По названию' },
]

// ─── URL state helpers ───────────────────────────────────────────────────────
const TAB_KEYS: readonly TabKey[] = ['goals', 'kpi', 'biz', 'gri']
const NS_KEYS: readonly Namespace[] = ['all', 'biz', 'kpi', 'gri', 'goal']
const DATA_KEYS: readonly DataFilter[] = ['all', 'with_value', 'without_value', 'low_confidence']
// Only the sort modes the catalog can honour — a `?sort=trend_up` in a shared
// link must not restore a mode the picker refuses to offer.
const SORT_KEYS: readonly SortMode[] = USABLE_SORT_MODES

function pick<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

// ─── Page-level client component ──────────────────────────────────────────────
export interface MetricsPageClientProps {
  userId: string | null
  griAssessment: GriAssessmentRow | null
  company: CompanyRow | null
  surveyAnswers: Record<string, unknown>
}

type BreakdownPayload = Omit<MetricBreakdownModalProps, 'open' | 'onClose'>

export default function MetricsPageClient({
  userId,
  griAssessment,
  company,
  surveyAnswers,
}: MetricsPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [activeTab, setActiveTab] = useState<TabKey>(() =>
    pick(searchParams.get('tab'), TAB_KEYS, 'gri'),
  )
  const [filters, setFilters] = useState<CatalogFilters>(() => ({
    namespace: pick(searchParams.get('ns'), NS_KEYS, DEFAULT_CATALOG_FILTERS.namespace),
    department: searchParams.get('dept'),
    search: searchParams.get('q') ?? '',
    data: pick(searchParams.get('data'), DATA_KEYS, DEFAULT_CATALOG_FILTERS.data),
    sort: pick(searchParams.get('sort'), SORT_KEYS, DEFAULT_CATALOG_FILTERS.sort),
    view: pick(searchParams.get('view'), ['grid', 'table'] as const, 'grid') as CatalogView,
    page: Math.max(1, Number(searchParams.get('page') ?? '1') || 1),
  }))
  const [breakdown, setBreakdown] = useState<BreakdownPayload | null>(null)
  const [griStatusFilter, setGriStatusFilter] = useState<GriStatus | 'all'>('all')
  const [griSort, setGriSort] = useState<GriSortMode>('score_asc')

  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    goals: null, kpi: null, biz: null, gri: null,
  })

  // Keep the URL in sync so a filtered view is shareable and survives F5.
  // history.replaceState, not router.replace: this page is force-dynamic and a
  // router navigation on every keystroke would round-trip to the server.
  const syncUrl = useCallback((tab: TabKey, next: CatalogFilters) => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams()
    if (tab !== 'gri') params.set('tab', tab)
    if (next.namespace !== 'all') params.set('ns', next.namespace)
    if (next.department) params.set('dept', next.department)
    if (next.search) params.set('q', next.search)
    if (next.data !== 'all') params.set('data', next.data)
    if (next.sort !== 'label_asc') params.set('sort', next.sort)
    if (next.view !== 'grid') params.set('view', next.view)
    if (next.page > 1) params.set('page', String(next.page))
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname)
  }, [])

  const updateFilters = useCallback(
    (patch: Partial<CatalogFilters>) => {
      setFilters((prev) => {
        // Any filter change resets paging unless the page itself is being set.
        const next = { ...prev, ...patch, page: patch.page ?? 1 }
        syncUrl(activeTab, next)
        return next
      })
    },
    [activeTab, syncUrl],
  )

  const selectTab = useCallback(
    (tab: TabKey) => {
      setActiveTab(tab)
      syncUrl(tab, filters)
    },
    [filters, syncUrl],
  )

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((t) => t.key === activeTab)
    if (index === -1) return
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = TABS.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const nextTab = TABS[nextIndex]!.key
    selectTab(nextTab)
    tabRefs.current[nextTab]?.focus()
  }

  // ── Realtime ──────────────────────────────────────────────────────────────
  const bindings = useMemo<RealtimeSyncBinding[]>(() => {
    const list: RealtimeSyncBinding[] = []
    if (!userId) return list
    list.push({
      table: 'gri_assessments',
      filter: { column: 'user_id', value: userId },
      invalidateKeys: [['metrics-page-data'], ['metrics-catalog']],
      onChange: () => router.refresh(),
    })
    list.push({
      table: 'diagnostics',
      filter: { column: 'user_id', value: userId },
      invalidateKeys: [['metrics-page-data']],
      onChange: () => router.refresh(),
    })
    if (company?.id) {
      list.push({
        table: 'companies',
        filter: { column: 'id', value: company.id },
        invalidateKeys: [['metrics-page-data']],
        onChange: () => router.refresh(),
      })
    }
    return list
  }, [userId, company?.id, router])

  useRealtimeSync(bindings)

  // ── Derived data ──────────────────────────────────────────────────────────
  const { data: catalog } = useFullMetricCatalog()

  const sectionRows = useMemo<SectionRow[]>(
    () => (griAssessment ? deriveSectionRows(griAssessment) : []),
    [griAssessment],
  )
  const top5 = useMemo<Top5Row[]>(() => deriveTop5(sectionRows), [sectionRows])
  const insights = useMemo<Insight[]>(() => deriveInsights(sectionRows), [sectionRows])
  const kpis = useMemo<KpiCard[]>(() => deriveKpis(surveyAnswers, company), [surveyAnswers, company])
  const goals = useMemo<GoalRow[]>(() => deriveGoals(surveyAnswers, company), [surveyAnswers, company])

  const griIndex = griAssessment?.gri_index ?? null
  const scoredSections = useMemo(() => sectionRows.filter((r) => r.score > 0), [sectionRows])

  const summary = useMemo(() => {
    return {
      ok: scoredSections.filter((s) => s.tone.status === 'ok').length,
      weak: scoredSections.filter((s) => s.tone.status === 'weak').length,
      critical: scoredSections.filter((s) => s.tone.status === 'critical').length,
    }
  }, [scoredSections])

  const visibleSections = useMemo(() => {
    const rows =
      griStatusFilter === 'all'
        ? sectionRows.slice()
        : sectionRows.filter((r) => r.tone.status === griStatusFilter)
    switch (griSort) {
      case 'score_desc': return rows.sort((a, b) => b.score - a.score)
      case 'label_asc':  return rows.sort((a, b) => a.label.localeCompare(b.label, 'ru'))
      default:           return rows.sort((a, b) => a.score - b.score)
    }
  }, [sectionRows, griStatusFilter, griSort])

  const assessmentDate = griAssessment
    ? new Date(griAssessment.created_at).toLocaleDateString('ru-RU', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null

  // ── Breakdown builders ────────────────────────────────────────────────────
  const griHistoryEmptyText = assessmentDate
    ? `Пока есть только один замер — ${assessmentDate}. История появится после повторного прохождения GRI-диагностики: сравнить будет с чем.`
    : 'Замеров ещё не было.'

  function openGriIndexBreakdown() {
    if (!griAssessment) return
    setBreakdown({
      title: 'GRI-индекс · готовность к росту',
      value: `${griAssessment.gri_index.toFixed(2)} / 10`,
      valueCaption: 'Итоговый индекс',
      chips: [
        { label: `Оценка от ${assessmentDate}`, tone: 'neutral' },
        { label: `${scoredSections.length} из ${GRI_SECTIONS.length} блоков с оценкой`, tone: 'primary' },
      ],
      what: 'Сводная оценка готовности бизнеса к росту по семи блокам GRI: продукт и спрос, доверие, бизнес-модель, касса, операции, команда, готовность основателя.',
      why: 'Индекс показывает, где рост упрётся раньше всего. Балл ниже 4 по блоку — это ограничение, которое сожжёт бюджет на масштабирование.',
      how: 'Каждый критерий оценивается по шкале 1–10. Балл блока — среднее по критериям, на которые вы ответили. Индекс — среднее по блокам, у которых балл больше нуля. Неотвеченные критерии в расчёт не берутся и балл не занижают.',
      formula: 'балл блока = среднее(оценки критериев блока > 0)\nGRI-индекс = среднее(баллы блоков > 0)',
      lists: [
        {
          title: 'Из чего собран индекс',
          rows: sectionRows.map((r) => ({
            label: r.label,
            value: r.score > 0 ? `${r.score.toFixed(2)} / 10` : 'нет оценки',
          })),
        },
      ],
      sources: [
        { type: 'prisma', model: 'gri_assessments', field: 'gri_index' },
        { type: 'prisma', model: 'gri_assessments', field: 'section_avgs' },
        { type: 'prisma', model: 'gri_assessments', field: 'scores' },
      ],
      history: null,
      historyEmptyText: griHistoryEmptyText,
      links: [
        { label: 'Методика GRI', href: '/gri/methodology', icon: 'menu_book' },
        { label: 'Пройти заново', href: '/gri', icon: 'refresh' },
      ],
    })
  }

  function openSectionBreakdown(row: SectionRow) {
    const scored = row.criteria.filter((c) => c.score !== null)
    setBreakdown({
      title: `GRI · ${row.label}`,
      value: row.score > 0 ? `${row.score.toFixed(2)} / 10` : null,
      valueCaption: 'Балл блока',
      missingReason: 'Ни один критерий этого блока не оценён — пройдите блок в GRI-диагностике.',
      chips: [
        { label: GRI_STATUS_LABEL[row.tone.status], tone: row.tone.status === 'ok' ? 'primary' : row.tone.status === 'weak' ? 'warning' : 'error' },
        { label: `Отвечено ${row.answered} из ${row.criteriaTotal}`, tone: 'neutral' },
        ...(assessmentDate ? [{ label: `Оценка от ${assessmentDate}`, tone: 'neutral' as const }] : []),
      ],
      what: GRI_SECTIONS.find((s) => s.id === row.id)?.description,
      how: 'Среднее арифметическое по критериям блока, на которые вы дали оценку. Критерии без ответа в расчёт не входят.',
      formula: `балл блока = (${scored.map((c) => c.score).join(' + ') || '—'}) / ${scored.length || '—'}`,
      lists: [
        {
          title: 'Критерии блока',
          rows: row.criteria.map((c) => ({
            label: c.text,
            value: c.score !== null ? `${c.score} / 10` : 'нет оценки',
          })),
          emptyText: 'В этом блоке нет критериев.',
        },
      ],
      sources: [
        { type: 'prisma', model: 'gri_assessments', field: `section_avgs.${row.id}` },
        { type: 'prisma', model: 'gri_assessments', field: `scores.${row.id}` },
      ],
      history: null,
      historyEmptyText: griHistoryEmptyText,
      links: [{ label: 'Открыть блок в GRI', href: '/gri', icon: 'radar' }],
    })
  }

  function openCriterionBreakdown(sectionId: SectionId, block: string, crit: CriterionRow) {
    setBreakdown({
      title: crit.text,
      value: crit.score !== null ? `${crit.score} / 10` : null,
      valueCaption: 'Оценка критерия',
      missingReason: 'Критерий ещё не оценён.',
      chips: [
        { label: block, tone: 'neutral' },
        ...(assessmentDate ? [{ label: `Оценка от ${assessmentDate}`, tone: 'neutral' as const }] : []),
      ],
      what: crit.description,
      how: 'Оценка выставлена вами при прохождении GRI-диагностики по шкале 1–10. Это самооценка, а не расчёт по данным.',
      sections: [
        { title: 'Что улучшить', body: crit.whatToImprove, tone: 'primary' },
        { title: 'Что теряете', body: crit.businessLoss, tone: 'error' },
      ],
      sources: [{ type: 'prisma', model: 'gri_assessments', field: `scores.${sectionId}.${crit.id}` }],
      history: null,
      historyEmptyText: griHistoryEmptyText,
      links: [{ label: 'Открыть блок в GRI', href: '/gri', icon: 'radar' }],
    })
  }

  function openGoalBreakdown(goal: GoalRow) {
    setBreakdown({
      title: goal.label,
      value: goal.value,
      valueCaption: 'Значение из анкеты',
      chips: [{ label: 'Цель', tone: 'primary' }, { label: goal.sourceField, tone: 'neutral' }],
      what: goal.what,
      how: 'Значение не рассчитывается: вы вводите его сами в анкете Точки А. Оно меняется только при редактировании анкеты.',
      sources: goal.sources,
      history: null,
      historyEmptyText:
        'Прошлые версии целей не сохраняются — в базе хранится только текущее значение поля. История появится, если понадобится вести версии плана.',
      links: [{ label: 'Изменить в Точке А', href: '/point-a', icon: 'edit_note' }],
    })
  }

  /** Fact value for a KPI target, matched by catalog label. */
  const factByLabel = useCallback(
    (label: string | undefined) => {
      if (!label || !catalog) return null
      const item = catalog.find((it) => it.label === label && it.value !== null && it.value !== '')
      return item ?? null
    },
    [catalog],
  )

  function openKpiBreakdown(kpi: KpiCard) {
    const fact = factByLabel(kpi.factLabel)
    setBreakdown({
      title: kpi.label,
      value: kpi.target,
      valueCaption: 'Целевое значение',
      chips: [
        { label: kpi.category, tone: 'primary' },
        { label: `Owner: ${kpi.owner}`, tone: 'neutral' },
        { label: `Метод: ${kpi.method}`, tone: 'neutral' },
      ],
      what: 'Целевой показатель, который вы задали сами. Это план, а не факт.',
      how: `Значение читается напрямую из ${kpi.sourceField}. Никаких расчётов и коэффициентов над ним не выполняется.`,
      sections: fact
        ? [
            {
              title: `Факт для сравнения · ${fact.label}`,
              body:
                formatRuMetricWithUnit(fact.value, fact.unit) +
                ` — рассчитано из каталога метрик${formatUpdatedRu(fact.computedAt) ? `, ${formatUpdatedRu(fact.computedAt)}` : ''}.`,
              tone: 'primary' as const,
            },
          ]
        : [
            {
              title: 'Факт для сравнения',
              body: kpi.factLabel
                ? `Показатель «${kpi.factLabel}» ещё не рассчитан, поэтому сравнить план с фактом нельзя. Внесите фактическую выручку в анкете Точки А или загрузите отчёт о прибылях и убытках.`
                : 'Для этой цели нет числового факта: она задана текстом, сравнивать не с чем.',
              tone: 'warning' as const,
            },
          ],
      sources: kpi.sources,
      history: null,
      historyEmptyText:
        'История изменений цели не ведётся — в базе хранится только текущее значение.',
      links: [{ label: 'Изменить в Точке А', href: '/point-a', icon: 'edit_note' }],
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="flex flex-col items-start justify-between gap-6 lg:flex-row">
        <div>
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary/70">
            Система метрик · AIStart360
          </p>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface lg:text-4xl">
            Метрики <span className="text-gradient">роста</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">
            Цели роста · KPI · 7 блоков GRI · полная бизнес-аналитика — в реальном времени
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:flex-col lg:items-end">
          {company?.target_revenue_12m_kzt && company.target_revenue_12m_kzt > 0 ? (
            <Link
              href="/point-a"
              aria-label={`Цель по выручке ${fmtKzt(company.target_revenue_12m_kzt)} в год. Открыть Точку А`}
              className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 transition-colors hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-sm text-primary">flag</span>
              <span className="font-mono text-xs text-primary">
                Цель: {fmtKzt(company.target_revenue_12m_kzt)}/год
              </span>
            </Link>
          ) : null}
          {griIndex !== null && (
            <button
              type="button"
              onClick={openGriIndexBreakdown}
              aria-label={`GRI-индекс ${griIndex.toFixed(2)} из 10. Открыть разбор`}
              className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-surface-container px-3 py-2 transition-colors hover:border-secondary/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-sm text-secondary">radar</span>
              <span className="font-mono text-xs text-secondary">
                GRI Score: {griIndex.toFixed(2)} / 10
              </span>
            </button>
          )}
        </div>
      </section>

      {/* Live catalog */}
      <MetricsLiveCatalog
        companyId={company?.id ?? null}
        filters={filters}
        onFiltersChange={updateFilters}
      />

      {/* Tabs */}
      <div
        data-tour="metrics-tabs"
        role="tablist"
        aria-label="Разделы метрик"
        onKeyDown={handleTabKeyDown}
        className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-container p-1 no-scrollbar"
      >
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            ref={(el) => { tabRefs.current[key] = el }}
            type="button"
            role="tab"
            id={`metrics-tab-${key}`}
            aria-selected={activeTab === key}
            aria-controls={`metrics-panel-${key}`}
            tabIndex={activeTab === key ? 0 : -1}
            onClick={() => selectTab(key)}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-primary/40 ${
              activeTab === key
                ? 'bg-primary text-on-primary shadow'
                : 'text-on-surface-variant hover:bg-white/[0.04] hover:text-on-surface'
            }`}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* ══ TAB: GOALS ══ */}
      {activeTab === 'goals' && (
        <div id="metrics-panel-goals" role="tabpanel" aria-labelledby="metrics-tab-goals" className="space-y-5">
          {goals.length === 0 ? (
            <EmptyState
              icon="flag"
              title="Цели ещё не заданы"
              description="Здесь появятся ваши плановые цифры и текстовые цели, как только они будут в анкете."
              missing="план выручки на 12 месяцев и на 3 года, либо текстовые цели (шаг 6 анкеты Точки А)"
              ctaLabel="Перейти к Точке А"
              ctaHref="/point-a"
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {goals.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => openGoalBreakdown(g)}
                  aria-label={`${g.label}: ${g.value}. Открыть разбор цели`}
                  className="group rounded-2xl border border-white/[0.04] bg-surface-container-low p-5 text-left transition-colors hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <span className="mb-3 flex items-start gap-3">
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                      <span aria-hidden="true" className="material-symbols-outlined text-base text-primary">{g.icon}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="mb-1 block font-mono text-xs uppercase tracking-wider text-on-surface-variant">
                        {g.label}
                      </span>
                      <span className="block break-words font-mono text-base font-bold text-on-surface">
                        {g.value}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined text-base text-on-surface-variant/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
                    >
                      chevron_right
                    </span>
                  </span>
                  <span className="block font-mono text-[10px] text-on-surface-variant/60">
                    Источник: {g.sourceField}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ TAB: KPI ══ */}
      {activeTab === 'kpi' && (
        <div id="metrics-panel-kpi" role="tabpanel" aria-labelledby="metrics-tab-kpi" className="space-y-5">
          <div>
            <h2 className="font-headline text-xl font-bold text-on-surface">KPI компании</h2>
            <p className="mt-1 text-xs text-on-surface-variant">
              Плановые показатели из анкеты собственника. Факт подтягивается из каталога метрик — если он там рассчитан.
            </p>
          </div>
          {kpis.length === 0 ? (
            <EmptyState
              icon="monitoring"
              title="KPI ещё не настроены"
              description="KPI строятся из целей собственника: плана выручки и текстовых целей."
              missing="план выручки (12 мес / 3 года) или цели шага 6 в анкете Точки А"
              ctaLabel="Заполнить Точку А"
              ctaHref="/point-a"
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {kpis.map((kpi) => {
                const fact = factByLabel(kpi.factLabel)
                return (
                  <button
                    key={kpi.id}
                    type="button"
                    onClick={() => openKpiBreakdown(kpi)}
                    aria-label={`${kpi.label}, цель ${kpi.target}. Открыть разбор показателя`}
                    className="group rounded-2xl border border-white/[0.04] bg-surface-container-low p-5 text-left transition-colors hover:border-secondary/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <span className="mb-4 flex items-start justify-between">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-secondary/20 bg-secondary/10">
                        <span aria-hidden="true" className="material-symbols-outlined text-base text-secondary">{kpi.icon}</span>
                      </span>
                      <span className="rounded-full border border-white/[0.06] bg-surface-container px-2 py-0.5 font-mono text-[9px] uppercase text-on-surface-variant">
                        {kpi.category}
                      </span>
                    </span>
                    <span className="mb-2 block font-mono text-xs uppercase tracking-wider text-on-surface-variant">
                      {kpi.label}
                    </span>
                    <span className="mb-3 block">
                      <span className="mb-0.5 block text-[9px] text-primary/70">Целевое</span>
                      <span className="block break-words font-mono text-base font-bold text-primary">
                        {kpi.target}
                      </span>
                    </span>
                    <span className="mb-3 block rounded-lg border border-white/[0.04] bg-surface-container px-3 py-2">
                      <span className="mb-0.5 block text-[9px] text-on-surface-variant/60">Текущее</span>
                      {fact ? (
                        <span className="block font-mono text-sm text-on-surface">
                          {formatRuMetricWithUnit(fact.value, fact.unit)}
                          <span className="ml-1 font-mono text-[10px] text-on-surface-variant/60">
                            · {fact.label}
                          </span>
                        </span>
                      ) : (
                        <span className="block text-[11px] leading-relaxed text-on-surface-variant">
                          не рассчитано — нет исходных данных
                        </span>
                      )}
                    </span>
                    <span className="flex items-center justify-between border-t border-white/[0.04] pt-2.5">
                      <span className="text-[9px] text-on-surface-variant/50">{kpi.method}</span>
                      <span
                        aria-hidden="true"
                        className="material-symbols-outlined text-base text-on-surface-variant/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
                      >
                        chevron_right
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ TAB: COVERAGE ══ */}
      {activeTab === 'biz' && (
        <div id="metrics-panel-biz" role="tabpanel" aria-labelledby="metrics-tab-biz" className="space-y-5">
          <div>
            <h2 className="font-headline text-xl font-bold text-on-surface">Все метрики бизнеса</h2>
            <p className="mt-1 text-xs text-on-surface-variant">
              Где у Точки А данные есть, а где дыры. Кнопки настраивают фильтр каталога выше.
            </p>
          </div>
          <MetricsCoveragePanel filters={filters} onFiltersChange={updateFilters} />
        </div>
      )}

      {/* ══ TAB: GRI ══ */}
      {activeTab === 'gri' && (
        <div id="metrics-panel-gri" role="tabpanel" aria-labelledby="metrics-tab-gri" className="space-y-5">
          {!griAssessment ? (
            <EmptyState
              icon="insights"
              title="Тест GRI ещё не пройден"
              description="GRI-диагностика из 7 блоков даёт индекс готовности к росту, слабые места и план на 90 дней."
              missing="ответы на критерии семи блоков GRI"
              ctaLabel="Пройти GRI Assessment"
              ctaHref="/gri"
              secondary={{ label: 'Как считается GRI', href: '/gri/methodology' }}
            />
          ) : (
            <>
              {/* Score header */}
              <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-6">
                <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={openGriIndexBreakdown}
                    aria-label={`GRI-индекс ${griAssessment.gri_index.toFixed(2)} из 10. Открыть разбор: формула, блоки, источник`}
                    className="group relative h-24 w-24 flex-shrink-0 rounded-full transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <svg
                      viewBox="0 0 100 100"
                      role="img"
                      aria-label={`Шкала GRI: ${griAssessment.gri_index.toFixed(2)} из 10`}
                      className="h-full w-full -rotate-90"
                    >
                      <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="10" />
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="10"
                        strokeLinecap="round"
                        className={griTone(griAssessment.gri_index).text}
                        strokeDasharray={`${(griAssessment.gri_index / 10) * 251.2} 251.2`}
                      />
                    </svg>
                    <span className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="font-mono text-2xl font-bold text-on-surface">
                        {griAssessment.gri_index.toFixed(2)}
                      </span>
                      <span className="text-[9px] text-on-surface-variant">/10</span>
                    </span>
                  </button>
                  <div className="flex-1">
                    <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-on-surface-variant/60">
                      GRI Score · Итоговый
                    </p>
                    <h2 className="mb-1 font-headline text-2xl font-bold text-on-surface">
                      Индекс готовности к росту
                    </h2>
                    <p className="mb-3 text-sm text-on-surface-variant">
                      Дата оценки: {assessmentDate} · среднее по {scoredSections.length} из {GRI_SECTIONS.length} блоков
                    </p>
                    <div role="group" aria-label="Фильтр блоков по состоянию" className="flex flex-wrap gap-2">
                      {([
                        { key: 'all' as const,      label: `Все ${sectionRows.length}`,     cls: 'bg-surface-container border-white/[0.06] text-on-surface-variant' },
                        { key: 'ok' as const,       label: `${summary.ok} сильных`,         cls: 'bg-primary/10 border-primary/20 text-primary' },
                        { key: 'weak' as const,     label: `${summary.weak} слабых`,        cls: 'bg-tertiary-container/10 border-tertiary-container/20 text-tertiary-container' },
                        { key: 'critical' as const, label: `${summary.critical} критических`, cls: 'bg-error/10 border-error/20 text-error' },
                      ]).map((chip) => (
                        <button
                          key={chip.key}
                          type="button"
                          aria-pressed={griStatusFilter === chip.key}
                          aria-label={`Показать блоки: ${chip.label}`}
                          onClick={() => setGriStatusFilter(chip.key)}
                          className={`rounded-full border px-2.5 py-1 font-mono text-[10px] transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 ${chip.cls} ${
                            griStatusFilter === chip.key ? 'ring-1 ring-inset ring-current' : 'opacity-70 hover:opacity-100'
                          }`}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Block sort */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-headline text-base font-bold text-on-surface">
                  7 блоков · показано {visibleSections.length}
                </h3>
                <div role="group" aria-label="Сортировка блоков" className="flex flex-wrap gap-1">
                  {GRI_SORTS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={griSort === opt.value}
                      onClick={() => setGriSort(opt.value)}
                      className={
                        griSort === opt.value
                          ? 'rounded-full border border-primary/40 bg-primary/15 px-3 py-1.5 font-mono text-[11px] text-primary focus:outline-none focus:ring-2 focus:ring-primary/40'
                          : 'rounded-full border border-white/[0.04] bg-surface-container px-3 py-1.5 font-mono text-[11px] text-on-surface-variant hover:border-white/15 focus:outline-none focus:ring-2 focus:ring-primary/40'
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 7 blocks */}
              {visibleSections.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/[0.08] p-8 text-center">
                  <p className="text-sm text-on-surface-variant">Блоков с таким состоянием нет.</p>
                  <button
                    type="button"
                    onClick={() => setGriStatusFilter('all')}
                    className="mt-3 font-mono text-xs text-primary hover:text-primary/80 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    Показать все блоки
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {visibleSections.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => openSectionBreakdown(row)}
                      aria-label={`${row.label}: ${row.score > 0 ? `${row.score.toFixed(2)} из 10` : 'нет оценки'}. Открыть разбор блока`}
                      className="group relative flex w-full items-center gap-4 rounded-xl border border-white/[0.04] bg-surface-container-low p-4 text-left transition-colors hover:border-white/[0.08] hover:bg-white/[0.02] focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${row.tone.bg}`}>
                        <span aria-hidden="true" className={`material-symbols-outlined text-sm ${row.tone.text}`}>{row.icon}</span>
                      </span>
                      <span className="w-44 flex-shrink-0">
                        <span className="block text-sm font-medium text-on-surface">{row.label}</span>
                        <span className="block font-mono text-[10px] text-on-surface-variant/60">
                          {row.answered} из {row.criteriaTotal} критериев
                        </span>
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container">
                        <span
                          className={`block h-full rounded-full ${row.tone.bar}`}
                          style={{ width: `${(row.score / 10) * 100}%` }}
                        />
                      </span>
                      <span className={`w-16 flex-shrink-0 text-right font-mono text-sm font-bold ${row.tone.text}`}>
                        {row.score > 0 ? `${row.score.toFixed(2)}/10` : '—'}
                      </span>
                      <span
                        className={`hidden max-w-[180px] flex-shrink-0 truncate rounded-full border px-2 py-0.5 font-mono text-[9px] sm:inline ${row.tone.badge}`}
                      >
                        {GRI_STATUS_LABEL[row.tone.status]}
                      </span>
                      <span
                        aria-hidden="true"
                        className="material-symbols-outlined flex-shrink-0 text-base text-on-surface-variant/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
                      >
                        chevron_right
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Insights */}
              {insights.length > 0 && (
                <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <span aria-hidden="true" className="material-symbols-outlined text-base text-primary">tips_and_updates</span>
                    <h3 className="font-headline text-base font-bold text-on-surface">Инсайты и советы</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {insights.map((insight, idx) => {
                      const sev =
                        insight.severity === 'critical'
                          ? { label: 'Critical', text: 'text-error', border: 'border-error/20', bg: 'bg-error/5' }
                          : insight.severity === 'warning'
                            ? { label: 'Warning', text: 'text-tertiary-container', border: 'border-tertiary-container/20', bg: 'bg-tertiary-container/5' }
                            : { label: 'Strong', text: 'text-primary', border: 'border-primary/20', bg: 'bg-primary/5' }
                      const sectionRow = insight.sectionId
                        ? sectionRows.find((r) => r.id === insight.sectionId)
                        : undefined
                      return (
                        <div key={idx} className={`rounded-2xl border bg-surface-container p-5 ${sev.border}`}>
                          <div className="mb-3 flex items-center justify-between">
                            <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${sev.text} ${sev.border} ${sev.bg}`}>
                              {sev.label}
                            </span>
                            <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                              {insight.section}
                            </span>
                          </div>
                          <p className="mb-3 text-sm font-bold text-on-surface">{insight.problem}</p>
                          <div className="space-y-2 text-xs leading-relaxed text-on-surface-variant">
                            <p>
                              <span className="mr-1 font-mono text-[10px] uppercase tracking-widest text-primary/70">
                                Что делать:
                              </span>
                              {insight.recommendation}
                            </p>
                            <p>
                              <span className="mr-1 font-mono text-[10px] uppercase tracking-widest text-error/70">
                                Что теряете:
                              </span>
                              {insight.loss}
                            </p>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {sectionRow && (
                              <button
                                type="button"
                                onClick={() => openSectionBreakdown(sectionRow)}
                                aria-label={`Открыть разбор блока ${sectionRow.label}`}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.06] px-3 py-1.5 font-mono text-[11px] text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                              >
                                <span aria-hidden="true" className="material-symbols-outlined text-sm">insights</span>
                                Разбор блока
                              </button>
                            )}
                            <Link
                              href="/gri"
                              className="inline-flex items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/10 px-3 py-1.5 font-mono text-[11px] text-primary transition-colors hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/40"
                            >
                              <span aria-hidden="true" className="material-symbols-outlined text-sm">radar</span>
                              Открыть в GRI
                            </Link>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Top-5 lowest criteria */}
              {top5.length > 0 && (
                <div className="rounded-2xl border border-error/20 bg-surface-container-low p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <span aria-hidden="true" className="material-symbols-outlined text-sm text-error">warning</span>
                    <h3 className="font-headline text-base font-bold text-on-surface">Топ-5 ограничений роста</h3>
                  </div>
                  <ul className="space-y-2">
                    {top5.map((item) => (
                      <li key={`${item.sectionId}-${item.criterion.id}`}>
                        <button
                          type="button"
                          onClick={() => openCriterionBreakdown(item.sectionId, item.block, item.criterion)}
                          aria-label={`${item.criterion.text}, оценка ${item.criterion.score} из 10, блок ${item.block}. Открыть разбор критерия`}
                          className="group flex w-full items-center gap-3 rounded-xl bg-surface-container px-4 py-2.5 text-left transition-colors hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg border border-error/20 bg-error/10">
                            <span className="font-mono text-[10px] font-bold text-error">{item.criterion.score}</span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-on-surface">{item.criterion.text}</span>
                            <span className="block font-mono text-[10px] text-on-surface-variant">{item.block}</span>
                          </span>
                          <span className="h-1.5 w-20 flex-shrink-0 overflow-hidden rounded-full bg-surface-container-high">
                            <span
                              className="block h-full rounded-full bg-error"
                              style={{ width: `${((item.criterion.score ?? 0) / 10) * 100}%` }}
                            />
                          </span>
                          <span
                            aria-hidden="true"
                            className="material-symbols-outlined flex-shrink-0 text-base text-on-surface-variant/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
                          >
                            chevron_right
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {breakdown && (
        <MetricBreakdownModal open onClose={() => setBreakdown(null)} {...breakdown} />
      )}
    </div>
  )
}
