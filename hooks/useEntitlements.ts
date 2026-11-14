'use client'

/**
 * hooks/useEntitlements.ts — клиентский снимок прав доступа.
 * GET /api/v1/access/me через общий ключ react-query: сайдбар и экран GRI,
 * смонтированные вместе, делают один запрос (раньше — по запросу на каждый).
 * Решение принимает сервер (lib/access/decision.ts) — здесь только его ответ:
 * `point_a / point_b / market / gri_full` = открыт ли платный раздел (с учётом
 * тумблера, тарифа, override и персонала). Пока грузится или гейты выключены —
 * везде «разрешено» (сервер всё равно энфорсит платные роуты сам: 402).
 */

import { useQuery } from '@tanstack/react-query'
import { SHARED_STALE_MS } from '@/hooks/useOnboardingStatus'

export interface AccessMe {
  gatesEnabled: boolean
  tier: 'free' | 'pro'
  pdf_export: boolean
  ai_chat: boolean
  benchmarks: boolean
  point_b: boolean
  /** Точка А (полная страница). */
  point_a: boolean
  /** Рынок. */
  market: boolean
  /** Полный GRI (страница /gri и проходы). */
  gri_full: boolean
  /** Персонал этой сессии (тарифом не ограничивается). */
  staff: boolean
  griRunsUsed: number
  canRunFullGri: boolean
}

const OPEN: AccessMe = {
  gatesEnabled: false,
  tier: 'free',
  pdf_export: true,
  ai_chat: true,
  benchmarks: true,
  point_b: true,
  point_a: true,
  market: true,
  gri_full: true,
  staff: false,
  griRunsUsed: 0,
  canRunFullGri: true,
}

export const ACCESS_ME_KEY = ['access-me'] as const

/**
 * R-030: platform sections the old menus (Sidebar, MobileNav) mark «Pro» for a
 * client. The key is the section root; deeper paths belong to it.
 * Round 2: Точка А, Точка Б, Рынок и полный GRI — платные разделы (решение
 * фаундера); Метрики — как раньше, по тарифу (своего права и серверного гейта нет).
 */
export const PREMIUM_SECTIONS = ['/metrics', '/market', '/point-a', '/point-b', '/gri'] as const
export type PremiumSection = (typeof PREMIUM_SECTIONS)[number]

/** The «Pro» section an href belongs to, or null. */
export function premiumSectionOf(href: string): PremiumSection | null {
  return PREMIUM_SECTIONS.find((p) => href === p || href.startsWith(p + '/')) ?? null
}

/**
 * R-030: is the section behind a lock for this viewer?
 * - only a client is ever locked (staff see everything);
 * - gates off (access_gates, the fail-safe default) or still loading (OPEN) → nothing is locked;
 * - gates on → the server's decision for the paid sections (the API answers 402
 *   by exactly the same rule): Точка А / Б, Рынок, полный GRI. Метрики have no
 *   right of their own and no server gate, so they follow the account tier as before.
 */
export function isSectionLocked(href: string, role: string | null | undefined, access: AccessMe): boolean {
  if (role !== 'client' || !access.gatesEnabled || access.staff) return false
  const section = premiumSectionOf(href)
  if (!section) return false
  if (section === '/point-b') return !access.point_b
  if (section === '/point-a') return !access.point_a
  if (section === '/market') return !access.market
  if (section === '/gri') return !access.gri_full
  return access.tier !== 'pro'
}

/** Снимок прав или OPEN (гейты выключены / ответ не ok). Ошибка сети — исключение. */
async function fetchAccessMe(): Promise<AccessMe> {
  const r = await fetch('/api/v1/access/me', { credentials: 'include' })
  const j = await r.json()
  if (!j?.ok || !j.gatesEnabled) return OPEN // гейты выключены — «всё открыто»
  return {
    gatesEnabled: true,
    tier: j.entitlements?.tier === 'pro' ? 'pro' : 'free',
    pdf_export: Boolean(j.entitlements?.pdf_export),
    ai_chat: Boolean(j.entitlements?.ai_chat),
    benchmarks: Boolean(j.entitlements?.benchmarks),
    // The server's decision (switch, rights, staff); an older server only sent the right.
    point_b: Boolean(j.sections ? j.sections.point_b : j.entitlements?.point_b),
    // An older server without the section answers (rolling deploy) — keep them open; the API still gates.
    point_a: j.sections ? Boolean(j.sections.point_a) : true,
    market: j.sections ? Boolean(j.sections.market) : true,
    gri_full: j.sections ? Boolean(j.sections.gri_full) : true,
    staff: Boolean(j.staff),
    griRunsUsed: Number(j.griRunsUsed ?? 0),
    canRunFullGri: Boolean(j.canRunFullGri),
  }
}

export function useEntitlements(): { access: AccessMe; loading: boolean } {
  const q = useQuery({
    queryKey: ACCESS_ME_KEY,
    queryFn: fetchAccessMe,
    staleTime: SHARED_STALE_MS,
    retry: false,
    refetchOnWindowFocus: false,
  })
  // Сеть упала → открытое состояние; сервер защитит сам.
  return { access: q.data ?? OPEN, loading: q.isPending }
}
