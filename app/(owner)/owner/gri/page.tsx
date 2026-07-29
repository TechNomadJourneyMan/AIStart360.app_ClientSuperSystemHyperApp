'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ShareButtonAuto } from '@/components/share/ShareButtonAuto'

// 7 GRI blocks (section ids ↔ Russian labels) in canonical order.
const BLOCK_LABELS: { id: string; label: string }[] = [
  { id: 'product-demand', label: 'Продукт и спрос' },
  { id: 'trust-positioning', label: 'Доверие и позиционирование' },
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

interface ActionCard {
  priority: 'Критично' | 'Высокий' | 'Средний'
  limitation: string
  focus: string
  horizon: '1-30' | '31-60' | '61-90'
}

interface ActionPlan90d {
  days_1_30?: ActionCard[]
  days_31_60?: ActionCard[]
  days_61_90?: ActionCard[]
}

interface GriCurrent {
  gri_index?: number
  section_avgs?: Record<string, number>
  top_5_limits?: Top5Limit[]
  action_plan_90d?: ActionPlan90d
  created_at?: string
}

type Tier = 'good' | 'weak' | 'critical'

function tierFor(score: number): Tier {
  if (score >= 8) return 'good'
  if (score >= 4) return 'weak'
  return 'critical'
}

const tierColor = (tier: Tier) => {
  if (tier === 'good') return { text: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20', bar: 'bg-primary' }
  if (tier === 'weak') return { text: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/20', bar: 'bg-yellow-400' }
  return { text: 'text-error', bg: 'bg-error/10', border: 'border-error/20', bar: 'bg-error' }
}

const priorityColor = (p: string) => {
  if (p === 'Критично') return 'text-error bg-error/10 border-error/20'
  if (p === 'Высокий') return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20'
  return 'text-primary bg-primary/10 border-primary/20'
}

const HORIZON_WEEK: Record<string, string> = {
  '1-30': '1–30 дн.',
  '31-60': '31–60 дн.',
  '61-90': '61–90 дн.',
}

export default function OwnerGriPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'limits' | 'plan'>('overview')
  const [activeBlock, setActiveBlock] = useState<string | null>(null)
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

  const blocks = BLOCK_LABELS.map((b) => {
    const score = typeof sectionAvgs[b.id] === 'number' ? sectionAvgs[b.id] : 0
    return { ...b, score, tier: tierFor(score) }
  }).filter((b) => b.score > 0)

  const topLimits = current?.top_5_limits ?? []
  const plan = current?.action_plan_90d ?? {}
  const planCards: ActionCard[] = [
    ...(plan.days_1_30 ?? []),
    ...(plan.days_31_60 ?? []),
    ...(plan.days_61_90 ?? []),
  ]

  const criticalCount = blocks.filter((b) => b.tier === 'critical').length
  const griLabel = griScore >= 8 ? 'Высокий уровень' : griScore >= 4 ? 'Средний уровень' : 'Критический уровень'
  const griTone =
    griScore >= 8 ? 'text-primary' : griScore >= 4 ? 'text-yellow-400' : 'text-error'
  const griToneBadge =
    griScore >= 8
      ? 'bg-primary/10 text-primary border-primary/20'
      : griScore >= 4
        ? 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20'
        : 'bg-error/10 text-error border-error/20'

  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-10 border border-white/[0.06] text-center">
        <p className="text-sm text-on-surface-variant">Загрузка результатов GRI…</p>
      </div>
    )
  }

  if (!hasAssessment) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-headline text-2xl font-bold text-on-surface">GRI Результаты диагностики</h1>
          <p className="text-sm text-on-surface-variant mt-1">Growth Readiness Index</p>
        </div>
        <div className="glass-card rounded-2xl p-10 border border-white/[0.06] text-center">
          <div className="w-14 h-14 rounded-2xl bg-secondary/10 border border-secondary/20 flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-2xl text-secondary">radar</span>
          </div>
          <h2 className="text-lg font-bold text-on-surface mb-2">GRI-диагностика ещё не пройдена</h2>
          <p className="text-sm text-on-surface-variant max-w-md mx-auto mb-5">
            Пройдите диагностику Growth Readiness Index, чтобы получить оценку по 7 блокам,
            топ-5 ограничений роста и план действий на 90 дней.
          </p>
          {/* /gri владельцу закрыт middleware'ом — опросник живёт внутри owner-портала. */}
          <Link href="/owner/gri/assess"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-secondary/10 border border-secondary/20 text-secondary text-sm font-medium hover:bg-secondary/20 transition-colors">
            <span className="material-symbols-outlined text-lg">play_arrow</span>
            Пройти GRI-диагностику
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-headline text-2xl font-bold text-on-surface">GRI Результаты диагностики</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Growth Readiness Index
            {current?.created_at ? ` · ${new Date(current.created_at).toLocaleDateString('ru-RU')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/owner/gri/assess"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary/10 border border-secondary/20 text-secondary text-sm font-medium hover:bg-secondary/20 transition-colors">
            <span className="material-symbols-outlined text-lg">refresh</span>
            Пройти заново
          </Link>
          <ShareButtonAuto type="gri" />
        </div>
      </div>

      {/* Score hero */}
      <div className="glass-card rounded-2xl p-6 border border-white/[0.06] relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(circle at 80% 50%, #6effc0 0%, transparent 60%)' }} />
        <div className="relative flex items-center gap-8 flex-wrap">
          {/* Radar chart */}
          <div className="flex-shrink-0 relative w-36 h-36">
            <svg viewBox="0 0 200 200" className="w-full h-full opacity-80">
              {[20, 40, 60, 80].map((r) => (
                <polygon key={r}
                  points={Array.from({ length: 7 }, (_, i) => {
                    const angle = (i * 2 * Math.PI / 7) - Math.PI / 2
                    return `${100 + r * Math.cos(angle)},${100 + r * Math.sin(angle)}`
                  }).join(' ')}
                  fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1"
                />
              ))}
              {Array.from({ length: 7 }, (_, i) => {
                const angle = (i * 2 * Math.PI / 7) - Math.PI / 2
                return <line key={i} x1="100" y1="100" x2={100 + 80 * Math.cos(angle)} y2={100 + 80 * Math.sin(angle)} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
              })}
              <polygon
                points={BLOCK_LABELS.map((b, i) => {
                  const angle = (i * 2 * Math.PI / 7) - Math.PI / 2
                  const r = ((sectionAvgs[b.id] ?? 0) / 10) * 80
                  return `${100 + r * Math.cos(angle)},${100 + r * Math.sin(angle)}`
                }).join(' ')}
                fill="rgba(110,255,192,0.12)" stroke="#6effc0" strokeWidth="1.5"
              />
              {BLOCK_LABELS.map((b, i) => {
                const angle = (i * 2 * Math.PI / 7) - Math.PI / 2
                const score = sectionAvgs[b.id] ?? 0
                const r = (score / 10) * 80
                const tier = tierFor(score)
                const color = tier === 'good' ? '#6effc0' : tier === 'weak' ? '#facc15' : '#ef4444'
                return <circle key={b.id} cx={100 + r * Math.cos(angle)} cy={100 + r * Math.sin(angle)} r="4" fill={color} />
              })}
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <p className="text-2xl font-mono font-bold text-on-surface">{griScore}</p>
                <p className="text-[9px] font-mono text-on-surface-variant">GRI</p>
              </div>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">Итоговый GRI Score</p>
            <div className="flex items-baseline gap-3 mb-2">
              <span className={`text-4xl font-mono font-bold ${griTone}`}>{griScore}</span>
              <span className="text-lg text-on-surface-variant">/ 10</span>
              <span className={`px-3 py-1 rounded-full text-xs font-mono border ${griToneBadge}`}>
                {griLabel}
              </span>
            </div>
            <div className="flex flex-wrap gap-3 mt-3">
              {[
                { label: `${blocks.length} блоков`, sub: 'диагностики', color: 'text-primary' },
                { label: `${criticalCount} критичных`, sub: 'блока', color: 'text-error' },
                { label: `${topLimits.length} ограничений`, sub: 'топ-список', color: 'text-yellow-400' },
              ].map((s) => (
                <div key={s.label} className="bg-white/[0.04] rounded-xl px-3 py-2 border border-white/[0.06]">
                  <p className={`text-sm font-mono font-bold ${s.color}`}>{s.label}</p>
                  <p className="text-[10px] text-on-surface-variant">{s.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-surface-container rounded-xl border border-white/[0.04] w-fit">
        {[
          { id: 'overview', label: 'По блокам' },
          { id: 'limits', label: 'Ограничения' },
          { id: 'plan', label: 'План 90 дней' },
        ].map((tab) => (
          <button key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-secondary/10 text-secondary border border-secondary/20'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-3">
          {blocks.map((block) => {
            const c = tierColor(block.tier)
            const expanded = activeBlock === block.id
            return (
              <div key={block.id}
                className={`glass-card rounded-2xl border transition-all cursor-pointer ${expanded ? 'border-white/[0.1] bg-white/[0.04]' : 'border-white/[0.04] hover:border-white/[0.08]'}`}
                onClick={() => setActiveBlock(expanded ? null : block.id)}
              >
                <div className="p-4">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl ${c.bg} border ${c.border} flex items-center justify-center flex-shrink-0`}>
                      <span className={`text-lg font-mono font-bold ${c.text}`}>{block.score}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h3 className="text-sm font-semibold text-on-surface">{block.label}</h3>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${c.bg} ${c.text} border ${c.border}`}>
                          {block.tier === 'good' ? 'Хорошо' : block.tier === 'weak' ? 'Слабо' : 'Критично'}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${(block.score / 10) * 100}%` }} />
                      </div>
                    </div>
                    <span className={`material-symbols-outlined text-on-surface-variant text-lg transition-transform ${expanded ? 'rotate-180' : ''}`}>
                      expand_more
                    </span>
                  </div>
                </div>
                {expanded && (
                  <div className="px-4 pb-4 border-t border-white/[0.04] mt-1 pt-4">
                    <p className="text-sm text-on-surface-variant leading-relaxed">
                      Средняя оценка блока — {block.score} из 10.
                      {block.tier === 'critical'
                        ? ' Критический блок: требует приоритетной доработки в первые 30 дней.'
                        : block.tier === 'weak'
                          ? ' Слабый блок: усиление запланировано на 31–60 дней.'
                          : ' Сильный блок: точка роста для масштабирования.'}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Tab: Limits */}
      {activeTab === 'limits' && (
        <div className="glass-card rounded-2xl p-5 border border-white/[0.06] space-y-3">
          <p className="text-xs text-on-surface-variant mb-4">
            Топ-5 факторов, которые прямо сейчас блокируют рост бизнеса. Устранение этих ограничений — приоритет №1.
          </p>
          {topLimits.length === 0 ? (
            <p className="text-sm text-on-surface-variant">Ограничения появятся после полной диагностики.</p>
          ) : (
            topLimits.map((item, i) => (
              <div key={item.criterionId ?? i} className="flex items-start gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <div className="w-8 h-8 rounded-xl bg-error/10 border border-error/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-mono font-bold text-error">{item.score}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-sm font-medium text-on-surface">{item.criterionText}</p>
                    <span className="text-[10px] font-mono text-on-surface-variant bg-white/[0.04] px-2 py-0.5 rounded-full">{item.blockName}</span>
                  </div>
                  <div className="mt-2 h-1 bg-white/[0.04] rounded-full overflow-hidden">
                    <div className="h-full bg-error rounded-full" style={{ width: `${(item.score / 10) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Action Plan */}
      {activeTab === 'plan' && (
        <div className="glass-card rounded-2xl p-5 border border-white/[0.06]">
          <p className="text-xs text-on-surface-variant mb-5">
            90-дневный план приоритетных действий на основе GRI диагностики.
          </p>
          {planCards.length === 0 ? (
            <p className="text-sm text-on-surface-variant">План появится после полной диагностики.</p>
          ) : (
            <div className="space-y-3">
              {planCards.map((item, i) => (
                <div key={i} className="flex items-start gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                  <div className="flex-shrink-0 text-center">
                    <p className="text-[9px] font-mono text-on-surface-variant uppercase">Горизонт</p>
                    <p className="text-xs font-mono font-bold text-on-surface">{HORIZON_WEEK[item.horizon] ?? item.horizon}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-on-surface">{item.limitation}</p>
                    <p className="text-[10px] text-on-surface-variant mt-0.5">{item.focus}</p>
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border flex-shrink-0 ${priorityColor(item.priority)}`}>
                    {item.priority}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
