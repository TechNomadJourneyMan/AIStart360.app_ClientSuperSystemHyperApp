/**
 * 🔔 Personal notification settings of a linked person (both bots): the level
 * from which Telegram messages arrive and a temporary mute. Platform-wide
 * rules (threshold, quiet hours, cooldown) stay in lib/notifications/levels.ts
 * and are shown read-only.
 *   staff   staff_telegram_links (087) — used by lib/notifications/staff.ts
 *   expert  telegram_bot_links bot='expert' (095) — used by expert/notify.ts
 */
import { prisma } from '@/lib/db'
import { LEVEL_ICONS, LEVEL_LABELS, routingConfig, type OrderedLevel } from '@/lib/notifications/levels'
import type { BotContext } from './dispatcher'
import { dt, esc } from './ui'

export type SettingsOwner = 'staff' | 'expert'
export const ORDERED: OrderedLevel[] = ['INFO', 'SUCCESS', 'WARNING', 'CRITICAL']
export const LEVEL_CODES: Record<string, OrderedLevel> = { i: 'INFO', s: 'SUCCESS', w: 'WARNING', c: 'CRITICAL' }
const CODE_OF: Record<OrderedLevel, string> = { INFO: 'i', SUCCESS: 's', WARNING: 'w', CRITICAL: 'c' }

export interface PersonalSettings { minLevel: OrderedLevel; mutedUntil: Date | null }

export async function readSettings(owner: SettingsOwner, userId: string): Promise<PersonalSettings | null> {
  const rows = owner === 'staff'
    ? await prisma.$queryRaw<Array<{ min_level: OrderedLevel; muted_until: Date | null }>>`
        SELECT min_level, muted_until FROM public.staff_telegram_links WHERE user_id = ${userId}::uuid AND linked_at IS NOT NULL`
    : await prisma.$queryRaw<Array<{ min_level: OrderedLevel; muted_until: Date | null }>>`
        SELECT min_level, muted_until FROM public.telegram_bot_links WHERE bot = 'expert' AND user_id = ${userId}::uuid AND linked_at IS NOT NULL`
  const r = rows[0]
  return r ? { minLevel: r.min_level, mutedUntil: r.muted_until } : null
}

export async function writeLevel(owner: SettingsOwner, userId: string, level: OrderedLevel): Promise<boolean> {
  const n = owner === 'staff'
    ? await prisma.$executeRaw`UPDATE public.staff_telegram_links SET min_level = ${level} WHERE user_id = ${userId}::uuid`
    : await prisma.$executeRaw`UPDATE public.telegram_bot_links SET min_level = ${level} WHERE bot = 'expert' AND user_id = ${userId}::uuid`
  return n > 0
}

export async function writeMute(owner: SettingsOwner, userId: string, until: Date | null): Promise<boolean> {
  const n = owner === 'staff'
    ? await prisma.$executeRaw`UPDATE public.staff_telegram_links SET muted_until = ${until} WHERE user_id = ${userId}::uuid`
    : await prisma.$executeRaw`UPDATE public.telegram_bot_links SET muted_until = ${until} WHERE bot = 'expert' AND user_id = ${userId}::uuid`
  return n > 0
}

export function renderSettings<P>(ctx: BotContext<P>, s: PersonalSettings, prefix: 'nt' | 'en', note: string) {
  const cfg = routingConfig()
  const muted = s.mutedUntil && s.mutedUntil > ctx.deps.now()
  const lines = [
    '🔔 <b>Уведомления</b>',
    `Мой уровень: ${LEVEL_ICONS[s.minLevel]} ${esc(LEVEL_LABELS[s.minLevel])} и выше`,
    muted ? `🔕 Без звука до ${dt(s.mutedUntil)} (критичное приходит всегда)` : '🔔 Звук включён',
    '',
    `Платформа: в Telegram — от уровня «${esc(LEVEL_LABELS[cfg.telegramMinLevel])}»; тихие часы ${cfg.quietHours ? `${cfg.quietHours.from}:00–${cfg.quietHours.to}:00 (${esc(cfg.timeZone)})` : 'выключены'} — ночью приходит только критичное.`,
    note,
  ]
  const kb = [
    ORDERED.map((l) => ctx.button(`${l === s.minLevel ? '• ' : ''}${LEVEL_ICONS[l]}`, `${prefix}.lv`, CODE_OF[l])),
    [ctx.button('🔕 1 ч', `${prefix}.mu`, 1), ctx.button('🔕 8 ч', `${prefix}.mu`, 8), ctx.button('🔕 24 ч', `${prefix}.mu`, 24)],
    muted ? [ctx.button('🔔 Включить звук', `${prefix}.mu`, 0)] : [],
  ]
  return { text: lines.join('\n'), kb }
}

export function muteUntil(now: Date, hours: number): Date | null {
  return hours > 0 ? new Date(now.getTime() + Math.min(hours, 72) * 3_600_000) : null
}
