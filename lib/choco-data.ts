import type { Alert, ActivityItem, Report, Signal } from '@/types'

// ============================================================
// KPI Data — ключевые метрики из отчёта ChocoFamily
// ============================================================
export const CHOCO_KPI = [
  {
    label: 'Выручка (Net 2024E)',
    value: '$14.5M',
    trend: '+11.0%',
    trendUp: true,
    icon: 'payments',
    sublabel: 'оценка bottom-up, верифицировано',
    href: '/analytics',
  },
  {
    label: 'Доля рынка Food',
    value: '16.8%',
    trend: '−24.1% г/г',
    trendUp: false,
    icon: 'percent',
    sublabel: 'Baker Tilly 2024, #4 место',
    href: '/market',
  },
  {
    label: 'Smart Restaurant',
    value: '400+',
    trend: '→ 2 000 (2028)',
    trendUp: true,
    icon: 'storefront',
    sublabel: 'локаций, ~40K KZT/мес.',
    href: '/point-a',
  },
  {
    label: 'Совокупные выходы',
    value: '$52M+',
    trend: 'M&A',
    trendUp: true,
    icon: 'account_balance',
    sublabel: 'продажи активов 2019–2025',
    href: '/metrics',
  },
]

// ============================================================
// Alerts — приоритизированные риски из матрицы рисков
// ============================================================
export const CHOCO_ALERTS: Alert[] = [
  {
    id: 'c-a1',
    severity: 'critical',
    title: 'Угроза Kaspi.kz',
    description:
      'Kaspi.kz в 100–150× крупнее (выручка $5.6B). Потенциальный выход на доставку еды окончательно маргинализирует Chocofood. Покрытие ~50% населения КЗ.',
    time: 'Немедленно',
    action: { label: 'Смотреть конкурентов', href: '/competitors' },
  },
  {
    id: 'c-a2',
    severity: 'critical',
    title: 'Chocofood: структурный спад',
    description:
      'Доля рынка: 80% (2018) → 37.5% (2021) → 16.8% (2024). Единственный игрок в топ-5 с отрицательной динамикой (−24.1% г/г). Рейтинг приложения: 2.8.',
    time: 'Q1 2026',
    action: { label: 'Анализ рынка', href: '/market' },
  },
  {
    id: 'c-a3',
    severity: 'critical',
    title: 'Риск провала ИИ-стратегии',
    description:
      'Freedom AI Platform, казахский LLM, Voice AI — нет подтверждённых продуктов, нет PMF. Конкуренция с глобальными корпорациями. Высокий риск провала.',
    time: '2d ago',
    action: { label: 'Intelligence Hub', href: '/intelligence' },
  },
  {
    id: 'c-a4',
    severity: 'warning',
    title: 'Chocolife — зрелость рынка',
    description:
      'Выручка снижается 3-й год подряд: 1.15B → 838M → ~400-600M KZT. Рынок купонов насыщен — ~98% доли не защищают от структурного упадка категории.',
    time: '3d ago',
    action: { label: 'Метрики', href: '/metrics' },
  },
  {
    id: 'c-a5',
    severity: 'info',
    title: 'Smart Restaurant — экспортный потенциал',
    description:
      'Единственный B2B SaaS актив с defensive moat (switching costs через POS). Цель: 2 000–5 000 локаций к 2028. Потенциал экспансии в СНГ (TAM $191.6B к 2034).',
    time: '1w ago',
    action: { label: 'Анализ', href: '/point-a' },
  },
]

// ============================================================
// Activity Feed — хронология ключевых событий из отчёта
// ============================================================
export const CHOCO_ACTIVITY: ActivityItem[] = [
  {
    id: 'c-act1',
    actor: 'Рамиль Мухорьяпов',
    actorRole: 'CEO',
    event: 'Возвращение на должность CEO после перерыва',
    gri: 5.2,
    status: 'active',
    time: 'Июль 2025',
  },
  {
    id: 'c-act2',
    actor: 'inDrive (New Ventures)',
    actorRole: 'Strategic Partner',
    event: 'Регуляторное одобрение сделки покупки контроля "Чоко Рядом" (>50%)',
    gri: 5.2,
    status: 'active',
    time: 'Нояб 2025',
  },
  {
    id: 'c-act3',
    actor: 'AI Research Centre Ltd',
    actorRole: 'New Entity',
    event: 'Регистрация AI Research Centre Ltd в AIFC, Астана',
    gri: 5.2,
    status: 'active',
    time: 'Дек 2025',
  },
  {
    id: 'c-act4',
    actor: 'Анвар Бакиев',
    actorRole: 'Co-founder',
    event: 'Выход сооснователя, запуск нового стартапа extella.ai',
    gri: 5.2,
    status: 'active',
    time: '2025',
  },
  {
    id: 'c-act5',
    actor: 'Freedom Holding Corp',
    actorRole: 'Acquirer',
    event: 'Завершена продажа Aviata/Chocotravel за $32.3 млн',
    gri: 5.5,
    status: 'active',
    time: '2023',
  },
  {
    id: 'c-act6',
    actor: 'System AI',
    actorRole: 'Auto',
    event: 'OSINT-профиль ChocoFamily верифицирован (5 источников, Baker Tilly)',
    gri: 5.2,
    status: 'active',
    time: 'Март 2026',
  },
]

