/**
 * lib/access/entitlements.ts — модель прав доступа (Фаза 6, Пакет VIII; Раунд 2).
 *
 * Чистая логика: тариф + per-user override → набор разрешений. Единый источник
 * правды для серверных гейтов и экранов пейволла.
 *
 * Тариф = profiles.tier ('free' | 'pro'); его пишет только lib/payments/billing.ts
 * (миграция 106: subscriptions и profiles.tier меняются одной транзакцией).
 * Per-user override = profiles.feature_flags (редактор доступа в GIGA).
 *
 * Решение фаундера 2026-11 (подтверждено PO): Точка А, Точка Б, Рынок и полный
 * GRI — только платным клиентам. Бесплатно остаются регистрация, анкета
 * (включая экспресс-оценку и «Снимок бизнеса»), мини-GRI, сообщения, документы,
 * профиль, Пульс и мини-CRM — их здесь нет, они не гейтятся.
 * Раньше (решение 2026-07-09, вариант А) Free получал 1 демо-проход полного GRI;
 * теперь полный GRI на Free закрыт (gri_full = false). Лимит проходов
 * (настройка gri_free_runs) действует только для Free-аккаунта, которому
 * полный GRI открыт индивидуально (feature_flags.gri_full = true).
 */

export type Tier = 'free' | 'pro'
export type Feature =
  | 'gri_full'
  | 'pdf_export'
  | 'ai_chat'
  | 'benchmarks'
  | 'point_b'
  | 'point_a'
  | 'market'

/** Платные разделы кабинета (решение фаундера 2026-11): страница + API закрыты для Free. */
export const PAID_SECTIONS = ['point_a', 'point_b', 'market', 'gri_full'] as const
export type PaidSection = (typeof PAID_SECTIONS)[number]

export function isPaidSection(v: unknown): v is PaidSection {
  return typeof v === 'string' && (PAID_SECTIONS as readonly string[]).includes(v)
}

const ALL_FEATURES: readonly Feature[] = ['gri_full', 'pdf_export', 'ai_chat', 'benchmarks', 'point_b', 'point_a', 'market']

export interface Entitlements {
  tier: Tier
  /** Открыт ли полный GRI (страница и проходы; с учётом лимита — см. canRunFullGri). */
  gri_full: boolean
  /** Сколько полных GRI всего разрешено (pro: без лимита; free с индивидуальным доступом — настройка gri_free_runs). */
  gri_full_limit: number
  pdf_export: boolean
  ai_chat: boolean
  benchmarks: boolean
  /** Точка Б (план и цели). */
  point_b: boolean
  /** Точка А (полная страница, блоки, история, разбор). Экспресс-снимок — бесплатно. */
  point_a: boolean
  /** Рынок (Mark-analytics: карта, анализ ниши, чек-лист 50). */
  market: boolean
  /**
   * R2-C (Q3): фичи, открытые не собственным тарифом, а тарифом компании, где
   * пользователь — активный участник. Нет поля — ничего не унаследовано.
   */
  viaCompany?: Feature[]
}

const TIER_BASE: Record<Tier, Omit<Entitlements, 'tier'>> = {
  free: {
    gri_full: false,
    gri_full_limit: 1,
    pdf_export: false,
    ai_chat: false,
    benchmarks: false,
    point_b: false,
    point_a: false,
    market: false,
  },
  pro: {
    gri_full: true,
    gri_full_limit: Number.POSITIVE_INFINITY,
    pdf_export: true,
    ai_chat: true,
    benchmarks: true,
    point_b: true,
    point_a: true,
    market: true,
  },
}

export function normalizeTier(t: unknown): Tier {
  return t === 'pro' ? 'pro' : 'free'
}

/** Санитизируем per-user override: только известные boolean-фичи. */
export function normalizeOverrides(raw: unknown): Partial<Record<Feature, boolean>> {
  if (!raw || typeof raw !== 'object') return {}
  const src = raw as Record<string, unknown>
  const out: Partial<Record<Feature, boolean>> = {}
  for (const f of ALL_FEATURES) {
    if (typeof src[f] === 'boolean') out[f] = src[f] as boolean
  }
  return out
}

