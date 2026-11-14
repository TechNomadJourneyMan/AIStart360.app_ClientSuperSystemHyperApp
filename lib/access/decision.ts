/**
 * lib/access/decision.ts — ОДНА функция решения «открыт ли платный раздел»
 * (Раунд 2, R2-A). Её используют:
 *   • серверный гейт API (lib/access/gate.ts → 402 upgrade_required);
 *   • серверные страницы (components/access/FeatureGate.tsx → пейволл);
 *   • GET /api/v1/access/me (тот же ответ для UI: меню, замки, пейволл).
 *
 * Правило (по порядку):
 *   1. тумблер access_gates выключен  → открыто всем ('gates_off');
 *   2. право есть по тарифу/override   → открыто ('entitled');
 *   3. персонал платформы (staff_roles или активный эксперт, прошедший второй
 *      фактор этой сессии)            → открыто ('staff');
 *   4. иначе                           → закрыто ('upgrade_required').
 * При входе «от имени» сессия клиентская: персоналом она не считается, гейт
 * действует как для клиента.
 *
 * Чистая часть (decideFeature) не ходит в базу; серверная (resolveFeature /
 * resolveAccess) читает тумблер, собственный тариф и — только на пути отказа —
 * тариф компании (R2-C, Q3) и персонал, параллельно (ревью L-11: у Pro и при
 * выключенном тумблере компанию не спрашиваем вовсе, у Free — без лишнего
 * последовательного запроса).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSessionStaff } from '@/lib/api-identity'
import { getAccessGatesEnabled } from '@/lib/settings/system-settings'
import { can, needsCompanyRights, PAID_SECTIONS, withCompanyRights, type Entitlements, type Feature, type PaidSection } from './entitlements'
import { readCompanyRights, readOwnEntitlements, type OwnEntitlements } from './server'

export type DecisionReason = 'gates_off' | 'entitled' | 'staff' | 'upgrade_required'

export interface FeatureDecision {
  allowed: boolean
  reason: DecisionReason
}

export interface DecisionInput {
  gatesEnabled: boolean
  ent: Entitlements
  /** Персонал сессии. undefined — ещё не проверяли (решение без него). */
  staff?: boolean
}

/** Чистое решение по одной фиче. */
export function decideFeature(input: DecisionInput, feature: Feature): FeatureDecision {
  if (!input.gatesEnabled) return { allowed: true, reason: 'gates_off' }
  if (can(input.ent, feature)) return { allowed: true, reason: 'entitled' }
  if (input.staff) return { allowed: true, reason: 'staff' }
  return { allowed: false, reason: 'upgrade_required' }
}

/** Решения по всем платным разделам разом (для /api/v1/access/me и меню). */
export function decideSections(input: DecisionInput): Record<PaidSection, boolean> {
  const out = {} as Record<PaidSection, boolean>
  for (const s of PAID_SECTIONS) out[s] = decideFeature(input, s).allowed
  return out
}

// ─── Server side ─────────────────────────────────────────────────────────────

/**
 * Персонал этой сессии по правилу миграции 140 (lib/access/actor.ts): строка
 * staff_roles одобренного профиля или активный эксперт, прошедший второй фактор
 * этой сессии (getSessionStaff). Так распознаётся и сотрудник с profiles.role =
 * 'client'; устаревший profiles.role admin без staff_roles персоналом не считается
 * (getSessionRole дал бы ему staff-роль только при тех же условиях). Один запрос
 * (две параллельные выборки) вместо двух последовательных.
 * Любая ошибка — не персонал (fail closed: гейт остаётся закрытым).
 */
export async function isStaffSession(sb: SupabaseClient, userId: string): Promise<boolean> {
  try {
    return (await getSessionStaff(sb, userId)) !== null
  } catch {
    return false
  }
}

export interface AccessSnapshot {
  gatesEnabled: boolean
  ent: Entitlements
  staff: boolean
  sections: Record<PaidSection, boolean>
}

async function loadInputs(sb: SupabaseClient, userId: string): Promise<{ gatesEnabled: boolean; own: OwnEntitlements }> {
  const [gatesEnabled, own] = await Promise.all([getAccessGatesEnabled(), readOwnEntitlements(sb, userId)])
  return { gatesEnabled, own }
}

/** Путь отказа: права компании (если они могут что-то открыть) и персонал — одним параллельным шагом. */
async function refusalInputs(
  sb: SupabaseClient,
  userId: string,
  own: OwnEntitlements,
  withStaff: boolean,
): Promise<{ ent: Entitlements; staff: boolean }> {
  const [company, staff] = await Promise.all([
    needsCompanyRights(own.ent, own.overrides) ? readCompanyRights(sb, userId) : Promise.resolve(null),
    withStaff ? isStaffSession(sb, userId) : Promise.resolve(false),
  ])
  return { ent: withCompanyRights(own.ent, own.overrides, company), staff }
}

/** Серверное решение по одной фиче для пользователя сессии `userId`. */
export async function resolveFeature(
  sb: SupabaseClient,
  userId: string,
  feature: Feature,
  opts: { exemptStaff?: boolean } = {},
): Promise<FeatureDecision & { ent: Entitlements; gatesEnabled: boolean }> {
  const { gatesEnabled, own } = await loadInputs(sb, userId)
  const first = decideFeature({ gatesEnabled, ent: own.ent }, feature)
  if (first.allowed) return { ...first, ent: own.ent, gatesEnabled }
  // Компания и персонал — только на пути отказа: обычный проход не платит лишних запросов.
  const { ent, staff } = await refusalInputs(sb, userId, own, !!opts.exemptStaff)
  return { ...decideFeature({ gatesEnabled, ent, staff }, feature), ent, gatesEnabled }
}

/** Полный снимок для UI: тумблер, права, персонал и решения по платным разделам. */
export async function resolveAccess(sb: SupabaseClient, userId: string): Promise<AccessSnapshot> {
  const { gatesEnabled, own } = await loadInputs(sb, userId)
  const first = decideSections({ gatesEnabled, ent: own.ent })
  if (!Object.values(first).some((v) => !v)) return { gatesEnabled, ent: own.ent, staff: false, sections: first }
  const { ent, staff } = await refusalInputs(sb, userId, own, true)
  return { gatesEnabled, ent, staff, sections: decideSections({ gatesEnabled, ent, staff }) }
}

/**
 * R2-A (ревью M-1): a task of the action plan belongs to a paid section by its
 * source — tasks a Point B plan published → Точка Б; the 90-day plan of the GRI
 * (and anything else) → полный GRI.
 */
export function actionItemSection(source: unknown): 'point_b' | 'gri_full' {
  return source === 'point_b' ? 'point_b' : 'gri_full'
}
