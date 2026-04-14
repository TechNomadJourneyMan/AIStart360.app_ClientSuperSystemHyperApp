export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase-server'

export const metadata: Metadata = { title: 'GRI — Growth Readiness Index' }

// ─── portfolio GRI averages from Supabase diagnostics ────────────────────────
interface PortfolioGRI {
  overall:      number
  product:      number
  trust:        number
  bizmodel:     number
  cash:         number
  ops:          number
  team:         number
  founder:      number
  reportCount:  number
}

async function getPortfolioGRI(): Promise<PortfolioGRI | null> {
  try {
    const sb = createServerClient()

    // Get all diagnostics with scores
    const { data: diagnostics } = await sb
      .from('diagnostics')
      .select('overall_score, finance_score, sales_score, operations_score, marketing_score, strategy_score')
      .not('overall_score', 'is', null)
      .gt('overall_score', 0)

    if (!diagnostics?.length) return null

    // Map Point A blocks to GRI 7-domain model (approximate mapping)
    const getScore = (d: Record<string, unknown>, key: string): number => {
      const block = d[key] as { score?: number } | null
      return (block?.score ?? 0) / 10  // Convert 0-100 to 0-10
    }

    const avgField = (extractor: (d: Record<string, unknown>) => number): number => {
      const vals = diagnostics.map(d => extractor(d as Record<string, unknown>)).filter(v => v > 0)
      return vals.length > 0 ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0
    }

    return {
      overall:     avgField(d => (d.overall_score as number ?? 0) / 10),
      product:     avgField(d => getScore(d, 'marketing_score')),    // Marketing → Product & Demand
      trust:       avgField(d => getScore(d, 'strategy_score')),     // Strategy → Trust & Positioning
      bizmodel:    avgField(d => getScore(d, 'sales_score')),        // Sales → Business Model
      cash:        avgField(d => getScore(d, 'finance_score')),      // Finance → Cash
      ops:         avgField(d => getScore(d, 'operations_score')),   // Operations → Operations
      team:        avgField(d => getScore(d, 'operations_score')),   // Operations → Team (proxy)
      founder:     avgField(d => getScore(d, 'strategy_score')),     // Strategy → Founder (proxy)
      reportCount: diagnostics.length,
    }
  } catch (error) {
    console.error("Failed to load diagnostics for GRI:", error)
    return null
  }
}

