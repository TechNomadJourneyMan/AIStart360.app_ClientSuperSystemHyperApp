// Mock journey state used by the /client/journey page while real streaming
// AI + Supabase persistence are being wired up. Everything here will be
// replaced by real data from /api/journey/chat and Supabase realtime.

import type { JourneyState, Widget } from './state'

function iso(minsAgo: number): string {
  return new Date(Date.now() - minsAgo * 60_000).toISOString()
}

const widgets: Widget[] = [
  {
    id: 'w1',
    kind: 'question',
    title: 'Есть у вас CRM?',
    priority: 10,
    collapsed: false,
    createdAt: iso(1),
    prompt: 'Прежде чем считать unit-экономику — уточни: в чём сейчас ведёшь клиентов и сделки?',
    options: ['AmoCRM', 'Bitrix24', '1С', 'Excel / Google Sheets', 'Нет CRM'],
    targetField: 's3_has_crm',
  },
  {
    id: 'w2',
    kind: 'insight_card',
    title: 'Найдено в P&L: чек растёт',
    priority: 8,
    collapsed: false,
    createdAt: iso(3),
    headline: 'Средний чек +8.2% к прошлому кварталу',
    body: 'Из выгрузки sales_report_q3.xlsx: с ₸165K до ₸178K. Тренд стабильный 3 квартала — можно закладывать в план как базу.',
    quote: {
      text: 'Q3 средний чек = 178,240 KZT (было 164,900)',
      source: 'sales_report_q3.xlsx · строка 42',
    },
    severity: 'ok',
  },
  {
    id: 'w3',
    kind: 'metric_peek',
    title: 'Cash Flow (мес)',
    priority: 7,
    collapsed: false,
    createdAt: iso(5),
    label: 'Cash Flow / мес',
    value: '₸4.2М',
    delta: '+8.7%',
    trend: [3.1, 3.4, 3.2, 3.6, 3.9, 4.0, 4.2],
  },
  {
    id: 'w4',
    kind: 'risk_alert',
    title: 'Нет замера NPS',
    priority: 9,
    collapsed: false,
    createdAt: iso(6),
    reason: 'Не нашёл NPS ни в чате, ни в файлах. Retention на 42% — без NPS не увидим что чинить.',
    suggestion: 'Запустить 30-секундный опрос после сделки: 1 вопрос + шкала. Можно через WhatsApp-бота.',
  },
  {
    id: 'w5',
    kind: 'quick_win',
    title: 'Апсейл к базовой сделке',
    priority: 6,
    collapsed: false,
    createdAt: iso(8),
    expectedImpact: '+15% средний чек за 6 недель',
    effort: 'S',
    steps: [
      'Собрать 3 сопутствующих SKU для топ-5 базовых продуктов',
      'Обучить 2 менеджеров скрипту 3-минутной допродажи',
      'Замерить долю сделок с апсейлом до/после',
    ],
  },
  {
    id: 'w6',
    kind: 'upload_prompt',
    title: 'Нужен баланс за 2024',
    priority: 5,
    collapsed: false,
    createdAt: iso(11),
    reason: 'Для расчёта ROA и оборотки — не хватает бухбаланса на конец года.',
    acceptMime: ['application/pdf', 'application/vnd.ms-excel', 'text/csv'],
    suggestions: ['Выгрузка из 1С', 'PDF отчёт от бухгалтера'],
  },
  {
    id: 'w7',
    kind: 'benchmark_strip',
    title: 'LTV/CAC · твой vs рынок',
    priority: 4,
    collapsed: false,
    createdAt: iso(15),
    metric: 'LTV / CAC',
    your: 2.8,
    median: 3.2,
    top: 5.4,
    unit: 'x',
  },
  {
    id: 'w8',
    kind: 'video_rec',
    title: 'Полезное к твоему кейсу',
    priority: 3,
    collapsed: true,
    createdAt: iso(22),
    videos: [
      { title: 'Как поднять NPS за 30 дней — 3 механики', thumb: '', durationMin: 4, url: '#', whyRelevant: 'У тебя retention 42% + нет замера NPS.' },
      { title: 'Апсейл для средних бизнесов — скрипты', thumb: '', durationMin: 6, url: '#', whyRelevant: 'В плане Quick Win.' },
    ],
  },
  {
    id: 'w9',
    kind: 'news_digest',
    title: 'Новости отрасли',
    priority: 2,
    collapsed: true,
    createdAt: iso(30),
    industry: 'ecommerce',
    items: [
      { title: 'Kaspi запустил новые правила выкупа для Магазина', source: 'kaspi.kz', url: '#', ago: '2ч' },
      { title: 'Uzum Market снизил комиссию для электроники на 3%', source: 'uzum.uz', url: '#', ago: '1д' },
      { title: 'РК: цифровой ассортимент + новые квоты на импорт', source: 'gov.kz', url: '#', ago: '3д' },
    ],
  },
  {
    id: 'w10',
    kind: 'reminders_rail',
    title: 'На эту неделю',
    priority: 1,
    collapsed: true,
    createdAt: iso(45),
    items: [
      { id: 'r1', text: 'Закинуть баланс за 2024 (просит AI выше)', due: 'До четверга', done: false },
      { id: 'r2', text: 'Ответить: есть ли CRM (виджет наверху)', due: 'Сегодня', done: false },
      { id: 'r3', text: 'Запустить NPS-опрос по последним 50 сделкам', due: 'На следующей неделе', done: false },
    ],
  },
]

