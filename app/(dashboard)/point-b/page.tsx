import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export const metadata: Metadata = { title: 'Точка Б — Целевое состояние' }

export default async function PointBPage() {
  const t = await getTranslations('pointBPage')

  const MILESTONES = [
    { q: 'Q2 2026', title: t('q2Title'), desc: t('q2Desc'), status: 'current', icon: 'tune' },
    { q: 'Q3 2026', title: t('q3Title'), desc: t('q3Desc'), status: 'planned', icon: 'group_add' },
    { q: 'Q4 2026', title: t('q4Title'), desc: t('q4Desc'), status: 'planned', icon: 'flight_takeoff' },
    { q: 'Q1 2027', title: t('q1Title'), desc: t('q1Desc'), status: 'future', icon: 'rocket_launch' },
  ]

  const TARGETS = [
    { label: t('targetArr'),  value: '₸120М',  current: '₸84.2М',  pct: 70, icon: 'payments' },
    { label: t('targetGri'),  value: '850+',    current: '763',      pct: 76, icon: 'radar' },
    { label: t('clients'),    value: '80',      current: '48',       pct: 60, icon: 'groups' },
    { label: t('margin'),     value: '42%',     current: '34.2%',    pct: 81, icon: 'percent' },
    { label: t('nps'),        value: '85+',     current: '74',       pct: 87, icon: 'thumb_up' },
    { label: t('team'),       value: `45 ${t('people')}`,  current: `28 ${t('people')}`,   pct: 62, icon: 'badge' },
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          {t('growthStrategy')}
        </p>
        <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
          {t('title')}{' '}
          <span className="text-gradient">{t('titleB')}</span>
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm max-w-xl">
          {t('subtitle')}
        </p>
      </section>

      {/* Target KPIs */}
      <section>
        <h2 className="font-headline text-lg font-bold text-on-surface mb-5">{t('targetKpis')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {TARGETS.map((target) => (
            <div key={target.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 group hover:border-primary/20 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{target.label}</p>
                <span className="material-symbols-outlined text-base text-primary/40 group-hover:text-primary/70 transition-colors">{target.icon}</span>
              </div>
              <div className="flex items-end gap-3 mb-3">
                <span className="text-2xl font-mono font-bold text-primary">{target.value}</span>
                <span className="text-xs text-on-surface-variant font-mono pb-0.5">{t('goal')}</span>
              </div>
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-on-surface-variant font-mono">{target.current} {t('now')}</span>
                <span className="font-mono text-primary">{target.pct}%</span>
              </div>
              <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-primary-fixed-dim rounded-full transition-all duration-700"
                  style={{ width: `${target.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Roadmap */}
      <section>
        <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-5">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">{t('roadmap')}</h2>
            <p className="text-xs text-on-surface-variant mt-1">{t('roadmapDesc')}</p>
          </div>
        </div>
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-5 top-6 bottom-6 w-0.5 bg-gradient-to-b from-primary via-primary/20 to-transparent rounded-full" />
          <div className="space-y-4">
            {MILESTONES.map((m, i) => (
              <div key={i} className="relative flex gap-6 pl-14">
                {/* Dot */}
                <div className={`
                  absolute left-3 top-5 w-4 h-4 rounded-full flex items-center justify-center -translate-x-1/2
                  ${m.status === 'current' ? 'bg-primary ring-4 ring-primary/20' : m.status === 'planned' ? 'bg-surface-container-high border-2 border-primary/40' : 'bg-surface-container-high border-2 border-white/10'}
                `}>
                  {m.status === 'current' && (
                    <span className="w-2 h-2 rounded-full bg-on-primary" />
                  )}
                </div>

                <div className={`
                  flex-1 bg-surface-container-low rounded-2xl border p-5 transition-colors
                  ${m.status === 'current' ? 'border-primary/30 bg-primary/[0.04]' : 'border-white/[0.04] hover:border-white/[0.08]'}
                `}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className={`text-[10px] font-mono uppercase tracking-wider ${m.status === 'current' ? 'text-primary' : 'text-on-surface-variant'}`}>
                        {m.q} {m.status === 'current' ? `· ${t('current')}` : ''}
                      </span>
                      <h3 className="text-sm font-medium text-on-surface mt-0.5">{m.title}</h3>
                    </div>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${m.status === 'current' ? 'bg-primary/20' : 'bg-surface-container-high'}`}>
                      <span className={`material-symbols-outlined text-base ${m.status === 'current' ? 'text-primary' : 'text-on-surface-variant'}`}>{m.icon}</span>
                    </div>
                  </div>
                  <p className="text-xs text-on-surface-variant">{m.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gap Analysis */}
      <section>
        <h2 className="font-headline text-lg font-bold text-on-surface mb-5">{t('gapAnalysis')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: `${t('priority')} 1`, title: t('unitEcon'), gap: t('unitEconGap'), action: t('unitEconAction'), icon: 'priority_high', color: 'error' },
            { label: `${t('priority')} 2`, title: t('teamScale'), gap: t('teamScaleGap'), action: t('teamScaleAction'), icon: 'group', color: 'tertiary-container' },
            { label: `${t('priority')} 3`, title: t('automation'), gap: t('automationGap'), action: t('automationAction'), icon: 'automation', color: 'primary' },
          ].map((item) => (
            <div key={item.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
              <span className={`text-[10px] font-mono text-${item.color} uppercase tracking-wider`}>{item.label}</span>
              <h3 className="text-sm font-medium text-on-surface mt-2 mb-3">{item.title}</h3>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-sm text-error mt-0.5">cancel</span>
                  <span className="text-xs text-on-surface-variant">{item.gap}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-sm text-primary mt-0.5">check_circle</span>
                  <span className="text-xs text-on-surface">{item.action}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
