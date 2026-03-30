'use client'

import { useState } from 'react'

const INSIGHTS = [
  {
    id: 'i1',
    category: 'Финансы',
    title: 'Выручка растёт быстрее рынка',
    body: 'ARR вырос на 18.2% в Q4 2025 против среднеотраслевых 9.4%. Основной драйвер — расширение в сегменте Enterprise.',
    impact: 'high',
    type: 'opportunity',
    date: '22 Mar 2026',
    read: false,
  },
  {
    id: 'i2',
    category: 'Рынок',
    title: 'Новая ниша: SMB-автоматизация',
    body: 'Анализ данных показывает незакрытый спрос на автоматизацию среди SMB-компаний. Потенциал сегмента — ₸4.2 млрд к 2027.',
    impact: 'high',
    type: 'opportunity',
    date: '20 Mar 2026',
    read: false,
  },
  {
    id: 'i3',
    category: 'Команда',
    title: 'Дефицит инженеров продуктового уровня',
    body: 'Текущий состав покрывает 70% потребностей продуктовой дорожной карты. Рекомендуем найм 2-3 senior-инженеров в Q2 2026.',
    impact: 'medium',
    type: 'risk',
    date: '18 Mar 2026',
    read: true,
  },
  {
    id: 'i4',
    category: 'Продукт',
    title: 'Churn снизился до 2.1%',
    body: 'Внедрение онбординга в Q3 2025 снизило churn с 4.8% до 2.1%. Успешный кейс для масштабирования практики на новые сегменты.',
    impact: 'high',
    type: 'achievement',
    date: '15 Mar 2026',
    read: true,
  },
  {
    id: 'i5',
    category: 'Стратегия',
    title: 'OKR Q1 2026: прогресс 73%',
    body: '3 из 4 ключевых результатов выполнены на 100%. Отстаёт KR по партнёрским каналам (48%). Требует пересмотра приоритетов.',
    impact: 'medium',
    type: 'risk',
    date: '12 Mar 2026',
    read: true,
  },
  {
    id: 'i6',
    category: 'Операции',
    title: 'Автоматизация сэкономила 240 часов/мес',
    body: 'Внедрённые в Q4 2025 n8n-воркфлоу для отчётности и онбординга освободили ~240 часов команды ежемесячно.',
    impact: 'medium',
    type: 'achievement',
    date: '10 Mar 2026',
    read: true,
  },
]

const CATEGORIES = ['Все', 'Финансы', 'Рынок', 'Команда', 'Продукт', 'Стратегия', 'Операции']

const TYPE_CONFIG = {
  opportunity: { label: 'Возможность', icon: 'lightbulb',    color: 'text-primary',   bg: 'bg-primary/10',   border: 'border-primary/20'   },
  risk:         { label: 'Риск',        icon: 'warning',      color: 'text-error',     bg: 'bg-error/10',     border: 'border-error/20'     },
  achievement:  { label: 'Достижение', icon: 'star',          color: 'text-secondary', bg: 'bg-secondary/10', border: 'border-secondary/20' },
}

const IMPACT_COLORS = {
  high:   'text-primary bg-primary/10 border-primary/20',
  medium: 'text-on-surface-variant bg-surface-container border-white/[0.06]',
  low:    'text-on-surface-variant/60 bg-surface-container border-white/[0.04]',
}