// ─── Real GRI data from GRI_v11_with_colored_report.xlsx ─────────────────────
const GRI_BLOCKS = [
  {
    id: 'product',
    label: 'Product & Demand',
    labelRu: 'Product & Demand',
    icon: 'inventory_2',
    score: 4.7,
    color: 'error',
    status: 'Weak spot — priority improvement',
    description: 'Есть ли спрос, который выдерживает скорость $2M/год',
    economicLoss: '-40% выручки · длинный цикл сделки · слабый средний чек',
    criteria: [
      { label: 'Критичность боли',                       score: 8 },
      { label: 'Потери клиента (осознанность проблемы)', score: 3 },
      { label: 'Стиль поиска решения',                   score: 5 },
      { label: 'Потенциал высокого чека',                 score: 4 },
      { label: 'Потенциал повторных покупок',             score: 6 },
      { label: 'Потенциал платёжеспособного сегмента',   score: 8 },
    ],
  },
  {
    id: 'trust',
    label: 'Trust & Positioning',
    labelRu: 'Trust & Positioning',
    icon: 'verified',
    score: 5.2,
    color: 'error',
    status: 'Weak spot — priority improvement',
    description: 'Выбирают ли вас сразу. Почему вас, а не конкурента',
    economicLoss: '-30–50% конверсии · CAC ×2–3 · сделки зависают',
    criteria: [
      { label: 'Доверие с первого контакта',      score: 9 },
      { label: 'Доказательства результата',       score: 2 },
      { label: 'Социальное доказательство',       score: 3 },
      { label: 'Понятность решения',              score: 4 },
      { label: 'Информация о вас в сети',         score: 5 },
      { label: 'Отстройка от конкурентов',        score: 6 },
    ],
  },
  {
    id: 'bizmodel',
    label: 'Business Model',
    labelRu: 'Business Model',
    icon: 'account_tree',
    score: 7.4,
    color: 'secondary',
    status: 'Достаточный уровень — есть зоны усиления',
    description: 'Масштабируется ли прибыль, а не только оборот',
    economicLoss: 'Потолок роста ×2–5 ниже · рост «съедает» маржу',
    criteria: [
      { label: 'Подписочная модель',              score: 7 },
      { label: 'Дополнительные продажи (апселлы)',score: 7 },
      { label: 'Партнёрские каналы',              score: 8 },
      { label: 'Географическое масштабирование',  score: 9 },
      { label: 'Эффективность CAC',               score: 8 },
    ],
  },
  {
    id: 'cash',
    label: 'Cash Stability',
    labelRu: 'Financial Sustainability',
    icon: 'account_balance',
    score: 5.0,
    color: 'error',
    status: 'Weak spot — priority improvement',
    description: 'Кто финансирует рост — клиент или собственник',
    economicLoss: 'Кассовые разрывы · рост «на бумаге» · собственник докладывает деньги',
    criteria: [
      { label: 'Возможность внедрить депозит',    score: 5 },
      { label: 'Рассрочка / кредитование',        score: 2 },
      { label: 'CAC Payback (окупаемость)',        score: 4 },
    ],
  },
  {
    id: 'ops',
    label: 'Operations',
    labelRu: 'Operations',
    icon: 'precision_manufacturing',
    score: 2.1,
    color: 'error',
    status: '🔴 Критический блок — масштабирование невозможно',
    description: 'Повторяемость, стандарты, предсказуемость результата',
    economicLoss: 'Без операционной системы масштабирование ускоряет разрушение',
    criteria: [
      { label: 'Повторяемость процесса',           score: 1 },
      { label: 'Стандарты выполнения',             score: 3 },
      { label: 'Готовые модули для тиражирования', score: 4 },
      { label: 'Riskи при масштабировании',        score: 1 },
      { label: 'Metrics результата команды',       score: 1 },
      { label: 'Предсказуемость результата',       score: 1 },
      { label: 'Контроль качества',                score: 2 },
    ],
  },
  {
    id: 'team',
    label: 'Team',
    labelRu: 'Team',
    icon: 'groups',
    score: 2.5,
    color: 'error',
    status: '🔴 Критический блок — масштабирование невозможно',
    description: 'Укомплектованность, культура, дисциплина, найм',
    economicLoss: 'Нет команды — нет масштаба. Собственник — это потолок роста',
    criteria: [
      { label: 'Укомплектованность под $2M',      score: 2 },
      { label: 'Цифровизация',                    score: 2 },
      { label: 'Культура изменений',              score: 2 },
      { label: 'Прописанные ЦКП и чек-листы',     score: 8 },
      { label: 'Исполнительная дисциплина',        score: 2 },
      { label: 'Состав GTM-команды',              score: 2 },
      { label: 'Система найма',                   score: 2 },
      { label: 'Адаптация сотрудников',           score: 2 },
      { label: 'Удержание сотрудников',           score: 2 },
      { label: 'Конкурентные зарплаты',           score: 8 },
    ],
  },
  {
    id: 'founder',
    label: 'Founder Readiness',
    labelRu: 'Founder Readiness',
    icon: 'manage_accounts',
    score: 6.7,
    color: 'secondary',
    status: 'Достаточный уровень — есть зоны усиления',
    description: 'Скорость решений, финансовая зрелость, стрессоустойчивость',
    economicLoss: 'Собственник — узкое горлышко: решения замедляют рост',
    criteria: [
      { label: 'Нагрузка на собственника',         score: 8 },
      { label: 'Скорость принятия решений',        score: 9 },
      { label: 'Готовность к изменениям',          score: 6 },
      { label: 'Финансовая готовность',            score: 8 },
      { label: 'Стрессоустойчивость',              score: 6 },
      { label: 'Последовательность действий',      score: 6 },
      { label: 'Умеет читать отчёты',              score: 6 },
      { label: 'Зрелость мышления',                score: 6 },
      { label: 'Опыт управления $2M+',             score: 6 },
      { label: 'Уровень цифровизации',             score: 6 },
    ],
  },
]

const TOP_5_LIMITS = [
  { rank: 1, label: 'Повторяемость процесса',              block: 'Operations',       score: 1 },
  { rank: 2, label: 'Riskи при масштабировании',           block: 'Operations',       score: 1 },
  { rank: 3, label: 'Metrics результата команды',          block: 'Operations',       score: 1 },
  { rank: 4, label: 'Предсказуемость результата',          block: 'Operations',       score: 1 },
  { rank: 5, label: 'Доказательства результата',           block: 'Trust & Positioning', score: 2 },
]

