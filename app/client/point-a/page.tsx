'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import type { Diagnostic, BlockScore, Risk, Insight, QuickWin, DiagnosticStage } from '@/types/onboarding'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function stageLabel(s: DiagnosticStage | null): string {
  const map: Record<DiagnosticStage, string> = {
    seed: 'Seed', early: 'Early', growth: 'Growth', scale: 'Scale', mature: 'Mature'
  }
  return s ? map[s] : '—'
}

function blockLabel(status: string | undefined): { text: string; color: string } {
  const m: Record<string, { text: string; color: string }> = {
    critical:  { text: 'Критично',  color: 'text-error' },
    weak:      { text: 'Слабо',     color: 'text-orange-400' },
    average:   { text: 'Средне',    color: 'text-amber-400' },
    strong:    { text: 'Сильно',    color: 'text-primary' },
    excellent: { text: 'Отлично',   color: 'text-emerald-400' },
  }
  return m[status ?? ''] ?? { text: '—', color: 'text-on-surface-variant' }
}

function riskIcon(level: string): { icon: string; color: string; bg: string } {
  if (level === 'critical') return { icon: 'error', color: 'text-error', bg: 'bg-error/10' }
  if (level === 'important') return { icon: 'warning', color: 'text-amber-400', bg: 'bg-amber-400/10' }
  return { icon: 'info', color: 'text-on-surface-variant', bg: 'bg-surface-container' }
}

function ScoreGauge({ score, size = 120 }: { score: number; size?: number }) {
  const r = (size / 2) - 12
  const circ = 2 * Math.PI * r
  const arc = circ * 0.75
  const dash = (score / 100) * arc
  const offset = circ * 0.125

  const color = score >= 70 ? '#6EFFC0' : score >= 45 ? '#FBBF24' : '#EF4444'

  return (
    <svg width={size} height={size} className="rotate-[135deg]">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={10} strokeDasharray={`${arc} ${circ - arc}`} strokeDashoffset={-offset} strokeLinecap="round" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={10} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset} strokeLinecap="round" style={{ transition: 'stroke-dasharray 1s ease' }} />
    </svg>
  )
}

