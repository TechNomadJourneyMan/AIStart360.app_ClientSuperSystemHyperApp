export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/ui/Logo'
import {
  getShareByToken,
  incrementShareViews,
} from '@/lib/share/tokens'
import {
  loadSubject,
  loadGriView,
  loadPointAView,
  loadPointBView,
  loadSurveyView,
  type ReportSubject,
} from '@/lib/share/report-data'
import {
  SURVEY_LABELS,
  SURVEY_STEP_LABELS,
  getStepFromKey,
  formatSurveyValue,
} from '@/lib/survey-labels'

// Read-only public viewer — keep it out of search indexes.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

// ─── Type metadata ─────────────────────────────────────────────────────────────

const TYPE_META: Record<
  string,
  { tag: string; title: string; icon: string }
> = {
  survey: { tag: 'Онбординг · Анкета', title: 'Анкета компании', icon: 'assignment' },
  gri: {
    tag: 'Growth Readiness Index',
    title: 'Индекс готовности к росту',
    icon: 'speed',
  },
  point_a: {
    tag: 'Точка А · Диагностика',
    title: 'Точка А — диагностика бизнеса',
    icon: 'analytics',
  },
  point_b: {
    tag: 'Точка Б · Цель',
    title: 'Точка Б — план достижения цели',
    icon: 'flag',
  },
}

// ─── Small presentational helpers ───────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 70) return '#6EFFC0'
  if (score >= 45) return '#FBBF24'
  return '#EF4444'
}

function roadmapHorizonLabel(horizon: string): { title: string; color: string } {
  const map: Record<string, { title: string; color: string }> = {
    '30_days': { title: '30 дней', color: 'text-emerald-400' },
    '90_days': { title: '90 дней', color: 'text-blue-400' },
    '180_days': { title: '180 дней', color: 'text-violet-400' },
  }
  return map[horizon] ?? { title: horizon, color: 'text-on-surface-variant' }
}

function severityClass(sev?: string): string {
  const s = (sev || '').toLowerCase()
  if (s === 'critical') return 'text-error'
  if (s === 'high' || s === 'important') return 'text-amber-400'
  return 'text-on-surface-variant'
}

function fmtKzt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${Math.round(n).toLocaleString('ru-RU')} ₸`
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${Math.round(n)}%`
}

function fmtMult(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${Math.round(n * 10) / 10}×`
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const clamped = Math.max(0, Math.min(100, score))
  const color = scoreColor(clamped)
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-on-surface">{label}</span>
        <span className="text-xs font-mono font-bold" style={{ color }}>
          {Math.round(clamped)}/100
        </span>
      </div>
      <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${clamped}%`, background: color }}
        />
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-surface-container rounded-2xl border border-white/[0.06] shadow-card p-6">
      <h2 className="font-headline text-lg font-bold text-on-surface mb-4">
        {title}
      </h2>
      {children}
    </section>
  )
}

// ─── Invalid / expired state ─────────────────────────────────────────────────────

function InvalidLink() {
  return (
    <main className="min-h-screen bg-[#0A0B0F] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-surface-container rounded-2xl border border-white/[0.06] shadow-card p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-error/10 flex items-center justify-center mx-auto mb-5">
          <span className="material-symbols-outlined text-3xl text-error">
            link_off
          </span>
        </div>
        <h1 className="font-headline text-xl font-bold text-on-surface mb-2">
          Ссылка недействительна или истекла
        </h1>
        <p className="text-sm text-on-surface-variant">
          Эта ссылка на отчёт была отозвана или срок её действия закончился.
          Попросите автора сформировать новую ссылку.
        </p>
      </div>
    </main>
  )
}

// ─── Report header ─────────────────────────────────────────────────────────────