const ACTION_PLAN = [
  {
    focus: 'Деньги и скорость',
    limit: 'Повторяемость процесса',
    action: 'Record 1–3 ключевых процесса и внедрить в ежедневный ритм команды',
    why: 'Даст быстрый эффект и снизит потери при росте',
    icon: 'bolt',
  },
  {
    focus: 'Деньги и скорость',
    limit: 'Riskи при масштабировании',
    action: 'Провести аудит riskов для партнёрских каналов. Составить карту узких мест',
    why: 'Без этого масштабирование ускоряет разрушение, а не рост',
    icon: 'warning',
  },
  {
    focus: 'Система и команда',
    limit: 'Metrics результата команды',
    action: 'Внедрить еженедельный трекинг 3–5 ключевых метрик по каждой роли',
    why: 'Невозможно управлять тем, что не измеряешь',
    icon: 'monitoring',
  },
  {
    focus: 'Система и команда',
    limit: 'Предсказуемость результата',
    action: 'Прописать стандарты выполнения по ключевым процессам. Чек-листы + ЦКП',
    why: 'Предсказуемость = возможность масштабировать без собственника',
    icon: 'checklist',
  },
  {
    focus: 'Масштабирование',
    limit: 'Доказательства результата',
    action: 'Собрать 3–5 кейсов с конкретными цифрами: до/после. Разместить везде',
    why: 'Сильные доказательства сокращают цикл сделки в 3–5 раз',
    icon: 'star',
  },
]

const RECOMMENDATIONS_30D = [
  'Определить 2–3 самых слабых блока по GRI и сфокусировать усилия на них',
  'Перепроверить продуктовую ценность и воронку: лид → диалог → предложение → сделка',
  'Настроить базовый набор метрик: лиды, конверсия, выручка, стоимость привлечения',
  'Перераспределить нагрузку с собственника на команду через роли, ЦКП и регламенты',
  'Подготовить и запустить пилотный период 21–30 days с чёткими целями по деньгам',
]

