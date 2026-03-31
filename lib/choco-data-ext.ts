import type { Notification } from '@/types'
import { CHOCO_ALERTS } from './choco-data'

// ============================================================
// ChocoFamily Market Data — TAM/SAM/SOM из раздела 5 отчёта
// ============================================================
export const CHOCO_MARKET = {
  tam: '$9.9B (E-com KZ)',
  sam: '$350-400M (Food Delivery KZ)',
  som: '$59M GMV / $13M Net (Chocofood)',
  growth: '+14% CAGR Food',
  segments: [
    { name: 'Glovo', share: 36.6, color: '#ff9f60' },
    { name: 'Yandex Food', share: 25.7, color: '#ffbd60' },
    { name: 'Wolt', share: 17.6, color: '#00e29e' },
    { name: 'Chocofood', share: 16.8, color: '#6effc0' },
    { name: 'Airba Fresh', share: 3.3, color: '#84958a' },
  ],
  trends: [
    { label: 'Yandex Food: +363% г/г — угроза #1', priority: 'critical', icon: 'trending_up' },
    { label: 'Glovo: +64.3% г/г, доля #1 (36.6%)', priority: 'high', icon: 'campaign' },
    { label: 'Chocofood: −24.1% г/г, единственный минус', priority: 'critical', icon: 'trending_down' },
    { label: 'B2B SaaS (Smart Restaurant): устойчивый рост', priority: 'medium', icon: 'rocket_launch' },
    { label: 'E-com КЗ: +60% г/г, проникновение 21.9%', priority: 'medium', icon: 'public' },
  ],
}

// ============================================================
// ChocoFamily Notifications (derived from alerts)
// ============================================================
export const CHOCO_NOTIFICATIONS: Notification[] = CHOCO_ALERTS.map((a) => ({
  id: `notif-${a.id}`,
  type: (a.severity === 'critical' ? 'alert' : 'system') as Notification['type'],
  title: a.title,
  body: a.description,
  read: false,
  entityType: 'client',
  entityId: '7',
  time: a.time,
  createdAt: new Date().toISOString(),
}))

// ============================================================
// GRI Domains — proxy-метрики из раздела 4.5 отчёта
// Growth Score 55, Market Heat 40, Digital Presence 65,
// App Performance 70, Ecosystem Strength 50, Competitive Moat 35
// ============================================================
export const CHOCO_GRI_DOMAINS = [
  {
    id: 'app',
    label: 'App Performance',
    score: 7.0,
    max: 10,
    icon: 'smartphone',
    color: '#6effc0',
  },
  {
    id: 'digital',
    label: 'Digital Presence',
    score: 6.5,
    max: 10,
    icon: 'public',
    color: '#6effc0',
  },
  {
    id: 'growth',
    label: 'Growth Score',
    score: 5.5,
    max: 10,
    icon: 'trending_up',
    color: '#ffbd60',
  },
  {
    id: 'ecosystem',
    label: 'Ecosystem Strength',
    score: 5.0,
    max: 10,
    icon: 'hub',
    color: '#ffbd60',
  },
  {
    id: 'market',
    label: 'Market Heat',
    score: 4.0,
    max: 10,
    icon: 'show_chart',
    color: '#ff9f60',
  },
  {
    id: 'moat',
    label: 'Competitive Moat',
    score: 3.5,
    max: 10,
    icon: 'security',
    color: '#ff6b6b',
  },
]

// ============================================================
// ChocoFamily Metrics — финансы из разделов 4.1–4.3 отчёта
// ============================================================
export const CHOCO_METRICS = {
  financial: [
    { label: 'Выручка Net (2024E)', value: '$13–16M', delta: '+11%', up: true },
    { label: 'GMV Chocofood (2024)', value: '$59M', delta: '−24.1%', up: false },
    { label: 'Smart Restaurant MRR', value: '~$640K', delta: '+Рост', up: true },
    { label: 'Chocolife выручка', value: '~$1.2M', delta: '−35%', up: false },
    { label: 'Привлечено (AIX, 2020)', value: '$30M', delta: 'Облигации', up: true },
    { label: 'Совокупные выходы', value: '$52M+', delta: 'M&A 2019–25', up: true },
  ],
  growth: [
    { label: 'Доля рынка Food (2024)', value: '16.8%', delta: '−24.1% г/г', up: false },
    { label: 'Smart Restaurant lokatsii', value: '400+', delta: '→ 2K (2028)', up: true },
    { label: 'Зарег. пользователи', value: '3–4M', delta: 'Оценка 2024', up: true },
    { label: 'Партнёры-мерчанты', value: '~3 000', delta: '14 городов', up: true },
    { label: 'iDoctor пользователи', value: '2M', delta: 'Каждый 10-й', up: true },
    { label: 'Choco App MAU (2022)', value: '2.7M', delta: 'DAU 273K', up: true },
  ],
  operational: [
    { label: 'Сотрудники', value: '~450', delta: '2024–2025', up: true },
    { label: 'Города присутствия', value: '20+', delta: 'КЗ', up: true },
    { label: 'NPS (самоотчёт)', value: '~81%', delta: 'Только self-rep', up: true },
    { label: 'Chocofood App Rating', value: '2.8★', delta: 'Самый низкий', up: false },
    { label: 'Chocolife App Rating', value: '4.3★', delta: '>1M загрузок', up: true },
    { label: 'Choco App Rating', value: '4.8–4.9★', delta: 'Лучший финтех', up: true },
  ],
}

