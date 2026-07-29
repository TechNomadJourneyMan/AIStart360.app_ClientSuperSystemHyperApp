'use client'

import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import Link from 'next/link'
import { ShareButtonAuto } from '@/components/share/ShareButtonAuto'

// 7 GRI blocks (section ids ↔ Russian labels) in canonical order.
const BLOCK_LABELS: { id: string; label: string }[] = [
  { id: 'product-demand', label: 'Продукт и спрос' },
  { id: 'trust-positioning', label: 'Доверие и позиция' },
  { id: 'business-model', label: 'Бизнес-модель' },
  { id: 'cash-stability', label: 'Стабильность кассы' },
  { id: 'operations', label: 'Операции' },
  { id: 'team', label: 'Команда' },
  { id: 'owner-readiness', label: 'Готовность основателя' },
]

interface Top5Limit {
  criterionId: string
  criterionText: string
  blockId: string
  blockName: string
  score: number
}

interface GriCurrent {
  gri_index?: number
  section_avgs?: Record<string, number>
  top_5_limits?: Top5Limit[]
}

// Точка А — 5 блоков анкеты по шкале 0–100. Это НЕ GRI (7 блоков, 0–10):
// шкалы и блоки разные, смешивать их в одну цифру нельзя.
type PointABlockKey = 'finance_score' | 'sales_score' | 'operations_score' | 'marketing_score' | 'strategy_score'

interface PointABlock {
  score?: number
  status?: string
}

type DiagnosticsCurrent = Partial<Record<PointABlockKey, PointABlock | null>> & {
  overall_score?: number | null
  calculated_at?: string | null
}

const POINT_A_BLOCKS: { key: PointABlockKey; label: string; icon: string }[] = [
  { key: 'finance_score', label: 'Финансы', icon: 'payments' },
  { key: 'sales_score', label: 'Продажи', icon: 'trending_up' },
  { key: 'operations_score', label: 'Операции', icon: 'settings' },
  { key: 'marketing_score', label: 'Маркетинг', icon: 'campaign' },
  { key: 'strategy_score', label: 'Стратегия', icon: 'flag' },
]

// Подписи статусов — те же, что на /client/point-a, чтобы цифры читались одинаково.
const POINT_A_STATUS: Record<string, { text: string; color: string }> = {
  critical: { text: 'Критично', color: 'text-error' },
  weak: { text: 'Слабо', color: 'text-orange-400' },
  average: { text: 'Средне', color: 'text-amber-400' },
  strong: { text: 'Сильно', color: 'text-primary' },
  excellent: { text: 'Отлично', color: 'text-emerald-400' },
}

function tierOf(score: number): { color: string; bg: string; status: string } {
  if (score >= 8) return { color: 'text-primary', bg: 'bg-primary/10', status: 'Хорошо' }
  if (score >= 4) return { color: 'text-yellow-400', bg: 'bg-yellow-400/10', status: 'Слабое' }
  return { color: 'text-error', bg: 'bg-error/10', status: 'Критично' }
}

// Точка А считается по шкале 0–100 (пороги те же, что на /client/point-a).
const pointABar = (score: number) =>
  score >= 70 ? 'bg-primary' : score >= 45 ? 'bg-amber-400' : 'bg-error'

