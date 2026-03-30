import type { Alert, ActivityItem, Report, Signal } from '@/types'

// ============================================================
// KPI Data
// ============================================================
export const CHOCO_KPI = [
  { label: 'Выручка (Net)', value: '$14.5M', trend: '11.0%', trendUp: true, icon: 'payments', sublabel: 'оценка 2024E', href: '/analytics' },
  { label: 'Доля рынка Food', value: '16.8%', trend: '-24.1%', trendUp: false, icon: 'percent', sublabel: 'доля доставки 2024', href: '/metrics' },
  { label: 'Локации (SaaS)', value: '400+', trend: '+Рост', trendUp: true, icon: 'storefront', sublabel: 'Smart Restaurant', href: '/clients' },
  { label: 'Активы дивестиций', value: '$50.0M', trend: 'Exit', trendUp: true, icon: 'account_balance', sublabel: 'Совокупные выходы', href: '/metrics' },
]

// ============================================================
// Alerts
// ============================================================
export const CHOCO_ALERTS: Alert[] = [
  {
    id: 'c-a1',
    severity: 'critical',
    title: 'Угроза Kaspi.kz',
    description: 'Вероятность выхода экосистемы Kaspi на рынок доставки еды. Риск окончательной маргинализации Chocofood.',
    time: 'Немедленно',
    action: { label: 'Смотреть профиль', href: '/competitors' },
  },
  {
    id: 'c-a2',
    severity: 'critical',
    title: 'Структурный спад (Food)',
    description: 'Доля рынка упала с 80% (2018) до 16.8% (2024). Единственный игрок в топ-5 с отрицательной динамикой.',
    time: 'Q1 2026',
    action: { label: 'Отчеты рынка', href: '/market' },
  },
  {
    id: 'c-a3',
    severity: 'warning',
    title: 'ИИ-стратегия',
    description: 'Новая стратегическая ставка на AI не имеет PMF. Высокие риски конкуренции с глобальными корпорациями.',
    time: '2d ago',
    action: { label: 'Детали', href: '/intelligence' },
  },
  {
    id: 'c-a4',
    severity: 'info',
    title: 'Экспорт Smart Restaurant',
    description: 'Единственный продукт экосистемы с потенциалом экспансии в СНГ (switching costs через POS).',
    time: '1w ago',
    action: { label: 'Анализ', href: '/point-a' },
  },
]

// ============================================================
// Activity Feed
// ============================================================
export const CHOCO_ACTIVITY: ActivityItem[] = [
  { id: 'c-act1', actor: 'Рамиль Мухорьяпов', actorRole: 'CEO', event: 'Возвращение на позицию CEO', gri: 5.2, status: 'active', time: 'Июль 2025' },
  { id: 'c-act2', actor: 'inDrive', actorRole: 'Partner', event: 'Одобрение сделки "Рядом" регулятором', gri: 5.2, status: 'active', time: 'Нояб 2025' },
  { id: 'c-act3', actor: 'System AI', actorRole: 'System', event: 'Регистрация AI Research Centre', gri: 5.2, status: 'active', time: 'Дек 2025' },
  { id: 'c-act4', actor: 'System AI', actorRole: 'Auto', event: 'OSINT-профиль загружен', gri: 5.2, status: 'active', time: '4ч назад' },
]

