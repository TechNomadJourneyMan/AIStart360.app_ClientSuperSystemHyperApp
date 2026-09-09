// Registry of product verticals. Adding a new vertical = adding an entry here.
// Welcome-screen renders one card per entry; migration 008 keeps the DB in sync
// via CHECK constraint — if adding a new id, update the migration too.

export const VERTICAL_IDS = ['generic', 'medical', 'ecommerce'] as const
export type VerticalId = (typeof VERTICAL_IDS)[number]

const VERTICAL_ID_SET = new Set<string>(VERTICAL_IDS)

export interface Vertical {
  id: VerticalId
  label: string
  /** Short tagline for the welcome-screen card subtitle */
  subtitle: string
  icon: string           // material-symbols name (no emoji in business UI)
  /** 3 key features shown on the card */
  features: string[]
  /** Longer description for the welcome-screen / settings page */
  description: string
  /** Default product name (branding.product_name fallback) */
  productName: string
}

export interface VerticalUiConfig {
  onboarding: `/${string}`
  result: `/${string}`
  verticalNav: {
    label: string
    href: `/${string}`
    icon: string
  } | null
  specializedJourney: `/${string}` | null
}

export const VERTICALS: Vertical[] = [
  {
    id: 'generic',
    label: 'Общий бизнес',
    subtitle: 'Услуги, B2B, SaaS, производство',
    icon: 'business_center',
    features: [
      'GRI-диагностика по 7 категориям',
      'Диагностика Точка А по 5 блокам',
      'AI-анализ и стратегия роста B2B',
    ],
    description:
      'Классический бизнес-аудит для компаний с корпоративными клиентами. ' +
      'Расчёт GRI, выявление точек роста, персональная стратегия по юнит-экономике.',
    productName: 'AIStart360',
  },
  {
    id: 'medical',
    label: 'Клиника / медицина',
    subtitle: 'Пациенты, визиты, повторные продажи',
    icon: 'medical_services',
    features: [
      '9 AI-связок роста выручки',
      'RFM-сегментация базы пациентов',
      'PDF-стратегия + XLSX для обзвона',
    ],
    description:
      'AI-усиление для клиник: работа с базой пациентов, сегментация, карта потерь ' +
      'выручки, 9 связок роста и готовые сценарии для WhatsApp / обзвона.',
    productName: 'AIStart360',
  },
  {
    id: 'ecommerce',
    label: 'Интернет-магазин',
    subtitle: 'eCom, маркетплейсы, D2C',
    icon: 'shopping_cart',
    features: [
      'SKU-эконом + ABC/XYZ-анализ',
      'Funnel: visit → cart → paid + recovery',
      'Атрибуция канал → выручка по UTM',
      'Маркетплейсы: WB · Ozon · Kaspi · Uzum',
    ],
    description:
      'AI-операционка для онлайн-ритейла: каталог, воронка, маркетплейсы, юнит-эконом ' +
      'по каналам. RFM-сегментация, cohort LTV, cart-recovery flow и сезонный прогноз ' +
      'кэша. Подключаем GA4 / Meta / Yandex / WB / Ozon / Kaspi и считаем сами.',
    productName: 'AIStart360',
  },
]

export const VERTICALS_BY_ID: Record<VerticalId, Vertical> = Object.fromEntries(
  VERTICALS.map((v) => [v.id, v]),
) as Record<VerticalId, Vertical>

// Product routes and the optional specialized navigation slot for each
// vertical. Generic businesses already have the shared /dashboard item, so a
// second link to the same destination would be misleading and is omitted.
export const VERTICAL_UI = {
  generic: {
    onboarding: '/client/onboarding',
    result: '/dashboard',
    verticalNav: null,
    specializedJourney: null,
  },
  medical: {
    onboarding: '/client/onboarding-medical',
    result: '/clinic',
    verticalNav: {
      label: 'Клиника',
      href: '/clinic',
      icon: 'medical_services',
    },
    specializedJourney: null,
  },
  ecommerce: {
    onboarding: '/client/onboarding-ecommerce',
    result: '/dashboard',
    verticalNav: {
      label: 'Магазин',
      href: '/store',
      icon: 'storefront',
    },
    specializedJourney: '/client/journey/store',
  },
} as const satisfies Record<VerticalId, VerticalUiConfig>

/** Parse only exact, own vertical ids. Never accept inherited object keys. */
export function parseVerticalId(value: unknown): VerticalId | null {
  return typeof value === 'string' && VERTICAL_ID_SET.has(value)
    ? (value as VerticalId)
    : null
}

/** Resolve a vertical by id, falling back to 'generic' for unknown ids */
export function getVertical(id: string | null | undefined): Vertical {
  return VERTICALS_BY_ID[parseVerticalId(id) ?? 'generic']
}

export function isValidVerticalId(v: unknown): v is VerticalId {
  return parseVerticalId(v) !== null
}

/** Resolve product UI config with the same fail-closed generic fallback. */
export function getVerticalUi(id: unknown): VerticalUiConfig {
  return VERTICAL_UI[parseVerticalId(id) ?? 'generic']
}

// ── Branding ────────────────────────────────────────────────────────────────

export interface Branding {
  logo_url?: string | null
  primary_color?: string | null   // e.g. '#6EFFC0'
  secondary_color?: string | null
  product_name?: string | null
}

export function resolveProductName(branding: Branding | null | undefined, vertical: VerticalId): string {
  return branding?.product_name?.trim() || getVertical(vertical).productName
}
