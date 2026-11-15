/**
 * lib/access/gate.ts — серверный гейт платных фич для route-хендлеров.
 * Возвращает NextResponse(402) когда фича закрыта, иначе null (пропустить).
 *
 * Решение — одно на всю платформу: lib/access/decision.ts (тумблер access_gates,
 * тариф profiles.tier + override feature_flags, персонал). Тот же ответ видит
 * UI через GET /api/v1/access/me, а страницы — через components/access/FeatureGate.
 *
 * Тело ответа 402 одинаково для всех платных API — по нему клиентский код
 * показывает пейволл (components/access/paywall-model.ts → isUpgradeRequired):
 *   { ok: false, error: 'upgrade_required', feature, message }
 */

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveFeature } from './decision'
import type { Feature } from './entitlements'

export const UPGRADE_MESSAGES: Record<Feature, string> = {
  point_a: 'Точка А доступна на платном тарифе. Оставьте заявку на доступ — с вами свяжутся.',
  point_b: 'Точка Б доступна на платном тарифе вместе с полным GRI и Точкой А.',
  market: 'Раздел «Рынок» доступен на платном тарифе. Оставьте заявку на доступ — с вами свяжутся.',
  gri_full: 'Полный GRI доступен на платном тарифе. Бесплатно — экспресс-оценка в анкете и мини-GRI.',
  ai_chat: 'AI-чат по вашему отчёту доступен на тарифе Pro.',
  pdf_export: 'PDF-экспорт доступен на тарифе Pro.',
  benchmarks: 'Бенчмарки отрасли доступны на тарифе Pro.',
}

export interface GateOptions {
  /**
   * Персонал (эксперт, админ) тарифом не ограничивается: проверяется только на пути
   * отказа, чтобы не добавлять запрос в обычный проход. Для клиента «от имени» сессия
   * клиентская, поэтому гейт действует как для него.
   */
  exemptStaff?: boolean
}

/** Тело и статус ответа «нужен платный доступ» — одно для всех платных API. */
export function upgradeRequiredResponse(feature: Feature): NextResponse {
  return NextResponse.json(
    { ok: false, error: 'upgrade_required', feature, message: UPGRADE_MESSAGES[feature] ?? 'Функция доступна на платном тарифе.' },
    { status: 402 },
  )
}

export async function gateFeature(
  sb: SupabaseClient,
  userId: string,
  feature: Feature,
  opts: GateOptions = {},
): Promise<NextResponse | null> {
  const decision = await resolveFeature(sb, userId, feature, { exemptStaff: opts.exemptStaff })
  return decision.allowed ? null : upgradeRequiredResponse(feature)
}

/**
 * Гейт платного раздела (Точка А, Точка Б, Рынок, полный GRI): персонал всегда
 * проходит. Короткая форма для route-хендлеров:
 *   const upgrade = await gatePaidSection(sb, user.id, 'point_a'); if (upgrade) return upgrade
 */
export function gatePaidSection(
  sb: SupabaseClient,
  userId: string,
  feature: 'point_a' | 'point_b' | 'market' | 'gri_full',
): Promise<NextResponse | null> {
  return gateFeature(sb, userId, feature, { exemptStaff: true })
}