function ReportHeader({
  subject,
  type,
}: {
  subject: ReportSubject
  type: string
}) {
  const meta = TYPE_META[type] ?? {
    tag: 'Отчёт',
    title: 'Отчёт',
    icon: 'description',
  }
  return (
    <header className="bg-surface-container-low rounded-2xl border border-white/[0.06] shadow-card p-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-2xl text-primary">
            {meta.icon}
          </span>
        </div>
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-1.5">
            {meta.tag}
          </p>
          <h1 className="font-headline text-2xl font-extrabold text-on-surface leading-tight">
            {meta.title}
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            {subject.companyName}
            {subject.industry ? ` · ${subject.industry}` : ''}
          </p>
        </div>
      </div>
    </header>
  )
}

// ─── Top navigation bar (exit affordance) ────────────────────────────────────────

function TopBar() {
  return (
    <div className="sticky top-0 z-20 bg-[#0A0B0F]/90 backdrop-blur border-b border-white/[0.06]">
      <div className="max-w-3xl mx-auto px-5 h-14 flex items-center justify-between gap-4">
        <Logo href="/" />
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-primary/10 border border-primary/20 px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-primary">
          <span className="material-symbols-outlined text-sm">visibility</span>
          Только просмотр
        </span>
      </div>
    </div>
  )
}

// ─── Footer CTA (exit + next step for a recipient without an account) ─────────────

function ViewerFooter() {
  return (
    <footer className="pt-2 pb-10 space-y-5">
      <div className="bg-surface-container-low rounded-2xl border border-primary/20 shadow-card p-6 text-center">
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">
          AIStart360
        </p>
        <h2 className="font-headline text-xl font-bold text-on-surface mb-2">
          Получите такую же диагностику бизнеса
        </h2>
        <p className="text-sm text-on-surface-variant max-w-md mx-auto mb-5">
          Бесплатная экспресс-оценка готовности к росту за 5 минут — без
          регистрации.
        </p>
        <Link
          href="/gri-free"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm px-6 py-3 transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          Создать свою диагностику
          <span className="material-symbols-outlined text-base">arrow_forward</span>
        </Link>
      </div>
      <p className="text-center text-xs font-mono text-on-surface-variant">
        © AIStart360 · Документ предоставлен в режиме «только просмотр»
      </p>
    </footer>
  )
}

// ─── Per-type bodies ─────────────────────────────────────────────────────────────

function NoData() {
  return (
    <Section title="Данные пока не сформированы">
      <p className="text-sm text-on-surface-variant">
        Для этой компании ещё нет рассчитанного отчёта.
      </p>
    </Section>
  )
}

