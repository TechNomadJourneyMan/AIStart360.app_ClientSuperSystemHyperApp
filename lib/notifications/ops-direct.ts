/**
 * lib/notifications/ops-direct.ts — an alarm that does not need the database (R4-A1, N4A-2).
 *
 * notifyStaff (lib/notifications/staff.ts) first writes the event to notification_events and only
 * then delivers it, so when the database or the portal is down it says nothing at all. This module
 * is the other path: one Bot API call per chat, straight from the process, for the alarms that are
 * about the platform itself — the cron claims in workflow-db keep failing (lib/cron/runner.ts), the
 * portal or its database does not answer the agents service (lib/ops/crosswatch.ts), the watchdog
 * cannot read the database (lib/ops/job-watchdog.ts).
 *
 *   chats  TELEGRAM_ADMIN_CHAT_IDS (comma or space separated chat ids). Nothing else: linked staff
 *          live in the database, which is exactly what may be gone.
 *   bot    the admin bot (TELEGRAM_ADMIN_BOT_TOKEN) when its token is set, else the client bot
 *          (TELEGRAM_BOT_TOKEN) — the token only, no webhook secret is needed to send.
 *   time   every call is bounded by the Bot API helper (8 s, lib/telegram/bots/registry.ts callApi);
 *          it never throws.
 *
 * Without chats (the production state on 2026-11-16: the variable is not set and no staff member
 * has linked Telegram) nothing is sent: one console.error per process says so, and the watchdog
 * reports «тревогам некуда приходить» in the GIGA feed and the system card (alertRoutes below).
 *
 * Imports nothing that touches the database: it must work when everything else does not.
 */
import { callApi, botToken, type BotId } from '@/lib/telegram/bots/registry'
import { tgEscape } from '@/lib/telegram/bot-api'
import { LEVEL_ICONS, LEVEL_LABELS } from '@/lib/notifications/levels'

type Env = Partial<NodeJS.ProcessEnv>

export type OpsDirectLevel = 'CRITICAL' | 'WARNING' | 'SUCCESS'

export interface OpsDirectAlert {
  level: OpsDirectLevel
  title: string
  lines?: string[]
}

export interface OpsDirectResult {
  /** Chats that accepted the message. */
  sent: number
  /** Chats that refused it or could not be reached. */
  failed: number
  /** Why nothing was attempted. */
  skipped?: 'no_chats' | 'no_token'
}

/** TELEGRAM_ADMIN_CHAT_IDS as chat ids: integers, a group id may be negative; anything else is dropped. */
export function opsAlertChatIds(env: Env = process.env): string[] {
  return (env.TELEGRAM_ADMIN_CHAT_IDS ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^-?\d{1,20}$/.test(s))
}

/** The bot that carries the alarm: the admin bot when its token is set, else the client bot, else none. */
export function opsAlertBot(): BotId | null {
  if (botToken('admin')) return 'admin'
  if (botToken('client')) return 'client'
  return null
}

/** Can an alarm without the database reach anyone at all? (Shown in GIGA and checked by the watchdog.) */
export function opsDirectConfigured(env: Env = process.env): boolean {
  return opsAlertChatIds(env).length > 0 && opsAlertBot() !== null
}

export function formatOpsAlert(alert: OpsDirectAlert): string {
  const head = `${LEVEL_ICONS[alert.level]} <b>[AIStart360]</b> ${tgEscape(LEVEL_LABELS[alert.level])}`
  const body = [`<b>${tgEscape(alert.title)}</b>`, ...(alert.lines ?? []).map(tgEscape)]
  return `${head}\n\n${body.join('\n')}\n\n<i>Отправлено напрямую, без записи в базу.</i>`
}

// Once per process, on globalThis: Next compiles instrumentation.ts and the routes separately.
const WARNED_KEY = Symbol.for('aistart360.ops.direct.warned')
const flags = globalThis as Record<symbol, Set<string> | undefined>

function warnOnce(reason: string, line: string, log: (line: string) => void): void {
  const warned = (flags[WARNED_KEY] ??= new Set<string>())
  if (warned.has(reason)) return
  warned.add(reason)
  try {
    log(line)
  } catch {
    // a broken logger must not turn an alarm into an exception
  }
}

/**
 * Sends `alert` to every chat of TELEGRAM_ADMIN_CHAT_IDS, one after another. Never throws; a chat
 * that fails does not stop the others. The token never reaches a log line (callApi redacts it).
 */
export async function sendOpsDirect(
  alert: OpsDirectAlert,
  opts: { fetchImpl?: typeof fetch; env?: Env; logError?: (line: string) => void } = {},
): Promise<OpsDirectResult> {
  const logError = opts.logError ?? ((line: string) => console.error(line))
  const chats = opsAlertChatIds(opts.env ?? process.env)
  if (chats.length === 0) {
    warnOnce('no_chats', 'ops: TELEGRAM_ADMIN_CHAT_IDS не задан — тревоги без базы (cron, перекрёстный сторож) некуда отправить, они есть только в логе', logError)
    return { sent: 0, failed: 0, skipped: 'no_chats' }
  }
  const bot = opsAlertBot()
  if (!bot) {
    warnOnce('no_token', 'ops: нет токена Telegram-бота (TELEGRAM_ADMIN_BOT_TOKEN / TELEGRAM_BOT_TOKEN) — тревоги без базы некуда отправить', logError)
    return { sent: 0, failed: 0, skipped: 'no_token' }
  }
  const text = formatOpsAlert(alert)
  let sent = 0
  let failed = 0
  for (const chat of chats) {
    const res = await callApi<{ message_id: number }>(bot, 'sendMessage', {
      chat_id: chat,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }, opts.fetchImpl)
    if (res.ok) {
      sent += 1
    } else {
      failed += 1
      try {
        logError(`ops: тревога в Telegram не доставлена (чат ${chat}): ${res.description}`)
      } catch {
        // ignore
      }
    }
  }
  return { sent, failed }
}
