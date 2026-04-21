// Registry of product verticals. Adding a new vertical = adding an entry here.
// Welcome-screen renders one card per entry; migration 008 keeps the DB in sync
// via CHECK constraint — if adding a new id, update the migration too.

export type VerticalId = 'generic' | 'medical'

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
]

export const VERTICALS_BY_ID: Record<VerticalId, Vertical> = Object.fromEntries(
  VERTICALS.map((v) => [v.id, v]),
) as Record<VerticalId, Vertical>

/** Resolve a vertical by id, falling back to 'generic' for unknown ids */
export function getVertical(id: string | null | undefined): Vertical {
  if (id && id in VERTICALS_BY_ID) return VERTICALS_BY_ID[id as VerticalId]
  return VERTICALS_BY_ID.generic
}

export function isValidVerticalId(v: unknown): v is VerticalId {
  return typeof v === 'string' && v in VERTICALS_BY_ID
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
