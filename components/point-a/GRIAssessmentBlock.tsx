import Link from 'next/link'
import dynamic from 'next/dynamic'
import { GRI_SECTIONS, type SectionId } from '@/lib/gri-assessment/sections'

const GRIAssessmentTrendChart = dynamic(() => import('./GRIAssessmentTrendChart'), {
  loading: () => (
    <div className="h-[120px] bg-white/[0.02] rounded-xl animate-pulse" />
  ),
})

interface AssessmentRow {
  id: string
  user_id: string
  company_id: string | null
  onboarding: Record<string, unknown> | null
  scores: Record<string, Record<string, number>> | null
  section_avgs: Record<string, number> | null
  gri_index: number
  completed_sections: Record<string, boolean> | null
  is_current: boolean
  created_at: string
}

function colorForScore(score: number): { text: string; bar: string; bg: string; border: string } {
  if (score >= 7) {
    return {
      text: 'text-primary',
      bar: 'bg-primary',
      bg: 'bg-primary/5',
      border: 'border-primary/20',
    }
  }
  if (score >= 4) {
    return {
      text: 'text-tertiary-container',
      bar: 'bg-tertiary-container',
      bg: 'bg-tertiary-container/5',
      border: 'border-tertiary-container/20',
    }
  }
  return {
    text: 'text-error',
    bar: 'bg-error',
    bg: 'bg-error/5',
    border: 'border-error/20',
  }
}

function statusForGRI(score: number): { label: string; tone: ReturnType<typeof colorForScore> } {
  if (score >= 7) return { label: 'Сильная база', tone: colorForScore(7) }
  if (score >= 4) return { label: 'Зона риска', tone: colorForScore(5) }
  return { label: 'Критическое состояние', tone: colorForScore(2) }
}