// ============================================================
// Competitors
// ============================================================
export const CHOCO_COMPETITORS = [
  {
    id: 'kaspi', name: 'Kaspi.kz', threat: 'high', arr: '$5.6B', funding: 'Public (IPO)', market: 'Super-App (КЗ)', clients: '~50% КЗ',
    strengths: ['Банковская лицензия', 'Доминирование в E-commerce', 'Крупнейшая база пользователей'],
    weaknesses: ['Отсутствие собственной доставки еды', 'Фокус только на локальном рынке'],
  },
  {
    id: 'glovo', name: 'Glovo (Delivery Hero)', threat: 'high', arr: 'Н/Д', funding: 'Corporate', market: 'Food Delivery', clients: '36.6% (Доля)',
    strengths: ['Глобальные ресурсы', 'Агрессивный рост (+64% г/г)', 'Обширный флот курьеров'],
    weaknesses: ['Низкая операционная маржа', 'Зависимость от гиг-экономики'],
  },
  {
    id: 'yandex', name: 'Yandex Food', threat: 'high', arr: 'Н/Д', funding: 'Corporate', market: 'E-grocery / Food', clients: '25.7% (Доля)',
    strengths: ['Алгоритмы маршрутизации', 'Синергия с Yandex Go (+363% рост)', 'Огромные капиталы'],
    weaknesses: ['Геополитические риски', 'Возможное давление регуляторов'],
  },
  {
    id: 'wolt', name: 'Wolt (DoorDash)', threat: 'medium', arr: 'Н/Д', funding: 'Corporate', market: 'Food Delivery', clients: '17.6% (Доля)',
    strengths: ['Качество сервиса', 'Сильный бренд', 'Стабильный рост (+36.8%)'],
    weaknesses: ['Премиальное позиционирование сужает TAM'],
  }
]

// ============================================================
// Reports
// ============================================================
export const CHOCO_REPORTS: Report[] = [
  {
    id: 'cr1', clientId: '7', clientName: 'ChocoFamily', name: 'ChocoFamily_Complete_Analytical_Profile',
    category: 'Strategic', type: 'docx', fileUrl: '/reports/choco_complete', fileSize: '48 KB',
    uploadedBy: 'System AI', uploadedAt: '12 Марта, 2026',
  },
  {
    id: 'cr2', clientId: '7', clientName: 'ChocoFamily', name: 'ChocoFamily_OSINT_Profile',
    category: 'Intelligence', type: 'pdf', fileUrl: '/reports/choco_osint', fileSize: '85 KB',
    uploadedBy: 'System AI', uploadedAt: '10 Марта, 2026',
  },
  {
    id: 'cr3', clientId: '7', clientName: 'ChocoFamily', name: 'Protocol ChocoFamily',
    category: 'Protocol', type: 'pdf', fileUrl: '/reports/choco_protocol', fileSize: '322 KB',
    uploadedBy: 'Alex Kim', uploadedAt: '05 Марта, 2026',
  },
  {
    id: 'cr4', clientId: '7', clientName: 'ChocoFamily', name: 'Market Share H2 2025 Analysis',
    category: 'Market', type: 'pdf', fileUrl: '/reports/choco_market', fileSize: '1.2 MB',
    uploadedBy: 'Data Team', uploadedAt: '15 Февраля, 2026',
  }
]

// ============================================================
// Market Insights / Signals
// ============================================================
export const CHOCO_SIGNALS: Signal[] = [
  { id: 'cs1', type: 'market', priority: 'high', title: 'Рост e-commerce КЗ', description: 'Объем рынка e-com вырос на 60% г/г. Транзакции: +87%.', tags: ['E-commerce', 'Казахстан', 'GMV'], time: 'Q4 2025' },
  { id: 'cs2', type: 'competitive', priority: 'critical', title: 'Yandex Food Scaling', description: 'Взрывной рост Яндекс Еды (+363%) угрожает остальным игрокам.', tags: ['Конкуренция', 'Yandex', 'Food Delivery'], time: 'Jan 2026' },
  { id: 'cs3', type: 'regulatory', priority: 'high', title: 'НДС 16%', description: 'Введение нового НДС 16% с 2026 года снизит чистую доходность платформ.', tags: ['Регулирование', 'НДС', 'Казахстан'], time: 'Feb 2026' },
]

export const CHOCO_TEAM = [
  { id: 't1', name: 'Рамиль Мухорьяпов', role: 'CEO', load: 85, clients: ['Chocofood', 'Smart Restaurant', 'AI Research'], email: 'ramil@chocofamily.kz' },
  { id: 't2', name: 'Николай Мазнетсов', role: 'COO Chocofood', load: 90, clients: ['Chocofood'], email: 'nikolay@chocofamily.kz' },
]