// ============================================================
// Competitors — матрица конкурентов из раздела 6 отчёта
// ============================================================
export const CHOCO_COMPETITORS = [
  {
    id: 'kaspi',
    name: 'Kaspi.kz',
    threat: 'high',
    arr: '$5.6B выручка',
    funding: 'Public (LSE + KASE IPO)',
    market: 'Super-App КЗ',
    clients: '~50% населения КЗ',
    strengths: [
      'Банковская лицензия',
      'Покрытие 50% населения',
      'Собственный маркетплейс',
      'Платёжная экосистема',
    ],
    weaknesses: ['Нет доставки еды', 'Только локальный рынок'],
  },
  {
    id: 'glovo',
    name: 'Glovo (Delivery Hero)',
    threat: 'high',
    arr: 'Корп. финансирование',
    funding: 'Subsidiary Delivery Hero',
    market: 'Food Delivery KZ #1',
    clients: '36.6% (GMV 64.3B KZT)',
    strengths: [
      'Глобальные ресурсы DH',
      '+64.3% рост г/г (2024)',
      'Широкая сеть ресторанов',
    ],
    weaknesses: ['Низкая операционная маржа', 'Зависимость от гиг-экономики'],
  },
  {
    id: 'yandex',
    name: 'Yandex Food / Yandex Go',
    threat: 'high',
    arr: 'Yandex Corp',
    funding: 'Corporate',
    market: 'Food Delivery KZ #2',
    clients: '25.7% (GMV 45.1B KZT)',
    strengths: [
      '+363% рост г/г (2024)',
      'Синергия с Yandex Go',
      'Огромные капиталы',
      'Алгоритмы маршрутизации',
    ],
    weaknesses: ['Геополитические риски', 'Возможное давление регуляторов'],
  },
  {
    id: 'wolt',
    name: 'Wolt (DoorDash)',
    threat: 'medium',
    arr: 'DoorDash Corp',
    funding: 'Subsidiary DoorDash',
    market: 'Food Delivery KZ #3',
    clients: '17.6% (GMV 30.9B KZT)',
    strengths: [
      '+36.8% рост г/г (2024)',
      'Высокие рейтинги сервиса',
      'Европейский бренд',
    ],
    weaknesses: ['Премиальное позиционирование сужает TAM'],
  },
  {
    id: 'wildberries',
    name: 'Wildberries',
    threat: 'medium',
    arr: 'Крупнейший маркетплейс СНГ',
    funding: 'Private (RU)',
    market: 'E-commerce / Маркетплейс',
    clients: '72% e-com КЗ через маркетплейсы',
    strengths: [
      'Логистическая инфраструктура',
      'Широкий ассортимент',
      'Узнаваемость бренда в СНГ',
    ],
    weaknesses: ['Нет экосистемы финтех', 'Слабая локализация под КЗ'],
  },
]

// ============================================================
// Reports — реальные документы из папки ChocoFamily Data
// ============================================================
export const CHOCO_REPORTS: Report[] = [
  {
    id: 'cr1',
    clientId: '7',
    clientName: 'ChocoFamily',
    name: 'Complete Analytical Profile (5 источников)',
    category: 'Strategic',
    type: 'docx',
    fileUrl: '/clients/ChocoFamily Data/ChocoFamily_Complete_Analytical_Profile.md',
    fileSize: '38.6 KB',
    uploadedBy: 'System AI',
    uploadedAt: '12 Марта, 2026',
  },
  {
    id: 'cr2',
    clientId: '7',
    clientName: 'ChocoFamily',
    name: 'OSINT Analytical Profile',
    category: 'Intelligence',
    type: 'pdf',
    fileUrl: '/clients/ChocoFamily Data/ChocoFamily_OSINT_Analytical_Profile.pdf',
    fileSize: '85 KB',
    uploadedBy: 'System AI',
    uploadedAt: '10 Марта, 2026',
  },
  {
    id: 'cr3',
    clientId: '7',
    clientName: 'ChocoFamily',
    name: 'Protocol ChocoFamily — Валидированный профиль',
    category: 'Protocol',
    type: 'pdf',
    fileUrl: '/clients/ChocoFamily Data/Protocol ChocoFamily.pdf',
    fileSize: '322 KB',
    uploadedBy: 'Alex Kim',
    uploadedAt: '05 Марта, 2026',
  },
  {
    id: 'cr4',
    clientId: '7',
    clientName: 'ChocoFamily',
    name: 'Модульный аналитический отчёт (Holding)',
    category: 'Strategic',
    type: 'pdf',
    fileUrl: '/clients/ChocoFamily Data/ChocoFamily Holding модульный аналитический отчёт.pdf',
    fileSize: '1.7 MB',
    uploadedBy: 'Data Team',
    uploadedAt: '08 Марта, 2026',
  },
  {
    id: 'cr5',
    clientId: '7',
    clientName: 'ChocoFamily',
    name: 'GPT Intelligence Summary (Grok + GLM + Perplexity)',
    category: 'AI',
    type: 'pdf',
    fileUrl: '/clients/ChocoFamily Data/ChocoFamilyGPTReport.pdf',
    fileSize: '87 KB',
    uploadedBy: 'GPT-4o',
    uploadedAt: '06 Марта, 2026',
  },
  {
    id: 'cr6',
    clientId: '7',
    clientName: 'ChocoFamily',
    name: 'Аналитический профиль (Казахстан)',
    category: 'Market',
    type: 'pdf',
    fileUrl: '/clients/ChocoFamily Data/Аналитический профиль ChocoFamily Казахстан.pdf',
    fileSize: '224 KB',
    uploadedBy: 'System',
    uploadedAt: '04 Марта, 2026',
  },
]

