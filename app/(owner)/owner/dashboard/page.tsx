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

function tierOf(score: number): { color: string; bg: string; status: string } {
  if (score >= 8) return { color: 'text-primary', bg: 'bg-primary/10', status: 'Хорошо' }
  if (score >= 4) return { color: 'text-yellow-400', bg: 'bg-yellow-400/10', status: 'Слабое' }
  return { color: 'text-error', bg: 'bg-error/10', status: 'Критично' }
}

export default function OwnerDashboardPage() {
  const { user } = useAuthStore()
  const [current, setCurrent] = useState<GriCurrent | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/v1/gri/assessment', { credentials: 'include' })
        const j = await res.json()
        if (active) setCurrent(j?.data?.current ?? null)
      } catch {
        if (active) setCurrent(null)
      } finally {
        if (active) setLoading(false)
      }
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
            {hasAssessment ? ' · GRI Диагностика завершена' : ' · GRI-диагностика ещё не пройдена'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasAssessment && <ShareButtonAuto type="gri" />}
          <Link href="/owner/gri"
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
      ) : !hasAssessment ? (
        /* Empty state */
        <div className="glass-card rounded-2xl p-10 border border-white/[0.06] text-center">
          <div className="w-14 h-14 rounded-2xl bg-secondary/10 border border-secondary/20 flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-2xl text-secondary">radar</span>
          </div>
          <h2 className="text-lg font-bold text-on-surface mb-2">GRI-диагностика ещё не пройдена</h2>
          <p className="text-sm text-on-surface-variant max-w-md mx-auto mb-5">
            Пройдите диагностику Growth Readiness Index, чтобы увидеть оценку по 7 блокам,
            топ-5 ограничений роста и персональный план на 90 дней.
          </p>
          <Link href="/owner/gri"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-secondary/10 border border-secondary/20 text-secondary text-sm font-medium hover:bg-secondary/20 transition-colors">
            <span className="material-symbols-outlined text-lg">play_arrow</span>
            Пройти GRI-диагностику
          </Link>
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
