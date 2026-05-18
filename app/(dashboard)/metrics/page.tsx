'use client'

import { useEffect, useState } from 'react'
import {
  getBizDescription,
  getGriDescription,
  getKpiDescription,
  getGoalDescription,
  formatSource,
  type MetricSource,
} from '@/lib/metrics/descriptions'

// ─── Modal types ──────────────────────────────────────────────────────────────
type ModalProps = {
  open: boolean
  onClose: () => void
  title: string
  what: string
  why: string
  how: string
  current_state?: string
  formula?: string
  benchmark?: string
  owner?: string | null
  method?: string | null
  category?: string
  sources: MetricSource[]
}

// ─── 11 Goals from Metrics.docx ──────────────────────────────────────────────
const METRIC_GOALS = [
  {
    id: 'acquisition', number: '01',
    goal: 'Привлечение новых клиентов',
    icon: 'person_add', color: 'primary',
    categories: ['Продажи', 'Маркетинг'],
    metrics: [
      { label: 'Количество новых клиентов',    formula: 'Новые оплаты за период',               benchmark: 'MoM ≥15%' },
      { label: 'Количество новых лидов',       formula: 'Входящие заявки / обращения',           benchmark: '' },
      { label: 'Количество целевых лидов',     formula: 'Лиды, прошедшие квалификацию',          benchmark: '>60% от всех' },
      { label: 'Стоимость привлечения (CAC)',  formula: '(Маркетинг + Продажи) / Новые клиенты', benchmark: 'LTV/CAC ≥ 3' },
      { label: 'Стоимость лида (CPL)',         formula: 'Расходы на рекламу / Новые лиды',       benchmark: '' },
      { label: 'Стоимость целевого лида',      formula: 'Расходы / Целевые лиды',                benchmark: '' },
      { label: 'Расходы на рекламу',           formula: 'Совокупный рекламный бюджет',           benchmark: '' },
      { label: 'Сумма продаж с канала',        formula: 'Выручка по источнику привлечения',      benchmark: '' },
    ],
    insight: 'Без CAC Payback ≤30–45 дней рост финансируется из кармана собственника.',
  },
  {
    id: 'retention', number: '02',
    goal: 'Удержание и повторные продажи',
    icon: 'favorite', color: 'primary',
    categories: ['Удержание', 'Клиенты'],
    metrics: [
      { label: 'Repeat Purchase Rate',    formula: 'Клиенты с ≥2 покупками / Все × 100%',       benchmark: '≥40%' },
      { label: 'Churn Rate',              formula: 'Ушедшие / Клиенты в начале × 100%',          benchmark: '≤5%/мес' },
      { label: 'Retention 30 / 60 / 90', formula: 'Активные через N дней / Клиенты в старте',   benchmark: '60% / 40% / 25%' },
      { label: 'LTV (Lifetime Value)',    formula: 'Средний чек × Частота × Срок жизни',         benchmark: 'LTV/CAC ≥ 3' },
      { label: 'Time Between Purchases', formula: 'Ср. кол-во дней между покупками',             benchmark: '' },
      { label: 'Среднее кол-во покупок', formula: 'Всего покупок / Всего клиентов',              benchmark: '' },
      { label: 'Повторная выручка %',    formula: 'Повторные продажи / Общая выручка × 100%',   benchmark: '40–60%' },
    ],
    insight: 'Retention +10% → рост прибыли на 25–95%. Без retention каждый месяц — с нуля.',
    retentionLevels: [
      { period: '30 дней', good: '50–70%', label: 'хорошо'    },
      { period: '60 дней', good: '30–50%', label: 'стабильно' },
      { period: '90 дней', good: '15–30%', label: 'отлично'   },
    ],
  },
  {
    id: 'avg_check', number: '03',
    goal: 'Рост среднего чека',
    icon: 'trending_up', color: 'primary',
    categories: ['Монетизация', 'Продажи'],
    metrics: [
      { label: 'Средний чек',       formula: 'Выручка / Кол-во сделок',                   benchmark: 'MoM ↑' },
      { label: 'Доход на 1 клиента',formula: 'Выручка / Кол-во уникальных клиентов',      benchmark: '' },
      { label: 'Доля апселов',      formula: 'Клиенты с апселлом / Все × 100%',           benchmark: '≥20%' },
      { label: 'Сумма апселов',     formula: 'Выручка от апселл-продуктов',               benchmark: '' },
      { label: 'Доля кросс-продаж', formula: 'Клиенты с кросс-покупкой / Все × 100%',    benchmark: '' },
      { label: 'Сумма кросселлов',  formula: 'Выручка от сопутствующих продуктов',        benchmark: '' },
    ],
    insight: 'Рост среднего чека без роста трафика — самый эффективный путь к $2M.',
  },
  {
    id: 'frequency', number: '04',
    goal: 'Увеличение частоты покупки',
    icon: 'repeat', color: 'secondary',
    categories: ['Удержание', 'Монетизация'],
    metrics: [
      { label: 'Frequency',              formula: 'Кол-во покупок за период / Клиентов', benchmark: '' },
      { label: 'Repeat Purchase Rate',   formula: '% клиентов, вернувшихся повторно',    benchmark: '≥40%' },
      { label: 'Time Between Purchases', formula: 'Ср. дней между покупками',            benchmark: '' },
      { label: 'LTV',                    formula: 'Доход от клиента за весь период',      benchmark: '' },
      { label: 'Retention 30/60/90',     formula: 'Удержание по временным интервалам',   benchmark: '' },
    ],
    insight: 'Один и тот же клиент, покупающий 2–5 раз = рост без роста рекламных затрат.',
  },
  {
    id: 'referral', number: '05',
    goal: 'Сарафанное радио',
    icon: 'share', color: 'primary',
    categories: ['Маркетинг', 'Клиенты'],
    metrics: [
      { label: 'Referral Rate (кол-во)', formula: 'Клиенты по рекомендации за период',      benchmark: '' },
      { label: 'Referral Rate (%)',       formula: 'Реф. клиенты / Все новые × 100%',        benchmark: '≥15%' },
      { label: 'NPS',                     formula: '% Промоутеров − % Критиков (1–10)',      benchmark: '≥50' },
      { label: '% лидов по рекомендации', formula: 'Реф. лиды / Все лиды × 100%',           benchmark: '' },
      { label: 'UGC Volume',              formula: 'Кол-во контента, созданного клиентами',  benchmark: '' },
      { label: 'Share Rate',              formula: '% людей, пересылающих материалы',        benchmark: '' },
    ],
    insight: 'Реферальные клиенты платят быстрее, больше и обходятся дешевле рекламных.',
  },
  {
    id: 'competitors', number: '06',
    goal: 'Переключение от конкурентов',
    icon: 'compare_arrows', color: 'secondary',
    categories: ['Конкуренция', 'Продажи'],
    metrics: [
      { label: 'Кол-во клиентов от конкурентов', formula: 'Новые, сменившие конкурента',    benchmark: '' },
      { label: '% от конкурентов',               formula: 'Реф. от конк. / Все новые × 100%', benchmark: '' },
      { label: 'Win Rate',                        formula: 'Выигранные / Все конкурентные',   benchmark: '>50%' },
      { label: 'Loss Rate',                       formula: 'Проигранные / Все конкурентные',  benchmark: '' },
    ],
    insight: 'Win Rate ниже 50% → слабое позиционирование или Trust & Positioning блок.',
  },
  {
    id: 'demand', number: '07',
    goal: 'Формирование потребности',
    icon: 'psychology', color: 'primary',
    categories: ['Маркетинг', 'Воронка'],
    metrics: [
      { label: 'Engagement Rate',         formula: 'Взаимодействия / Охват × 100%',         benchmark: '≥3%' },
      { label: 'CR контент → диалог',     formula: '% начавших переписку из контента',       benchmark: '' },
      { label: 'CR диалог → диагностика', formula: '% дошедших до разбора',                  benchmark: '' },
      { label: '% прогретых лидов',       formula: 'Признавшие проблему / Все лиды',         benchmark: '' },
      { label: 'Time-to-Interest',        formula: 'Время от первого касания до интереса',   benchmark: '' },
    ],
    insight: 'Без осознанной потребности цикл сделки удлиняется в 3–5 раз.',
  },
  {
    id: 'deal_speed', number: '08',
    goal: 'Ускорение сделки',
    icon: 'speed', color: 'secondary',
    categories: ['Воронка', 'Продажи'],
    metrics: [
      { label: 'Средний цикл закрытия',  formula: 'Сумма дней / Кол-во сделок',             benchmark: 'MoM ↓' },
      { label: 'Лид → Диалог (дни)',     formula: 'Среднее время перехода',                  benchmark: '' },
      { label: 'Диалог → Встреча (дни)', formula: 'Среднее время перехода',                  benchmark: '' },
      { label: 'Встреча → КП (дни)',     formula: 'Среднее время перехода',                  benchmark: '' },
      { label: 'КП → Сделка (дни)',      formula: 'Среднее время перехода',                  benchmark: '' },
    ],
    insight: 'Критичность боли 9–10 → цикл сделки короче в 3–5 раз. Это прямые деньги.',
  },
  {
    id: 'cac', number: '09',
    goal: 'Снижение CAC',
    icon: 'savings', color: 'primary',
    categories: ['Маркетинг', 'Монетизация'],
    metrics: [
      { label: 'CAC',         formula: '(Маркетинг + Продажи + Прочие) / Новые клиенты', benchmark: 'LTV > CAC×3' },
      { label: 'LTV/CAC',    formula: 'LTV / CAC',                                        benchmark: '≥ 3x' },
      { label: 'CAC Payback', formula: 'CAC / Средний чек или маржа/мес',                benchmark: '≤30–45 дней' },
    ],
    formulaBlock: {
      title: 'Формула CAC',
      formula: 'CAC = (Маркетинг + Продажи + Прочие) / Новые_клиенты',
      rules: ['LTV > CAC × 3 → прибыльный рост', 'CAC растёт → воронка хуже', 'CAC падает → маркетинг эффективнее'],
    },
    insight: 'CAC Payback ≤30–45 дней = безопасное масштабирование за счёт клиентов.',
  },
  {
    id: 'conversion', number: '10',
    goal: 'Конверсия в продажи',
    icon: 'filter_alt', color: 'primary',
    categories: ['Воронка', 'Продажи'],
    metrics: [
      { label: 'Лид → Диалог',    formula: '% лидов, начавших диалог',           benchmark: '>60%' },
      { label: 'Диалог → Встреча',formula: '% диалогов → встреча',               benchmark: '>40%' },
      { label: 'Встреча → КП',    formula: '% встреч, получивших КП',            benchmark: '>70%' },
      { label: 'КП → Сделка',     formula: '% КП, закрытых в сделку',            benchmark: '>30%' },
      { label: 'Time to Response', formula: 'Среднее время ответа на лид (мин)', benchmark: '<15 мин' },
      { label: 'Time to Close',   formula: 'Полный цикл от лида до оплаты',      benchmark: '' },
    ],
    insight: 'Улучшение на 10% на каждом этапе воронки = рост выручки ×1.5.',
  },
  {
    id: 'winrate', number: '11',
    goal: 'Выбор вас, а не конкурента',
    icon: 'emoji_events', color: 'primary',
    categories: ['Конкуренция', 'Продажи'],
    metrics: [
      { label: 'Win Rate',               formula: 'Выигранные конкурентные / Все × 100%',  benchmark: '>50%' },
      { label: '% выбравших вас',        formula: 'При прямом сравнении с конкурентом',    benchmark: '' },
      { label: 'Loss Rate',              formula: 'Проигранные / Все конкурентные × 100%', benchmark: '' },
      { label: '% выбравших конкурента', formula: 'При прямом сравнении',                  benchmark: '' },
    ],
    insight: 'Сильное доверие → +40–70% конверсии. Без отстройки — уговоры вместо продаж.',
  },
]

