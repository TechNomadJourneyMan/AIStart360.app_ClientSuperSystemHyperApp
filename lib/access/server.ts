/**
 * lib/access/server.ts — серверное чтение прав доступа пользователя (Фаза 6).
 *
 * Читает profiles.tier + feature_flags под переданным клиентом (сессия — RLS own,
 * или service — для админ-контекста). Устойчиво к неприменённой миграции 048:
 * при отсутствии колонок возвращает free-права (безопасный дефолт, ничего не
 * гейтит сверх текущего поведения, пока энфорсмент не включён в роутах).
 *
 * R2-C (Q3): участник компании наследует тариф компании. Если собственный тариф
 * что-то закрывает (а не явный override), спрашиваем SQL-функцию
 * company_inherited_rights() (миграция 148) — ту же, что использует RLS
 * (has_paid_section). Под сессией функция отвечает только о самом пользователе,
 * под service role — о любом. Ошибка / нет миграции → без наследования (закрыто).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  entitlementsFor,
  needsCompanyRights,
  normalizeOverrides,
  normalizeTier,
  parseCompanyRights,
  withCompanyRights,
  type CompanyRights,
  type Entitlements,
  type Feature,
} from './entitlements'
import { getSetting } from '@/lib/settings/store'

async function freeGriLimit(): Promise<number | undefined> {
  try {
    return await getSetting('gri_free_runs')
  } catch {
    return undefined
  }
}

/** Права, унаследованные от компаний пользователя; null — нет данных (ошибка, нет миграции 148). */
export async function readCompanyRights(sb: SupabaseClient, userId: string): Promise<CompanyRights | null> {
  try {
    if (typeof (sb as { rpc?: unknown }).rpc !== 'function') return null
    const { data, error } = await sb.rpc('company_inherited_rights', { p_user: userId })
    if (error) return null
    return parseCompanyRights(data)
  } catch {
    return null
  }
}

/** Собственные права (тариф + override) и сами override — без компании. */
export interface OwnEntitlements {
  ent: Entitlements
  overrides: Partial<Record<Feature, boolean>>
}

export async function readOwnEntitlements(sb: SupabaseClient, userId: string): Promise<OwnEntitlements> {
  try {
    const [{ data, error }, limit] = await Promise.all([
      sb.from('profiles').select('tier, feature_flags').eq('id', userId).maybeSingle(),
      freeGriLimit(),
    ])
    if (error) return { ent: entitlementsFor('free', undefined, limit), overrides: {} }
    const row = data as { tier?: unknown; feature_flags?: unknown } | null
    const overrides = normalizeOverrides(row?.feature_flags)
    return { ent: entitlementsFor(normalizeTier(row?.tier), overrides, limit), overrides }
  } catch {
    return { ent: entitlementsFor('free'), overrides: {} }
  }
}

/**
 * Права целиком: собственные + унаследованные от компании. Компанию спрашиваем,
 * только если собственный тариф что-то закрывает (не явный override). Решение
 * (lib/access/decision.ts) читает компанию лениво — только на пути отказа.
 */
export async function readEntitlements(
  sb: SupabaseClient,
  userId: string,
): Promise<Entitlements> {
  const { ent, overrides } = await readOwnEntitlements(sb, userId)
  if (!needsCompanyRights(ent, overrides)) return ent
  return withCompanyRights(ent, overrides, await readCompanyRights(sb, userId))
}
