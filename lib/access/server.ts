/**
 * lib/access/server.ts — серверное чтение прав доступа пользователя (Фаза 6).
 *
 * Читает profiles.tier + feature_flags под переданным клиентом (сессия — RLS own,
 * или service — для админ-контекста). Устойчиво к неприменённой миграции 048:
 * при отсутствии колонок возвращает free-права (безопасный дефолт, ничего не
 * гейтит сверх текущего поведения, пока энфорсмент не включён в роутах).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  entitlementsFor,
  normalizeOverrides,
  normalizeTier,
  type Entitlements,
} from './entitlements'

export async function readEntitlements(
  sb: SupabaseClient,
  userId: string,
): Promise<Entitlements> {
  try {
    const { data, error } = await sb
      .from('profiles')
      .select('tier, feature_flags')
      .eq('id', userId)
      .maybeSingle()
    if (error) return entitlementsFor('free')
    const row = data as { tier?: unknown; feature_flags?: unknown } | null
    return entitlementsFor(normalizeTier(row?.tier), normalizeOverrides(row?.feature_flags))
  } catch {
    return entitlementsFor('free')
  }
}
