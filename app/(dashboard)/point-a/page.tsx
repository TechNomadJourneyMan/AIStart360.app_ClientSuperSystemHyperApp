import type { Metadata } from 'next'
import { MOCK_GRI_DOMAINS, MOCK_METRICS } from '@/lib/mock-data'

export const metadata: Metadata = { title: 'Точка А — Текущее состояние' }

export default function PointAPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          Диагностика · Текущее состояние
        </p>
        <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
          Точка{' '}
          <span className="text-gradient">А</span>
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm max-w-xl">
          Объективная оценка текущего состояния бизнеса — фундамент для построения стратегии роста.
        </p>
      </section>

      {/* Current State Overview */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Общий GRI',      value: '763',    icon: 'radar',        good: true,  note: '+24 vs Q4' },
          { label: 'Доход',          value: '₸84.2М', icon: 'payments',     good: true,  note: '+12.4% г/г' },
          { label: 'Маржа',          value: '34.2%',  icon: 'percent',      good: true,  note: '+2.1 пп' },
          { label: 'Расходы',        value: '₸55.4М', icon: 'trending_down', good: false, note: '+8.2% г/г' },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{stat.label}</p>
              <span className={`material-symbols-outlined text-base ${stat.good ? 'text-primary/50' : 'text-error/50'}`}>{stat.icon}</span>
            </div>
            <p className="text-2xl font-mono font-bold text-on-surface mb-1">{stat.value}</p>
            <p className={`text-xs font-mono ${stat.good ? 'text-primary' : 'text-error'}`}>{stat.note}</p>
          </div>
        ))}
      </section>

      {/* Domain Diagnostics */}
      <section>
        <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-5">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">Диагностика доменов</h2>
            <p className="text-xs text-on-surface-variant mt-1">Текущий уровень готовности по каждому направлению</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {MOCK_GRI_DOMAINS.map((domain) => {
            const pct = (domain.score / domain.max) * 100
            const isStrong = domain.score >= 700
            const isCritical = domain.score < 500
            return (
              <div key={domain.id} className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 p-5 transition-colors group">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-lg text-primary">{domain.icon}</span>
                  </div>
                  <span className={`text-xs font-mono ${isCritical ? 'text-error' : isStrong ? 'text-primary' : 'text-tertiary-container'}`}>
                    {isCritical ? 'Критично' : isStrong ? 'Сильная зона' : 'Развивается'}
                  </span>
                </div>
                <h3 className="text-sm font-medium text-on-surface mb-3">{domain.label}</h3>
                <div className="flex items-end justify-between mb-2">
                  <span className="text-3xl font-mono font-bold text-on-surface">{domain.score}</span>
                  <span className="text-xs text-on-surface-variant font-mono">/ 1000</span>
                </div>
                <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${isCritical ? 'bg-error' : isStrong ? 'bg-primary' : 'bg-tertiary-container'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Problem Areas */}
      <section>
        <h2 className="font-headline text-lg font-bold text-on-surface mb-5">Выявленные проблемы</h2>
        <div className="space-y-3">
          {[
            { domain: 'Команда', issue: 'Высокая текучесть в отделе продаж (32% за год)', severity: 'high', action: 'Пересмотр системы мотивации' },
            { domain: 'Маркетинг', issue: 'CAC вырос на 18% при неизменном LTV', severity: 'medium', action: 'Оптимизация каналов привлечения' },
            { domain: 'Операции', issue: 'Ручные процессы в 40% ключевых workflow', severity: 'medium', action: 'Автоматизация и документирование' },
          ].map((item, i) => (
            <div key={i} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 flex items-start gap-4">
              <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${item.severity === 'high' ? 'bg-error' : 'bg-tertiary-container'}`} />
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-[10px] font-mono bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-md uppercase tracking-wider">
                    {item.domain}
                  </span>
                  <span className={`text-[10px] font-mono uppercase ${item.severity === 'high' ? 'text-error' : 'text-tertiary-container'}`}>
                    {item.severity === 'high' ? 'Высокий' : 'Средний'} приоритет
                  </span>
                </div>
                <p className="text-sm text-on-surface mb-1">{item.issue}</p>
                <p className="text-xs text-primary">→ {item.action}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