function computeSectionAvg(
  scores: Record<string, Record<string, number>> | null | undefined,
  section_avgs: Record<string, number> | null | undefined,
  sectionId: SectionId,
): number {
  if (section_avgs && typeof section_avgs[sectionId] === 'number') {
    return section_avgs[sectionId]
  }
  if (!scores || !scores[sectionId]) return 0
  const values = Object.values(scores[sectionId]).filter(
    (v): v is number => typeof v === 'number',
  )
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function findLowestCriterion(
  scores: Record<string, Record<string, number>> | null | undefined,
  sectionId: SectionId,
): { id: string; text: string; whatToImprove: string; businessLoss: string; score: number } | null {
  if (!scores || !scores[sectionId]) return null
  const section = GRI_SECTIONS.find((s) => s.id === sectionId)
  if (!section) return null
  const map = scores[sectionId]
  let lowest: { id: string; score: number } | null = null
  for (const crit of section.criteria) {
    const val = map[crit.id]
    if (typeof val !== 'number') continue
    if (!lowest || val < lowest.score) {
      lowest = { id: crit.id, score: val }
    }
  }
  if (!lowest) return null
  const crit = section.criteria.find((c) => c.id === lowest!.id)
  if (!crit) return null
  return {
    id: crit.id,
    text: crit.text,
    whatToImprove: crit.whatToImprove,
    businessLoss: crit.businessLoss,
    score: lowest.score,
  }
}

export default async function GRIAssessmentBlock({ userId }: { userId: string }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !serviceKey) {
    return null
  }

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

  let current: AssessmentRow | null = null
  let history: AssessmentRow[] = []
  try {
    const currentRes = await fetch(
      `${supabaseUrl}/rest/v1/gri_assessments?user_id=eq.${userId}&is_current=eq.true&select=*&limit=1`,
      { headers, cache: 'no-store' },
    )
    if (currentRes.ok) {
      const rows = (await currentRes.json()) as AssessmentRow[]
      current = Array.isArray(rows) && rows[0] ? rows[0] : null
    }

    const historyRes = await fetch(
      `${supabaseUrl}/rest/v1/gri_assessments?user_id=eq.${userId}&select=*&order=created_at.desc&limit=5`,
      { headers, cache: 'no-store' },
    )
    if (historyRes.ok) {
      const rows = (await historyRes.json()) as AssessmentRow[]
      history = Array.isArray(rows) ? rows : []
    }
  } catch (err) {
    console.error('[point-a/GRIAssessmentBlock] fetch error', err)
  }

  // Empty state
  if (!current) {
    return (
      <section>
        <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-6">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">GRI Assessment</h2>
            <p className="text-xs text-on-surface-variant mt-1">Глубокая оценка готовности к масштабированию</p>
          </div>
        </div>
        <div className="bg-surface-container-low rounded-2xl border border-dashed border-white/10 p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-3 block">
            insights
          </span>
          <p className="text-sm text-on-surface font-medium mb-1">Тест GRI ещё не пройден</p>
          <p className="text-xs text-on-surface-variant/80 mb-5">
            Пройдите детальный тест из 7 блоков и получите план роста.
          </p>
          <Link
            href="/gri"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary/10 hover:bg-primary/15 text-primary text-sm font-bold border border-primary/20 transition-colors focus:ring-2 focus:ring-primary/40 focus:outline-none"
          >
            <span className="material-symbols-outlined text-base">play_arrow</span>
            Пройти GRI Assessment
          </Link>
        </div>
      </section>
    )
  }

  const griIndex = current.gri_index ?? 0
  const status = statusForGRI(griIndex)

  // Δ vs previous
  // history is desc; index 0 = current, index 1 = previous
  const previous = history.length >= 2 ? history[1] : null
  const delta = previous && typeof previous.gri_index === 'number' ? griIndex - previous.gri_index : null

  // Section bars
  const sectionBars = GRI_SECTIONS.map((section) => {
    const avg = computeSectionAvg(current!.scores, current!.section_avgs, section.id)
    const prevAvg = previous
      ? computeSectionAvg(previous.scores, previous.section_avgs, section.id)
      : null
    const trend = prevAvg !== null && Math.abs(avg - prevAvg) >= 0.1 ? avg - prevAvg : null
    return { section, avg, trend }
  })

  // Insights: pick sections with avg < 6, sorted ascending, max 3
  const weakSections = sectionBars
    .filter((b) => b.avg < 6 && b.avg > 0)
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 3)

  type Insight = {
    severity: 'critical' | 'warning' | 'positive'
    section: string
    problem: string
    recommendation: string
    loss: string
  }

  const insights: Insight[] = []
  if (weakSections.length === 0) {
    insights.push({
      severity: 'positive',
      section: 'Все блоки',
      problem: 'Сильная база — фокус на масштабирование',
      recommendation:
        'Удерживайте текущий уровень и сосредоточьтесь на росте: премиум-сегменты, новые гео, апселлы.',
      loss: 'Без масштабирования вы оставляете рост на столе.',
    })
  } else {
    for (const { section, avg } of weakSections) {
      const crit = findLowestCriterion(current.scores, section.id)
      if (!crit) continue
      insights.push({
        severity: avg < 4 ? 'critical' : 'warning',
        section: section.shortTitle,
        problem: crit.text,
        recommendation: crit.whatToImprove,
        loss: crit.businessLoss,
      })
    }
  }

  // Trend chart data — chronological (oldest first) of last 5 attempts
  const trendPoints =
    history.length >= 2
      ? [...history]
          .reverse()
          .map((row, idx) => ({
            attempt: idx + 1,
            gri: Number(row.gri_index?.toFixed?.(2) ?? row.gri_index ?? 0),
            label: new Date(row.created_at).toLocaleDateString('ru-RU', {
              day: 'numeric',
              month: 'short',
            }),
          }))
      : []
  const trendDelta =
    trendPoints.length >= 2 ? trendPoints[trendPoints.length - 1].gri - trendPoints[0].gri : 0

  return (
    <section>
      <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center border border-white/[0.04]">
            <span className="material-symbols-outlined text-lg text-primary">insights</span>
          </div>
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">GRI Assessment</h2>
            <p className="text-xs text-on-surface-variant mt-1">
              Growth Readiness Index — 7 блоков · {new Date(current.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>
        <Link
          href="/gri"
          className="text-xs text-primary/70 hover:text-primary transition-colors font-mono flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-sm">edit</span>
          Пройти заново
        </Link>
      </div>

      {/* Compact header: GRI summary (left) + quick-action CTAs (right) */}
      <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-4 mb-4">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-center">
          {/* GRI summary — compact, single row */}
          <div className="lg:col-span-2 flex flex-wrap items-baseline gap-3">
            <div>
              <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.18em]">GRI Index</p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className={`text-3xl font-mono font-black ${status.tone.text}`}>
                  {griIndex.toFixed(1)}
                </span>
                <span className="text-[10px] font-mono text-on-surface-variant">/ 10</span>
              </div>
            </div>
            {delta !== null && Math.abs(delta) >= 0.05 && (
              <span
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold border ${
                  delta > 0
                    ? 'text-primary border-primary/20 bg-primary/5'
                    : 'text-error border-error/20 bg-error/5'
                }`}
              >
                <span className="material-symbols-outlined text-[12px]">
                  {delta > 0 ? 'trending_up' : 'trending_down'}
                </span>
                {delta > 0 ? '+' : ''}{delta.toFixed(1)}
              </span>
            )}
            <span className={`text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded-md border ${status.tone.text} ${status.tone.border} ${status.tone.bg}`}>
              {status.label}
            </span>
            <div className="ml-auto text-right">
              <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">Цель</p>
              <p className="text-sm font-mono font-bold text-primary">8.5+</p>
            </div>
          </div>

          {/* Quick-action CTAs — fills the previously-empty right zone */}
          <div className="lg:col-span-3 grid grid-cols-2 lg:grid-cols-3 gap-1.5">
            <Link
              href="/gri"
              className="flex items-center gap-1.5 bg-primary/10 hover:bg-primary/15 border border-primary/30 text-primary text-[11px] font-mono px-2.5 py-1.5 rounded-lg transition-colors"
              title="Открыть калькулятор и пройти GRI заново"
            >
              <span className="material-symbols-outlined text-[14px]">play_arrow</span>
              <span className="truncate">Пройти GRI</span>
            </Link>
            <Link
              href="/client/onboarding"
              className="flex items-center gap-1.5 bg-surface-container hover:bg-surface-container-high border border-white/[0.06] hover:border-primary/20 text-on-surface text-[11px] font-mono px-2.5 py-1.5 rounded-lg transition-colors"
              title="Заполнить анкету или приложить документы"
            >
              <span className="material-symbols-outlined text-[14px] text-primary/70">edit_note</span>
              <span className="truncate">Анкета · файлы</span>
            </Link>
            <Link
              href="/gri"
              className="flex items-center gap-1.5 bg-surface-container hover:bg-surface-container-high border border-white/[0.06] hover:border-primary/20 text-on-surface text-[11px] font-mono px-2.5 py-1.5 rounded-lg transition-colors"
              title="Перейти к экспорту: «Скачать» в шапке калькулятора генерирует PDF"
            >
              <span className="material-symbols-outlined text-[14px] text-primary/70">download</span>
              <span className="truncate">PDF отчёт</span>
            </Link>
            <Link
              href="/point-b"
              className="flex items-center gap-1.5 bg-surface-container hover:bg-surface-container-high border border-white/[0.06] hover:border-primary/20 text-on-surface text-[11px] font-mono px-2.5 py-1.5 rounded-lg transition-colors"
              title="Сгенерировать стратегию роста на основе GRI"
            >
              <span className="material-symbols-outlined text-[14px] text-primary/70">auto_awesome</span>
              <span className="truncate">Стратегия роста</span>
            </Link>
            <a
              href="https://tidycal.com/istart/gtm"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-on-primary text-[11px] font-mono px-2.5 py-1.5 rounded-lg transition-colors col-span-2 lg:col-span-1"
              title="Записаться на консультацию с экспертом"
            >
              <span className="material-symbols-outlined text-[14px]">event_available</span>
              <span className="truncate">Консультация</span>
              <span className="material-symbols-outlined text-[12px] opacity-70 ml-auto">open_in_new</span>
            </a>
          </div>
        </div>
      </div>

      {/* 7-section bars — use a 7-col equal grid on wide screens so all
          sections fit on a single row without orphan cells. Falls back to
          2/3/4 on smaller screens. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 mb-6">
        {sectionBars.map(({ section, avg, trend }) => {
          const pct = (avg / 10) * 100
          const tone = colorForScore(avg)
          const isStrong = avg >= 7
          const isCritical = avg < 4
          return (
            <div
              key={section.id}
              className="bg-surface-container-low rounded-xl border border-white/[0.04] hover:border-primary/10 p-3 transition-all"
              title={section.title}
            >
              <div className="flex items-start justify-between mb-2 gap-1">
                <span
                  className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded-md border ${tone.text} ${tone.border} ${tone.bg}`}
                >
                  {isCritical ? 'Крит' : isStrong ? 'Сильно' : 'Средне'}
                </span>
                {trend !== null && (
                  <span
                    className={`inline-flex items-center gap-0.5 text-[10px] font-mono tabular-nums ${
                      trend > 0 ? 'text-primary' : 'text-error'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[11px]">
                      {trend > 0 ? 'trending_up' : 'trending_down'}
                    </span>
                    {trend > 0 ? '+' : ''}
                    {trend.toFixed(1)}
                  </span>
                )}
              </div>
              <h3 className="text-[11px] font-bold text-on-surface mb-2 leading-tight line-clamp-2 min-h-[28px]">
                {section.shortTitle}
              </h3>
              <div className="flex items-baseline gap-1 mb-1.5">
                <span className="text-xl font-mono font-bold text-on-surface tabular-nums">{avg.toFixed(1)}</span>
                <span className="text-[9px] text-on-surface-variant font-mono">/ 10</span>
              </div>
              <div className="h-1 bg-surface-container rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${tone.bar}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Insights & советы */}
      <div className="mb-6">
        <h3 className="font-headline text-base font-bold text-on-surface mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">tips_and_updates</span>
          Инсайты и советы
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {insights.map((insight, idx) => {
            const sev =
              insight.severity === 'critical'
                ? { label: 'Critical', text: 'text-error', border: 'border-error/20', bg: 'bg-error/5' }
                : insight.severity === 'warning'
                  ? { label: 'Warning', text: 'text-tertiary-container', border: 'border-tertiary-container/20', bg: 'bg-tertiary-container/5' }
                  : { label: 'Strong', text: 'text-primary', border: 'border-primary/20', bg: 'bg-primary/5' }
            return (
              <div
                key={idx}
                className={`bg-surface-container-low rounded-2xl border ${sev.border} p-5`}
              >
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

      {/* Dynamic (only if 2+ attempts) */}
      {trendPoints.length >= 2 && (
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-headline text-base font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">timeline</span>
              Динамика GRI
            </h3>
            <span
              className={`inline-flex items-center gap-1 text-xs font-mono font-bold ${
                trendDelta > 0 ? 'text-primary' : trendDelta < 0 ? 'text-error' : 'text-on-surface-variant'
              }`}
            >
              <span className="material-symbols-outlined text-sm">
                {trendDelta > 0 ? 'trending_up' : trendDelta < 0 ? 'trending_down' : 'trending_flat'}
              </span>
              {trendDelta > 0 ? '+' : ''}
              {trendDelta.toFixed(1)} за последние {trendPoints.length} попыток
            </span>
          </div>
          <GRIAssessmentTrendChart data={trendPoints} />
        </div>
      )}
    </section>
  )
}