function BlockCard({ title, icon, score }: { title: string; icon: string; score: BlockScore | null }) {
  const [open, setOpen] = useState(false)
  const pct = score?.score ?? 0
  const lbl = blockLabel(score?.status)

  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-5 transition-all hover:border-primary/20">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-sm text-primary">{icon}</span>
          </div>
          <span className="text-sm font-medium text-on-surface">{title}</span>
        </div>
        <span className={`text-xs font-mono font-bold ${lbl.color}`}>
          {(pct / 10).toFixed(1)}/10
        </span>
      </div>

      <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden mb-2">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{
            width: `${pct}%`,
            background: pct >= 70 ? 'linear-gradient(90deg, #6EFFC0, #00e29e)' : pct >= 45 ? '#FBBF24' : '#EF4444'
          }}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className={`text-xs font-mono ${lbl.color}`}>{lbl.text}</span>
        {(score?.top_issues?.length ?? 0) > 0 && (
          <button onClick={() => setOpen(v => !v)} className="text-xs text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1">
            {open ? 'Свернуть' : 'Подробнее'}
            <span className="material-symbols-outlined text-xs">{open ? 'expand_less' : 'expand_more'}</span>
          </button>
        )}
      </div>

      {open && score && (
        <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-3">
          {score.top_issues.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Проблемы</p>
              <ul className="space-y-1">
                {score.top_issues.map((iss, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-on-surface-variant">
                    <span className="material-symbols-outlined text-xs text-error mt-0.5 flex-shrink-0">close</span>
                    {iss}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {score.recommendations.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Рекомендации</p>
              <ul className="space-y-1">
                {score.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-on-surface-variant">
                    <span className="material-symbols-outlined text-xs text-primary mt-0.5 flex-shrink-0">arrow_forward</span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PointAClientPage() {
  const [diag, setDiag] = useState<Diagnostic | null>(null)
  const [company, setCompany] = useState<{ name: string; industry: string | null; employee_count: number | null } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRecalculating, setIsRecalculating] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [recalculateError, setRecalculateError] = useState<string | null>(null)

  useEffect(() => {
    const sb = createClient()
    sb.auth.getSession().then(({ data, error }) => {
      const u = data.session?.user
      if (u?.id) {
        setUserId(u.id)
        return
      }

      setIsLoading(false)
      setLoadError(error?.message ?? 'Не удалось определить текущего пользователя.')
    })
  }, [])

  const loadData = useCallback(async (background = false) => {
    if (!userId) return false
    if (!background) setIsLoading(true)
    setLoadError(null)

    try {
      const [diagRes, compRes] = await Promise.all([
        fetch(`/api/v1/diagnostics/current?user_id=${userId}`),
        fetch(`/api/v1/onboarding/company?user_id=${userId}`),
      ])

      const diagData = await diagRes.json()
      const compData = await compRes.json()

      if (!diagRes.ok || diagData.ok !== true) {
        throw new Error(diagData.error || 'Не удалось загрузить диагностику.')
      }
      if (!compRes.ok || compData.ok !== true) {
        throw new Error(compData.error || 'Не удалось загрузить данные компании.')
      }

      setDiag(diagData.data ?? null)
      setCompany(compData.data ?? null)
      return true
    } catch (error) {
      console.error('[client/point-a] data load failed', error)
      setLoadError('Не удалось обновить данные «Точки А». Проверьте соединение и повторите попытку.')
      return false
    } finally {
      if (!background) setIsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (userId) loadData()
  }, [userId, loadData])

  const recalculate = async () => {
    if (!userId) return
    setIsRecalculating(true)
    setRecalculateError(null)

    try {
      const response = await fetch('/api/v1/diagnostics/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      const result = await response.json()

      if (!response.ok || result.ok !== true) {
        if (response.status === 422) {
          throw new Error('Сначала заполните анкету, затем повторите расчёт.')
        }
        throw new Error(result.error || 'Не удалось пересчитать диагностику.')
      }

      if (result.data?.diagnostic) {
        setDiag(result.data.diagnostic)
      }
      await loadData(true)
    } catch (error) {
      console.error('[client/point-a] recalculation failed', error)
      setRecalculateError(
        error instanceof Error
          ? error.message
          : 'Не удалось пересчитать диагностику. Повторите попытку.',
      )
    } finally {
      setIsRecalculating(false)
    }
  }

  const score = diag?.overall_score ?? 0
  const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

  const blocks = [
    { key: 'finance',    title: 'Финансы',    icon: 'payments',   data: diag?.finance_score },
    { key: 'sales',      title: 'Продажи',    icon: 'trending_up', data: diag?.sales_score },
    { key: 'operations', title: 'Операции',   icon: 'settings',   data: diag?.operations_score },
    { key: 'marketing',  title: 'Маркетинг',  icon: 'campaign',   data: diag?.marketing_score },
    { key: 'strategy',   title: 'Стратегия',  icon: 'flag',       data: diag?.strategy_score },
  ]

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
            Диагностика бизнеса
          </p>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface">Точка А</h1>
          <p className="mt-2 text-sm text-on-surface-variant">
            Текущее состояние компании, ключевые риски и быстрые улучшения.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={recalculate}
            disabled={isLoading || isRecalculating || !userId}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-2 text-xs font-mono text-on-surface-variant transition-all hover:text-primary disabled:opacity-60"
          >
            <span className={`material-symbols-outlined text-sm ${isRecalculating ? 'animate-spin' : ''}`}>refresh</span>
            Пересчитать
          </button>
          <Link
            href="/client/onboarding/documents"
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-2 text-xs font-mono text-on-surface-variant transition-all hover:text-primary"
          >
            <span className="material-symbols-outlined text-sm">upload_file</span>
            Документы
          </Link>
        </div>
      </section>

      <div className="space-y-8">
        {(loadError || recalculateError) && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{recalculateError ?? loadError}</span>
            {loadError && (
              <button
                type="button"
                onClick={() => void loadData()}
                disabled={isLoading || !userId}
                className="self-start rounded-lg border border-error/30 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-error/10 disabled:opacity-50 sm:self-auto"
              >
                Повторить
              </button>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-4">
              <span className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <p className="text-sm text-on-surface-variant">Загружаем диагностику...</p>
            </div>
          </div>
        ) : !diag && !loadError ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-3xl text-primary">analytics</span>
            </div>
            <h2 className="font-headline text-xl font-bold text-on-surface mb-2">Диагностика не рассчитана</h2>
            <p className="text-sm text-on-surface-variant mb-6">Заполните анкету и нажмите «Пересчитать»</p>
            <div className="flex gap-3 justify-center">
              <Link href="/client/onboarding" className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] text-[#003824] font-bold text-sm">
                Заполнить анкету
              </Link>
              <button onClick={recalculate} disabled={isRecalculating || !userId}
                className="px-5 py-2.5 rounded-xl border border-white/[0.08] text-on-surface-variant text-sm hover:text-on-surface transition-all">
                Пересчитать
              </button>
            </div>
          </div>
        ) : diag ? (
          <>
            {/* 1. Hero Block */}
            <section className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-6">
              <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
                {/* Gauge */}
                <div className="relative flex-shrink-0">
                  <ScoreGauge score={score} size={140} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-mono text-3xl font-extrabold text-on-surface">{(score / 10).toFixed(1)}</span>
                    <span className="text-xs text-on-surface-variant">/10</span>
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 text-center md:text-left">
                  <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Индекс здоровья бизнеса</p>
                  <h1 className="font-headline text-2xl font-extrabold text-on-surface mb-1">
                    Добро пожаловать{company?.name ? `, ${company.name}` : ''}!
                  </h1>
                  <div className="flex flex-wrap gap-3 justify-center md:justify-start mt-3">
                    <span className="flex items-center gap-1.5 text-xs bg-surface-container px-3 py-1.5 rounded-lg text-on-surface-variant">
                      <span className="material-symbols-outlined text-sm">radar</span>
                      Стадия: <strong className="text-on-surface ml-1">{stageLabel(diag.stage)}</strong>
                    </span>
                    {company?.industry && (
                      <span className="flex items-center gap-1.5 text-xs bg-surface-container px-3 py-1.5 rounded-lg text-on-surface-variant">
                        <span className="material-symbols-outlined text-sm">business</span>
                        {company.industry}
                      </span>
                    )}
                    {company?.employee_count && (
                      <span className="flex items-center gap-1.5 text-xs bg-surface-container px-3 py-1.5 rounded-lg text-on-surface-variant">
                        <span className="material-symbols-outlined text-sm">people</span>
                        {company.employee_count} сотрудников
                      </span>
                    )}
                    <span className="flex items-center gap-1.5 text-xs bg-surface-container px-3 py-1.5 rounded-lg text-on-surface-variant">
                      <span className="material-symbols-outlined text-sm">calendar_today</span>
                      {today}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* 2. Block Scores */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-headline text-lg font-bold text-on-surface">Блоки оценки</h2>
                <span className="text-xs text-on-surface-variant font-mono">5 направлений</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {blocks.map(b => (
                  <BlockCard key={b.key} title={b.title} icon={b.icon} score={b.data as BlockScore | null} />
                ))}
              </div>
            </section>

            {/* 3. Risks */}
            {(diag.risks?.length ?? 0) > 0 && (
              <section>
                <h2 className="font-headline text-lg font-bold text-on-surface mb-4">Риски</h2>
                <div className="space-y-2">
                  {(diag.risks as Risk[]).map((risk, i) => {
                    const ri = riskIcon(risk.level)
                    return (
                      <div key={i} className={`flex items-start gap-3 ${ri.bg} rounded-xl border border-white/[0.04] p-4`}>
                        <span className={`material-symbols-outlined text-lg flex-shrink-0 mt-0.5 ${ri.color}`}>{ri.icon}</span>
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-xs font-mono uppercase ${ri.color}`}>
                              {risk.level === 'critical' ? 'КРИТИЧНО' : risk.level === 'important' ? 'ВАЖНО' : 'УМЕРЕННО'}
                            </span>
                            <span className="text-xs text-on-surface-variant">· {risk.area}</span>
                          </div>
                          <p className="text-sm text-on-surface">{risk.text}</p>
                          {risk.impact && <p className="text-xs text-on-surface-variant mt-0.5">→ {risk.impact}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* 4. Insights */}
            {(diag.insights?.length ?? 0) > 0 && (
              <section>
                <h2 className="font-headline text-lg font-bold text-on-surface mb-4">Инсайты</h2>
                <div className="space-y-2">
                  {(diag.insights as Insight[]).map((ins, i) => (
                    <div key={i} className="flex items-start gap-3 bg-surface-container-low rounded-xl border border-white/[0.06] p-4">
                      <span className="material-symbols-outlined text-lg text-primary flex-shrink-0 mt-0.5">lightbulb</span>
                      <div>
                        <span className="text-xs font-mono text-on-surface-variant">{ins.area} · </span>
                        <span className="text-sm text-on-surface">{ins.text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 5. Quick Wins */}
            {(diag.quick_wins?.length ?? 0) > 0 && (
              <section>
                <h2 className="font-headline text-lg font-bold text-on-surface mb-4">Быстрые победы</h2>
                <div className="space-y-2">
                  {(diag.quick_wins as QuickWin[]).map((qw, i) => (
                    <div key={i} className="flex items-center gap-3 bg-surface-container-low rounded-xl border border-white/[0.06] p-4">
                      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-xs text-primary">check</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-on-surface">{qw.action}</p>
                        <p className="text-xs text-on-surface-variant">{qw.area}</p>
                      </div>
                      <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-1 rounded-lg flex-shrink-0">
                        {qw.timeline}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 6. Upload more */}
            <section className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-6">
              <h2 className="text-sm font-medium text-on-surface mb-4">Улучшить диагностику</h2>
              <div className="grid grid-cols-2 gap-3">
                <Link href="/client/onboarding/documents" className="flex items-center gap-2 bg-surface-container rounded-xl border border-white/[0.08] hover:border-primary/30 p-4 transition-all group">
                  <span className="material-symbols-outlined text-xl text-primary">upload_file</span>
                  <div>
                    <p className="text-xs font-medium text-on-surface group-hover:text-primary transition-colors">Загрузить отчёт</p>
                    <p className="text-[10px] text-on-surface-variant">P&L, баланс, CRM</p>
                  </div>
                </Link>
                <Link href="/client/onboarding" className="flex items-center gap-2 bg-surface-container rounded-xl border border-white/[0.08] hover:border-primary/30 p-4 transition-all group">
                  <span className="material-symbols-outlined text-xl text-primary">edit_note</span>
                  <div>
                    <p className="text-xs font-medium text-on-surface group-hover:text-primary transition-colors">Обновить анкету</p>
                    <p className="text-[10px] text-on-surface-variant">Изменить ответы</p>
                  </div>
                </Link>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}