// ============================================================
// Продуктовый портфель — раздел 3 отчёта
// ============================================================
export const CHOCO_PRODUCTS = [
  {
    id: 'chocolife',
    name: 'Chocolife.me',
    category: 'Купоны / Скидки',
    status: 'active',
    kpi: '~98% рынка купонов КЗ, 2.2M пользователей, 4.3★',
    revenue: '~$1.2M (снижение)',
    moat: 'high',
    risk: 'Зрелось категории, снижение 3-й год подряд',
  },
  {
    id: 'chocofood',
    name: 'Chocofood.kz',
    category: 'Доставка еды',
    status: 'active',
    kpi: 'GMV $59M, доля 16.8%, 2.8★, 1 500+ партнёров',
    revenue: '~$12–13M Net',
    moat: 'low',
    risk: 'Структурный спад −24.1% г/г, рейтинг 2.8★',
  },
  {
    id: 'smart-restaurant',
    name: 'Smart Restaurant',
    category: 'B2B SaaS',
    status: 'active',
    kpi: '400+ локаций, ~40K KZT/мес/лок, +13–15% средний чек',
    revenue: '~$640K MRR',
    moat: 'high',
    risk: 'PMF неподтверждён, 400 лок — мало для масштабирования',
  },
  {
    id: 'choco-app',
    name: 'Choco (ex-Rakhmet)',
    category: 'Финтех / Кэшбэк',
    status: 'active',
    kpi: '4.8–4.9★, 280K пользователей за 2 года, 200K+ транзакций/мес',
    revenue: 'N/A (синергетическая)',
    moat: 'medium',
    risk: 'Конкуренция с Kaspi, нет банковской лицензии',
  },
  {
    id: 'idoctor',
    name: 'iDoctor.kz',
    category: 'Здравоохранение',
    status: 'active',
    kpi: '2M пользователей, 55K+ врачей, 4K клиник',
    revenue: 'Лидогенерация',
    moat: 'high',
    risk: 'Зависимость от государственной системы здравоохранения',
  },
  {
    id: 'lensmark',
    name: 'Lensmark.kz',
    category: 'E-commerce (оптика)',
    status: 'active',
    kpi: 'В 6× больше ближайшего конкурента',
    revenue: 'N/A',
    moat: 'medium',
    risk: 'Нишевый рынок, риск выхода федеральных игроков',
  },
]

// ============================================================
// Стратегические сценарии — раздел 12 отчёта
// ============================================================
export const CHOCO_SCENARIOS = [
  {
    id: 'best',
    label: 'Лучший сценарий',
    probability: '15–20%',
    icon: 'trending_up',
    color: 'text-primary',
    bg: 'bg-primary/10',
    border: 'border-primary/20',
    valuation2028: '$150–300M',
    description:
      'Smart Restaurant масштабируется до 3 000+ локаций; Казахский ИИ → лицензирование госструктурам; региональная экспансия в СНГ.',
  },
  {
    id: 'base',
    label: 'Базовый сценарий',
    probability: '50–60%',
    icon: 'remove',
    color: 'text-tertiary-container',
    bg: 'bg-tertiary-container/10',
    border: 'border-tertiary-container/20',
    valuation2028: '$40–80M',
    description:
      'Smart Restaurant — 1 000 локаций; Chocofood стабилизируется на 10–12%; удержание позиций в нишах (Chocolife, iDoctor).',
  },
  {
    id: 'worst',
    label: 'Худший сценарий',
    probability: '20–25%',
    icon: 'trending_down',
    color: 'text-error',
    bg: 'bg-error/10',
    border: 'border-error/20',
    valuation2028: '$10–25M',
    description:
      'Chocofood падает ниже 8%; продажа оставшихся активов; поглощение или forced sale при усилении давления Kaspi / международников.',
  },
]