export default function OwnerDashboardPage() {
  const { user } = useAuthStore()
  const [current, setCurrent] = useState<GriCurrent | null>(null)
  const [diag, setDiag] = useState<DiagnosticsCurrent | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      let gri: GriCurrent | null = null
      try {
        const res = await fetch('/api/v1/gri/assessment', { credentials: 'include' })
        const j = await res.json()
        gri = j?.data?.current ?? null
      } catch {
        gri = null
      }
      if (!active) return
      setCurrent(gri)

      // GRI нет — подтягиваем фактические данные Точки А, чтобы владелец,
      // заполнивший анкету, видел свои посчитанные цифры, а не пустой экран.
      const griReady =
        !!gri &&
        typeof gri.gri_index === 'number' &&
        gri.gri_index > 0 &&
        Object.keys(gri.section_avgs ?? {}).length > 0
      if (!griReady) {
        try {
          const res = await fetch('/api/v1/diagnostics/current', { credentials: 'include' })
          const j = await res.json()
          if (active) setDiag(j?.ok ? (j.data ?? null) : null)
        } catch {
          if (active) setDiag(null)
        }
      }
      if (active) setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [])

  const sectionAvgs = current?.section_avgs ?? {}
  const griScore = typeof current?.gri_index === 'number' ? current.gri_index : 0
  const hasAssessment =
    !!current &&
    typeof current.gri_index === 'number' &&
    griScore > 0 &&
    Object.keys(sectionAvgs).length > 0

  const blocks = BLOCK_LABELS.map((b) => ({
    ...b,
    score: typeof sectionAvgs[b.id] === 'number' ? sectionAvgs[b.id] : 0,
  })).filter((b) => b.score > 0)

  // Фактические блоки Точки А: показываем только те, что реально посчитаны.
  const pointABlocks = POINT_A_BLOCKS.flatMap((b) => {
    const block = diag?.[b.key] ?? null
    return typeof block?.score === 'number'
      ? [{ ...b, score: block.score, status: block.status ?? '' }]
      : []
  })
  const hasPointA = pointABlocks.some((b) => b.score > 0)
  const pointAOverall = typeof diag?.overall_score === 'number' ? diag.overall_score : null

  const topLimits = current?.top_5_limits ?? []
  const strongCount = blocks.filter((b) => b.score >= 8).length
  const weakCount = blocks.filter((b) => b.score >= 4 && b.score < 8).length
  const criticalCount = blocks.filter((b) => b.score < 4).length

  const scoreWidth = (score: number) => `${(score / 10) * 100}%`
  const griLabel = griScore >= 8 ? 'Высокий уровень' : griScore >= 4 ? 'Средний уровень' : 'Критический уровень'
  const griTone =
    griScore >= 8
      ? 'bg-primary/10 text-primary border-primary/20'
      : griScore >= 4
        ? 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20'
        : 'bg-error/10 text-error border-error/20'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-headline text-2xl font-bold text-on-surface">
            Добро пожаловать, {user?.name?.split(' ')[0] ?? ''}
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            {user?.organization ?? ''}
            {hasAssessment
              ? ' · GRI Диагностика завершена'
              : hasPointA
                ? ' · Точка А посчитана · GRI-диагностика ещё не пройдена'
                : ' · GRI-диагностика ещё не пройдена'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasAssessment && <ShareButtonAuto type="gri" />}
          <Link href={hasAssessment ? '/owner/gri' : '/owner/gri/assess'}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary/10 border border-secondary/20 text-secondary text-sm font-medium hover:bg-secondary/20 transition-colors">
            <span className="material-symbols-outlined text-lg">radar</span>
            {hasAssessment ? 'Полный отчёт GRI' : 'Пройти GRI-диагностику'}
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="glass-card rounded-2xl p-10 border border-white/[0.06] text-center">
          <p className="text-sm text-on-surface-variant">Загрузка данных GRI…</p>
        </div>
      ) : !hasAssessment && hasPointA ? (
        /* GRI нет, но анкета заполнена — показываем фактические данные Точки А.
           Никаких пересчётов в шкалу GRI: подписываем, что именно на экране. */
        <>
          <div className="glass-card rounded-2xl p-4 border border-yellow-400/20 bg-yellow-400/[0.04] flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-yellow-400 text-xl">info</span>
              <div>
                <p className="text-sm text-on-surface">
                  Показаны фактические данные из анкеты. Самооценка GRI ещё не пройдена
                </p>
                <p className="text-xs text-on-surface-variant mt-1">
                  Точка А — 5 блоков по шкале 0–100, посчитаны по вашим ответам.
                  GRI — 7 блоков по шкале 0–10, это отдельная самооценка.
                </p>
              </div>
            </div>
            <Link href="/owner/gri/assess"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary/10 border border-secondary/20 text-secondary text-sm font-medium hover:bg-secondary/20 transition-colors">
              <span className="material-symbols-outlined text-lg">play_arrow</span>
              Пройти GRI-диагностику
            </Link>
          </div>

          <div className="glass-card rounded-2xl p-5 border border-white/[0.06]">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">my_location</span>
                <h3 className="text-sm font-semibold text-on-surface">Точка А — фактические данные</h3>
              </div>
              {pointAOverall !== null && (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-mono font-bold text-on-surface">{Math.round(pointAOverall)}</span>
                  <span className="text-xs text-on-surface-variant">/ 100 общий балл</span>
                </div>
              )}
            </div>
            <div className="space-y-3">
              {pointABlocks.map((b) => {
                const label = POINT_A_STATUS[b.status]
                return (
                  <div key={b.key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                        <span className="material-symbols-outlined text-sm">{b.icon}</span>
                        {b.label}
                      </span>
                      <span className="flex items-center gap-2">
                        {label && <span className={`text-[10px] font-mono ${label.color}`}>{label.text}</span>}
                        <span className="text-xs font-mono font-bold text-on-surface">{Math.round(b.score)}</span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${pointABar(b.score)}`}
                        style={{ width: `${Math.min(100, Math.max(0, b.score))}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-[10px] text-on-surface-variant mt-4 leading-relaxed">
              Баллы посчитаны по анкете Точки А (шкала 0–100) и не являются GRI-оценкой:
              у GRI другая шкала (0–10) и другие 7 блоков. Подробности — в разделе{' '}
              <Link href="/owner/point-a" className="text-primary hover:underline">Точка А</Link>.
            </p>
          </div>
        </>
      ) : !hasAssessment ? (
        /* Ни GRI, ни анкеты — честное пустое состояние: объясняем, что заполнить. */
        <div className="glass-card rounded-2xl p-10 border border-white/[0.06] text-center">
          <div className="w-14 h-14 rounded-2xl bg-secondary/10 border border-secondary/20 flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-2xl text-secondary">radar</span>
          </div>
          <h2 className="text-lg font-bold text-on-surface mb-2">Данных пока нет</h2>
          <p className="text-sm text-on-surface-variant max-w-md mx-auto mb-5">
            Дашборд собирается из двух источников. Анкета Точки А даёт фактические баллы
            по 5 блокам (финансы, продажи, операции, маркетинг, стратегия).
            GRI-диагностика — самооценку по 7 блокам, топ-5 ограничений роста и план на 90 дней.
            Пока не заполнено ни то, ни другое, показывать нечего.
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Link href="/owner/gri/assess"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-secondary/10 border border-secondary/20 text-secondary text-sm font-medium hover:bg-secondary/20 transition-colors">
              <span className="material-symbols-outlined text-lg">play_arrow</span>
              Пройти GRI-диагностику
            </Link>
            <Link href="/owner/point-a"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-on-surface-variant text-sm font-medium hover:text-on-surface hover:bg-white/[0.06] transition-colors">
              <span className="material-symbols-outlined text-lg">my_location</span>
              Заполнить анкету Точки А
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* GRI Score Hero */}
          <div className="glass-card rounded-2xl p-6 border border-white/[0.06] relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.03]"
              style={{ backgroundImage: 'radial-gradient(circle at 70% 50%, #6effc0 0%, transparent 60%)' }} />
            <div className="relative flex items-center gap-8 flex-wrap">
              {/* Score circle */}
              <div className="flex-shrink-0">
                <div className="relative w-32 h-32">
                  <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                    <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                    <circle cx="60" cy="60" r="52" fill="none"
                      stroke={griScore >= 8 ? '#6effc0' : griScore >= 4 ? '#facc15' : '#ef4444'}
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={`${(griScore / 10) * 327} 327`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-mono font-bold text-on-surface">{griScore}</span>
                    <span className="text-[10px] font-mono text-on-surface-variant">/ 10</span>
                  </div>
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">GRI Score</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${griTone}`}>
                    {griLabel}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-on-surface mb-2">Индекс готовности к росту</h2>
                <div className="flex items-center gap-4 mt-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    <span className="text-xs text-on-surface-variant">{strongCount} блоков сильные</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-yellow-400" />
                    <span className="text-xs text-on-surface-variant">{weakCount} блоков слабые</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-error" />
                    <span className="text-xs text-on-surface-variant">{criticalCount} блоков критичных</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Two columns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Block scores */}
            <div className="glass-card rounded-2xl p-5 border border-white/[0.06]">
              <div className="flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined text-secondary text-xl">bar_chart</span>
                <h3 className="text-sm font-semibold text-on-surface">Оценка по блокам</h3>
              </div>
              <div className="space-y-3">
                {blocks.map((b) => (
                  <div key={b.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-on-surface-variant">{b.label}</span>
                      <span className={`text-xs font-mono font-bold ${tierOf(b.score).color}`}>{b.score}</span>
                    </div>
                    <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${b.score >= 8 ? 'bg-primary' : b.score >= 4 ? 'bg-yellow-400' : 'bg-error'}`}
                        style={{ width: scoreWidth(b.score) }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top 5 limits */}
            <div className="glass-card rounded-2xl p-5 border border-white/[0.06]">
              <div className="flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined text-error text-xl">warning</span>
                <h3 className="text-sm font-semibold text-on-surface">Топ-5 ограничений</h3>
              </div>
              {topLimits.length === 0 ? (
                <p className="text-xs text-on-surface-variant">Ограничения появятся после полной диагностики.</p>
              ) : (
                <div className="space-y-2.5">
                  {topLimits.map((item, i) => (
                    <div key={item.criterionId ?? i} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                      <div className="w-7 h-7 rounded-lg bg-error/10 border border-error/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-mono font-bold text-error">{item.score}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-on-surface">{item.criterionText}</p>
                        <p className="text-[10px] text-on-surface-variant mt-0.5">{item.blockName}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Next steps */}
          <div className="glass-card rounded-2xl p-5 border border-white/[0.06]">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-primary text-xl">rocket_launch</span>
              <h3 className="text-sm font-semibold text-on-surface">Следующие шаги</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { icon: 'event', title: 'Сессия с экспертом', desc: 'Запланируйте разбор слабых блоков', color: 'text-secondary', bg: 'bg-secondary/10' },
                { icon: 'description', title: 'Полный отчёт', desc: 'Откройте детальный GRI отчёт с планом действий', color: 'text-primary', bg: 'bg-primary/10' },
                { icon: 'track_changes', title: 'План на 90 дней', desc: 'Приоритетные действия для роста', color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
              ].map((step) => (
                <div key={step.title} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-colors cursor-pointer">
                  <div className={`w-8 h-8 rounded-xl ${step.bg} flex items-center justify-center flex-shrink-0`}>
                    <span className={`material-symbols-outlined text-lg ${step.color}`}>{step.icon}</span>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-on-surface">{step.title}</p>
                    <p className="text-[10px] text-on-surface-variant mt-0.5 leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