// ─── Business Metrics by Department ──────────────────────────────────────────
const BIZ_METRICS = [
  {
    dept: 'Финансы', icon: 'payments', color: 'primary',
    items: [
      { label: 'Выручка (год)',          value: '₸84.2М',   target: '₸110М',        trend: '+12.4%', up: true,  status: 'ok'       },
      { label: 'Валовая маржа',          value: '34.2%',    target: '40%',           trend: '+2.1%',  up: true,  status: 'ok'       },
      { label: 'EBITDA',                 value: '₸28.7М',   target: '₸38М',         trend: '+8.3%',  up: true,  status: 'ok'       },
      { label: 'ROA',                    value: '2.73%',    target: '4–5%',          trend: '+0.4%',  up: true,  status: 'weak'     },
      { label: 'Операционные расходы',   value: '₸54.8М',   target: '≤₸55М',        trend: '+3.1%',  up: false, status: 'warn'     },
      { label: 'Себестоимость (индекс)', value: '100',      target: '90–95',         trend: '0%',     up: false, status: 'warn'     },
      { label: 'Дебиторская задолженность', value: '₸12.3М', target: '≤₸10М',      trend: '-5.2%',  up: false, status: 'warn'     },
      { label: 'Cash Flow (мес)',        value: '₸4.2М',    target: 'Положительный', trend: '+8.7%',  up: true,  status: 'ok'       },
    ],
  },
  {
    dept: 'Маркетинг', icon: 'ads_click', color: 'secondary',
    items: [
      { label: 'CAC',                  value: '₸45 000',  target: '≤₸38 000',  trend: '-8.3%',  up: true,  status: 'ok'   },
      { label: 'LTV/CAC',              value: '4.78x',    target: '≥5x',        trend: '+0.3x',  up: true,  status: 'ok'   },
      { label: 'CPL (стоимость лида)', value: '₸8 200',   target: '≤₸7 000',   trend: '-5.1%',  up: true,  status: 'warn' },
      { label: 'Лидов в мес.',         value: '340',      target: '500+',       trend: '+22%',   up: true,  status: 'ok'   },
      { label: 'Конверсия лид→клиент', value: '18.2%',    target: '≥25%',       trend: '+3.1%',  up: true,  status: 'warn' },
      { label: 'NPS',                  value: '35',       target: '50+',        trend: '+3',     up: true,  status: 'warn' },
      { label: 'Посещений сайта/мес',  value: '150 000',  target: '500 000',    trend: '+18%',   up: true,  status: 'warn' },
      { label: 'Фолловеры соцсети',    value: '50 000',   target: '200 000',    trend: '+12%',   up: true,  status: 'weak' },
      { label: 'Engagement Rate',      value: '2.4%',     target: '≥3%',        trend: '+0.3%',  up: true,  status: 'warn' },
    ],
  },
  {
    dept: 'Продажи', icon: 'handshake', color: 'primary',
    items: [
      { label: 'Средний чек',          value: '₸180 000', target: '₸210 000',   trend: '+8.2%',  up: true,  status: 'ok'   },
      { label: 'eCommerce средний чек',value: '₸8 500',   target: '₸10 500',    trend: '+4.1%',  up: true,  status: 'warn' },
      { label: 'Win Rate',             value: '48%',      target: '>50%',        trend: '-2%',    up: false, status: 'warn' },
      { label: 'Цикл закрытия сделки', value: '14 дней',  target: '≤10 дней',   trend: '-3д',    up: true,  status: 'warn' },
      { label: 'Конверсия КП→Сделка', value: '28%',      target: '>30%',        trend: '+3%',    up: true,  status: 'warn' },
      { label: 'Time to Response',     value: '18 мин',   target: '<15 мин',     trend: '-4 мин', up: true,  status: 'warn' },
      { label: 'Выручка с продажника', value: '₸4.2М',    target: '₸6М',        trend: '+7%',    up: true,  status: 'weak' },
    ],
  },
  {
    dept: 'Операции', icon: 'settings', color: 'error',
    items: [
      { label: 'Время доставки',         value: '3–5 дн',  target: '2–3 дн',      trend: '0',      up: false, status: 'warn'     },
      { label: 'Выполнение SLA',         value: '87%',     target: '≥95%',         trend: '+2%',    up: true,  status: 'warn'     },
      { label: 'Повторяемость процессов',value: 'GRI 1/10',target: '≥6/10',        trend: '—',      up: false, status: 'critical' },
      { label: 'Предсказуемость',        value: 'GRI 1/10',target: '≥6/10',        trend: '—',      up: false, status: 'critical' },
      { label: 'Кол-во SKU',             value: '412',     target: '450+',         trend: '+5',     up: true,  status: 'ok'       },
      { label: 'Брак / возвраты',        value: '3.2%',    target: '<2%',          trend: '-0.4%',  up: true,  status: 'warn'     },
      { label: 'Производительность',     value: '₸341K/чел',target: '₸420K/чел',  trend: '+4%',    up: true,  status: 'weak'     },
    ],
  },
  {
    dept: 'HR', icon: 'groups', color: 'secondary',
    items: [
      { label: 'Текучесть кадров',    value: '18%',   target: '<10%',   trend: '-2%',   up: true,  status: 'weak' },
      { label: 'eNPS',                value: '42',    target: '60+',    trend: '+5',    up: true,  status: 'warn' },
      { label: 'Кол-во сотрудников',  value: '247',   target: '300',    trend: '+12',   up: true,  status: 'ok'   },
      { label: 'Метрики команды GRI', value: '2.55/10',target: '≥6/10', trend: '—',    up: false, status: 'critical' },
      { label: 'Скорость найма',      value: '23 дня',target: '≤14 дн', trend: '-3д',  up: true,  status: 'warn' },
      { label: 'Процент выполнения OKR', value: '68%',target: '≥80%',  trend: '+4%',   up: true,  status: 'warn' },
    ],
  },
  {
    dept: 'Продукт', icon: 'inventory_2', color: 'primary',
    items: [
      { label: 'Доля рынка конфет',    value: '37%',     target: '40–42%',    trend: '+2%',    up: true, status: 'ok'   },
      { label: 'Доля экспорта',        value: '9.9%',    target: '20%',       trend: '+0.3%',  up: true, status: 'weak' },
      { label: 'Доля онлайн-продаж',   value: '15%',     target: '30–35%',    trend: '+3%',    up: true, status: 'weak' },
      { label: 'Активных SKU',         value: '412',     target: '450+',      trend: '+5',     up: true, status: 'ok'   },
      { label: 'Product Score (GRI)',  value: '4.7/10',  target: '≥7/10',     trend: '—',      up: false, status: 'warn' },
    ],
  },
  {
    dept: 'Клиенты', icon: 'person', color: 'secondary',
    items: [
      { label: 'Активных клиентов', value: '1 847', target: '3 000',   trend: '+8%',    up: true,  status: 'ok'   },
      { label: 'Churn Rate',        value: '4.2%',  target: '<3%',     trend: '-0.6%',  up: true,  status: 'warn' },
      { label: 'NPS',               value: '35',    target: '50+',     trend: '+3',     up: true,  status: 'warn' },
      { label: 'Retention 30d',     value: '42%',   target: '≥60%',    trend: '+3%',    up: true,  status: 'weak' },
      { label: 'ARPU',              value: '₸180К', target: '₸240К',   trend: '+8.2%',  up: true,  status: 'ok'   },
      { label: 'Время доставки',    value: '3–5 дн',target: '2–3 дн',  trend: '0',      up: false, status: 'warn' },
    ],
  },
]

