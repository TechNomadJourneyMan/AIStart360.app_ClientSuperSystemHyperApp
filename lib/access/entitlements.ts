/**
 * lib/access/entitlements.ts — модель прав доступа (Фаза 6, Пакет VIII).
 *
 * Чистая логика: тариф + per-user override → набор разрешений. Единый источник
 * правды для серверных гейтов и upgrade-экранов. Решение ПО 2026-07-09 (вариант А):
 *   free — mini-GRI + Пульс + мини-CRM + 1 демо-проход полного GRI;
 *   pro  — повторные полные GRI, PDF-экспорт, AI-чат по отчёту, бенчмарки.
 *
 * Пульс и мини-CRM НЕ гейтятся (базовый бесплатный контур) — их здесь нет.
 */

export type Tier = 'free' | 'pro'
export type Feature = 'gri_full' | 'pdf_export' | 'ai_chat' | 'benchmarks'

export interface Entitlements {
  tier: Tier
  /** Разрешён ли полный GRI в принципе (с учётом лимита — см. canRunFullGri). */
  gri_full: boolean
  /** Сколько полных GRI всего разрешено (free: 1 демо, pro: без лимита). */
  gri_full_limit: number
  pdf_export: boolean
  ai_chat: boolean
  benchmarks: boolean
}

const TIER_BASE: Record<Tier, Omit<Entitlements, 'tier'>> = {
  free: {
    gri_full: true,
    gri_full_limit: 1,
    pdf_export: false,
    ai_chat: false,
    benchmarks: false,
  },
  pro: {
    gri_full: true,
    gri_full_limit: Number.POSITIVE_INFINITY,
    pdf_export: true,
    ai_chat: true,
    benchmarks: true,
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
  for (const f of ['gri_full', 'pdf_export', 'ai_chat', 'benchmarks'] as Feature[]) {
    if (typeof src[f] === 'boolean') out[f] = src[f] as boolean
  }
  return out
}

export function entitlementsFor(
  tier: Tier,
  overrides?: Partial<Record<Feature, boolean>>,
): Entitlements {
  const base = TIER_BASE[tier]
  const o = overrides ?? {}
  return {
    tier,
    gri_full: o.gri_full ?? base.gri_full,
    gri_full_limit: base.gri_full_limit,
    pdf_export: o.pdf_export ?? base.pdf_export,
    ai_chat: o.ai_chat ?? base.ai_chat,
    benchmarks: o.benchmarks ?? base.benchmarks,
  }
}

/** Может ли пользователь пройти ЕЩЁ один полный GRI (лимит тира vs уже пройдено). */
export function canRunFullGri(ent: Entitlements, alreadyCompleted: number): boolean {
  if (!ent.gri_full) return false
  return alreadyCompleted < ent.gri_full_limit
}

/** Разрешение на простую boolean-фичу (кроме gri_full — там лимит). */
export function can(ent: Entitlements, feature: Exclude<Feature, 'gri_full'>): boolean {
  return ent[feature]
}
