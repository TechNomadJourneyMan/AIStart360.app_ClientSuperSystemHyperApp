'use client'

// components/gri/page/GriPageShell.tsx — контейнер страницы /gri:
// hero + вкладки Оценка / Результат / Динамика / AI-аналитик.
// Владеет shared-стейтом оценок (scores/niche/size), чтобы вкладка
// AI-аналитика работала с теми же данными, что и калькулятор.
import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import GriHero from './GriHero'
import { DEFAULT_SCORES } from '@/lib/gri-calculator/gri-data'

const GRICalculator = dynamic(() => import('@/components/gri/calculator/GRICalculator'), {
  loading: () => <div className="animate-pulse h-[400px] bg-white/[0.03] rounded-2xl" />,
})
const GRIAssessment = dynamic(() => import('@/components/gri/assessment/GRIAssessment'), {
  loading: () => <div className="animate-pulse h-[400px] bg-white/[0.03] rounded-2xl" />,
})
const GriResultPanel = dynamic(() => import('./GriResultPanel'))
const GriDynamicsPanel = dynamic(() => import('./GriDynamicsPanel'))
const FinancialAnalyst = dynamic(() => import('@/components/gri/calculator/FinancialAnalyst'))
const GrowthStrategy = dynamic(() => import('@/components/gri/calculator/GrowthStrategy'))

const TABS = [
  { key: 'assess', label: 'Оценка', icon: 'tune' },
  { key: 'result', label: 'Результат', icon: 'insights' },
  { key: 'dynamics', label: 'Динамика', icon: 'monitoring' },
  { key: 'ai', label: 'AI-аналитик', icon: 'auto_awesome' },
] as const

type TabKey = (typeof TABS)[number]['key']

export interface AssessmentCurrent {
  gri_index: number
  section_avgs: Record<string, number>
  top_5_limits: unknown
  action_plan_90d: unknown
  created_at: string
}

export default function GriPageShell() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawTab = searchParams.get('tab') as TabKey | null
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : 'assess'

  const [scores, setScores] = useState<Record<string, number>>(DEFAULT_SCORES)
  const [niche, setNiche] = useState('general')
  const [size, setSize] = useState('small')
  const [assessment, setAssessment] = useState<AssessmentCurrent | null>(null)

  const setTab = useCallback(
    (key: TabKey) => router.replace(`/gri?tab=${key}`, { scroll: false }),
    [router],
  )

  const loadAssessment = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/gri/assessment', { credentials: 'include' })
      if (!res.ok) return
      const json = await res.json()
      // GET /api/v1/gri/assessment → { ok, data: { current } }
      const cur = json?.data?.current ?? null
      if (cur && typeof cur.gri_index !== 'undefined') setAssessment(cur as AssessmentCurrent)
    } catch {
      /* оффлайн/аноним — hero покажет «диагностика не пройдена» */
    }
  }, [])

  useEffect(() => {
    void loadAssessment()
    const onUpdate = () => void loadAssessment()
    window.addEventListener('gri:assessment-updated', onUpdate)
    return () => window.removeEventListener('gri:assessment-updated', onUpdate)
  }, [loadAssessment])

  return (
    <div className="px-4 py-4 space-y-5 max-w-6xl mx-auto">
      <GriHero
        griIndex={assessment ? Number(assessment.gri_index) : null}
        assessedAt={assessment?.created_at ?? null}
        onStartAssessment={() => {
          setTab('assess')
          // Прокрутка к точной диагностике — секция ниже калькулятора.
          setTimeout(() => document.getElementById('gri-assessment')?.scrollIntoView({ behavior: 'smooth' }), 60)
        }}
      />

      <nav
        className="flex gap-1 overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.02] p-1"
        role="tablist"
        aria-label="Разделы GRI"
      >
        {TABS.map((tItem) => (
          <button
            key={tItem.key}
            role="tab"
            aria-selected={tab === tItem.key}
            onClick={() => setTab(tItem.key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
              tab === tItem.key
                ? 'bg-primary/15 text-primary font-semibold'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-white/[0.05]'
            }`}
          >
            <span className="material-symbols-outlined text-base" aria-hidden>{tItem.icon}</span>
            {tItem.label}
          </button>
        ))}
      </nav>

      {/* Панель «Оценка» рендерится ВСЕГДА и скрывается через CSS (hidden),
          чтобы GRICalculator/GRIAssessment не размонтировались при смене вкладки:
          иначе mount-only sync-эффект калькулятора при возврате заново тянет
          /api/v1/gri/assessment и перезатирает ручные правки и оценки,
          применённые из AI-вкладки. */}
      <div className={tab === 'assess' ? 'space-y-6' : 'hidden'} aria-hidden={tab !== 'assess'}>
        <GRICalculator
          scores={scores}
          onScoresChange={setScores}
          niche={niche}
          size={size}
          onNicheChange={setNiche}
          onSizeChange={setSize}
        />
        <div id="gri-assessment">
          <GRIAssessment />
        </div>
      </div>
      {tab === 'result' && <GriResultPanel assessment={assessment} onGoAssess={() => setTab('assess')} />}
      {tab === 'dynamics' && <GriDynamicsPanel />}
      {tab === 'ai' && (
        <div className="space-y-6">
          <FinancialAnalyst scores={scores} onApplyScores={setScores} />
          <GrowthStrategy scores={scores} niche={niche} size={size} />
        </div>
      )}
    </div>
  )
}
