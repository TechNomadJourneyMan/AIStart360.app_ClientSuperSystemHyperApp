'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
// formatSource + types come from the light ./format module; the heavy
// descriptions catalog (getGriDescription) is imported dynamically on demand
// (openGriBlockModal) to keep it out of the /metrics first-load bundle.
import { formatSource, type MetricSource } from '@/lib/metrics/format'
import MetricsLiveCatalog from '@/components/metrics/MetricsLiveCatalog'
import { useRealtimeSync, type RealtimeSyncBinding } from '@/hooks/useRealtimeSync'
import { GRI_SECTIONS, type SectionId } from '@/lib/gri-assessment/sections'
import type {
  GriAssessmentRow,
  CompanyRow,
} from '@/lib/metrics/page-data'

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

function griTone(score: number): {
  status: 'critical' | 'weak' | 'ok'
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

interface SectionRow {
  id: SectionId
  label: string
  icon: string
  score: number
  tone: ReturnType<typeof griTone>
}

interface Top5Row {
  label: string
  block: string
  score: number
}

function deriveSectionRows(assessment: GriAssessmentRow): SectionRow[] {
  const out: SectionRow[] = []
  for (const sec of GRI_SECTIONS) {
    const meta = SECTION_META[sec.id]
    const fromAvgs = assessment.section_avgs?.[sec.id]
    let score = typeof fromAvgs === 'number' ? fromAvgs : 0
    // Fallback: average raw scores if section_avgs is missing
    if (!score && assessment.scores?.[sec.id]) {
      const vals = Object.values(assessment.scores[sec.id]).filter(
        (v): v is number => typeof v === 'number' && v > 0,
      )
      if (vals.length) score = vals.reduce((a, b) => a + b, 0) / vals.length
    }
    out.push({
      id: sec.id,
      label: meta.label,
      icon: meta.icon,
      score: Number(score.toFixed(2)),
      tone: griTone(score),
    })
  }
  // Show worst sections first so the user sees the bottlenecks
  return out.sort((a, b) => a.score - b.score)
}

function deriveTop5(assessment: GriAssessmentRow): Top5Row[] {
  const rows: Top5Row[] = []
  for (const sec of GRI_SECTIONS) {
    const meta = SECTION_META[sec.id]
    const sectionScores = assessment.scores?.[sec.id]
    if (!sectionScores) continue
    for (const crit of sec.criteria) {
      const raw = sectionScores[crit.id]
      const v = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(v) || v <= 0) continue
      rows.push({ label: crit.text, block: meta.label, score: v })
    }
  }
  return rows.sort((a, b) => a.score - b.score).slice(0, 5)
}

interface Insight {
  severity: 'critical' | 'warning' | 'positive'
  section: string
  problem: string
  recommendation: string
  loss: string
}

function deriveInsights(assessment: GriAssessmentRow): Insight[] {
  const sectionRows = GRI_SECTIONS.map((sec) => {
    const fromAvgs = assessment.section_avgs?.[sec.id]
    let avg = typeof fromAvgs === 'number' ? fromAvgs : 0
    if (!avg && assessment.scores?.[sec.id]) {
      const vals = Object.values(assessment.scores[sec.id]).filter(
        (v): v is number => typeof v === 'number' && v > 0,
      )
      if (vals.length) avg = vals.reduce((a, b) => a + b, 0) / vals.length
    }
    return { sec, avg }
  })

  const weak = sectionRows
    .filter((r) => r.avg > 0 && r.avg < 6)
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 4)

  if (weak.length === 0) {
    return [
      {
        severity: 'positive',
        section: 'Все блоки',
        problem: 'Сильная база — фокус на масштабирование',
        recommendation:
          'Удерживайте текущий уровень и сосредоточьтесь на росте: премиум-сегменты, новые гео, апселлы.',
        loss: 'Без масштабирования вы оставляете рост на столе.',
      },
    ]
  }

  const insights: Insight[] = []
  for (const { sec, avg } of weak) {
    const map = assessment.scores?.[sec.id]
    if (!map) continue
    // Find lowest scored criterion in this section
    let lowestId: string | null = null
    let lowestScore = Number.POSITIVE_INFINITY
    for (const c of sec.criteria) {
      const v = map[c.id]
      if (typeof v !== 'number' || v <= 0) continue
      if (v < lowestScore) {
        lowestScore = v
        lowestId = c.id
      }
    }
    const crit = lowestId ? sec.criteria.find((c) => c.id === lowestId) : null
    if (!crit) continue
    insights.push({
      severity: avg < 4 ? 'critical' : 'warning',
      section: SECTION_META[sec.id].label,
      problem: crit.text,
      recommendation: crit.whatToImprove,
      loss: crit.businessLoss,
    })
  }
  return insights
}