export default function ExpertInsightsPage() {
  const [filter, setFilter] = useState('Все')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [readInsights, setReadInsights] = useState<Set<string>>(
    new Set(INSIGHTS.filter(i => i.read).map(i => i.id))
  )

  const filtered = INSIGHTS.filter(ins => {
    const matchCat  = filter === 'Все' || ins.category === filter
    const matchType = !typeFilter || ins.type === typeFilter
    return matchCat && matchType
  })

  const unreadCount = INSIGHTS.filter(i => !readInsights.has(i.id)).length

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">Expert Portal</p>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-headline text-3xl font-extrabold text-on-surface">Инсайты</h1>
            <p className="text-on-surface-variant mt-2 text-sm">AI-аналитика на основе ваших данных</p>
          </div>
          {unreadCount > 0 && (
            <span className="text-xs font-mono text-primary bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-xl">
              {unreadCount} новых
            </span>
          )}
        </div>
      </section>

      {/* Summary stats */}
      <section className="grid grid-cols-3 gap-3">
        {[
          { label: 'Возможности', count: INSIGHTS.filter(i => i.type === 'opportunity').length, icon: 'lightbulb', color: 'text-primary' },
          { label: 'Риски',       count: INSIGHTS.filter(i => i.type === 'risk').length,        icon: 'warning',   color: 'text-error'   },
          { label: 'Достижения',  count: INSIGHTS.filter(i => i.type === 'achievement').length, icon: 'star',      color: 'text-secondary' },
        ].map((s) => (
          <button key={s.label}
            onClick={() => setTypeFilter(typeFilter === s.label.toLowerCase().slice(0,-1) ? null : s.label.toLowerCase().slice(0,-1))}
            className={`bg-surface-container-low rounded-2xl border p-4 text-left transition-colors ${
              typeFilter && s.label.toLowerCase().startsWith(typeFilter)
                ? 'border-primary/30 bg-primary/5'
                : 'border-white/[0.04] hover:border-white/[0.08]'
            }`}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`material-symbols-outlined text-base ${s.color}`}>{s.icon}</span>
              <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{s.label}</span>
            </div>
            <p className={`text-2xl font-mono font-bold ${s.color}`}>{s.count}</p>
          </button>
        ))}
      </section>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => setFilter(c)}
            className={`text-xs font-mono px-3 py-1.5 rounded-full border transition-colors ${
              filter === c
                ? 'bg-primary/10 text-primary border-primary/20'
                : 'text-on-surface-variant border-white/[0.06] hover:border-white/[0.12] hover:text-on-surface'
            }`}>
            {c}
          </button>
        ))}
      </div>

      {/* Insights list */}
      <section className="space-y-4">
        {filtered.map((ins) => {
          const typeConf = TYPE_CONFIG[ins.type as keyof typeof TYPE_CONFIG]
          const isUnread = !readInsights.has(ins.id)
          return (
            <div
              key={ins.id}
              onClick={() => setReadInsights(prev => new Set([...prev, ins.id]))}
              className={`bg-surface-container-low rounded-2xl border p-5 transition-all cursor-pointer hover:border-primary/20 ${
                isUnread ? 'border-primary/10' : 'border-white/[0.04]'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${typeConf.bg} border ${typeConf.border}`}>
                    <span className={`material-symbols-outlined text-lg ${typeConf.color}`}>{typeConf.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{ins.category}</span>
                      {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
                    </div>
                    <h3 className="text-sm font-semibold text-on-surface mb-1.5">{ins.title}</h3>
                    <p className="text-sm text-on-surface-variant leading-relaxed">{ins.body}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <span className={`text-[10px] font-mono uppercase px-2.5 py-1 rounded-full border ${typeConf.bg} ${typeConf.color} ${typeConf.border}`}>
                    {typeConf.label}
                  </span>
                  <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${IMPACT_COLORS[ins.impact as keyof typeof IMPACT_COLORS]}`}>
                    {ins.impact === 'high' ? 'Высокий' : ins.impact === 'medium' ? 'Средний' : 'Низкий'}
                  </span>
                  <span className="text-[10px] font-mono text-on-surface-variant">{ins.date}</span>
                </div>
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/20 block mb-3">lightbulb</span>
            <p className="text-sm text-on-surface-variant">Инсайты не найдены</p>
            <button onClick={() => { setFilter('Все'); setTypeFilter(null) }}
              className="mt-3 text-xs text-primary hover:underline font-mono">
              Сбросить фильтры
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
