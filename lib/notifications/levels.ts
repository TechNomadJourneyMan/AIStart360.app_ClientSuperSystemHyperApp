/**
 * Staff notification levels and routing rules (docs/platform/07-admin-control-center.md).
 *
 *   INFO < SUCCESS < WARNING < CRITICAL      — ordered; a channel takes events at or above its threshold
 *   APPROVAL_REQUIRED                         — routed to approvers only, never muted
 *
 * Defaults keep Telegram for things that need a human: WARNING and above,
 * plus approvals. Quiet hours hold back non-critical Telegram messages at
 * night (they stay in the admin feed). Overrides by env:
 *   NOTIFY_TELEGRAM_MIN_LEVEL, NOTIFY_EMAIL_MIN_LEVEL (INFO|SUCCESS|WARNING|CRITICAL),
 *   NOTIFY_QUIET_HOURS="23-8" (empty = off), NOTIFY_TIMEZONE="Asia/Almaty".
 */

export const LEVELS = ['INFO', 'SUCCESS', 'WARNING', 'CRITICAL', 'APPROVAL_REQUIRED'] as const
export type NotificationLevel = (typeof LEVELS)[number]
export type OrderedLevel = Exclude<NotificationLevel, 'APPROVAL_REQUIRED'>

const ORDER: Record<OrderedLevel, number> = { INFO: 0, SUCCESS: 1, WARNING: 2, CRITICAL: 3 }

export const LEVEL_LABELS: Record<NotificationLevel, string> = {
  INFO: 'Информация',
  SUCCESS: 'Готово',
  WARNING: 'Внимание',
  CRITICAL: 'Критично',
  APPROVAL_REQUIRED: 'Нужно одобрение',
}

export const LEVEL_ICONS: Record<NotificationLevel, string> = {
  INFO: 'ℹ️',
  SUCCESS: '✅',
  WARNING: '⚠️',
  CRITICAL: '🚨',
  APPROVAL_REQUIRED: '🟡',
}

export function isLevel(v: unknown): v is NotificationLevel {
  return typeof v === 'string' && (LEVELS as readonly string[]).includes(v)
}

function envLevel(name: string, fallback: OrderedLevel): OrderedLevel {
  const v = process.env[name]?.trim().toUpperCase()
  return v && v in ORDER ? (v as OrderedLevel) : fallback
}

export interface RoutingConfig {
  telegramMinLevel: OrderedLevel
  emailMinLevel: OrderedLevel
  quietHours: { from: number; to: number } | null
  timeZone: string
}

export function routingConfig(): RoutingConfig {
  const raw = process.env.NOTIFY_QUIET_HOURS ?? '23-8'
  const m = raw.trim().match(/^(\d{1,2})-(\d{1,2})$/)
  const quiet = m && Number(m[1]) <= 23 && Number(m[2]) <= 23 ? { from: Number(m[1]), to: Number(m[2]) } : null
  return {
    telegramMinLevel: envLevel('NOTIFY_TELEGRAM_MIN_LEVEL', 'WARNING'),
    emailMinLevel: envLevel('NOTIFY_EMAIL_MIN_LEVEL', 'CRITICAL'),
    quietHours: quiet,
    timeZone: process.env.NOTIFY_TIMEZONE?.trim() || 'Asia/Almaty',
  }
}

/** Does `level` reach a channel whose threshold is `min`? Approvals always do. */
export function reaches(level: NotificationLevel, min: OrderedLevel): boolean {
  if (level === 'APPROVAL_REQUIRED') return true
  return ORDER[level] >= ORDER[min]
}

function hourIn(tz: string, at: Date): number {
  const h = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(at)
  return Number(h)
}

/** Night hours hold back everything except CRITICAL and approvals. */
export function inQuietHours(level: NotificationLevel, cfg: RoutingConfig, at = new Date()): boolean {
  if (!cfg.quietHours || level === 'CRITICAL' || level === 'APPROVAL_REQUIRED') return false
  const h = hourIn(cfg.timeZone, at)
  const { from, to } = cfg.quietHours
  return from > to ? h >= from || h < to : h >= from && h < to
}
