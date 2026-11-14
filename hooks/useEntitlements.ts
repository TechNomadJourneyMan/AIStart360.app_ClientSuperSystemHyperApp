'use client'

/**
 * hooks/useEntitlements.ts — клиентский снимок прав доступа (Фаза 6).
 * GET /api/v1/access/me через общий ключ react-query: сайдбар и экран GRI,
 * смонтированные вместе, делают один запрос (раньше — по запросу на каждый).
 * Пока грузится или гейты выключены — везде «разрешено» (сервер всё равно
 * энфорсит платные роуты сам).
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
  griRunsUsed: 0,
  canRunFullGri: true,
}

export const ACCESS_ME_KEY = ['access-me'] as const

/**
 * R-030: platform sections the old menus (Sidebar, MobileNav) mark «Pro» for a
 * client. The key is the section root; deeper paths belong to it.
 */
export const PREMIUM_SECTIONS = ['/metrics', '/market', '/point-b'] as const
export type PremiumSection = (typeof PREMIUM_SECTIONS)[number]

/** The «Pro» section an href belongs to, or null. */
export function premiumSectionOf(href: string): PremiumSection | null {
  return PREMIUM_SECTIONS.find((p) => href === p || href.startsWith(p + '/')) ?? null
}

/**
 * R-030: is the section behind a lock for this viewer?
 * - only a client is ever locked (staff see everything);
 * - gates off (access_gates, the fail-safe default) or still loading (OPEN) → nothing is locked;
 * - gates on → the real right: Точка Б by the `point_b` entitlement (the server
 *   enforces exactly that); Метрики / Рынок have no entitlement of their own and
 *   no server gate, so they follow the account tier (Pro) as before.
 */
export function isSectionLocked(href: string, role: string | null | undefined, access: AccessMe): boolean {
  if (role !== 'client' || !access.gatesEnabled) return false
  const section = premiumSectionOf(href)
  if (!section) return false
  if (section === '/point-b') return !access.point_b
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
    point_b: Boolean(j.entitlements?.point_b),
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