// ─── KPI: from survey answers ────────────────────────────────────────────────
interface KpiCard {
  label: string
  current: string
  target: string
  icon: string
  category: string
  method: string
  owner: string
}

/**
 * Build the KPI list from real survey answers. We only emit a card if the
 * underlying answer is present — no mock fallbacks.
 *
 * Survey keys come from `lib/survey-labels.ts` / the medical onboarding form.
 * Known revenue / kpi answers live under stable keys (s6_*, s5_*).
 */
function deriveKpis(survey: Record<string, unknown>, company: CompanyRow | null): KpiCard[] {
  const cards: KpiCard[] = []
  const fmtKzt = (n: number) => {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} млрд ₸`
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн ₸`
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)} тыс ₸`
    return `${Math.round(n)} ₸`
  }

  // 1. Revenue target (12m / 3y) from companies row → goals/financials
  if (company?.target_revenue_12m_kzt && company.target_revenue_12m_kzt > 0) {
    cards.push({
      label: 'План выручки (12 мес)',
      current: '—',
      target: fmtKzt(company.target_revenue_12m_kzt),
      icon: 'payments',
      category: 'Финансы',
      method: 'Из анкеты собственника',
      owner: 'Собственник',
    })
  }
  if (company?.target_revenue_3y_kzt && company.target_revenue_3y_kzt > 0) {
    cards.push({
      label: 'План выручки (3 года)',
      current: '—',
      target: fmtKzt(company.target_revenue_3y_kzt),
      icon: 'rocket_launch',
      category: 'Финансы',
      method: 'Из анкеты собственника',
      owner: 'Собственник',
    })
  }

  // 2. Free-text survey goals (only if not numerically parsed yet)
  const g12 = survey['s6_goal_12months']
  if (
    typeof g12 === 'string' &&
    g12.trim().length > 0 &&
    !(company?.target_revenue_12m_kzt && company.target_revenue_12m_kzt > 0)
  ) {
    cards.push({
      label: 'Цель на 12 месяцев',
      current: '—',
      target: g12.trim().slice(0, 60),
      icon: 'flag',
      category: 'Рост',
      method: 'Анкета: s6_goal_12months',
      owner: 'Собственник',
    })
  }
  const g3y = survey['s6_goal_3years']
  if (
    typeof g3y === 'string' &&
    g3y.trim().length > 0 &&
    !(company?.target_revenue_3y_kzt && company.target_revenue_3y_kzt > 0)
  ) {
    cards.push({
      label: 'Цель на 3 года',
      current: '—',
      target: g3y.trim().slice(0, 60),
      icon: 'rocket_launch',
      category: 'Рост',
      method: 'Анкета: s6_goal_3years',
      owner: 'Собственник',
    })
  }

  return cards
}

// ─── Goals tab: company revenue plan, period-over-period from /api/v1/point-a
// We render the same 12m + 3y plan + survey free-text goals here as a clean
// list. If user has no targets and no survey, render empty state.
interface GoalRow {
  id: string
  label: string
  icon: string
  value: string
  description: string
}

function deriveGoals(survey: Record<string, unknown>, company: CompanyRow | null): GoalRow[] {
  const rows: GoalRow[] = []
  const fmtKzt = (n: number) => {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} млрд ₸`
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн ₸`
    return `${Math.round(n)} ₸`
  }

  if (company?.target_revenue_12m_kzt && company.target_revenue_12m_kzt > 0) {
    rows.push({
      id: 'rev-12m',
      label: 'План выручки на 12 месяцев',
      icon: 'payments',
      value: fmtKzt(company.target_revenue_12m_kzt),
      description: 'Источник: anketa собственника · поле target_revenue_12m_kzt',
    })
  }
  if (company?.target_revenue_3y_kzt && company.target_revenue_3y_kzt > 0) {
    rows.push({
      id: 'rev-3y',
      label: 'План выручки на 3 года',
      icon: 'rocket_launch',
      value: fmtKzt(company.target_revenue_3y_kzt),
      description: 'Источник: anketa собственника · поле target_revenue_3y_kzt',
    })
  }
  const g12 = survey['s6_goal_12months']
  if (typeof g12 === 'string' && g12.trim().length > 0) {
    rows.push({
      id: 'goal-12m',
      label: 'Цель на 12 месяцев (текст)',
      icon: 'flag',
      value: g12.trim().slice(0, 120),
      description: 'Источник: анкета s6_goal_12months',
    })
  }
  const g3y = survey['s6_goal_3years']
  if (typeof g3y === 'string' && g3y.trim().length > 0) {
    rows.push({
      id: 'goal-3y',
      label: 'Цель на 3 года (текст)',
      icon: 'flag',
      value: g3y.trim().slice(0, 120),
      description: 'Источник: анкета s6_goal_3years',
    })
  }
  return rows
}

// ─── Empty state card ─────────────────────────────────────────────────────────
function EmptyState({
  icon,
  title,
  description,
  ctaLabel,
  ctaHref,
}: {
  icon: string
  title: string
  description: string
  ctaLabel: string
  ctaHref: string
}) {
  return (
    <div className="bg-surface-container-low rounded-2xl border border-dashed border-white/10 p-10 text-center">
      <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-3 block">
        {icon}
      </span>
      <p className="text-sm text-on-surface font-medium mb-1">{title}</p>
      <p className="text-xs text-on-surface-variant/80 mb-5 max-w-md mx-auto leading-relaxed">
        {description}
      </p>
      <Link
        href={ctaHref}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary/10 hover:bg-primary/15 text-primary text-sm font-bold border border-primary/20 transition-colors"
      >
        <span className="material-symbols-outlined text-base">play_arrow</span>
        {ctaLabel}
      </Link>
    </div>
  )
}

// ─── Source icon (re-used from descriptions modal) ───────────────────────────
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

// ─── Metric Detail Modal (kept from previous version) ────────────────────────
interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  what: string
  why: string
  how: string
  current_state?: string
  formula?: string
  benchmark?: string
  owner?: string | null
  method?: string | null
  category?: string
  sources: MetricSource[]
}

function MetricDetailModal({
  open,
  onClose,
  title,
  what,
  why,
  how,
  current_state,
  formula,
  benchmark,
  owner,
  method,
  category,
  sources,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const hasChips = !!(owner || method || category)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-surface-container-low rounded-2xl border border-white/[0.04] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface-container-low/95 backdrop-blur-sm flex items-center justify-between gap-4 px-6 py-4 border-b border-white/[0.04]">
          <h3 className="font-headline text-lg font-bold text-on-surface flex-1 min-w-0 pr-2 truncate">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/[0.04] text-on-surface-variant hover:text-on-surface transition-colors"
            aria-label="Закрыть"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
        <div className="px-6 py-5 space-y-5">
          {hasChips && (
            <div className="flex flex-wrap gap-1.5">
              {category && (
                <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary">
                  {category}
                </span>
              )}
              {owner && (
                <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-surface-container border border-white/[0.06] text-on-surface-variant">
                  Owner: {owner}
                </span>
              )}
              {method && (
                <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-surface-container border border-white/[0.06] text-on-surface-variant">
                  Метод: {method}
                </span>
              )}
            </div>
          )}
          {what && (
            <section>
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Что это</p>
              <p className="text-sm text-on-surface leading-relaxed">{what}</p>
            </section>
          )}
          {why && (
            <section>
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Зачем</p>
              <p className="text-sm text-on-surface-variant leading-relaxed">{why}</p>
            </section>
          )}
          {how && (
            <section>
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Как считается</p>
              <p className="text-sm text-on-surface-variant leading-relaxed">{how}</p>
            </section>
          )}
          {formula && (
            <section>
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Формула</p>
              <pre className="text-xs font-mono text-primary bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 whitespace-pre-wrap break-words">
                {formula}
              </pre>
            </section>
          )}
          {benchmark && (
            <section>
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Бенчмарк</p>
              <span className="inline-block text-xs font-mono uppercase px-3 py-1 rounded-full bg-secondary/10 border border-secondary/20 text-secondary">
                {benchmark}
              </span>
            </section>
          )}
          {current_state && (
            <section className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3">
              <p className="text-[10px] font-mono text-primary uppercase tracking-[0.2em] mb-1">Текущее состояние</p>
              <p className="text-sm text-on-surface leading-relaxed">{current_state}</p>
            </section>
          )}
          {sources && sources.length > 0 && (
            <section>
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Источники данных</p>
              <ul className="space-y-1.5">
                {sources.map((src, i) => {
                  const ico = sourceIcon(src.type)
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 bg-surface-container rounded-lg border border-white/[0.04] px-3 py-2"
                    >
                      <span className={`material-symbols-outlined text-sm flex-shrink-0 mt-0.5 ${ico.cls}`}>
                        {ico.icon}
                      </span>
                      <span className="text-xs text-on-surface-variant leading-relaxed break-words">
                        {formatSource(src)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
          {(!sources || sources.length === 0) && !what && !why && !how && (
            <p className="text-sm text-on-surface-variant italic">Описание скоро будет добавлено.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Page-level client component ──────────────────────────────────────────────
export interface MetricsPageClientProps {
  userId: string | null
  griAssessment: GriAssessmentRow | null
  company: CompanyRow | null
  surveyAnswers: Record<string, unknown>
}

export default function MetricsPageClient({
  userId,
  griAssessment,
  company,
  surveyAnswers,
}: MetricsPageClientProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'goals' | 'kpi' | 'gri' | 'biz'>('gri')
  const [modal, setModal] = useState<ModalProps | null>(null)

  // ── Realtime: invalidate (refresh) on changes to any of these tables ──
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
      list.push({
        table: 'metrics',
        filter: { column: 'company_id', value: company.id },
        invalidateKeys: [['metrics-catalog'], ['metrics']],
      })
    }
    return list
  }, [userId, company?.id, router])

  useRealtimeSync(bindings)

  const sectionRows = useMemo<SectionRow[]>(
    () => (griAssessment ? deriveSectionRows(griAssessment) : []),
    [griAssessment],
  )
  const top5 = useMemo<Top5Row[]>(
    () => (griAssessment ? deriveTop5(griAssessment) : []),
    [griAssessment],
  )
  const insights = useMemo<Insight[]>(
    () => (griAssessment ? deriveInsights(griAssessment) : []),
    [griAssessment],
  )
  const kpis = useMemo<KpiCard[]>(
    () => deriveKpis(surveyAnswers, company),
    [surveyAnswers, company],
  )
  const goals = useMemo<GoalRow[]>(
    () => deriveGoals(surveyAnswers, company),
    [surveyAnswers, company],
  )

  const griIndex = griAssessment?.gri_index ?? null

  const summary = useMemo(() => {
    if (!sectionRows.length) return { strong: 0, weak: 0, critical: 0 }
    return {
      strong: sectionRows.filter((s) => s.tone.status === 'ok').length,
      weak: sectionRows.filter((s) => s.tone.status === 'weak').length,
      critical: sectionRows.filter((s) => s.tone.status === 'critical').length,
    }
  }, [sectionRows])

  async function openGriBlockModal(label: string) {
    // Lazy-load the heavy descriptions catalog only when a block is opened.
    const { getGriDescription } = await import('@/lib/metrics/descriptions')
    const desc = getGriDescription(label)
    setModal({
      open: true,
      onClose: () => setModal(null),
      title: label,
      what: desc?.what ?? 'Описание скоро будет добавлено.',
      why: desc?.why ?? '',
      how: desc?.how ?? '',
      current_state: desc?.current_state,
      sources: desc?.sources ?? [],
    })
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="flex flex-col lg:flex-row justify-between items-start gap-6">
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
            Система метрик · AIStart360
          </p>
          <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
            Метрики <span className="text-gradient">роста</span>
          </h1>
          <p className="text-on-surface-variant mt-2 text-sm max-w-2xl">
            Цели роста · KPI · 7 блоков GRI · полная бизнес-аналитика — в реальном времени
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:flex-col lg:items-end">
          {company?.target_revenue_12m_kzt && company.target_revenue_12m_kzt > 0 && (
            <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-xl px-3 py-2">
              <span className="material-symbols-outlined text-sm text-primary">flag</span>
              <span className="text-xs font-mono text-primary">
                Цель:{' '}
                {company.target_revenue_12m_kzt >= 1_000_000_000
                  ? `${(company.target_revenue_12m_kzt / 1_000_000_000).toFixed(2)} млрд ₸`
                  : `${(company.target_revenue_12m_kzt / 1_000_000).toFixed(1)} млн ₸`}
                /год
              </span>
            </div>
          )}
          {griIndex !== null && (
            <div className="flex items-center gap-2 bg-surface-container border border-white/[0.06] rounded-xl px-3 py-2">
              <span className="material-symbols-outlined text-sm text-secondary">radar</span>
              <span className="text-xs font-mono text-secondary">
                GRI Score: {griIndex.toFixed(2)} / 10
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Live catalog */}
      <MetricsLiveCatalog userId={userId ?? undefined} />

      {/* Tab switcher */}
      <div className="flex gap-1 bg-surface-container rounded-xl p-1 w-fit flex-wrap">
        {([
          { key: 'goals', label: 'Цели роста',         icon: 'track_changes' },
          { key: 'kpi',   label: 'KPI компании',       icon: 'monitoring'    },
          { key: 'biz',   label: 'Все метрики',         icon: 'bar_chart'     },
          { key: 'gri',   label: 'GRI диагностика',    icon: 'radar'         },
        ] as const).map(({ key, label, icon }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
              activeTab === key
                ? 'bg-primary text-on-primary shadow'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-white/[0.04]'
            }`}>
            <span className="material-symbols-outlined text-[16px]">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* ══ TAB: GOALS ══ */}
      {activeTab === 'goals' && (
        <div className="space-y-5">
          {goals.length === 0 ? (
            <EmptyState
              icon="flag"
              title="Цели ещё не заданы"
              description="Введите план выручки на 12 месяцев и 3 года в анкете — и они появятся здесь в реальном времени."
              ctaLabel="Перейти к Точке А"
              ctaHref="/point-a"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {goals.map((g) => (
                <div
                  key={g.id}
                  className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 hover:border-primary/20 transition-colors"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                      <span className="material-symbols-outlined text-base text-primary">{g.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-on-surface-variant mb-1 uppercase tracking-wider">
                        {g.label}
                      </p>
                      <p className="text-base font-mono font-bold text-on-surface break-words">
                        {g.value}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] font-mono text-on-surface-variant/60">{g.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ TAB: KPI ══ */}
      {activeTab === 'kpi' && (
        <div className="space-y-5">
          <div>
            <h2 className="font-headline text-xl font-bold text-on-surface">KPI компании</h2>
            <p className="text-xs text-on-surface-variant mt-1">
              Показатели на основе анкеты и целей собственника · обновляются в реальном времени
            </p>
          </div>
          {kpis.length === 0 ? (
            <EmptyState
              icon="monitoring"
              title="KPI ещё не настроены"
              description="Чтобы увидеть KPI компании, заполните анкету Точки А — данные подтянутся автоматически."
              ctaLabel="Заполнить анкету"
              ctaHref="/client/onboarding"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {kpis.map((kpi, i) => (
                <div
                  key={`${kpi.label}-${i}`}
                  className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 hover:border-secondary/20 transition-colors"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center">
                      <span className="material-symbols-outlined text-base text-secondary">{kpi.icon}</span>
                    </div>
                    <span className="text-[9px] font-mono uppercase px-2 py-0.5 bg-surface-container border border-white/[0.06] rounded-full text-on-surface-variant">
                      {kpi.category}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-on-surface-variant mb-2 uppercase tracking-wider">{kpi.label}</p>
                  <div className="flex items-end gap-2 mb-3">
                    <div>
                      <p className="text-[9px] text-on-surface-variant/60 mb-0.5">Текущее</p>
                      <p className="text-base font-mono font-bold text-on-surface">{kpi.current}</p>
                    </div>
                    <span className="material-symbols-outlined text-primary mb-0.5 text-sm">arrow_forward</span>
                    <div>
                      <p className="text-[9px] text-primary/70 mb-0.5">Целевое</p>
                      <p className="text-base font-mono font-bold text-primary break-words">{kpi.target}</p>
                    </div>
                  </div>
                  <div className="pt-2.5 border-t border-white/[0.04] flex items-center justify-between">
                    <p className="text-[9px] text-on-surface-variant/50">{kpi.method}</p>
                    <p className="text-[9px] font-mono text-on-surface-variant/40">{kpi.owner}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ TAB: ALL BIZ METRICS ══ */}
      {activeTab === 'biz' && (
        <div className="space-y-5">
          <div>
            <h2 className="font-headline text-xl font-bold text-on-surface">Все метрики бизнеса</h2>
            <p className="text-xs text-on-surface-variant mt-1">
              Полный каталог Точки А · live-значения из таблицы metrics, обновляются в реальном времени
            </p>
          </div>
          {/* The MetricsLiveCatalog above already renders the catalog with realtime
              wiring. We render an info card here to confirm the catalog is the
              authoritative source, and to point owners at it. */}
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 flex items-start gap-3">
            <span className="material-symbols-outlined text-primary text-base mt-0.5">info</span>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Все 122 показателя отображаются в каталоге выше (Точка А — Real-time). Используйте поиск, фильтр по
              namespace и отделу — значения тянутся из таблицы <code className="font-mono text-primary">public.metrics</code>.
            </p>
          </div>
        </div>
      )}

      {/* ══ TAB: GRI ══ */}
      {activeTab === 'gri' && (
        <div className="space-y-5">
          {!griAssessment ? (
            <EmptyState
              icon="insights"
              title="Тест GRI ещё не пройден"
              description="Пройдите GRI Assessment из 7 блоков — увидите свой Growth Readiness Index, слабые места и план на 90 дней."
              ctaLabel="Пройти GRI Assessment"
              ctaHref="/gri"
            />
          ) : (
            <>
              {/* Score header */}
              <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                  <div className="relative w-24 h-24 flex-shrink-0">
                    <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
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
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-mono font-bold text-on-surface">
                        {griAssessment.gri_index.toFixed(2)}
                      </span>
                      <span className="text-[9px] text-on-surface-variant">/10</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-widest mb-1">
                      GRI Score · Итоговый
                    </p>
                    <h2 className="font-headline text-2xl font-bold text-on-surface mb-1">
                      Индекс готовности к росту
                    </h2>
                    <p className="text-sm text-on-surface-variant mb-3">
                      Дата оценки:{' '}
                      {new Date(griAssessment.created_at).toLocaleDateString('ru-RU', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary">
                        {summary.strong} сильных
                      </span>
                      <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-tertiary-container/10 border border-tertiary-container/20 text-tertiary-container">
                        {summary.weak} слабых
                      </span>
                      <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-error/10 border border-error/20 text-error">
                        {summary.critical} критических
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 7 blocks */}
              <div className="space-y-2">
                {sectionRows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => openGriBlockModal(row.label)}
                    className="group relative bg-surface-container-low rounded-xl border border-white/[0.04] p-4 flex items-center gap-4 w-full text-left hover:bg-white/[0.02] hover:border-white/[0.08] transition-colors cursor-pointer"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${row.tone.bg}`}>
                      <span className={`material-symbols-outlined text-sm ${row.tone.text}`}>{row.icon}</span>
                    </div>
                    <p className="text-sm font-medium text-on-surface w-44 flex-shrink-0">{row.label}</p>
                    <div className="flex-1 h-2 bg-surface-container rounded-full overflow-hidden">
                      <div
                        className={`h-full ${row.tone.bar} rounded-full`}
                        style={{ width: `${(row.score / 10) * 100}%` }}
                      />
                    </div>
                    <span className={`text-sm font-mono font-bold w-14 text-right flex-shrink-0 ${row.tone.text}`}>
                      {row.score.toFixed(2)}/10
                    </span>
                    <span
                      className={`hidden sm:inline text-[9px] font-mono px-2 py-0.5 rounded-full border ${row.tone.badge} flex-shrink-0 max-w-[180px] truncate`}
                    >
                      {row.tone.status === 'critical'
                        ? 'КРИТИЧЕСКИЙ БЛОК'
                        : row.tone.status === 'weak'
                          ? 'Слабое место'
                          : 'Достаточный уровень'}
                    </span>
                  </button>
                ))}
              </div>

              {/* Insights */}
              {insights.length > 0 && (
                <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="material-symbols-outlined text-primary text-base">tips_and_updates</span>
                    <h3 className="font-headline text-base font-bold text-on-surface">Инсайты и советы</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {insights.map((insight, idx) => {
                      const sev =
                        insight.severity === 'critical'
                          ? { label: 'Critical', text: 'text-error', border: 'border-error/20', bg: 'bg-error/5' }
                          : insight.severity === 'warning'
                            ? {
                                label: 'Warning',
                                text: 'text-tertiary-container',
                                border: 'border-tertiary-container/20',
                                bg: 'bg-tertiary-container/5',
                              }
                            : {
                                label: 'Strong',
                                text: 'text-primary',
                                border: 'border-primary/20',
                                bg: 'bg-primary/5',
                              }
                      return (
                        <div key={idx} className={`bg-surface-container rounded-2xl border ${sev.border} p-5`}>
                          <div className="flex items-center justify-between mb-3">
                            <span
                              className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full border ${sev.text} ${sev.border} ${sev.bg}`}
                            >
                              {sev.label}
                            </span>
                            <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
                              {insight.section}
                            </span>
                          </div>
                          <p className="text-sm font-bold text-on-surface mb-3">{insight.problem}</p>
                          <div className="space-y-2 text-xs text-on-surface-variant leading-relaxed">
                            <p>
                              <span className="font-mono uppercase tracking-widest text-primary/70 text-[10px] mr-1">
                                Что делать:
                              </span>
                              {insight.recommendation}
                            </p>
                            <p>
                              <span className="font-mono uppercase tracking-widest text-error/70 text-[10px] mr-1">
                                Что теряете:
                              </span>
                              {insight.loss}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Top-5 lowest criteria */}
              {top5.length > 0 && (
                <div className="bg-surface-container-low rounded-2xl border border-error/20 p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="material-symbols-outlined text-error text-sm">warning</span>
                    <h3 className="font-headline text-base font-bold text-on-surface">Топ-5 ограничений роста</h3>
                  </div>
                  <div className="space-y-2">
                    {top5.map((item, i) => (
                      <div key={i} className="flex items-center gap-3 bg-surface-container rounded-xl px-4 py-2.5">
                        <div className="w-6 h-6 rounded-lg bg-error/10 border border-error/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-mono font-bold text-error">{item.score}</span>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-on-surface">{item.label}</p>
                          <p className="text-[10px] font-mono text-on-surface-variant">{item.block}</p>
                        </div>
                        <div className="w-20 h-1.5 bg-surface-container-high rounded-full overflow-hidden flex-shrink-0">
                          <div
                            className="h-full bg-error rounded-full"
                            style={{ width: `${(item.score / 10) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {modal && <MetricDetailModal {...modal} />}
    </div>
  )
}
