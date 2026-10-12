/**
 * lib/point-a/v4/config.ts — the block constructor of Point A
 * (spec 2026-10-12 §2.2).
 *
 * Three levels:
 *   template  admin (public.pa_templates; the code ones below are the seed and
 *             the fallback before migration 111): blocks and weights per industry
 *   expert    per company (pa_company_config.expert_overrides): enable /
 *             disable a block, change its weight
 *   client    per company (pa_company_config.client_view): hide, reorder,
 *             add a block from the library — never weights. A hidden block
 *             still counts in the score; a block the client added that the
 *             template does not weigh is informational (weight 0).
 */

export const BLOCK_KEYS = ['finance', 'sales', 'operations', 'marketing', 'strategy', 'team', 'product'] as const
export type BlockKey = (typeof BLOCK_KEYS)[number]

export function isBlockKey(v: unknown): v is BlockKey {
  return typeof v === 'string' && (BLOCK_KEYS as readonly string[]).includes(v)
}

export interface BlockDef {
  key: BlockKey
  title: string
  description: string
  icon: string
  /** Catalog metrics shown in the block and whose conflicts lower its confidence. */
  metrics: readonly string[]
}

export const BLOCK_LIBRARY: Readonly<Record<BlockKey, BlockDef>> = {
  finance: {
    key: 'finance', title: 'Финансы', icon: 'finance',
    description: 'Выручка и её динамика, маржинальность, юнит-экономика, долги, точка безубыточности',
    metrics: ['biz.finansy.vyruchka_god', 'biz.finansy.valovaya_marzha', 'biz.marketing.cac', 'biz.marketing.ltv_cac', 'goal.04.ltv'],
  },
  sales: {
    key: 'sales', title: 'Продажи', icon: 'sales',
    description: 'CRM, цикл сделки, повторные продажи, воронка и отказы',
    metrics: ['biz.prodazhi.tsikl_zakrytiya_sdelki', 'goal.02.repeat_purchase_rate', 'goal.06.loss_rate'],
  },
  operations: {
    key: 'operations', title: 'Операции', icon: 'operations',
    description: 'Оргструктура, KPI отделов, планёрки, отчётность и управление задачами',
    metrics: [],
  },
  marketing: {
    key: 'marketing', title: 'Маркетинг', icon: 'marketing',
    description: 'Бюджет, каналы, целевая аудитория, конкуренты и УТП',
    metrics: ['biz.marketing.cac'],
  },
  strategy: {
    key: 'strategy', title: 'Стратегия', icon: 'strategy',
    description: 'Цели на 12 месяцев и 3 года, главная проблема и барьеры роста',
    metrics: [],
  },
  team: {
    key: 'team', title: 'Команда', icon: 'team',
    description: 'Структура под задачи, делегирование, загрузка собственника, руководители отделов',
    metrics: ['biz.hr.kol_vo_sotrudnikov'],
  },
  product: {
    key: 'product', title: 'Продукт', icon: 'product',
    description: 'Продуктовая линейка, продукт-локомотив, входной продукт, защита от копирования, NPS',
    metrics: ['biz.klienty.nps', 'biz.produkt.aktivnykh_sku'],
  },
}

export interface TemplateBlock {
  key: BlockKey
  weight: number
  enabled: boolean
}

export interface BlockTemplate {
  key: string
  title: string
  /** Lower-case substrings of companies.industry this template fits. */
  industries: readonly string[]
  blocks: readonly TemplateBlock[]
  version: number
}

const t = (key: string, title: string, industries: string[], w: Record<BlockKey, number>): BlockTemplate => ({
  key, title, industries, version: 1,
  blocks: BLOCK_KEYS.map((k) => ({ key: k, weight: w[k], enabled: w[k] > 0 })),
})

export const DEFAULT_TEMPLATE: BlockTemplate = t('default', 'Универсальный', [], {
  finance: 0.25, sales: 0.2, operations: 0.15, marketing: 0.12, strategy: 0.1, team: 0.1, product: 0.08,
})

export const CODE_TEMPLATES: readonly BlockTemplate[] = [
  DEFAULT_TEMPLATE,
  t('ecommerce', 'E-commerce и розница', ['e-commerce', 'ecommerce', 'интернет', 'маркетплейс', 'розниц', 'ритейл', 'retail'], {
    finance: 0.22, sales: 0.18, operations: 0.12, marketing: 0.2, strategy: 0.08, team: 0.06, product: 0.14,
  }),
  t('services', 'Услуги и B2B', ['услуг', 'консалт', 'b2b', 'агентств', 'сервис', 'it', 'образован'], {
    finance: 0.22, sales: 0.24, operations: 0.12, marketing: 0.12, strategy: 0.1, team: 0.14, product: 0.06,
  }),
  t('production', 'Производство', ['производ', 'завод', 'промышлен', 'строител', 'manufactur'], {
    finance: 0.28, sales: 0.16, operations: 0.22, marketing: 0.08, strategy: 0.1, team: 0.1, product: 0.06,
  }),
]