async function GriBody({ subject }: { subject: ReportSubject }) {
  const data = await loadGriView(subject).catch(() => null)
  if (!data) return <NoData />
  return (
    <>
      <Section title="Общий индекс готовности">
        <div className="flex items-baseline gap-3">
          <span
            className="font-mono text-5xl font-extrabold"
            style={{ color: scoreColor(data.overall) }}
          >
            {data.overall}
          </span>
          <span className="text-sm text-on-surface-variant">/100</span>
        </div>
      </Section>

      {data.blocks.length > 0 && (
        <Section title="Готовность по блокам">
          <div className="space-y-4">
            {data.blocks.map((b) => (
              <ScoreBar key={b.key} label={b.label} score={b.score} />
            ))}
          </div>
        </Section>
      )}

      {data.top5.length > 0 && (
        <Section title="TOP-5 ограничений роста">
          <ol className="space-y-2.5">
            {data.top5.slice(0, 5).map((t, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="font-mono text-xs text-on-surface-variant mt-0.5 w-5 flex-shrink-0">
                  {t.rank}.
                </span>
                <span className={`text-sm ${severityClass(t.severity)}`}>
                  {t.title}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {data.actionPlan.length > 0 && (
        <Section title="Приоритетный план действий">
          <div className="space-y-3">
            {data.actionPlan.map((a, i) => (
              <div
                key={i}
                className="bg-surface-container-low rounded-xl border border-white/[0.06] p-4"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-primary/70 uppercase tracking-wider">
                    {a.horizon}
                  </span>
                </div>
                <p className="text-sm text-on-surface">{a.title}</p>
                {a.detail && (
                  <p className="text-xs text-on-surface-variant mt-1">
                    {a.detail}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

async function PointABody({ subject }: { subject: ReportSubject }) {
  const data = await loadPointAView(subject).catch(() => null)
  if (!data) return <NoData />
  return (
    <>
      <Section title="Сводные показатели">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-1">
              Общая оценка
            </p>
            <p
              className="font-mono text-3xl font-extrabold"
              style={{ color: scoreColor(data.overallScore) }}
            >
              {Math.round(data.overallScore)}
              <span className="text-sm text-on-surface-variant font-normal">
                /100
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-1">
              Индекс здоровья
            </p>
            <p
              className="font-mono text-3xl font-extrabold"
              style={{ color: scoreColor(data.healthIndex) }}
            >
              {Math.round(data.healthIndex)}
              <span className="text-sm text-on-surface-variant font-normal">
                /100
              </span>
            </p>
          </div>
        </div>
      </Section>

      {data.executiveSummary && (
        <Section title="Краткое резюме">
          <p className="text-sm text-on-surface leading-relaxed">
            {data.executiveSummary}
          </p>
        </Section>
      )}

      <Section title="Оценки по блокам">
        <div className="space-y-4">
          {data.blocks.map((b) => (
            <ScoreBar key={b.key} label={b.label} score={b.score} />
          ))}
        </div>
      </Section>

      {data.blocks.some(
        (b) => b.diagnosis || b.key_risk || b.top_recommendation,
      ) && (
        <Section title="Разбор по блокам">
          <div className="space-y-4">
            {data.blocks
              .filter(
                (b) => b.diagnosis || b.key_risk || b.top_recommendation,
              )
              .map((b) => (
                <div
                  key={b.key}
                  className="bg-surface-container-low rounded-xl border border-white/[0.06] p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-on-surface">
                      {b.label}
                    </span>
                    <span
                      className="text-xs font-mono font-bold"
                      style={{ color: scoreColor(b.score) }}
                    >
                      {Math.round(b.score)}/100
                    </span>
                  </div>
                  {b.diagnosis && (
                    <p className="text-sm text-on-surface mb-2">{b.diagnosis}</p>
                  )}
                  {b.benchmark_comparison && (
                    <p className="text-xs text-on-surface-variant mb-1">
                      <span className="text-blue-400">Бенчмарк:</span>{' '}
                      {b.benchmark_comparison}
                    </p>
                  )}
                  {b.key_risk && (
                    <p className="text-xs text-on-surface-variant mb-1">
                      <span className="text-error">Риск:</span> {b.key_risk}
                    </p>
                  )}
                  {b.top_recommendation && (
                    <p className="text-xs text-on-surface-variant">
                      <span className="text-primary">Рекомендация:</span>{' '}
                      {b.top_recommendation}
                    </p>
                  )}
                </div>
              ))}
          </div>
        </Section>
      )}

      {data.risks.length > 0 && (
        <Section title="Ключевые риски">
          <ul className="space-y-2.5">
            {data.risks.map((r, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  className={`material-symbols-outlined text-base mt-0.5 flex-shrink-0 ${severityClass(
                    r.level,
                  )}`}
                >
                  {r.level === 'critical' ? 'error' : 'warning'}
                </span>
                <p className="text-sm text-on-surface">
                  <span className="text-on-surface-variant">{r.area}:</span>{' '}
                  {r.text}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {data.strategicPriorities.length > 0 && (
        <Section title="Стратегические приоритеты">
          <div className="space-y-3">
            {data.strategicPriorities.map((p, i) => (
              <div
                key={i}
                className="bg-surface-container-low rounded-xl border border-white/[0.06] p-4 relative"
              >
                <div className="absolute top-3.5 right-3.5 w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center">
                  <span className="text-xs font-mono font-bold text-primary">
                    {i + 1}
                  </span>
                </div>
                <p className="text-sm font-bold text-on-surface mb-1.5 pr-8">
                  {p.title}
                </p>
                {p.rationale && (
                  <p className="text-xs text-on-surface-variant mb-2">
                    {p.rationale}
                  </p>
                )}
                {p.expected_impact && (
                  <div className="flex items-start gap-1.5 pt-2 border-t border-white/[0.06]">
                    <span className="material-symbols-outlined text-sm text-primary mt-0.5 flex-shrink-0">
                      trending_up
                    </span>
                    <p className="text-xs text-primary">{p.expected_impact}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {data.growthRoadmap.length > 0 && (
        <Section title="Дорожная карта роста">
          <div className="space-y-4">
            {data.growthRoadmap.map((rm) => {
              const l = roadmapHorizonLabel(rm.horizon)
              return (
                <div
                  key={rm.horizon}
                  className="bg-surface-container-low rounded-xl border border-white/[0.06] p-4"
                >
                  <p
                    className={`text-xs font-mono font-bold uppercase tracking-widest mb-2.5 ${l.color}`}
                  >
                    {l.title}
                  </p>
                  <ul className="space-y-1.5">
                    {rm.actions.map((action, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-xs text-on-surface-variant"
                      >
                        <span className="material-symbols-outlined text-sm text-primary mt-0.5 flex-shrink-0">
                          check_circle
                        </span>
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {data.quickWins.length > 0 && (
        <Section title="Быстрые победы">
          <div className="space-y-2.5">
            {data.quickWins.map((qw, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-surface-container-low rounded-xl border border-white/[0.06] p-4"
              >
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-xs text-primary">
                    check
                  </span>
                </div>
                <div className="flex-1">
                  <p className="text-sm text-on-surface">{qw.action}</p>
                  {qw.area && (
                    <p className="text-xs text-on-surface-variant">{qw.area}</p>
                  )}
                </div>
                {qw.timeline && (
                  <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-1 rounded-lg flex-shrink-0">
                    {qw.timeline}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {data.industryContext && (
        <Section title="Контекст отрасли">
          <p className="text-sm text-on-surface-variant leading-relaxed">
            {data.industryContext}
          </p>
        </Section>
      )}
    </>
  )
}

async function PointBBody({ subject }: { subject: ReportSubject }) {
  const data = await loadPointBView(subject).catch(() => null)
  if (!data) return <NoData />
  const gap12 = data.gap.find((g) => g.horizon === '12m')
  const ai = data.ai_strategy as
    | {
        strategic_bridge_summary?: string
        milestones?: Array<{ q?: string; title?: string; desc?: string }>
      }
    | null
  return (
    <>
      <Section title="Цели владельца">
        <div className="space-y-2">
          <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
            <span className="text-sm text-on-surface-variant">
              Текущая выручка / год
            </span>
            <span className="font-mono text-sm text-on-surface">
              {fmtKzt(data.goals.current_revenue_year)}
            </span>
          </div>
          <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
            <span className="text-sm text-on-surface-variant">
              Цель на 12 месяцев / год
            </span>
            <span className="font-mono text-sm text-primary">
              {fmtKzt(data.goals.goal_12m_revenue_year)}
            </span>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm text-on-surface-variant">
              Цель на 3 года / год
            </span>
            <span className="font-mono text-sm text-primary">
              {fmtKzt(data.goals.goal_3y_revenue_year)}
            </span>
          </div>
        </div>
        {data.goals.main_pain && (
          <p className="text-xs text-on-surface-variant mt-4">
            <span className="text-on-surface">Главная боль:</span>{' '}
            {data.goals.main_pain}
          </p>
        )}
      </Section>

      {gap12 && (
        <Section title="Разрыв до цели">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-1">
                Множитель 12 мес
              </p>
              <p className="font-mono text-2xl font-extrabold text-primary">
                {fmtMult(gap12.multiplier)}
              </p>
            </div>
            <div>
              <p className="text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-1">
                Требуемый CAGR
              </p>
              <p className="font-mono text-2xl font-extrabold text-on-surface">
                {fmtPct(gap12.required_cagr)}
              </p>
            </div>
          </div>
        </Section>
      )}

      {data.realism && data.realism.level !== 'unknown' && (
        <Section title="Реалистичность цели">
          <div className="flex items-center gap-4 mb-3">
            <span
              className="font-mono text-3xl font-extrabold"
              style={{ color: scoreColor(data.realism.score) }}
            >
              {Math.round(data.realism.score)}
              <span className="text-sm text-on-surface-variant font-normal">
                /100
              </span>
            </span>
            <span className="text-sm text-on-surface-variant">
              уверенность в достижимости
            </span>
          </div>
          {data.realism.rationale.length > 0 && (
            <ul className="space-y-1.5">
              {data.realism.rationale.map((r, i) => (
                <li
                  key={i}
                  className="text-sm text-on-surface-variant flex items-start gap-2"
                >
                  <span className="material-symbols-outlined text-sm text-primary mt-0.5 flex-shrink-0">
                    chevron_right
                  </span>
                  {r}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {data.scenarios.length > 0 && (
        <Section title="Сценарии роста">
          <div className="space-y-3">
            {data.scenarios.map((s) => (
              <div
                key={s.key}
                className="bg-surface-container-low rounded-xl border border-white/[0.06] p-4 flex items-center justify-between gap-4"
              >
                <span className="text-sm font-medium text-on-surface">
                  {s.label}
                </span>
                <div className="text-right">
                  <p className="font-mono text-sm text-primary">
                    {fmtKzt(s.target_revenue_12m)}
                  </p>
                  <p className="text-xs text-on-surface-variant">за 12 мес</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {data.levers.length > 0 && (
        <Section title="Рычаги роста">
          <div className="space-y-3">
            {data.levers
              .slice()
              .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
              .map((l) => (
                <div
                  key={l.key}
                  className="bg-surface-container-low rounded-xl border border-white/[0.06] p-4"
                >
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <span className="text-sm font-medium text-on-surface">
                      {l.label}
                    </span>
                    <span
                      className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-lg flex-shrink-0 ${
                        l.difficulty === 'high'
                          ? 'text-error bg-error/10'
                          : l.difficulty === 'medium'
                            ? 'text-amber-400 bg-amber-400/10'
                            : 'text-primary bg-primary/10'
                      }`}
                    >
                      {l.difficulty === 'high'
                        ? 'Сложно'
                        : l.difficulty === 'medium'
                          ? 'Средне'
                          : 'Просто'}
                    </span>
                  </div>
                  {l.expected_effect && (
                    <p className="text-xs text-on-surface-variant">
                      {l.expected_effect}
                    </p>
                  )}
                </div>
              ))}
          </div>
        </Section>
      )}

      {data.growth_decomposition &&
        (data.growth_decomposition.summary ||
          data.growth_decomposition.steps.length > 0) && (
          <Section title="Декомпозиция роста">
            {data.growth_decomposition.required_multiplier != null && (
              <p className="text-sm text-on-surface-variant mb-3">
                Требуемый множитель выручки:{' '}
                <span className="font-mono font-bold text-primary">
                  {fmtMult(data.growth_decomposition.required_multiplier)}
                </span>
              </p>
            )}
            {data.growth_decomposition.summary && (
              <p className="text-sm text-on-surface leading-relaxed mb-3">
                {data.growth_decomposition.summary}
              </p>
            )}
            {data.growth_decomposition.steps.length > 0 && (
              <ul className="space-y-1.5">
                {data.growth_decomposition.steps.map((s) => (
                  <li
                    key={s.key}
                    className="flex items-start gap-2 text-sm text-on-surface-variant"
                  >
                    <span className="material-symbols-outlined text-sm text-primary mt-0.5 flex-shrink-0">
                      chevron_right
                    </span>
                    <span>
                      <span className="text-on-surface">{s.label}</span>
                      {s.note ? ` — ${s.note}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

      {data.top5_limits.length > 0 && (
        <Section title="TOP-5 ограничений роста">
          <ol className="space-y-2.5">
            {data.top5_limits.slice(0, 5).map((t, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="font-mono text-xs text-on-surface-variant mt-0.5 w-5 flex-shrink-0">
                  {t.rank}.
                </span>
                <span className={`text-sm ${severityClass(t.severity)}`}>
                  {t.title}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {ai && (ai.strategic_bridge_summary || (ai.milestones?.length ?? 0) > 0) && (
        <Section title="Стратегический мост к цели">
          {ai.strategic_bridge_summary && (
            <p className="text-sm text-on-surface leading-relaxed mb-4">
              {ai.strategic_bridge_summary}
            </p>
          )}
          {ai.milestones && ai.milestones.length > 0 && (
            <div className="space-y-2.5">
              {ai.milestones.map((m, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-xs font-mono text-primary/70 uppercase tracking-wider mt-0.5 flex-shrink-0">
                    {m.q}
                  </span>
                  <div>
                    <p className="text-sm text-on-surface">{m.title}</p>
                    {m.desc && (
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        {m.desc}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </>
  )
}

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

async function SurveyBody({ subject }: { subject: ReportSubject }) {
  const data = await loadSurveyView(subject).catch(() => null)
  if (!data) return <NoData />

  const byStep = new Map<number, Array<[string, unknown]>>()
  for (const [key, value] of Object.entries(data.answers)) {
    if (!hasValue(value)) continue
    const step = getStepFromKey(key)
    if (step <= 0) continue
    if (!byStep.has(step)) byStep.set(step, [])
    byStep.get(step)!.push([key, value])
  }
  const steps = Array.from(byStep.keys()).sort((a, b) => a - b)

  if (steps.length === 0) {
    return (
      <Section title="Ответы анкеты">
        <p className="text-sm text-on-surface-variant">
          Ответы анкеты не заполнены.
        </p>
      </Section>
    )
  }

  return (
    <>
      {steps.map((step) => (
        <Section
          key={step}
          title={`${step}. ${SURVEY_STEP_LABELS[step] ?? `Шаг ${step}`}`}
        >
          <div className="space-y-2.5">
            {byStep.get(step)!.map(([key, value]) => (
              <div
                key={key}
                className="flex items-start justify-between gap-4 py-1.5 border-b border-white/[0.04] last:border-0"
              >
                <span className="text-sm text-on-surface-variant flex-1">
                  {SURVEY_LABELS[key] ?? key}
                </span>
                <span className="text-sm text-on-surface text-right font-medium max-w-[55%]">
                  {formatSurveyValue(key, value)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      ))}
    </>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default async function SharedReportPage({
  params,
}: {
  params: { token: string }
}) {
  // Defensive: getShareByToken already degrades to null on transport/HTTP
  // errors, but guard here too so the public viewer can never 500 — any throw
  // becomes the InvalidLink card.
  let share: Awaited<ReturnType<typeof getShareByToken>> = null
  try {
    share = await getShareByToken(params.token)
  } catch {
    share = null
  }
  if (!share) return <InvalidLink />

  // Record the view (best-effort, never blocks the render).
  await incrementShareViews(params.token).catch(() => {})

  // Subject load must not throw the page into the global 500 — degrade to
  // InvalidLink on any failure.
  let subject: ReportSubject | null = null
  try {
    subject = await loadSubject(share.companyId)
  } catch {
    subject = null
  }
  if (!subject) return <InvalidLink />

  return (
    <main className="min-h-screen bg-[#0A0B0F]">
      <TopBar />
      <div className="max-w-3xl mx-auto px-5 py-8 space-y-5">
        <ReportHeader subject={subject} type={share.type} />

        {share.type === 'gri' && <GriBody subject={subject} />}
        {share.type === 'point_a' && <PointABody subject={subject} />}
        {share.type === 'point_b' && <PointBBody subject={subject} />}
        {share.type === 'survey' && <SurveyBody subject={subject} />}

        <ViewerFooter />
      </div>
    </main>
  )
}