// ============================================================
// Signals — рыночные сигналы и разведка из отчёта
// ============================================================
export const CHOCO_SIGNALS: Signal[] = [
  {
    id: 'cs1',
    type: 'market',
    priority: 'high',
    title: 'E-commerce КЗ: +60% г/г, транзакции +87%',
    description:
      'Объём рынка e-commerce КЗ достиг ~$6–9.9 млрд. Транзакции: 162 млн (+87% г/г). Маркетплейсы — 72% рынка. Проникновение интернета в КЗ — 92.9%.',
    tags: ['E-commerce', 'Казахстан', 'GMV'],
    time: 'Q4 2025',
    relatedClient: 'ChocoFamily',
  },
  {
    id: 'cs2',
    type: 'competitive',
    priority: 'critical',
    title: 'Yandex Food: рост +363% г/г',
    description:
      'Yandex Food вышел на 2-е место в KZ food delivery с долей 25.7% (GMV 45.1B KZT). Рост +363% г/г создаёт экзистенциальную угрозу для Chocofood (−24.1%).',
    tags: ['Конкуренция', 'Yandex', 'Food Delivery'],
    time: 'Q4 2024',
    relatedClient: 'ChocoFamily',
  },
  {
    id: 'cs3',
    type: 'regulatory',
    priority: 'high',
    title: 'НДС 16% с 2026 года',
    description:
      'Введение НДС 16% в 2026 году снизит чистую доходность платформ. Для delivery с маржой ~20% take rate — дополнительная нагрузка на и без того отрицательный EBITDA.',
    tags: ['Регулирование', 'НДС', 'Казахстан'],
    time: 'Feb 2026',
    relatedClient: 'ChocoFamily',
  },
  {
    id: 'cs4',
    type: 'market',
    priority: 'medium',
    title: 'ЦА e-com: CAGR 28.23% до 2034',
    description:
      'TAM Центральной Азии: $19.2 млрд (2025) → $191.6 млрд (2034), CAGR 28.23%. Smart Restaurant имеет потенциал экспансии в СНГ — единственный экспортный продукт.',
    tags: ['СНГ', 'SaaS', 'Экспансия'],
    time: 'Jan 2026',
    relatedClient: 'ChocoFamily',
  },
  {
    id: 'cs5',
    type: 'competitive',
    priority: 'critical',
    title: 'Kaspi: потенциальный вход в food delivery',
    description:
      'Kaspi.kz (~50% населения КЗ, $5.6B выручка) пока не имеет доставки еды. Вход в сегмент через M&A или органический запуск возможен в 2026–2027. Критический риск.',
    tags: ['Kaspi', 'Угроза', 'Super-App'],
    time: 'Q1 2026',
    relatedClient: 'ChocoFamily',
  },
  {
    id: 'cs6',
    type: 'market',
    priority: 'medium',
    title: 'iDoctor: каждый 10-й казахстанец',
    description:
      'iDoctor.kz — 2 млн пользователей, 55K+ врачей, 4K клиник. Недооценённый актив с монопольной позицией в e-health КЗ. 2.2M + 1M загрузок (Chocolife + Chocofood).',
    tags: ['Health', 'B2B', 'iDoctor'],
    time: 'Mar 2026',
    relatedClient: 'ChocoFamily',
  },
]

// ============================================================
// Team — реальное руководство из раздела 2.2 отчёта
// ============================================================
export const CHOCO_TEAM = [
  {
    id: 't1',
    name: 'Рамиль Мухорьяпов',
    role: 'Основатель & CEO',
    load: 95,
    clients: ['Chocofood', 'Smart Restaurant', 'AI Research Centre', 'Chocolife'],
    email: 'ramil@chocofamily.kz',
  },
  {
    id: 't2',
    name: 'Николай Мазнетсов',
    role: 'Сооснователь & COO Chocofood',
    load: 90,
    clients: ['Chocofood'],
    email: 'nikolay@chocofamily.kz',
  },
  {
    id: 't3',
    name: 'Анвар Бакиев',
    role: 'Сооснователь (Exited 2025)',
    load: 0,
    clients: ['extella.ai'],
    email: 'anvar@extella.ai',
  },
]