const messages = [
  {
    id: 'm1',
    role: 'assistant' as const,
    text: 'Привет. Я AI-ассистент AIStart360. Расскажи про бизнес — что делаешь, кому продаёшь, какие последние месяцы? Или просто закинь мне отчёты — я сам разложу.',
    createdAt: iso(30),
  },
  {
    id: 'm2',
    role: 'user' as const,
    text: 'Интернет-магазин электроники и аксессуаров, работаем в РК + Узбекистан. 3 года. В команде 12 человек. Выручка ~₸84М/год.',
    createdAt: iso(28),
  },
  {
    id: 'm3',
    role: 'assistant' as const,
    text: 'Понял. Электроника + аксессуары, СНГ, крепкий средний бизнес. Смотри — по трём цифрам, которые ты дал, я уже могу поставить первые вопросы (справа). Прежде чем считать unit-экономику — уточни как ведёшь клиентов? И если есть P&L за 2024 — закинь, я извлеку.',
    createdAt: iso(27),
    spawn: [
      { kind: 'question' as const, title: 'CRM' } as never, // schema-loose in mock
    ],
  },
  {
    id: 'm4',
    role: 'user' as const,
    text: 'Держи P&L и sales report за Q3.',
    attachments: [
      { id: 'a1', name: 'PL_2024_KZ.pdf',      mime: 'application/pdf', sizeBytes: 341_200 },
      { id: 'a2', name: 'sales_report_q3.xlsx', mime: 'application/vnd.ms-excel', sizeBytes: 82_400 },
    ],
    createdAt: iso(16),
  },
  {
    id: 'm5',
    role: 'assistant' as const,
    text: 'Прогнал через парсер. Извлёк 47 полей из P&L, 3 квартала продаж. Средний чек растёт — вот факт (справа). Cash Flow позитивный. Но retention 42% и NPS не замеряется — это первый риск, добавил алёрт. И 1 быстрый рычаг: апсейл к базовой сделке даст +15% чека за 6 недель. Дай ещё баланс за 2024 — посчитаю ROA.',
    createdAt: iso(14),
  },
]

