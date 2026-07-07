/**
 * lib/assistant/escalation/format.ts — shared helpers for the DEDICATED expert
 * escalation channels (telegram / email / whatsapp adapters).
 *
 * Keeps the three adapters DRY: parsing comma-separated recipient lists, reading
 * the explicit on/off override env flag, building the experts dashboard URL, and
 * composing the Russian message text from an {@link ExpertCase}. Pure functions —
 * no I/O, never throws.
 */

import type { ExpertCase } from '../types'
import { getSiteUrl } from '@/lib/site-url'

/** Truthy env values used by the explicit on-overrides (mirrors notifications). */
const TRUTHY = new Set(['1', 'true', 'on', 'yes'])
/** Falsy env values used by the explicit off-switches. */
const FALSY = new Set(['0', 'false', 'off', 'no'])

/**
 * Parse a comma-separated env list into trimmed, non-empty entries.
 * Tries each var name in order and returns the first one that yields entries.
 */
export function parseList(...rawValues: Array<string | undefined>): string[] {
  for (const raw of rawValues) {
    if (!raw) continue
    const items = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (items.length > 0) return items
  }
  return []
}

/** First non-empty, trimmed value among the candidates (recipient fallbacks). */
export function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    const t = v?.trim()
    if (t) return t
  }
  return undefined
}

/**
 * Resolve an "auto-on once creds exist" flag. Returns `credsReady` UNLESS the
 * explicit override env var is set: '1'|'true'|'on'|'yes' forces enabled,
 * '0'|'false'|'off'|'no' forces disabled. Any other value falls back to creds.
 */
export function resolveEnabled(overrideRaw: string | undefined, credsReady: boolean): boolean {
  const v = (overrideRaw ?? '').toLowerCase().trim()
  if (FALSY.has(v)) return false
  if (TRUTHY.has(v)) return true
  return credsReady
}

/** The experts dashboard URL (AUTH_URL base + /expert/dashboard). */
export function expertDashboardUrl(): string {
  return getSiteUrl('/expert/dashboard')
}

/** Russian label for the case company (name from summary is already embedded). */
function companyLine(c: ExpertCase): string {
  return c.companyId ? `Компания (id): ${c.companyId}` : 'Компания: не указана'
}

/** Trim a client message for inclusion in a notification body. */
function clipMessage(msg: string | undefined, max = 500): string {
  if (!msg) return ''
  const t = msg.trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/**
 * Build the plain-text Russian body shared by Telegram and WhatsApp. Repeats
 * only values already on the case (no invented numbers) and appends the experts
 * dashboard link.
 */
export function buildExpertPlainText(c: ExpertCase): string {
  const lines: string[] = [
    '🆘 Новое обращение к эксперту',
    '',
    `Тема: ${c.title}`,
    `Приоритет: ${c.priority}`,
    companyLine(c),
  ]
  if (c.summary?.trim()) lines.push('', `Сводка: ${c.summary.trim()}`)
  const msg = clipMessage(c.userMessage)
  if (msg) lines.push('', `Сообщение клиента: «${msg}»`)
  lines.push('', `Открыть портал эксперта: ${expertDashboardUrl()}`)
  return lines.join('\n')
}

/**
 * Build a Russian HTML body for the email channel (matches the dark themed
 * sendNotificationEmail wrapper — caller passes title/body/CTA separately, this
 * returns the inner body HTML).
 */
export function buildExpertEmailBody(c: ExpertCase): string {
  const parts: string[] = [
    `<p style="margin:0 0 8px"><b>Тема:</b> ${escapeHtml(c.title)}</p>`,
    `<p style="margin:0 0 8px"><b>Приоритет:</b> ${escapeHtml(c.priority)}</p>`,
    `<p style="margin:0 0 8px"><b>${escapeHtml(c.companyId ? `Компания (id): ${c.companyId}` : 'Компания: не указана')}</b></p>`,
  ]
  if (c.summary?.trim()) {
    parts.push(`<p style="margin:0 0 8px"><b>Сводка:</b> ${escapeHtml(c.summary.trim())}</p>`)
  }
  const msg = clipMessage(c.userMessage)
  if (msg) {
    parts.push(`<p style="margin:0 0 8px"><b>Сообщение клиента:</b><br>«${escapeHtml(msg)}»</p>`)
  }
  return parts.join('')
}

/** Minimal HTML escaper for user-supplied strings in the email body. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
