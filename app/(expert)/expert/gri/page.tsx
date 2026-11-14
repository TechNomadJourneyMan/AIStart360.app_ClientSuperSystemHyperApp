'use client'

import { useEffect, useState } from 'react'
import { ShareButtonAuto } from '@/components/share/ShareButtonAuto'
import { formatGri, griColor, griPercentOfScale, griTone, griZone, toGri, GRI_TONE_TEXT_CLASS } from '@/lib/format/gri'

// 7 GRI blocks (section ids ↔ Russian labels + icons) in canonical order.
const BLOCKS: { id: string; label: string; icon: string; desc: string }[] = [
  { id: 'product-demand', label: 'Продукт и спрос', icon: 'inventory_2', desc: 'PMF, спрос, unit-экономика' },
  { id: 'trust-positioning', label: 'Доверие и позиционирование', icon: 'verified', desc: 'Бренд, доказательства, отстройка' },
  { id: 'business-model', label: 'Бизнес-модель', icon: 'account_tree', desc: 'Монетизация, каналы, масштаб' },
  { id: 'cash-stability', label: 'Стабильность кассы', icon: 'payments', desc: 'Денежный поток, предоплата, резервы' },
  { id: 'operations', label: 'Операции', icon: 'precision_manufacturing', desc: 'Процессы, метрики, автоматизация' },
  { id: 'team', label: 'Команда', icon: 'groups', desc: 'Роли, найм, дисциплина' },
  { id: 'owner-readiness', label: 'Готовность основателя', icon: 'person', desc: 'Делегирование, дисциплина, мышление' },
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

function ScoreBar({ score }: { score: number }) {
  const tone = griTone(score)
  const bar = tone === 'green' ? 'bg-primary' : tone === 'amber' ? 'bg-yellow-400' : 'bg-error'
  return (
    <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
      <div
        className={`h-full ${bar} rounded-full transition-all duration-700`}
        style={{ width: `${griPercentOfScale(score)}%` }}
      />
    </div>
  )
}

function ScoreColor(score: number) {
  const tone = griTone(score)
  return tone ? GRI_TONE_TEXT_CLASS[tone] : 'text-on-surface-variant'
}

export default function ExpertGriPage() {
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
  const totalScore = toGri(current?.gri_index) ?? 0
  const hasAssessment =
    !!current &&
    typeof current.gri_index === 'number' &&
    totalScore > 0 &&
    Object.keys(sectionAvgs).length > 0

  const blocks = BLOCKS.map((b) => ({
    ...b,
    score: typeof sectionAvgs[b.id] === 'number' ? sectionAvgs[b.id] : 0,
  })).filter((b) => b.score > 0)

  const topLimits = current?.top_5_limits ?? []
  const circumference = 2 * Math.PI * 64
  // One set of GRI zones and one formatter (lib/format/gri.ts, R-036).
  const dialColor = griColor(totalScore)
  const dialLabel = griZone(totalScore)?.label ?? 'нет данных'

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">Expert Portal</p>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface">GRI-диагностика</h1>
          <p className="text-on-surface-variant mt-2 text-sm">Growth Readiness Index — комплексная оценка готовности к росту</p>
        </div>
        <ShareButtonAuto type="gri" />
      </section>

      {loading ? (
        <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-10 text-center">
          <p className="text-sm text-on-surface-variant">Загрузка данных GRI…</p>
        </section>
      ) : !hasAssessment ? (
        <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-2xl text-primary">radar</span>
          </div>
          <h2 className="text-lg font-bold text-on-surface mb-2">GRI-диагностика ещё не пройдена</h2>
          <p className="text-sm text-on-surface-variant max-w-md mx-auto">
            Результаты появятся после прохождения диагностики Growth Readiness Index.
          </p>
        </section>
      ) : (
        <>
          {/* Score + Limits */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main dial */}
            <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-8 flex flex-col items-center justify-center">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-6">Итоговый GRI Score</p>
              <div className="relative w-44 h-44 mb-6">
                <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
                  <circle cx="80" cy="80" r="64" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
                  <circle cx="80" cy="80" r="64" fill="none" stroke={dialColor} strokeWidth="10" strokeLinecap="round"
                    strokeDasharray={`${circumference * (totalScore / 10)} ${circumference}`} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-4xl font-mono font-bold text-on-surface">{formatGri(totalScore, { empty: '—' })}</span>
                  <span className="text-[10px] font-mono text-on-surface-variant">/ 10</span>
                </div>
              </div>
              <span className="text-sm font-mono text-primary bg-primary/10 border border-primary/20 px-4 py-1.5 rounded-full">{dialLabel}</span>
            </div>

            {/* Top limits */}
            <div className="lg:col-span-2 bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-6">Топ-5 ограничений роста</p>
              {topLimits.length === 0 ? (
                <p className="text-sm text-on-surface-variant">Ограничения появятся после полной диагностики.</p>
              ) : (
                <div className="space-y-3">
                  {topLimits.map((item, i) => (
                    <div key={item.criterionId ?? i} className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-lg bg-error/10 border border-error/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-mono font-bold text-error">{item.score}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-on-surface truncate">{item.criterionText}</p>
                        <p className="text-[10px] font-mono text-on-surface-variant">{item.blockName}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Domain breakdown */}
          <section>
            <h2 className="font-headline text-lg font-bold text-on-surface mb-5">Разбивка по блокам</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {blocks.map((block) => (
                <div key={block.id} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 hover:border-primary/20 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                        <span className="material-symbols-outlined text-base text-primary">{block.icon}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-on-surface">{block.label}</p>
                      </div>
                    </div>
                    <span className={`text-xl font-mono font-bold ${ScoreColor(block.score)}`}>{formatGri(block.score, { empty: '—' })}</span>
                  </div>
                  <ScoreBar score={block.score} />
                  <p className="text-[11px] text-on-surface-variant mt-2">{block.desc}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