// ─── KPI Targets from KPI_Metrics.csv ────────────────────────────────────────
const KPI_TARGETS = [
  { label: 'Общая выручка (год)',    current: '~90 000 млн ₸', target: '110 000–115 000 млн ₸', icon: 'payments',      category: 'Финансы',  method: 'Финотчётность KASE',    owner: 'CFO'          },
  { label: 'Доля рынка конфет',      current: '35–40%',         target: '40–42%',                icon: 'pie_chart',     category: 'Рынок',    method: 'Statista, BMI Research', owner: 'Market Res.'  },
  { label: 'Доля онлайн-продаж',     current: '15%',            target: '30–35%',                icon: 'shopping_cart', category: 'Цифровой', method: 'CRM, Google Analytics', owner: 'Digital'      },
  { label: 'Доля экспорта',          current: '9.9%',           target: '20%',                   icon: 'public',        category: 'Рынок',    method: 'Таможенная статистика', owner: 'Export'       },
  { label: 'ROA',                    current: '2.73%',          target: '4–5%',                  icon: 'account_balance',category: 'Финансы', method: 'Финотчётность',         owner: 'CFO'          },
  { label: 'Среднее число SKU',      current: '400+',           target: '450+',                  icon: 'inventory_2',   category: 'Продукт',  method: 'Система ассортимента',  owner: 'Product'      },
  { label: 'Себестоимость (индекс)', current: '100 (базис)',    target: '90–95',                 icon: 'manufacturing', category: 'Финансы',  method: 'Управленческий учёт',   owner: 'Supply Chain' },
  { label: 'Посещений сайта/мес',    current: '150 000',        target: '500 000',               icon: 'web',           category: 'Цифровой', method: 'Google Analytics',      owner: 'Digital'      },
  { label: 'Фолловеры соцсети',      current: '50 000',         target: '200 000',               icon: 'thumb_up',      category: 'Цифровой', method: 'Соц. медиа аналитика', owner: 'SMM'          },
  { label: 'Средний чек eCommerce',  current: '8 500 ₸',        target: '10 500 ₸',             icon: 'receipt_long',  category: 'Продажи',  method: 'POS-система, CRM',      owner: 'E-commerce'   },
  { label: 'Время доставки',         current: '3–5 дней',       target: '2–3 дня',              icon: 'local_shipping',category: 'Операции', method: 'Логистика',             owner: 'Logistics'    },
  { label: 'NPS',                    current: '35 баллов',      target: '50+ баллов',            icon: 'star',          category: 'Клиенты',  method: 'NPS-опросы',            owner: 'Cust. Service'},
]