function ScoreBar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = (score / max) * 100
  const color = score >= 7 ? 'bg-primary' : score >= 5 ? 'bg-secondary' : 'bg-error'
  return (
    <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden flex-1">
      <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function scoreColor(s: number) {
  if (s >= 7) return 'text-primary'
  if (s >= 5) return 'text-secondary'
  return 'text-error'
}

export default async function GriPage() {
  const portfolio = await getPortfolioGRI()

  // Merge portfolio averages into GRI_BLOCKS (if real data exists)
  const scoreMap: Record<string, number> = portfolio ? {
    product: portfolio.product,
    trust:   portfolio.trust,
    bizmodel:portfolio.bizmodel,
    cash:    portfolio.cash,
    ops:     portfolio.ops,
    team:    portfolio.team,
    founder: portfolio.founder,
  } : {}

  const blocks = GRI_BLOCKS.map((b) =>
    scoreMap[b.id] !== undefined && scoreMap[b.id] > 0
      ? { ...b, score: scoreMap[b.id] }
      : b
  )

  const totalGRI   = portfolio?.overall
    ?? Number((blocks.reduce((sum, b) => sum + b.score, 0) / blocks.length).toFixed(2))
  const circumference = 2 * Math.PI * 64
  const dialColor  = totalGRI >= 7 ? '#6effc0' : totalGRI >= 5 ? '#a78bfa' : '#f87171'

  const scoreLabel =
    totalGRI >= 8 ? 'Высокая готовность' :
    totalGRI >= 6 ? 'Достаточный уровень' :
    totalGRI >= 4 ? 'Средняя готовность' :
                    'Критический уровень'

  return (
    <div className="space-y-10">

      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">GRI Strategy Workshop</p>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
              Growth Readiness Index
            </h1>
            <p className="text-on-surface-variant mt-2 text-sm max-w-2xl">
              Сборка и проверка системы роста на скорость $2M/год. Фиксация узких мест, экономических потерь и реального потолка роста.
            </p>
          </div>
          <span className="text-xs font-mono text-on-surface-variant bg-surface-container border border-white/[0.06] px-3 py-1.5 rounded-xl">
            {portfolio
              ? `Портфель · ${portfolio.reportCount} отчёт${portfolio.reportCount === 1 ? '' : portfolio.reportCount < 5 ? 'а' : 'ов'}`
              : 'Демо-анализ · Марина Рахимжанова'}
          </span>
        </div>
      </section>

      {/* Overall Score + Interpretation */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Dial */}
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-8 flex flex-col items-center">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-6">
            {portfolio ? 'Средний GRI портфеля' : 'Итоговый GRI'}
          </p>
          <div className="relative w-44 h-44 mb-5">
            <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
              <circle cx="80" cy="80" r="64" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
              <circle cx="80" cy="80" r="64" fill="none" stroke={dialColor} strokeWidth="10" strokeLinecap="round"
                strokeDasharray={`${circumference * (totalGRI / 10)} ${circumference}`} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-mono font-bold text-on-surface">{totalGRI}</span>
              <span className="text-[10px] font-mono text-on-surface-variant">/ 10</span>
            </div>
          </div>
          <span className={`text-sm font-mono px-4 py-1.5 rounded-full mb-3 ${
            totalGRI >= 7 ? 'text-primary bg-primary/10 border border-primary/20' :
            totalGRI >= 5 ? 'text-secondary bg-secondary/10 border border-secondary/20' :
                            'text-error bg-error/10 border border-error/20'
          }`}>
            {scoreLabel}
          </span>
          <p className="text-xs text-on-surface-variant text-center leading-relaxed">
            {totalGRI >= 7
              ? 'Высокий уровень готовности. Можно масштабировать.'
              : totalGRI >= 5
              ? 'Есть основа для роста. Требуется доработка блоков.'
              : 'Высокий risk провала при росте. Нужен пилот и доработка ключевых блоков.'}
          </p>
        </div>

        {/* Block scores */}
        <div className="lg:col-span-2 bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-5">Результаты по блокам</p>
          <div className="space-y-4">
            {blocks.map((block) => (
              <div key={block.id}>
                <div className="flex items-center gap-3 mb-1.5">
                  <span className="material-symbols-outlined text-base text-on-surface-variant/50 flex-shrink-0">{block.icon}</span>
                  <span className="text-sm text-on-surface flex-1">{block.labelRu}</span>
                  <span className={`text-sm font-mono font-bold flex-shrink-0 ${scoreColor(block.score)}`}>{block.score}</span>
                  <span className="text-[10px] font-mono text-on-surface-variant/50 w-5 text-right">/10</span>
                </div>
                <div className="ml-7">
                  <ScoreBar score={block.score} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why $2M/year */}
      <section className="relative rounded-2xl overflow-hidden border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-6">
        <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-[0.07]">
          <span className="material-symbols-outlined text-[120px] text-primary">rocket_launch</span>
        </div>
        <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">Почему именно $2M/год</p>
        <p className="text-sm text-on-surface-variant max-w-3xl leading-relaxed mb-4">
          <strong className="text-on-surface">$2M/год</strong> — это порог, после которого хаос становится фатальным. Граница между предпринимательством и управлением. Минимальная скорость для масштабирования, франшизы и передачи операционному директору.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-xl">
          {[
            { label: 'CAC Payback', value: '≤30–45 дней' },
            { label: 'Retention 30d', value: '50–70%' },
            { label: 'LTV/CAC', value: '≥ 3x' },
            { label: 'Повторная выручка', value: '40–60%' },
          ].map(s => (
            <div key={s.label}>
              <p className="text-base font-mono font-bold text-primary">{s.value}</p>
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 7 Blocks Detailed */}
      <section>
        <h2 className="font-headline text-xl font-bold text-on-surface mb-6">Детальный разбор по блокам</h2>
        <div className="space-y-4">
          {blocks.map((block) => (
            <details key={block.id} className="group bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
              <summary className="flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-white/[0.02] transition-colors list-none">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  block.score >= 7 ? 'bg-primary/10' : block.score >= 5 ? 'bg-secondary/10' : 'bg-error/10'
                }`}>
                  <span className={`material-symbols-outlined text-lg ${scoreColor(block.score)}`}>{block.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-on-surface">{block.labelRu}</p>
                    <span className="text-[10px] font-mono text-on-surface-variant">{block.label}</span>
                  </div>
                  <p className="text-xs text-on-surface-variant mt-0.5">{block.status}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`text-2xl font-mono font-bold ${scoreColor(block.score)}`}>{block.score}</span>
                  <span className="material-symbols-outlined text-on-surface-variant/40 group-open:rotate-180 transition-transform">expand_more</span>
                </div>
              </summary>

              <div className="px-6 pb-6 border-t border-white/[0.04]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-5">
                  {/* Criteria */}
                  <div>
                    <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-3">Критерии оценки</p>
                    <div className="space-y-2.5">
                      {block.criteria.map((c) => (
                        <div key={c.label} className="flex items-center gap-3">
                          <span className="text-xs text-on-surface-variant flex-1 min-w-0 truncate">{c.label}</span>
                          <ScoreBar score={c.score} />
                          <span className={`text-xs font-mono font-bold w-4 text-right flex-shrink-0 ${scoreColor(c.score)}`}>{c.score}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Economic context */}
                  <div className="space-y-4">
                    <div className="bg-surface-container rounded-xl p-4">
                      <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-2">Что проверяем</p>
                      <p className="text-sm text-on-surface">{block.description}</p>
                    </div>
                    <div className="bg-error/5 border border-error/20 rounded-xl p-4">
                      <p className="text-[10px] font-mono text-error/70 uppercase tracking-widest mb-2">Потери при слабом блоке</p>
                      <p className="text-sm text-on-surface-variant">{block.economicLoss}</p>
                    </div>
                  </div>
                </div>
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* Top 5 Limits */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <div className="flex items-center gap-2 mb-5">
            <span className="material-symbols-outlined text-lg text-error">block</span>
            <h2 className="font-headline text-lg font-bold text-on-surface">ТОП-5 Ограничений</h2>
          </div>
          <div className="space-y-3">
            {TOP_5_LIMITS.map((item) => (
              <div key={item.rank} className="flex items-center gap-4 p-3 rounded-xl bg-error/5 border border-error/10">
                <span className="text-xl font-mono font-bold text-error/40 w-6 flex-shrink-0">#{item.rank}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-on-surface">{item.label}</p>
                  <p className="text-[10px] font-mono text-on-surface-variant">{item.block}</p>
                </div>
                <span className="text-lg font-mono font-bold text-error">{item.score}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 30-day Recommendations */}
        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
          <div className="flex items-center gap-2 mb-5">
            <span className="material-symbols-outlined text-lg text-primary">calendar_today</span>
            <h2 className="font-headline text-lg font-bold text-on-surface">Рекомендации на 30 days</h2>
          </div>
          <div className="space-y-3">
            {RECOMMENDATIONS_30D.map((rec, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="material-symbols-outlined text-base text-primary flex-shrink-0 mt-0.5">check_circle</span>
                <p className="text-sm text-on-surface-variant">{rec}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-primary/5 border border-primary/20 rounded-xl">
            <p className="text-xs text-on-surface-variant">
              <strong className="text-on-surface">Потенциал:</strong> При доработке продукта, команды и операционной системы — движение к $2M за 2–3 года.
            </p>
          </div>
        </div>
      </section>

      {/* 90-Day Action Plan */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="font-headline text-xl font-bold text-on-surface">План действий на 90 days</h2>
            <p className="text-xs text-on-surface-variant mt-1">Приоритеты по ограничениям GRI</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {ACTION_PLAN.map((item, i) => (
            <div key={i} className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/20 p-5 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-lg text-primary">{item.icon}</span>
                </div>
                <span className="text-[10px] font-mono text-on-surface-variant bg-surface-container px-2 py-1 rounded-md">{item.focus}</span>
              </div>
              <p className="text-[10px] font-mono text-error/70 uppercase tracking-widest mb-1">Ограничение</p>
              <p className="text-sm font-semibold text-on-surface mb-3">{item.limit}</p>
              <p className="text-xs text-on-surface-variant leading-relaxed mb-3">{item.action}</p>
              <div className="flex items-start gap-2 bg-primary/5 rounded-xl p-3">
                <span className="material-symbols-outlined text-sm text-primary flex-shrink-0">lightbulb</span>
                <p className="text-[11px] text-on-surface-variant">{item.why}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Workshop CTA */}
      <section className="bg-surface-container-low rounded-2xl border border-primary/20 p-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">GRI Strategy Workshop</p>
            <h3 className="font-headline text-lg font-bold text-on-surface mb-1">
              Готов ли ваш бизнес держать скорость $2M/год?
            </h3>
            <p className="text-sm text-on-surface-variant">
              Разбор по 7 блокам. Собственник отвечает на вопросы → система считает GRI → вы видите точки роста, красные флаги и упущенные деньги.
            </p>
          </div>
          <a href="https://aistart360.app" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm font-mono text-[#003824] bg-gradient-to-r from-primary to-[#00e29e] px-5 py-2.5 rounded-xl font-bold hover:scale-[0.98] transition-all flex-shrink-0 whitespace-nowrap">
            <span className="material-symbols-outlined text-lg">open_in_new</span>
            Записаться на воркшоп
          </a>
        </div>
      </section>

    </div>
  )
}
