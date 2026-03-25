'use client'

import { useState } from 'react'

const GRI_BLOCKS = [
  {
    id: 'business_model',
    label: 'Бизнес-модель',
    score: 7.4,
    max: 10,
    status: 'Достаточный уровень, но есть зоны для усиления',
    tier: 'good',
    description: 'Модель монетизации понятна, есть повторяемые источники дохода. Требует усиления в части масштабирования и партнёрских каналов.',
    actions: ['Формализовать партнёрскую модель продаж', 'Добавить второй канал монетизации', 'Протестировать апселл-воронку'],
  },
  {
    id: 'founder',
    label: 'Готовность основателя',
    score: 6.7,
    max: 10,
    status: 'Достаточный уровень, но есть зоны для усиления',
    tier: 'good',
    description: 'Высокий уровень вовлечённости и экспертизы основателя. Есть риск операционного залипания — стоит делегировать больше.',
    actions: ['Делегировать операционные задачи', 'Выстроить личный стратегический ритм', 'Инвестировать время в системное развитие'],
  },
  {
    id: 'trust',
    label: 'Доверие и позиционирование',
    score: 5.17,
    max: 10,
    status: 'Слабое место, требует приоритетной доработки',
    tier: 'weak',
    description: 'Позиционирование размытое, недостаточно кейсов и доказательств результата. Сложно отличиться от конкурентов.',
    actions: ['Зафиксировать 3 сильных кейса с цифрами', 'Обновить позиционирование на сайте', 'Запустить контент-стратегию с экспертизой'],
  },
  {
    id: 'cash',
    label: 'Стабильность кассы',
    score: 5.0,
    max: 10,
    status: 'Слабое место, требует приоритетной доработки',
    tier: 'weak',
    description: 'Кассовые разрывы присутствуют, выручка нестабильная. Нет финансовой подушки на 3+ месяца.',
    actions: ['Выстроить финансовую модель на 6 месяцев', 'Внедрить предоплатную или подписочную модель', 'Сократить дебиторскую задолженность'],
  },
  {
    id: 'product',
    label: 'Продукт и спрос',
    score: 4.7,
    max: 10,
    status: 'Слабое место, требует приоритетной доработки',
    tier: 'weak',
    description: 'Продукт есть, но спрос нестабильный и зависит от ручных усилий. PMF не подтверждён метриками.',
    actions: ['Провести 10 custdev-интервью', 'Замерить NPS и retention', 'Протестировать 2 новые аудитории'],
  },
  {
    id: 'team',
    label: 'Команда',
    score: 2.55,
    max: 10,
    status: 'КРИТИЧЕСКИЙ БЛОК — масштабирование невозможно',
    tier: 'critical',
    description: 'Команда слабо структурирована, нет системы онбординга и KPI. Высокая зависимость от конкретных людей.',
    actions: ['Описать роли и ответственности', 'Внедрить еженедельный командный ритм', 'Разработать систему KPI для ключевых позиций'],
  },
  {
    id: 'operations',
    label: 'Операции',
    score: 2.14,
    max: 10,
    status: 'КРИТИЧЕСКИЙ БЛОК — масштабирование невозможно',
    tier: 'critical',
    description: 'Процессы не описаны, результат непредсказуем. Нет метрик, стандартов и инструментов для повторяемости.',
    actions: ['Описать топ-3 критичных процесса', 'Внедрить инструмент управления задачами', 'Создать систему метрик результата'],
  },
]

const TOP_LIMITS = [
  { block: 'Операции',          issue: 'Повторяемость процесса',     score: 1, detail: 'Каждый раз всё делается по-разному, нет стандартов' },
  { block: 'Операции',          issue: 'Риски при масштабировании',  score: 1, detail: 'При росте нагрузки процессы сломаются' },
  { block: 'Операции',          issue: 'Метрики результата команды', score: 1, detail: 'Нет измеримых показателей работы команды' },
  { block: 'Операции',          issue: 'Предсказуемость результата', score: 1, detail: 'Непонятно, какой будет результат завтра' },
  { block: 'Доверие и позиция', issue: 'Доказательства результата',  score: 2, detail: 'Недостаточно кейсов с измеримыми результатами' },
]

const ACTION_PLAN = [
  { week: '1–2', priority: 'Критично', action: 'Описать 3 ключевых операционных процесса', block: 'Операции' },
  { week: '2–3', priority: 'Критично', action: 'Внедрить систему KPI для команды', block: 'Команда' },
  { week: '3–4', priority: 'Высокий',  action: 'Зафиксировать 3 кейса с цифрами для сайта', block: 'Доверие' },
  { week: '4–6', priority: 'Высокий',  action: 'Построить финансовую модель на 6 месяцев', block: 'Касса' },
  { week: '6–8', priority: 'Средний',  action: 'Провести custdev и замерить NPS', block: 'Продукт' },
  { week: '8–12', priority: 'Средний', action: 'Тест партнёрской модели продаж', block: 'Бизнес-модель' },
]