// ─── GRI data ─────────────────────────────────────────────────────────────────
const GRI_BLOCKS = [
  { label: 'Бизнес-модель',         score: 7.4,  status: 'ok',       icon: 'account_tree' },
  { label: 'Готовность основателя', score: 6.7,  status: 'ok',       icon: 'person'       },
  { label: 'Доверие и позиция',     score: 5.17, status: 'weak',     icon: 'verified'     },
  { label: 'Стабильность кассы',    score: 5.0,  status: 'weak',     icon: 'account_balance' },
  { label: 'Продукт и спрос',       score: 4.7,  status: 'weak',     icon: 'inventory_2'  },
  { label: 'Команда',               score: 2.55, status: 'critical', icon: 'group'        },
  { label: 'Операции',              score: 2.14, status: 'critical', icon: 'settings'     },
]

const GRI_TOP5 = [
  { label: 'Повторяемость процесса',   block: 'Операции',           score: 1 },
  { label: 'Риски при масштабировании',block: 'Операции',           score: 1 },
  { label: 'Метрики результата команды',block: 'Операции',          score: 1 },
  { label: 'Предсказуемость результата',block: 'Операции',          score: 1 },
  { label: 'Доказательства результата', block: 'Доверие и позиция', score: 2 },
]

// ─── Category configs ─────────────────────────────────────────────────────────
const GOAL_CATEGORIES  = ['Все', 'Продажи', 'Маркетинг', 'Удержание', 'Воронка', 'Конкуренция', 'Монетизация', 'Клиенты']
const KPI_CATEGORIES   = ['Все KPI', 'Финансы', 'Рынок', 'Цифровой', 'Продажи', 'Продукт', 'Операции', 'Клиенты']

function cc(color: string, type: 'text' | 'bg' | 'border') {
  if (color === 'primary') {
    if (type === 'text')   return 'text-primary'
    if (type === 'bg')     return 'bg-primary/10'
    return 'border-primary/20'
  }
  if (type === 'text')   return 'text-secondary'
  if (type === 'bg')     return 'bg-secondary/10'
  return 'border-secondary/20'
}

function griColor(s: string) {
  if (s === 'critical') return { bar: 'bg-error',               badge: 'bg-error/10 border-error/20 text-error',                                                         text: 'text-error' }
  if (s === 'weak')     return { bar: 'bg-tertiary-container', badge: 'bg-tertiary-container/10 border-tertiary-container/20 text-tertiary-container', text: 'text-tertiary-container' }
  return                       { bar: 'bg-primary',             badge: 'bg-primary/10 border-primary/20 text-primary',                                                   text: 'text-primary' }
}

function statusIcon(s: string) {
  if (s === 'ok')       return { icon: 'check_circle', cls: 'text-primary' }
  if (s === 'warn')     return { icon: 'warning',      cls: 'text-tertiary-container' }
  if (s === 'weak')     return { icon: 'error',        cls: 'text-tertiary-container' }
  return                       { icon: 'cancel',       cls: 'text-error' }
}

