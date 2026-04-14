// ─── Industry options ─────────────────────────────────────────────────────────
export const INDUSTRIES = [
  'IT / Технологии',
  'Ритейл / E-commerce',
  'Производство',
  'Строительство',
  'Финансы / Банкинг',
  'Образование',
  'Медицина / Здравоохранение',
  'Логистика / Транспорт',
  'HoReCa / Рестораны',
  'Агробизнес',
  'Консалтинг / Услуги B2B',
  'Медиа / Реклама',
  'Другое',
] as const

// ─── Region options ──────────────────────────────────────────────────────────
export const REGIONS = [
  'Алматы',
  'Астана',
  'Шымкент',
  'Алматинская область',
  'Карагандинская область',
  'Восточный Казахстан',
  'Западный Казахстан',
  'Северный Казахстан',
  'Россия',
  'Другие страны СНГ',
] as const

// ─── Promo / sales channels ──────────────────────────────────────────────────
export const PROMO_CHANNELS = [
  'Instagram',
  'Facebook',
  'TikTok',
  'YouTube',
  'Telegram',
  'Google Ads',
  'SEO',
  'Email-маркетинг',
  'Партнёры / Реферальная программа',
  'Холодные звонки',
  'Выставки / Мероприятия',
  'Сарафанное радио',
] as const

// ─── Marketing channels ──────────────────────────────────────────────────────
export const MARKETING_CHANNELS = [
  'SMM (соцсети)',
  'Контекстная реклама',
  'SEO',
  'Email-рассылка',
  'Telegram-канал',
  'PR / СМИ',
  'Партнёрский маркетинг',
  'Influencer-маркетинг',
  'Офлайн-реклама',
] as const

// ─── Audience segments ───────────────────────────────────────────────────────
export const AUDIENCE_SEGMENTS = [
  'Малый бизнес (SMB)',
  'Средний бизнес',
  'Крупный бизнес / Корпорации',
  'Государственные структуры',
  'Физические лица (B2C)',
  'Стартапы',
  'Иностранные компании',
] as const

// ─── Growth blockers ─────────────────────────────────────────────────────────
export const GROWTH_BLOCKERS = [
  'Деньги / Финансирование',
  'Команда / Кадры',
  'Процессы / Операции',
  'Технологии / IT',
  'Рынок / Конкуренция',
  'Маркетинг / Продажи',
  'Другое',
] as const

// ─── Company stages ──────────────────────────────────────────────────────────
export const COMPANY_STAGES = [
  { value: 'Startup', label: 'Startup' },
  { value: 'Growth', label: 'Growth' },
  { value: 'Scale', label: 'Scale' },
  { value: 'Mature', label: 'Mature' },
] as const

// ─── Business models ─────────────────────────────────────────────────────────
export const BUSINESS_MODELS = [
  { value: 'B2B', label: 'B2B' },
  { value: 'B2C', label: 'B2C' },
  { value: 'B2B2C', label: 'B2B2C' },
  { value: 'Mixed', label: 'Mixed' },
] as const

// ─── CRM options ─────────────────────────────────────────────────────────────
export const CRM_OPTIONS = [
  { value: 'none', label: 'Нет CRM' },
  { value: 'excel', label: 'Excel / Google Sheets' },
  { value: 'amocrm', label: 'amoCRM' },
  { value: 'bitrix24', label: 'Bitrix24' },
  { value: 'other', label: 'Другая CRM' },
] as const

// ─── Debt load options ───────────────────────────────────────────────────────
export const DEBT_LOAD_OPTIONS = [
  { value: 'none', label: 'Нет' },
  { value: 'moderate', label: 'Умеренная' },
  { value: 'high', label: 'Высокая' },
] as const

// ─── Management methods ──────────────────────────────────────────────────────
export const MANAGEMENT_METHODS = [
  { value: 'manual', label: 'Ручное управление' },
  { value: 'kpi', label: 'KPI' },
  { value: 'okr', label: 'OKR' },
  { value: 'hybrid', label: 'Гибридное' },
] as const

// ─── Reporting tools ─────────────────────────────────────────────────────────
export const REPORTING_TOOLS = [
  { value: 'excel', label: 'Excel / Google Sheets' },
  { value: 'bi', label: 'BI-система' },
  { value: 'crm', label: 'CRM-отчёты' },
  { value: 'none', label: 'Нет системы' },
] as const

// ─── Task managers ───────────────────────────────────────────────────────────
export const TASK_MANAGERS = [
  { value: 'none', label: 'Нет' },
  { value: 'trello', label: 'Trello' },
  { value: 'jira', label: 'Jira' },
  { value: 'notion', label: 'Notion' },
  { value: 'other', label: 'Другое' },
] as const