export function pickTemplate(industry: string | null | undefined, templates: readonly BlockTemplate[] = CODE_TEMPLATES): BlockTemplate {
  const i = (industry ?? '').toLowerCase()
  if (i) {
    for (const tpl of templates) {
      if (tpl.key !== 'default' && tpl.industries.some((s) => i.includes(s))) return tpl
    }
  }
  return templates.find((x) => x.key === 'default') ?? DEFAULT_TEMPLATE
}

export interface CompanyBlockConfig {
  templateKey?: string | null
  expertOverrides?: Partial<Record<BlockKey, { weight?: number; enabled?: boolean }>>
  clientView?: { hidden?: string[]; order?: string[]; added?: string[] }
  version?: number
}

export interface EffectiveBlock {
  key: BlockKey
  title: string
  /** Normalised over enabled weighted blocks (sum 1). 0 = informational. */
  weight: number
  enabled: boolean
  hiddenForClient: boolean
  informational: boolean
  order: number
  origin: 'template' | 'expert' | 'client'
}

/** The blocks of a company: template → expert overrides → client view. */
export function effectiveBlocks(template: BlockTemplate, cfg: CompanyBlockConfig = {}): EffectiveBlock[] {
  const byKey = new Map<BlockKey, { weight: number; enabled: boolean; origin: EffectiveBlock['origin'] }>()
  for (const b of template.blocks) byKey.set(b.key, { weight: Math.max(0, b.weight), enabled: b.enabled, origin: 'template' })
  for (const [k, o] of Object.entries(cfg.expertOverrides ?? {})) {
    if (!isBlockKey(k) || !o) continue
    const cur = byKey.get(k) ?? { weight: 0, enabled: false, origin: 'expert' as const }
    byKey.set(k, {
      weight: typeof o.weight === 'number' && Number.isFinite(o.weight) ? Math.max(0, o.weight) : cur.weight,
      enabled: typeof o.enabled === 'boolean' ? o.enabled : cur.enabled,
      origin: 'expert',
    })
  }
  for (const k of cfg.clientView?.added ?? []) {
    if (!isBlockKey(k)) continue
    const cur = byKey.get(k)
    if (!cur) byKey.set(k, { weight: 0, enabled: true, origin: 'client' })
    else if (!cur.enabled) byKey.set(k, { ...cur, enabled: true, weight: 0, origin: 'client' })
  }

  const hidden = new Set(cfg.clientView?.hidden ?? [])
  const order = cfg.clientView?.order ?? []
  const total = [...byKey.values()].filter((b) => b.enabled).reduce((s, b) => s + b.weight, 0)
  const out: EffectiveBlock[] = []
  for (const key of BLOCK_KEYS) {
    const b = byKey.get(key)
    if (!b || !b.enabled) continue
    const weight = total > 0 ? Math.round((b.weight / total) * 10_000) / 10_000 : 0
    const idx = order.indexOf(key)
    out.push({
      key, title: BLOCK_LIBRARY[key].title, weight, enabled: true,
      hiddenForClient: hidden.has(key), informational: weight === 0,
      order: idx >= 0 ? idx : order.length + BLOCK_KEYS.indexOf(key),
      origin: b.origin,
    })
  }
  return out.sort((a, b) => a.order - b.order)
}

/**
 * Version of the scoring rules (checks, coverage, weights logic). Bump it with
 * a change of lib/point-a-engine.ts / lib/point-a/v4/* that changes scores:
 * the next recalculation of every company then writes a new Point A instead
 * of stopping at «inputs unchanged».
 */
export const POINT_A_RULES_VERSION = 'r1'

/** Stable version of the effective configuration (for snapshots). */
export function configVersion(template: BlockTemplate, cfg: CompanyBlockConfig = {}): string {
  return `${template.key}@${template.version}/${cfg.version ?? 0}/${POINT_A_RULES_VERSION}`
}

/** A template / company config edit changes its content even without a version bump. */
export function configFingerprint(template: BlockTemplate, cfg: CompanyBlockConfig = {}): string {
  return JSON.stringify([template.blocks, cfg.templateKey ?? null, cfg.expertOverrides ?? {}, cfg.clientView ?? {}])
}