const tierColor = (tier: string) => {
  if (tier === 'good')     return { text: 'text-primary',    bg: 'bg-primary/10',    border: 'border-primary/20',    bar: 'bg-primary'    }
  if (tier === 'weak')     return { text: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/20', bar: 'bg-yellow-400' }
  return                          { text: 'text-error',      bg: 'bg-error/10',      border: 'border-error/20',      bar: 'bg-error'      }
}

const priorityColor = (p: string) => {
  if (p === 'Критично') return 'text-error bg-error/10 border-error/20'
  if (p === 'Высокий')  return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20'
  return 'text-primary bg-primary/10 border-primary/20'
}

export default function OwnerGriPage() {
  const [activeBlock, setActiveBlock] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'limits' | 'plan'>('overview')

  const griScore = 4.59

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-headline text-2xl font-bold text-on-surface">GRI Результаты диагностики</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Growth Readiness Index · TechStart KZ · Март 2026
        </p>
      </div>

      {/* Score hero */}
      <div className="glass-card rounded-2xl p-6 border border-white/[0.06] relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(circle at 80% 50%, #6effc0 0%, transparent 60%)' }} />
        <div className="relative flex items-center gap-8 flex-wrap">
          {/* Radar chart placeholder */}
          <div className="flex-shrink-0 relative w-36 h-36">
            <svg viewBox="0 0 200 200" className="w-full h-full opacity-80">
              {[20,40,60,80].map((r) => (
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
                points={GRI_BLOCKS.map((b, i) => {
                  const angle = (i * 2 * Math.PI / 7) - Math.PI / 2
                  const r = (b.score / 10) * 80
                  return `${100 + r * Math.cos(angle)},${100 + r * Math.sin(angle)}`
                }).join(' ')}
                fill="rgba(110,255,192,0.12)" stroke="#6effc0" strokeWidth="1.5"
              />
              {GRI_BLOCKS.map((b, i) => {
                const angle = (i * 2 * Math.PI / 7) - Math.PI / 2
                const r = (b.score / 10) * 80
                const color = b.tier === 'good' ? '#6effc0' : b.tier === 'weak' ? '#facc15' : '#ef4444'
                return <circle key={i} cx={100 + r * Math.cos(angle)} cy={100 + r * Math.sin(angle)} r="4" fill={color} />
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
              <span className="text-4xl font-mono font-bold text-yellow-400">{griScore}</span>
              <span className="text-lg text-on-surface-variant">/ 10</span>
              <span className="px-3 py-1 rounded-full text-xs font-mono bg-yellow-400/10 text-yellow-400 border border-yellow-400/20">
                Средний уровень
              </span>
            </div>
            <p className="text-sm text-on-surface-variant max-w-lg leading-relaxed">
              Бизнес имеет потенциал, но операционная неготовность блокирует масштабирование. Приоритет — операции и команда.
            </p>
            <div className="flex flex-wrap gap-3 mt-3">
              {[
                { label: '7 блоков', sub: 'диагностики', color: 'text-primary' },
                { label: '2 критичных', sub: 'блока', color: 'text-error' },
                { label: '5 ограничений', sub: 'топ-список', color: 'text-yellow-400' },
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
          { id: 'limits',   label: 'Ограничения' },
          { id: 'plan',     label: 'План 90 дней' },
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
          {GRI_BLOCKS.map((block) => {
            const c = tierColor(block.tier)
            const expanded = activeBlock === block.id
            return (
              <div key={block.id}
                className={`glass-card rounded-2xl border transition-all cursor-pointer ${expanded ? `border-white/[0.1] bg-white/[0.04]` : 'border-white/[0.04] hover:border-white/[0.08]'}`}
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
                  <div className="px-4 pb-4 pt-0 space-y-3 border-t border-white/[0.04] mt-1 pt-4">
                    <p className="text-sm text-on-surface-variant leading-relaxed">{block.description}</p>
                    <div>
                      <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider mb-2">Приоритетные действия</p>
                      <ul className="space-y-1.5">
                        {block.actions.map((a, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-on-surface">
                            <span className={`w-4 h-4 rounded-full ${c.bg} border ${c.border} flex items-center justify-center flex-shrink-0 text-[9px] font-mono ${c.text} mt-0.5`}>{i+1}</span>
                            {a}
                          </li>
                        ))}
                      </ul>
                    </div>
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
          {TOP_LIMITS.map((item, i) => (
            <div key={i} className="flex items-start gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              <div className="w-8 h-8 rounded-xl bg-error/10 border border-error/20 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-mono font-bold text-error">{item.score}</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm font-medium text-on-surface">{item.issue}</p>
                  <span className="text-[10px] font-mono text-on-surface-variant bg-white/[0.04] px-2 py-0.5 rounded-full">{item.block}</span>
                </div>
                <p className="text-xs text-on-surface-variant mt-1">{item.detail}</p>
                <div className="mt-2 h-1 bg-white/[0.04] rounded-full overflow-hidden">
                  <div className="h-full bg-error rounded-full" style={{ width: `${(item.score / 10) * 100}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Action Plan */}
      {activeTab === 'plan' && (
        <div className="glass-card rounded-2xl p-5 border border-white/[0.06]">
          <p className="text-xs text-on-surface-variant mb-5">
            90-дневный план приоритетных действий на основе GRI диагностики.
          </p>
          <div className="space-y-3">
            {ACTION_PLAN.map((item, i) => (
              <div key={i} className="flex items-start gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <div className="flex-shrink-0 text-center">
                  <p className="text-[9px] font-mono text-on-surface-variant uppercase">Неделя</p>
                  <p className="text-xs font-mono font-bold text-on-surface">{item.week}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm text-on-surface">{item.action}</p>
                  </div>
                  <p className="text-[10px] text-on-surface-variant mt-0.5">{item.block}</p>
                </div>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border flex-shrink-0 ${priorityColor(item.priority)}`}>
                  {item.priority}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
