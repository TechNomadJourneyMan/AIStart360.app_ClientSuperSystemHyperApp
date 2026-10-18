/**
 * lib/access/gate.ts — серверный гейт платных фич для route-хендлеров (Фаза 6).
 * Возвращает NextResponse(402) когда фича закрыта, иначе null (пропустить).
 * Уважает системный тумблер access_gates (default OFF — fail-safe).
 */

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAccessGatesEnabled } from '@/lib/settings/system-settings'
import { getSessionRole, isStaffRole } from '@/lib/api-identity'
import { readEntitlements } from './server'
import { can, type Feature } from './entitlements'

const MESSAGES: Record<string, string> = {
  ai_chat: 'AI-чат по вашему отчёту доступен на тарифе Pro.',
  pdf_export: 'PDF-экспорт доступен на тарифе Pro.',
  benchmarks: 'Бенчмарки отрасли доступны на тарифе Pro.',
  point_b: 'Точка Б доступна на тарифе Pro вместе с полным GRI и Точкой А.',
}

export interface GateOptions {
  /**
   * Персонал (эксперт, админ) тарифом не ограничивается: проверяется только на пути
   * отказа, чтобы не добавлять запрос в обычный проход. Для клиента «от имени» сессия
   * клиентская, поэтому роль — client и гейт действует как для него.
   */
  exemptStaff?: boolean
}

export async function gateFeature(
  sb: SupabaseClient,
  userId: string,
  feature: Exclude<Feature, 'gri_full'>,
  opts: GateOptions = {},
): Promise<NextResponse | null> {
  if (!(await getAccessGatesEnabled())) return null
  const ent = await readEntitlements(sb, userId)
  if (can(ent, feature)) return null
  if (opts.exemptStaff) {
    try {
      if (isStaffRole(await getSessionRole(sb, userId))) return null
    } catch {
      /* роль не прочитана — гейт остаётся закрытым */
    }
  }
  return NextResponse.json(
    {
      ok: false,
      error: 'upgrade_required',
      feature,
      message: MESSAGES[feature] ?? 'Функция доступна на тарифе Pro.',
    },
    { status: 402 },
  )
}