export function entitlementsFor(
  tier: Tier,
  overrides?: Partial<Record<Feature, boolean>>,
  /** Free-tier full-GRI allowance from platform settings (default 1). */
  freeGriLimit?: number,
): Entitlements {
  const base = TIER_BASE[tier]
  const o = overrides ?? {}
  return {
    tier,
    gri_full: o.gri_full ?? base.gri_full,
    gri_full_limit:
      tier === 'free' && typeof freeGriLimit === 'number' && Number.isFinite(freeGriLimit) && freeGriLimit >= 0
        ? Math.floor(freeGriLimit)
        : base.gri_full_limit,
    pdf_export: o.pdf_export ?? base.pdf_export,
    ai_chat: o.ai_chat ?? base.ai_chat,
    benchmarks: o.benchmarks ?? base.benchmarks,
    point_b: o.point_b ?? base.point_b,
    point_a: o.point_a ?? base.point_a,
    market: o.market ?? base.market,
  }
}

// ─── R2-C (Q3): участники компании наследуют тариф компании ──────────────────

/**
 * Права, унаследованные от компаний, где пользователь — активный участник
 * (company_members: owner / admin / member / viewer, status 'active'), по праву
 * основного владельца компании (companies.user_id): его override, иначе tier pro.
 * Источник — SQL-функция company_inherited_rights() (миграция 148); та же
 * функция стоит в has_paid_section(), поэтому приложение и RLS решают одинаково.
 */
export interface CompanyRights {
  features: Partial<Record<Feature, boolean>>
  /** Право на полный GRI пришло от владельца на тарифе Pro — без лимита проходов. */
  griUnlimited: boolean
}

/** Ответ company_inherited_rights() → CompanyRights; всё непонятное — «нет права». */
export function parseCompanyRights(raw: unknown): CompanyRights | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const src = raw as Record<string, unknown>
  const features: Partial<Record<Feature, boolean>> = {}
  for (const f of ALL_FEATURES) if (src[f] === true) features[f] = true
  return { features, griUnlimited: src.gri_full_unlimited === true }
}

/**
 * Нужно ли вообще спрашивать компанию: есть фича, закрытая тарифом, а не
 * собственным явным override (явный false участника наследованием не открывается).
 */
export function needsCompanyRights(own: Entitlements, overrides: Partial<Record<Feature, boolean>>): boolean {
  return ALL_FEATURES.some((f) => own[f] !== true && typeof overrides[f] !== 'boolean')
}

/**
 * Собственные права + унаследованные от компании. Порядок как в
 * has_paid_section(): собственный override → собственный тариф → компания.
 */
export function withCompanyRights(
  own: Entitlements,
  overrides: Partial<Record<Feature, boolean>>,
  company: CompanyRights | null,
): Entitlements {
  if (!company) return own
  const out: Entitlements = { ...own }
  const inherited: Feature[] = []
  for (const f of ALL_FEATURES) {
    if (typeof overrides[f] === 'boolean' || own[f] === true) continue
    if (company.features[f] === true) {
      out[f] = true
      inherited.push(f)
    }
  }
  if (inherited.length === 0) return own
  if (inherited.includes('gri_full') && company.griUnlimited) out.gri_full_limit = Number.POSITIVE_INFINITY
  out.viaCompany = inherited
  return out
}

/** Может ли пользователь пройти ЕЩЁ один полный GRI (лимит тира vs уже пройдено). */
export function canRunFullGri(ent: Entitlements, alreadyCompleted: number): boolean {
  if (!ent.gri_full) return false
  return alreadyCompleted < ent.gri_full_limit
}

/**
 * Разрешение на фичу как на раздел: открыт ли он вообще. Для gri_full — сам
 * доступ к полному GRI (страница, результат), без учёта лимита проходов.
 */
export function can(ent: Entitlements, feature: Feature): boolean {
  return ent[feature] === true
}

/**
 * A paying (or paid-for) account: tier pro, or any paid feature open — by a per-user override
 * (the access editor in GIGA) or by the tariff of a company the user is a member of (148, Q3).
 * The free tier opens none of them. Used by the AI budget (lib/ai/budget.ts) for «paid».
 */
export function hasPaidAccess(ent: Entitlements): boolean {
  return ent.tier === 'pro' || ALL_FEATURES.some((f) => ent[f] === true)
}
