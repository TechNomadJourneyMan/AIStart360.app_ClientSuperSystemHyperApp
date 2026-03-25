'use client'

const GRI_DOMAINS = [
  { id: 'finance',    label: 'Финансы',        score: 88, weight: 25, icon: 'payments',         desc: 'Выручка, маржа, рентабельность' },
  { id: 'market',    label: 'Рынок',            score: 79, weight: 20, icon: 'public',            desc: 'Доля рынка, конкуренты, позиционирование' },
  { id: 'product',   label: 'Продукт',          score: 92, weight: 20, icon: 'inventory_2',       desc: 'Продуктовый портфель, unit-экономика' },
  { id: 'team',      label: 'Команда',          score: 71, weight: 15, icon: 'groups',            desc: 'Компетенции, структура, культура' },
  { id: 'ops',       label: 'Операции',         score: 84, weight: 10, icon: 'precision_manufacturing', desc: 'Процессы, автоматизация, эффективность' },
  { id: 'strategy',  label: 'Стратегия',        score: 76, weight: 10, icon: 'track_changes',     desc: 'Цели, дорожная карта, OKR' },
]

const INSIGHTS = [
  { type: 'strength', text: 'Высокий продуктовый скор — сильная unit-экономика и чёткий PMF.', domain: 'Продукт' },
  { type: 'growth',   text: 'Команда — зона роста. Рекомендуем усилить ключевые роли.', domain: 'Команда' },
  { type: 'growth',   text: 'Стратегический OKR требует пересмотра на H2 2026.', domain: 'Стратегия' },
  { type: 'strength', text: 'Финансовые показатели в топ-15% среди похожих компаний.', domain: 'Финансы' },
]

const HISTORY = [
  { period: 'Q2 2025', score: 760 },
  { period: 'Q3 2025', score: 798 },
  { period: 'Q4 2025', score: 818 },
  { period: 'Q1 2026', score: 842 },
]

function ScoreBar({ score, color = 'primary' }: { score: number; color?: string }) {
  return (
    <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
      <div
        className={`h-full bg-${color} rounded-full transition-all duration-700`}
        style={{ width: `${score}%` }}
      />
    </div>
  )
}

function ScoreColor(score: number) {
  if (score >= 85) return 'text-primary'
  if (score >= 70) return 'text-secondary'
  return 'text-error'
}

export default function ExpertGriPage() {
  const totalScore = 842
  const circumference = 2 * Math.PI * 64

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">Expert Portal</p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface">GRI-диагностика</h1>
        <p className="text-on-surface-variant mt-2 text-sm">Growth Readiness Index — комплексная оценка готовности к росту</p>
      </section>

      {/* Score + Trend */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main dial */}
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-8 flex flex-col items-center justify-center">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-6">Итоговый GRI Score</p>
          <div className="relative w-44 h-44 mb-6">
            <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
              <circle cx="80" cy="80" r="64" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
              <circle cx="80" cy="80" r="64" fill="none" stroke="#6effc0" strokeWidth="10" strokeLinecap="round"
                strokeDasharray={`${circumference * (totalScore / 1000)} ${circumference}`} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-mono font-bold text-on-surface">{totalScore}</span>
              <span className="text-[10px] font-mono text-on-surface-variant">/ 1000</span>
            </div>
          </div>
          <span className="text-sm font-mono text-primary bg-primary/10 border border-primary/20 px-4 py-1.5 rounded-full mb-3">Strong Growth Ready</span>
          <p className="text-xs text-on-surface-variant text-center">Топ 18% среди компаний вашего сегмента</p>
        </div>

        {/* History */}
        <div className="lg:col-span-2 bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-6">История GRI Score</p>
          <div className="flex items-end justify-around h-40 gap-4 mb-4">
            {HISTORY.map((h) => {
              const height = (h.score / 1000) * 100
              return (
                <div key={h.period} className="flex flex-col items-center gap-2 flex-1">
                  <span className="text-xs font-mono text-primary">{h.score}</span>
                  <div className="w-full rounded-t-lg bg-primary/20 border-t-2 border-primary/60 transition-all duration-700"
                    style={{ height: `${height}%` }} />
                  <span className="text-[10px] font-mono text-on-surface-variant whitespace-nowrap">{h.period}</span>
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="material-symbols-outlined text-sm text-primary">trending_up</span>
            <span className="text-xs text-primary font-mono">+82 pts за год</span>
            <span className="text-xs text-on-surface-variant ml-2">Средний прирост +20.5 pts/квартал</span>
          </div>
        </div>
      </section>

      {/* Domain breakdown */}
      <section>
        <h2 className="font-headline text-lg font-bold text-on-surface mb-5">Разбивка по доменам</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {GRI_DOMAINS.map((domain) => (
            <div key={domain.id} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 hover:border-primary/20 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-base text-primary">{domain.icon}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-on-surface">{domain.label}</p>
                    <p className="text-[10px] font-mono text-on-surface-variant">Вес: {domain.weight}%</p>
                  </div>
                </div>
                <span className={`text-xl font-mono font-bold ${ScoreColor(domain.score)}`}>{domain.score}</span>
              </div>
              <ScoreBar score={domain.score} />
              <p className="text-[11px] text-on-surface-variant mt-2">{domain.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Insights */}
      <section>
        <h2 className="font-headline text-lg font-bold text-on-surface mb-5">Ключевые инсайты</h2>
        <div className="space-y-3">
          {INSIGHTS.map((ins, i) => (
            <div key={i} className={`flex items-start gap-4 p-4 rounded-xl border ${
              ins.type === 'strength'
                ? 'bg-primary/5 border-primary/20'
                : 'bg-secondary/5 border-secondary/20'
            }`}>
              <span className={`material-symbols-outlined text-xl flex-shrink-0 ${
                ins.type === 'strength' ? 'text-primary' : 'text-secondary'
              }`}>
                {ins.type === 'strength' ? 'check_circle' : 'arrow_upward'}
              </span>
              <div className="flex-1">
                <p className="text-sm text-on-surface">{ins.text}</p>
                <span className="text-[10px] font-mono text-on-surface-variant mt-1 inline-block">{ins.domain}</span>
              </div>
              <span className={`text-[10px] font-mono uppercase px-2 py-1 rounded-full border flex-shrink-0 ${
                ins.type === 'strength'
                  ? 'text-primary bg-primary/10 border-primary/20'
                  : 'text-secondary bg-secondary/10 border-secondary/20'
              }`}>
                {ins.type === 'strength' ? 'Сила' : 'Рост'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
