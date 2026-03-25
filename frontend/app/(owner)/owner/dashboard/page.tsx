'use client'

import { useAuthStore } from '@/stores/auth.store'
import Link from 'next/link'

const GRI_BLOCKS = [
  { label: 'Бизнес-модель',       score: 7.4,  color: 'text-primary',   bg: 'bg-primary/10',   status: 'Хорошо' },
  { label: 'Готовность основателя', score: 6.7,  color: 'text-primary',   bg: 'bg-primary/10',   status: 'Хорошо' },
  { label: 'Доверие и позиция',    score: 5.17, color: 'text-yellow-400', bg: 'bg-yellow-400/10', status: 'Слабое' },
  { label: 'Стабильность кассы',   score: 5.0,  color: 'text-yellow-400', bg: 'bg-yellow-400/10', status: 'Слабое' },
  { label: 'Продукт и спрос',      score: 4.7,  color: 'text-yellow-400', bg: 'bg-yellow-400/10', status: 'Слабое' },
  { label: 'Команда',              score: 2.55, color: 'text-error',      bg: 'bg-error/10',      status: 'Критично' },
  { label: 'Операции',             score: 2.14, color: 'text-error',      bg: 'bg-error/10',      status: 'Критично' },
]

const TOP_LIMITS = [
  { block: 'Операции',              issue: 'Повторяемость процесса',        score: 1 },
  { block: 'Операции',              issue: 'Риски при масштабировании',     score: 1 },
  { block: 'Операции',              issue: 'Метрики результата команды',    score: 1 },
  { block: 'Операции',              issue: 'Предсказуемость результата',    score: 1 },
  { block: 'Доверие и позиция',     issue: 'Доказательства результата',     score: 2 },
]

export default function OwnerDashboardPage() {
  const { user } = useAuthStore()
  const griScore = 4.59

  const scoreWidth = (score: number) => `${(score / 10) * 100}%`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-headline text-2xl font-bold text-on-surface">
            Добро пожаловать, {user?.name?.split(' ')[0] ?? 'Марина'}
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            {user?.organization ?? 'TechStart KZ'} · GRI Диагностика завершена
          </p>
        </div>
        <Link href="/owner/gri"
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary/10 border border-secondary/20 text-secondary text-sm font-medium hover:bg-secondary/20 transition-colors">
          <span className="material-symbols-outlined text-lg">radar</span>
          Полный отчёт GRI
        </Link>
      </div>

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
                  stroke={griScore >= 7 ? '#6effc0' : griScore >= 5 ? '#facc15' : '#ef4444'}
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
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-yellow-400/10 text-yellow-400 border border-yellow-400/20">
                Средний уровень
              </span>
            </div>
            <h2 className="text-xl font-bold text-on-surface mb-2">Индекс готовности к росту</h2>
            <p className="text-sm text-on-surface-variant leading-relaxed max-w-lg">
              Ваш бизнес имеет сильную бизнес-модель и высокую готовность основателя, но операционный блок является критическим ограничителем для масштабирования.
            </p>
            <div className="flex items-center gap-4 mt-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-primary" />
                <span className="text-xs text-on-surface-variant">2 блока сильные</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-yellow-400" />
                <span className="text-xs text-on-surface-variant">3 блока слабые</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-error" />
                <span className="text-xs text-on-surface-variant">2 блока критичных</span>
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
            {GRI_BLOCKS.map((b) => (
              <div key={b.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-on-surface-variant">{b.label}</span>
                  <span className={`text-xs font-mono font-bold ${b.color}`}>{b.score}</span>
                </div>
                <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${b.score >= 7 ? 'bg-primary' : b.score >= 5 ? 'bg-yellow-400' : 'bg-error'}`}
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
          <div className="space-y-2.5">
            {TOP_LIMITS.map((item, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <div className="w-7 h-7 rounded-lg bg-error/10 border border-error/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-mono font-bold text-error">{item.score}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-on-surface">{item.issue}</p>
                  <p className="text-[10px] text-on-surface-variant mt-0.5">{item.block}</p>
                </div>
              </div>
            ))}
          </div>
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
            { icon: 'event', title: 'Сессия с экспертом', desc: 'Запланируйте разбор операционного блока', color: 'text-secondary', bg: 'bg-secondary/10' },
            { icon: 'description', title: 'Полный отчёт', desc: 'Скачайте детальный GRI отчёт с планом действий', color: 'text-primary', bg: 'bg-primary/10' },
            { icon: 'track_changes', title: 'План на 90 дней', desc: 'Приоритетные действия для роста операций', color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
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
    </div>
  )
}