const pointA: JourneyState['pointA'] = [
  {
    id: 'a-finance',   label: 'Финансы',  block: 'finance',   status: 'ok',
    x: 8,  y: 25,
    facts: [
      { k: 'Выручка/год',    v: '₸84М' },
      { k: 'Валовая маржа',  v: '34.2%' },
      { k: 'Cash Flow/мес',  v: '₸4.2М' },
    ],
  },
  {
    id: 'a-sales',     label: 'Продажи',  block: 'sales',     status: 'ok',
    x: 6,  y: 50,
    facts: [
      { k: 'Средний чек',    v: '₸178К' },
      { k: 'Сделок/мес',     v: '~120' },
      { k: 'Win Rate',       v: '48%' },
    ],
  },
  {
    id: 'a-clients',   label: 'Клиенты',  block: 'clients',   status: 'weak',
    x: 12, y: 72,
    facts: [
      { k: 'Retention 30d',  v: '42%' },
      { k: 'Churn',          v: '4.2%' },
      { k: 'NPS',            v: 'не измеряется' },
    ],
  },
  {
    id: 'a-team',      label: 'Команда',  block: 'team',      status: 'weak',
    x: 15, y: 15,
    facts: [
      { k: 'Сотрудников',    v: '12' },
      { k: 'Оргструктура',   v: 'нет' },
    ],
  },
]

const pointB: JourneyState['pointB'] = [
  {
    id: 'b-finance',   label: 'Финансы',  block: 'finance',   status: 'ok',
    x: 85, y: 25,
    facts: [
      { k: 'Выручка/год',    v: '₸140М' },
      { k: 'Валовая маржа',  v: '40%' },
      { k: 'Cash Flow/мес',  v: '₸8М' },
    ],
  },
  {
    id: 'b-sales',     label: 'Продажи',  block: 'sales',     status: 'ok',
    x: 88, y: 50,
    facts: [
      { k: 'Средний чек',    v: '₸210К' },
      { k: 'LTV/CAC',        v: '≥ 5x' },
      { k: 'Win Rate',       v: '>55%' },
    ],
  },
  {
    id: 'b-clients',   label: 'Клиенты',  block: 'clients',   status: 'ok',
    x: 84, y: 72,
    facts: [
      { k: 'Retention 30d',  v: '≥ 60%' },
      { k: 'Churn',          v: '<3%' },
      { k: 'NPS',            v: '≥ 50' },
    ],
  },
]

const milestones: JourneyState['milestones'] = [
  {
    id: 'ms-30',  t: 0.18, label: '30 дней',  daysFromStart: 30,
    description: 'Запустить NPS-опрос + подключить CRM. Прикрыть корневой риск retention.',
    metric: { name: 'NPS', from: '—', to: '≥ 30 (baseline)' },
    done: false, active: true,
  },
  {
    id: 'ms-60',  t: 0.38, label: '60 дней',  daysFromStart: 60,
    description: 'Программа апсейла к базовой сделке. Сегментация клиентов по RFM.',
    metric: { name: 'Средний чек', from: '₸178К', to: '₸195К' },
    done: false, active: false,
  },
  {
    id: 'ms-90',  t: 0.55, label: '90 дней',  daysFromStart: 90,
    description: 'Триггерные коммуникации retention 30/60/90 через WhatsApp.',
    metric: { name: 'Retention 30d', from: '42%', to: '50%' },
    done: false, active: false,
  },
  {
    id: 'ms-180', t: 0.75, label: '6 месяцев', daysFromStart: 180,
    description: 'Cross-sell матрица + expansion в Узбекистан по 2 категориям.',
    metric: { name: 'Выручка/мес', from: '₸7М', to: '₸10М' },
    done: false, active: false,
  },
  {
    id: 'ms-365', t: 0.92, label: '12 месяцев', daysFromStart: 365,
    description: 'Точка Б: ₸140М/год, LTV/CAC ≥5, NPS ≥50.',
    metric: { name: 'Выручка/год', from: '₸84М', to: '₸140М' },
    done: false, active: false,
  },
]

export const MOCK_JOURNEY_STATE: JourneyState = {
  userId: 'demo',
  companyName: 'Demo Shop',
  industry: 'ecommerce · электроника',
  pointA,
  pointB,
  milestones,
  messages,
  widgets,
  updatedAt: new Date().toISOString(),
}
