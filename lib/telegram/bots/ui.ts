/** Formatting helpers for bot messages (Telegram HTML parse mode, Russian copy). */
import type { BotContext } from './dispatcher'
import type { InlineButton } from './registry'

export function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function cut(value: unknown, max = 80): string {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export function usd(v: unknown): string {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return '$0'
  return n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`
}

const TZ = () => process.env.NOTIFY_TIMEZONE?.trim() || 'Asia/Almaty'

export function dt(v: unknown): string {
  if (!v) return '—'
  const d = new Date(v as string)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', { timeZone: TZ(), day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)
}

export function pct(v: unknown): string {
  const n = Number(v)
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—'
}

export const PAGE_SIZE = 8

/** « ‹ » navigation row for a list rendered with `action` and a page number as the LAST arg. */
export function pagerRow<P>(ctx: BotContext<P>, action: string, page: number, hasMore: boolean, ...args: string[]): Array<InlineButton | null> {
  const row: Array<InlineButton | null> = []
  if (page > 0) row.push(ctx.button('‹ Назад', action, ...args, page - 1))
  if (hasMore) row.push(ctx.button('Вперёд ›', action, ...args, page + 1))
  return row
}

export function pageOf(arg: string | undefined): number {
  const n = Number(arg ?? 0)
  return Number.isInteger(n) && n >= 0 && n < 1000 ? n : 0
}

/** Mask a free-text echo that might contain a secret (never echo user input verbatim). */
export function maskHint(hint: string | null | undefined): string {
  if (!hint) return '••••'
  return hint.length > 12 ? `${hint.slice(0, 4)}…${hint.slice(-4)}` : hint
}