// ─── Collapsible Goal Card ────────────────────────────────────────────────────
function GoalCard({ goal, catFilter, onCatClick }: {
  goal: typeof METRIC_GOALS[0]
  catFilter: string
  onCatClick: (c: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <section id={`goal-${goal.id}`}
      className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden transition-all duration-200">

      {/* ── Summary row (always visible) ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors text-left"
      >
        <div className={`w-10 h-10 rounded-xl ${cc(goal.color,'bg')} border ${cc(goal.color,'border')} flex items-center justify-center flex-shrink-0`}>
          <span className={`material-symbols-outlined text-lg ${cc(goal.color,'text')}`}>{goal.icon}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-mono text-on-surface-variant/50">Цель {goal.number}</span>
            {goal.categories.map((cat) => (
              <button key={cat}
                onClick={(e) => { e.stopPropagation(); onCatClick(cat) }}
                className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded-full border transition-colors ${
                  catFilter === cat
                    ? 'bg-primary/20 text-primary border-primary/30'
                    : 'text-on-surface-variant/50 border-white/[0.06] hover:text-primary hover:border-primary/20'
                }`}>
                {cat}
              </button>
            ))}
          </div>
          <p className="text-sm font-semibold text-on-surface mt-0.5">{goal.goal}</p>
        </div>

        {/* Metric count badge */}
        <span className="text-[10px] font-mono text-on-surface-variant bg-surface-container px-2.5 py-1 rounded-full flex-shrink-0">
          {goal.metrics.length} метрик
        </span>

        {/* Insight preview (collapsed state) */}
        {!open && (
          <p className="hidden lg:block text-xs text-on-surface-variant/60 flex-1 max-w-[280px] truncate">
            {goal.insight}
          </p>
        )}

        <span className={`material-symbols-outlined text-[18px] text-on-surface-variant transition-transform duration-200 flex-shrink-0 ${open ? 'rotate-180' : ''}`}>
          expand_more
        </span>
      </button>

      {/* ── Expanded content ── */}
      {open && (
        <>
          {/* Insight */}
          <div className="px-5 pb-3 flex items-start gap-2 border-t border-white/[0.04]">
            <span className="material-symbols-outlined text-sm text-primary/60 flex-shrink-0 mt-2.5">lightbulb</span>
            <p className="text-xs text-on-surface-variant pt-2.5">{goal.insight}</p>
          </div>

          {/* Table */}
          <div className="overflow-x-auto border-t border-white/[0.04]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  {['Метрика', 'Как считать', 'Бенчмарк'].map((h) => (
                    <th key={h} className="text-left text-[10px] font-mono text-on-surface-variant uppercase tracking-widest px-5 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {goal.metrics.map((m, i) => (
                  <tr key={i} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-2.5">
                      <p className="text-sm font-medium text-on-surface">{m.label}</p>
                    </td>
                    <td className="px-5 py-2.5">
                      <p className="text-xs font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded inline-block">{m.formula}</p>
                    </td>
                    <td className="px-5 py-2.5">
                      {m.benchmark ? (
                        <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${cc(goal.color,'bg')} ${cc(goal.color,'text')} ${cc(goal.color,'border')}`}>
                          {m.benchmark}
                        </span>
                      ) : (
                        <span className="text-xs text-on-surface-variant/30">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Retention levels */}
          {'retentionLevels' in goal && goal.retentionLevels && (
            <div className="px-5 py-3 border-t border-white/[0.04] bg-surface-container/30 flex gap-3 flex-wrap">
              {goal.retentionLevels.map((r) => (
                <div key={r.period} className="flex items-center gap-2 bg-surface-container border border-white/[0.06] rounded-xl px-3 py-1.5">
                  <span className="material-symbols-outlined text-sm text-primary">check_circle</span>
                  <span className="text-xs font-mono font-bold text-on-surface">{r.good}</span>
                  <span className="text-[10px] text-on-surface-variant">{r.period} — {r.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Formula block */}
          {'formulaBlock' in goal && goal.formulaBlock && (
            <div className="px-5 py-3 border-t border-white/[0.04] bg-surface-container/30">
              <p className="text-xs font-mono text-primary bg-primary/5 border border-primary/20 px-3 py-1.5 rounded-lg inline-block mb-2">{goal.formulaBlock.formula}</p>
              <div className="flex flex-col gap-1">
                {goal.formulaBlock.rules.map((rule, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-primary">arrow_right</span>
                    <p className="text-xs text-on-surface-variant">{rule}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ─── Collapsible Business Metrics Department ─────────────────────────────────
function DeptCard({
  dept,
  onItemClick,
}: {
  dept: typeof BIZ_METRICS[0]
  onItemClick?: (item: typeof BIZ_METRICS[number]['items'][number]) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const crit  = dept.items.filter((i) => i.status === 'critical').length
  const weak  = dept.items.filter((i) => i.status === 'weak').length
  const warn  = dept.items.filter((i) => i.status === 'warn').length
  const items = dept.items.filter((i) => i.label.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">

      {/* Header row */}
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-white/[0.02] transition-colors text-left">
        <div className={`w-9 h-9 rounded-xl ${cc(dept.color,'bg')} border ${cc(dept.color,'border')} flex items-center justify-center flex-shrink-0`}>
          <span className={`material-symbols-outlined text-base ${cc(dept.color,'text')}`}>{dept.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-on-surface">{dept.dept}</p>
          <p className="text-[10px] text-on-surface-variant">{dept.items.length} показателей</p>
        </div>

        {/* Status summary chips */}
        <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
          {crit > 0 && <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-error/10 text-error border border-error/20">{crit} крит.</span>}
          {weak > 0 && <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-tertiary-container/10 text-tertiary-container border border-tertiary-container/20">{weak} слаб.</span>}
          {warn > 0 && <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant border border-white/[0.06]">{warn} внимание</span>}
        </div>

        <span className={`material-symbols-outlined text-[18px] text-on-surface-variant transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          expand_more
        </span>
      </button>

      {/* Expanded */}
      {open && (
        <div className="border-t border-white/[0.04]">
          {/* Search */}
          <div className="px-5 py-3 border-b border-white/[0.04]">
            <div className="relative">
              <span className="material-symbols-outlined text-sm text-on-surface-variant absolute left-3 top-1/2 -translate-y-1/2">search</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск метрики..."
                className="w-full bg-surface-container border border-white/[0.06] rounded-lg pl-9 pr-4 py-2 text-xs text-on-surface placeholder-on-surface-variant/40 outline-none focus:border-primary/30"
              />
            </div>
          </div>

          {/* Metrics grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 divide-y divide-white/[0.03] sm:divide-y-0">
            {items.map((item, i) => {
              const st = statusIcon(item.status)
              const hasDesc = !!getBizDescription(dept.dept, item.label)
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onItemClick?.(item)}
                  className="group relative flex items-start gap-3 px-5 py-3.5 hover:bg-white/[0.04] border-b border-white/[0.03] transition-colors sm:border-r sm:last:border-r-0 cursor-pointer text-left w-full"
                  title="Подробное описание метрики"
                >
                  <span className={`material-symbols-outlined text-sm flex-shrink-0 mt-0.5 ${st.cls}`}>{st.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-on-surface-variant mb-0.5 truncate">{item.label}</p>
                    <p className={`text-base font-mono font-bold ${item.up ? 'text-on-surface' : item.status === 'critical' ? 'text-error' : 'text-on-surface'}`}>
                      {item.value}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] text-on-surface-variant/50">→ {item.target}</span>
                      <span className={`text-[9px] font-mono ${item.up ? 'text-primary' : 'text-error'}`}>{item.trend}</span>
                    </div>
                  </div>
                  <span
                    className={`material-symbols-outlined text-sm absolute top-2 right-2 transition-opacity ${
                      hasDesc
                        ? 'text-primary/40 opacity-0 group-hover:opacity-100'
                        : 'text-on-surface-variant/20 opacity-30'
                    }`}
                  >
                    info
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MetricsPage() {
  const [activeGoalCat, setActiveGoalCat] = useState('Все')
  const [activeKpiCat,  setActiveKpiCat]  = useState('Все KPI')
  const [activeTab,     setActiveTab]     = useState<'goals' | 'kpi' | 'gri' | 'biz'>('goals')
  const [expandAll,     setExpandAll]     = useState(false)
  const [modal, setModal] = useState<ModalProps | null>(null)

  // Helper: open modal with description; if no description, show stub.
  const openMetricModal = (
    title: string,
    desc:
      | {
          what: string
          why: string
          how: string
          current_state?: string
          formula?: string
          benchmark?: string
          owner?: string | null
          method?: string | null
          category?: string
          sources: MetricSource[]
        }
      | undefined,
  ) => {
    if (!desc) {
      setModal({
        open: true,
        onClose: () => setModal(null),
        title,
        what: 'Описание скоро будет добавлено.',
        why: '',
        how: '',
        sources: [],
      })
      return
    }
    setModal({
      open: true,
      onClose: () => setModal(null),
      title,
      what: desc.what,
      why: desc.why,
      how: desc.how,
      current_state: desc.current_state,
      formula: desc.formula,
      benchmark: desc.benchmark,
      owner: desc.owner,
      method: desc.method,
      category: desc.category,
      sources: desc.sources,
    })
  }

  const filteredGoals = METRIC_GOALS.filter(
    (g) => activeGoalCat === 'Все' || g.categories.includes(activeGoalCat)
  )
  const filteredKpis = KPI_TARGETS.filter(
    (k) => activeKpiCat === 'Все KPI' || k.category === activeKpiCat
  )

  return (
    <div className="space-y-8">

      {/* Header */}
      <section className="flex flex-col lg:flex-row justify-between items-start gap-6">
        <div>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">Система метрик · AIStart360</p>
          <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
            Метрики <span className="text-gradient">роста</span>
          </h1>
          <p className="text-on-surface-variant mt-2 text-sm max-w-2xl">
            11 целей роста · 12 KPI · 7 блоков GRI · полная бизнес-аналитика по отделам
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:flex-col lg:items-end">
          <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-xl px-3 py-2">
            <span className="material-symbols-outlined text-sm text-primary">flag</span>
            <span className="text-xs font-mono text-primary">Цель: $2M / год</span>
          </div>
          <div className="flex items-center gap-2 bg-surface-container border border-white/[0.06] rounded-xl px-3 py-2">
            <span className="material-symbols-outlined text-sm text-secondary">radar</span>
            <span className="text-xs font-mono text-secondary">GRI Score: 4.59 / 10</span>
          </div>
        </div>
      </section>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-surface-container rounded-xl p-1 w-fit flex-wrap">
        {([
          { key: 'goals', label: '11 целей роста',    icon: 'track_changes' },
          { key: 'kpi',   label: 'KPI компании',      icon: 'monitoring'    },
          { key: 'biz',   label: 'Все метрики',        icon: 'bar_chart'     },
          { key: 'gri',   label: 'GRI диагностика',   icon: 'radar'         },
        ] as const).map(({ key, label, icon }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
              activeTab === key
                ? 'bg-primary text-on-primary shadow'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-white/[0.04]'
            }`}>
            <span className="material-symbols-outlined text-[16px]">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* ══ TAB: 11 GOALS ══ */}
      {activeTab === 'goals' && (
        <div className="space-y-5">
          {/* Category filters */}
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Фильтр:</span>
              {GOAL_CATEGORIES.map((cat) => (
                <button key={cat} onClick={() => setActiveGoalCat(cat)}
                  className={`text-[10px] font-mono uppercase px-3 py-1.5 rounded-full border transition-all duration-150 ${
                    activeGoalCat === cat
                      ? 'bg-primary text-on-primary border-primary shadow-sm'
                      : 'text-on-surface-variant border-white/[0.06] hover:border-primary/30 hover:text-primary'
                  }`}>
                  {cat}
                </button>
              ))}
            </div>
            <button onClick={() => setExpandAll((v) => !v)}
              className="text-[10px] font-mono text-on-surface-variant border border-white/[0.06] hover:border-primary/30 hover:text-primary px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">{expandAll ? 'unfold_less' : 'unfold_more'}</span>
              {expandAll ? 'Свернуть все' : 'Развернуть все'}
            </button>
          </div>

          <p className="text-xs text-on-surface-variant font-mono">Показано {filteredGoals.length} из {METRIC_GOALS.length} целей · нажмите на цель чтобы раскрыть</p>

          <div className="space-y-2">
            {filteredGoals.map((goal) => (
              <GoalCardWrapper
                key={goal.id}
                goal={goal}
                catFilter={activeGoalCat}
                onCatClick={setActiveGoalCat}
                forceOpen={expandAll}
                onRowClick={(label) => {
                  const goalDesc = getGoalDescription(goal.number)
                  const item = goalDesc?.items.find((it) => it.label === label)
                  openMetricModal(
                    label,
                    item
                      ? {
                          what: item.what,
                          why: item.why,
                          how: item.how,
                          formula: item.formula,
                          benchmark: item.benchmark,
                          sources: item.sources,
                        }
                      : undefined,
                  )
                }}
              />
            ))}
          </div>

          {/* Levers */}
          <section className="bg-surface-container-low rounded-2xl border border-primary/20 p-5">
            <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">Cash Stability — стратегические программы</p>
            <h3 className="font-headline text-base font-bold text-on-surface mb-3">6 рычагов скорости $2M/год</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
              {[
                { n: '1', label: 'Программа привлечения',         icon: 'person_add'     },
                { n: '2', label: 'Программа удержания',           icon: 'favorite'       },
                { n: '3', label: 'Рост чека и частоты',           icon: 'trending_up'    },
                { n: '4', label: 'Партнёрская сеть',              icon: 'hub'            },
                { n: '5', label: 'Сарафанное радио',              icon: 'share'          },
                { n: '6', label: 'Cash Stability (Компания-банк)', icon: 'account_balance'},
              ].map((p) => (
                <div key={p.n} className="flex items-center gap-3 bg-surface-container rounded-xl p-3">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-sm text-primary">{p.icon}</span>
                  </div>
                  <div>
                    <p className="text-[9px] font-mono text-on-surface-variant/50">Рычаг {p.n}</p>
                    <p className="text-xs text-on-surface">{p.label}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ══ TAB: KPI ══ */}
      {activeTab === 'kpi' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">KPI компании · 2025 → 2026</h2>
              <p className="text-xs text-on-surface-variant mt-1">12 ключевых метрик из KPI_Metrics.csv</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Раздел:</span>
            {['Все KPI', 'Финансы', 'Рынок', 'Цифровой', 'Продажи', 'Продукт', 'Операции', 'Клиенты'].map((cat) => (
              <button key={cat} onClick={() => setActiveKpiCat(cat)}
                className={`text-[10px] font-mono uppercase px-3 py-1.5 rounded-full border transition-all duration-150 ${
                  activeKpiCat === cat
                    ? 'bg-secondary text-on-secondary border-secondary shadow-sm'
                    : 'text-on-surface-variant border-white/[0.06] hover:border-secondary/30 hover:text-secondary'
                }`}>
                {cat}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredKpis.map((kpi, i) => {
              const kpiDesc = getKpiDescription(kpi.label)
              const hasDesc = !!kpiDesc
              return (
                <button
                  type="button"
                  key={i}
                  onClick={() =>
                    openMetricModal(
                      kpi.label,
                      kpiDesc
                        ? {
                            what: kpiDesc.what,
                            why: kpiDesc.why,
                            how: kpiDesc.how,
                            current_state: kpiDesc.current_state,
                            owner: kpiDesc.owner ?? kpi.owner,
                            method: kpiDesc.method ?? kpi.method,
                            category: kpiDesc.category ?? kpi.category,
                            sources: kpiDesc.sources,
                          }
                        : undefined,
                    )
                  }
                  className="group relative bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 hover:border-secondary/20 hover:bg-white/[0.02] transition-colors text-left w-full cursor-pointer"
                  title="Подробное описание KPI"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center">
                      <span className="material-symbols-outlined text-base text-secondary">{kpi.icon}</span>
                    </div>
                    <span className="text-[9px] font-mono uppercase px-2 py-0.5 bg-surface-container border border-white/[0.06] rounded-full text-on-surface-variant">{kpi.category}</span>
                  </div>
                  <p className="text-xs font-mono text-on-surface-variant mb-2 uppercase tracking-wider">{kpi.label}</p>
                  <div className="flex items-end gap-2 mb-3">
                    <div>
                      <p className="text-[9px] text-on-surface-variant/60 mb-0.5">Текущее</p>
                      <p className="text-base font-mono font-bold text-on-surface">{kpi.current}</p>
                    </div>
                    <span className="material-symbols-outlined text-primary mb-0.5 text-sm">arrow_forward</span>
                    <div>
                      <p className="text-[9px] text-primary/70 mb-0.5">Целевое</p>
                      <p className="text-base font-mono font-bold text-primary">{kpi.target}</p>
                    </div>
                  </div>
                  <div className="pt-2.5 border-t border-white/[0.04] flex items-center justify-between">
                    <p className="text-[9px] text-on-surface-variant/50">{kpi.method}</p>
                    <p className="text-[9px] font-mono text-on-surface-variant/40">{kpi.owner}</p>
                  </div>
                  <span
                    className={`material-symbols-outlined text-sm absolute top-3 right-3 transition-opacity ${
                      hasDesc
                        ? 'text-primary/40 opacity-0 group-hover:opacity-100'
                        : 'text-on-surface-variant/20 opacity-30'
                    }`}
                  >
                    info
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ══ TAB: ALL BIZ METRICS ══ */}
      {activeTab === 'biz' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-headline text-xl font-bold text-on-surface">Все метрики бизнеса</h2>
              <p className="text-xs text-on-surface-variant mt-1">По отделам: финансы, маркетинг, продажи, операции, HR, продукт, клиенты · нажмите на отдел</p>
            </div>
            {/* Health overview */}
            <div className="flex items-center gap-3 flex-shrink-0">
              {[
                { label: 'Критических', count: BIZ_METRICS.flatMap(d => d.items).filter(i => i.status === 'critical').length, color: 'error' },
                { label: 'Слабых',      count: BIZ_METRICS.flatMap(d => d.items).filter(i => i.status === 'weak').length,     color: 'tertiary-container' },
                { label: 'На контроле', count: BIZ_METRICS.flatMap(d => d.items).filter(i => i.status === 'warn').length,     color: 'on-surface-variant' },
                { label: 'В норме',     count: BIZ_METRICS.flatMap(d => d.items).filter(i => i.status === 'ok').length,       color: 'primary' },
              ].map((s) => (
                <div key={s.label} className="text-center">
                  <p className={`text-lg font-mono font-bold text-${s.color}`}>{s.count}</p>
                  <p className="text-[9px] text-on-surface-variant">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {BIZ_METRICS.map((dept) => (
              <DeptCard
                key={dept.dept}
                dept={dept}
                onItemClick={(item) => openMetricModal(item.label, getBizDescription(dept.dept, item.label))}
              />
            ))}
          </div>
        </div>
      )}

      {/* ══ TAB: GRI ══ */}
      {activeTab === 'gri' && (
        <div className="space-y-5">
          {/* Score */}
          <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <div className="relative w-24 h-24 flex-shrink-0">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="10" />
                  <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round"
                    className="text-tertiary-container" strokeDasharray={`${(4.59/10)*251.2} 251.2`} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-mono font-bold text-on-surface">4.59</span>
                  <span className="text-[9px] text-on-surface-variant">/10</span>
                </div>
              </div>
              <div className="flex-1">
                <p className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-widest mb-1">GRI Score · Итоговый</p>
                <h2 className="font-headline text-2xl font-bold text-on-surface mb-1">Индекс готовности к росту</h2>
                <p className="text-sm text-on-surface-variant mb-3">Сильная бизнес-модель, но Операции и Команда — критические ограничители масштабирования.</p>
                <div className="flex flex-wrap gap-2">
                  <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary">2 сильных блока</span>
                  <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-tertiary-container/10 border border-tertiary-container/20 text-tertiary-container">3 слабых</span>
                  <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-error/10 border border-error/20 text-error">2 критических</span>
                </div>
              </div>
            </div>
          </div>

          {/* 7 blocks */}
          <div className="space-y-2">
            {GRI_BLOCKS.map((block) => {
              const clr = griColor(block.status)
              const hasDesc = !!getGriDescription(block.label)
              return (
                <button
                  type="button"
                  key={block.label}
                  onClick={() => openMetricModal(block.label, getGriDescription(block.label))}
                  className="group relative bg-surface-container-low rounded-xl border border-white/[0.04] p-4 flex items-center gap-4 w-full text-left hover:bg-white/[0.02] hover:border-white/[0.08] transition-colors cursor-pointer"
                  title="Подробное описание блока GRI"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${block.status === 'critical' ? 'bg-error/10' : block.status === 'weak' ? 'bg-tertiary-container/10' : 'bg-primary/10'}`}>
                    <span className={`material-symbols-outlined text-sm ${clr.text}`}>{block.icon}</span>
                  </div>
                  <p className="text-sm font-medium text-on-surface w-44 flex-shrink-0">{block.label}</p>
                  <div className="flex-1 h-2 bg-surface-container rounded-full overflow-hidden">
                    <div className={`h-full ${clr.bar} rounded-full`} style={{ width: `${(block.score/10)*100}%` }} />
                  </div>
                  <span className={`text-sm font-mono font-bold w-12 text-right flex-shrink-0 ${clr.text}`}>{block.score}/10</span>
                  <span className={`hidden sm:inline text-[9px] font-mono px-2 py-0.5 rounded-full border ${clr.badge} flex-shrink-0 max-w-[180px] truncate`}>
                    {block.status === 'critical' ? 'КРИТИЧЕСКИЙ БЛОК' : block.status === 'weak' ? 'Слабое место' : 'Достаточный уровень'}
                  </span>
                  <span
                    className={`material-symbols-outlined text-sm flex-shrink-0 transition-opacity ${
                      hasDesc
                        ? 'text-primary/40 opacity-0 group-hover:opacity-100'
                        : 'text-on-surface-variant/20 opacity-30'
                    }`}
                  >
                    info
                  </span>
                </button>
              )
            })}
          </div>

          {/* Top 5 */}
          <div className="bg-surface-container-low rounded-2xl border border-error/20 p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-error text-sm">warning</span>
              <h3 className="font-headline text-base font-bold text-on-surface">Топ-5 ограничений роста</h3>
            </div>
            <div className="space-y-2">
              {GRI_TOP5.map((item, i) => (
                <div key={i} className="flex items-center gap-3 bg-surface-container rounded-xl px-4 py-2.5">
                  <div className="w-6 h-6 rounded-lg bg-error/10 border border-error/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-mono font-bold text-error">{item.score}</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-on-surface">{item.label}</p>
                    <p className="text-[10px] font-mono text-on-surface-variant">{item.block}</p>
                  </div>
                  <div className="w-20 h-1.5 bg-surface-container-high rounded-full overflow-hidden flex-shrink-0">
                    <div className="h-full bg-error rounded-full" style={{ width: `${(item.score/10)*100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 90-day plan */}
          <div className="bg-surface-container-low rounded-2xl border border-primary/20 p-5">
            <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">План · 90 дней</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { phase: 'Дни 1–30',  title: 'Стабилизация операций', items: ['Регламенты процессов', 'Метрики команды', 'Повторяемость'], color: 'error' },
                { phase: 'Дни 31–60', title: 'Усиление позиции',       items: ['Доказательства результата', 'Trust & Positioning', 'NPS-система'], color: 'tertiary-container' },
                { phase: 'Дни 61–90', title: 'Масштабирование',         items: ['Партнёрская модель', 'Программа привлечения', 'Cash Stability'], color: 'primary' },
              ].map((ph) => (
                <div key={ph.phase} className={`bg-surface-container rounded-xl p-4 border border-${ph.color}/20`}>
                  <p className={`text-[9px] font-mono text-${ph.color} uppercase tracking-widest mb-1`}>{ph.phase}</p>
                  <p className="text-sm font-bold text-on-surface mb-2">{ph.title}</p>
                  <ul className="space-y-1">
                    {ph.items.map((item, j) => (
                      <li key={j} className="flex items-center gap-2">
                        <span className={`material-symbols-outlined text-sm text-${ph.color}`}>check_small</span>
                        <span className="text-xs text-on-surface-variant">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Metric detail modal */}
      {modal && <MetricDetailModal {...modal} />}
    </div>
  )
}

// Wrapper to allow forced open from parent
function GoalCardWrapper({ goal, catFilter, onCatClick, forceOpen, onRowClick }: {
  goal: typeof METRIC_GOALS[0]
  catFilter: string
  onCatClick: (c: string) => void
  forceOpen: boolean
  onRowClick?: (label: string) => void
}) {
  const [localOpen, setLocalOpen] = useState(false)
  const open = forceOpen || localOpen

  return (
    <section id={`goal-${goal.id}`}
      className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
      <button
        onClick={() => setLocalOpen((v) => !v)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors text-left"
      >
        <div className={`w-10 h-10 rounded-xl ${cc(goal.color,'bg')} border ${cc(goal.color,'border')} flex items-center justify-center flex-shrink-0`}>
          <span className={`material-symbols-outlined text-lg ${cc(goal.color,'text')}`}>{goal.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[9px] font-mono text-on-surface-variant/50">Цель {goal.number}</span>
            {goal.categories.map((cat) => (
              <button key={cat}
                onClick={(e) => { e.stopPropagation(); onCatClick(cat) }}
                className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded-full border transition-colors ${
                  catFilter === cat
                    ? 'bg-primary/20 text-primary border-primary/30'
                    : 'text-on-surface-variant/50 border-white/[0.06] hover:text-primary hover:border-primary/20'
                }`}>
                {cat}
              </button>
            ))}
          </div>
          <p className="text-sm font-semibold text-on-surface">{goal.goal}</p>
        </div>
        <span className="text-[10px] font-mono text-on-surface-variant bg-surface-container px-2.5 py-1 rounded-full flex-shrink-0">{goal.metrics.length} метрик</span>
        {!open && (
          <p className="hidden lg:block text-xs text-on-surface-variant/60 flex-1 max-w-[260px] truncate">{goal.insight}</p>
        )}
        <span className={`material-symbols-outlined text-[18px] text-on-surface-variant transition-transform duration-200 flex-shrink-0 ${open ? 'rotate-180' : ''}`}>expand_more</span>
      </button>

      {open && (
        <>
          <div className="px-5 pb-3 flex items-start gap-2 border-t border-white/[0.04]">
            <span className="material-symbols-outlined text-sm text-primary/60 flex-shrink-0 mt-2.5">lightbulb</span>
            <p className="text-xs text-on-surface-variant pt-2.5">{goal.insight}</p>
          </div>
          <div className="overflow-x-auto border-t border-white/[0.04]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  {['Метрика', 'Как считать', 'Бенчмарк'].map((h) => (
                    <th key={h} className="text-left text-[10px] font-mono text-on-surface-variant uppercase tracking-widest px-5 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {goal.metrics.map((m, i) => {
                  const goalDesc = getGoalDescription(goal.number)
                  const item = goalDesc?.items.find((it) => it.label === m.label)
                  const hasDesc = !!item
                  return (
                    <tr
                      key={i}
                      onClick={() => onRowClick?.(m.label)}
                      className="group border-b border-white/[0.02] hover:bg-white/[0.04] transition-colors cursor-pointer"
                      title="Подробное описание метрики"
                    >
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-on-surface">{m.label}</p>
                          <span
                            className={`material-symbols-outlined text-sm transition-opacity ${
                              hasDesc
                                ? 'text-primary/40 opacity-0 group-hover:opacity-100'
                                : 'text-on-surface-variant/20 opacity-30'
                            }`}
                          >
                            info
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-2.5"><p className="text-xs font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded inline-block">{m.formula}</p></td>
                      <td className="px-5 py-2.5">
                        {m.benchmark
                          ? <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${cc(goal.color,'bg')} ${cc(goal.color,'text')} ${cc(goal.color,'border')}`}>{m.benchmark}</span>
                          : <span className="text-xs text-on-surface-variant/30">—</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {'retentionLevels' in goal && goal.retentionLevels && (
            <div className="px-5 py-3 border-t border-white/[0.04] bg-surface-container/30 flex gap-3 flex-wrap">
              {goal.retentionLevels.map((r) => (
                <div key={r.period} className="flex items-center gap-2 bg-surface-container border border-white/[0.06] rounded-xl px-3 py-1.5">
                  <span className="material-symbols-outlined text-sm text-primary">check_circle</span>
                  <span className="text-xs font-mono font-bold text-on-surface">{r.good}</span>
                  <span className="text-[10px] text-on-surface-variant">{r.period} — {r.label}</span>
                </div>
              ))}
            </div>
          )}
          {'formulaBlock' in goal && goal.formulaBlock && (
            <div className="px-5 py-3 border-t border-white/[0.04] bg-surface-container/30">
              <p className="text-xs font-mono text-primary bg-primary/5 border border-primary/20 px-3 py-1.5 rounded-lg inline-block mb-2">{goal.formulaBlock.formula}</p>
              <div className="flex flex-col gap-1">
                {goal.formulaBlock.rules.map((rule, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-primary">arrow_right</span>
                    <p className="text-xs text-on-surface-variant">{rule}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ─── Source type → icon mapping ───────────────────────────────────────────────
function sourceIcon(type: MetricSource['type']): { icon: string; cls: string } {
  switch (type) {
    case 'survey':   return { icon: 'quiz',        cls: 'text-primary' }
    case 'document': return { icon: 'description', cls: 'text-secondary' }
    case 'prisma':   return { icon: 'database',    cls: 'text-tertiary-container' }
    case 'external': return { icon: 'cloud',       cls: 'text-primary' }
    case 'manual':   return { icon: 'edit',        cls: 'text-on-surface-variant' }
    case 'missing':  return { icon: 'warning',     cls: 'text-error' }
    default:         return { icon: 'help',        cls: 'text-on-surface-variant' }
  }
}

// ─── Metric Detail Modal ──────────────────────────────────────────────────────
function MetricDetailModal({
  open,
  onClose,
  title,
  what,
  why,
  how,
  current_state,
  formula,
  benchmark,
  owner,
  method,
  category,
  sources,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const hasChips = !!(owner || method || category)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-surface-container-low rounded-2xl border border-white/[0.04] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-surface-container-low/95 backdrop-blur-sm flex items-center justify-between gap-4 px-6 py-4 border-b border-white/[0.04]">
          <h3 className="font-headline text-lg font-bold text-on-surface flex-1 min-w-0 pr-2 truncate">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/[0.04] text-on-surface-variant hover:text-on-surface transition-colors"
            aria-label="Закрыть"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {hasChips && (
            <div className="flex flex-wrap gap-1.5">
              {category && (
                <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary">
                  {category}
                </span>
              )}
              {owner && (
                <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-surface-container border border-white/[0.06] text-on-surface-variant">
                  Owner: {owner}
                </span>
              )}
              {method && (
                <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-surface-container border border-white/[0.06] text-on-surface-variant">
                  Метод: {method}
                </span>
              )}
            </div>
          )}

          {what && (
            <section>
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Что это</p>
              <p className="text-sm text-on-surface leading-relaxed">{what}</p>
            </section>
          )}

          {why && (
            <section>
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Зачем</p>
              <p className="text-sm text-on-surface-variant leading-relaxed">{why}</p>
            </section>
          )}

          {how && (
            <section>
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Как считается</p>
              <p className="text-sm text-on-surface-variant leading-relaxed">{how}</p>
            </section>
          )}

          {formula && (
            <section>
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Формула</p>
              <pre className="text-xs font-mono text-primary bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 whitespace-pre-wrap break-words">
                {formula}
              </pre>
            </section>
          )}

          {benchmark && (
            <section>
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Бенчмарк</p>
              <span className="inline-block text-xs font-mono uppercase px-3 py-1 rounded-full bg-secondary/10 border border-secondary/20 text-secondary">
                {benchmark}
              </span>
            </section>
          )}

          {current_state && (
            <section className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3">
              <p className="text-[10px] font-mono text-primary uppercase tracking-[0.2em] mb-1">Текущее состояние</p>
              <p className="text-sm text-on-surface leading-relaxed">{current_state}</p>
            </section>
          )}

          {sources && sources.length > 0 && (
            <section>
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">Источники данных</p>
              <ul className="space-y-1.5">
                {sources.map((src, i) => {
                  const ico = sourceIcon(src.type)
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 bg-surface-container rounded-lg border border-white/[0.04] px-3 py-2"
                    >
                      <span className={`material-symbols-outlined text-sm flex-shrink-0 mt-0.5 ${ico.cls}`}>
                        {ico.icon}
                      </span>
                      <span className="text-xs text-on-surface-variant leading-relaxed break-words">
                        {formatSource(src)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {(!sources || sources.length === 0) && !what && !why && !how && (
            <p className="text-sm text-on-surface-variant italic">Описание скоро будет добавлено.</p>
          )}
        </div>
      </div>
    </div>
  )
}
