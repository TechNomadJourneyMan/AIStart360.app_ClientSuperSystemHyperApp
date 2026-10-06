/**
 * Pure checks behind scripts/telegram/go-live-check.ts: is everything in
 * place for the admin and expert bots to start working? Each check returns a
 * line with a status and, when something is missing, what to do. Nothing here
 * prints or returns a token or a secret — only env variable names.
 */
import { botEnvNames, type BotId } from './registry'

export type CheckStatus = 'ok' | 'fail' | 'warn' | 'skip'
export interface Check {
  status: CheckStatus
  name: string
  detail: string
  /** What the owner has to do when status is fail/warn. */
  fix?: string
}

export const GO_LIVE_BOTS: BotId[] = ['admin', 'expert']
export const WEBHOOK_PATHS: Record<BotId, string> = {
  client: '/api/telegram/webhook',
  admin: '/api/telegram/admin',
  expert: '/api/telegram/expert',
}
/** Telegram accepts 1–256 characters [A-Za-z0-9_-]; we require ≥ 32 for entropy. */
export const MIN_WEBHOOK_SECRET = 32
export const OWNER_EMAIL = 'technomadjourneyman@gmail.com'

type Env = Record<string, string | undefined>
const val = (env: Env, name: string) => env[name]?.trim() || ''

/** Same decoding rule as lib/crypto/secrets.ts: 64 hex chars or base64 → exactly 32 bytes. */
export function encryptionKeyValid(raw: string): boolean {
  if (!raw) return false
  const k = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  return k.length === 32
}

export function checkBotEnv(bot: BotId, env: Env): Check[] {
  const names = botEnvNames(bot)
  const out: Check[] = []
  const token = val(env, names.token)
  out.push(
    !token
      ? { status: 'fail', name: `${bot}: ${names.token}`, detail: 'не задан', fix: `Vercel → Settings → Environment Variables: ${names.token} = токен от @BotFather` }
      : /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)
        ? { status: 'ok', name: `${bot}: ${names.token}`, detail: 'задан' }
        : { status: 'fail', name: `${bot}: ${names.token}`, detail: 'не похож на токен бота (<id>:<ключ>)', fix: 'Скопируйте токен из @BotFather целиком, без пробелов и кавычек' },
  )
  const username = val(env, names.username).replace(/^@/, '')
  out.push(
    username
      ? { status: 'ok', name: `${bot}: ${names.username}`, detail: `@${username}` }
      : { status: 'fail', name: `${bot}: ${names.username}`, detail: 'не задан — ссылки привязки t.me не строятся', fix: `${names.username} = имя бота без @` },
  )
  const secret = val(env, names.secret)
  out.push(
    !secret
      ? { status: 'fail', name: `${bot}: ${names.secret}`, detail: 'не задан — вебхук отвечает 503', fix: `${names.secret} = случайная строка: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` }
      : !/^[A-Za-z0-9_-]{1,256}$/.test(secret)
        ? { status: 'fail', name: `${bot}: ${names.secret}`, detail: 'Telegram принимает только A-Z a-z 0-9 _ - (до 256 символов)', fix: 'Сгенерируйте hex-строку командой выше' }
        : secret.length < MIN_WEBHOOK_SECRET
          ? { status: 'warn', name: `${bot}: ${names.secret}`, detail: `короче ${MIN_WEBHOOK_SECRET} символов`, fix: 'Используйте не меньше 32 случайных символов' }
          : { status: 'ok', name: `${bot}: ${names.secret}`, detail: `задан (${secret.length} симв.)` },
  )
  return out
}

export function checkPlatformEnv(env: Env): Check[] {
  const out: Check[] = []
  const key = val(env, 'SECRETS_ENCRYPTION_KEY')
  out.push(
    !key
      ? { status: 'fail', name: 'SECRETS_ENCRYPTION_KEY', detail: 'не задан — бот не сможет сохранять ключи провайдеров и токены', fix: 'SECRETS_ENCRYPTION_KEY = node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" (не меняйте после сохранения ключей)' }
      : encryptionKeyValid(key)
        ? { status: 'ok', name: 'SECRETS_ENCRYPTION_KEY', detail: '32 байта' }
        : { status: 'fail', name: 'SECRETS_ENCRYPTION_KEY', detail: 'не декодируется в 32 байта (нужно 64 hex или base64)', fix: 'Сгенерируйте заново командой выше' },
  )
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    out.push(val(env, name)
      ? { status: 'ok', name, detail: 'задан' }
      : { status: 'fail', name, detail: 'не задан — бот не читает и не пишет данные', fix: `${name} из Supabase → Project Settings → API` })
  }
  return out
}

/**
 * A POST with a wrong secret to the bot webhook. The app answers JSON
 * {"ok":false} with 401 (secret checked) or 503 (bot env missing); anything
 * else — typically an HTML 401/403 page — comes from Vercel Deployment
 * Protection or a wrong domain, and Telegram's updates would never arrive.
 */
export function classifyWebhookProbe(bot: BotId, url: string, status: number, contentType: string, body: string): Check {
  const name = `${bot}: вебхук ${url}`
  let json: unknown = null
  if (/application\/json/i.test(contentType)) {
    try { json = JSON.parse(body) } catch { json = null }
  }
  const fromApp = !!json && typeof json === 'object' && (json as { ok?: unknown }).ok === false
  if (status === 401 && fromApp) return { status: 'ok', name, detail: 'отвечает приложение, неверный секрет отклонён (401)' }
  if (status === 503 && fromApp) {
    const n = botEnvNames(bot)
    return { status: 'fail', name, detail: 'приложение отвечает 503 — на деплое нет токена или секрета бота', fix: `Задайте ${n.token} и ${n.secret} в окружении этого деплоя и передеплойте` }
  }
  if (status === 401 || status === 403) {
    return { status: 'fail', name, detail: `HTTP ${status} не от приложения — похоже на Vercel Deployment Protection`, fix: 'Vercel → Settings → Deployment Protection: выключите для этого окружения или используйте прод-домен' }
  }
  if (status === 404) return { status: 'fail', name, detail: 'HTTP 404 — на этом деплое нет маршрута бота', fix: 'Задеплойте ветку с ботами и проверьте домен' }
  if (status === 0) return { status: 'fail', name, detail: 'домен недоступен', fix: 'Проверьте адрес деплоя и сеть' }
  return { status: 'warn', name, detail: `неожиданный ответ HTTP ${status}` }
}

export interface WebhookInfo {
  url?: string
  pending_update_count?: number
  last_error_message?: string
  last_error_date?: number
}

export function classifyWebhookInfo(bot: BotId, expectedUrl: string | null, info: WebhookInfo): Check {
  const name = `${bot}: getWebhookInfo`
  const pending = info.pending_update_count ?? 0
  const lastError = info.last_error_message
    ? ` последняя ошибка: «${info.last_error_message}» (${new Date((info.last_error_date ?? 0) * 1000).toISOString()})`
    : ''
  if (!info.url) {
    return { status: 'fail', name, detail: 'вебхук не установлен', fix: 'npx tsx scripts/telegram/set-webhooks.ts https://<домен>' }
  }
  if (expectedUrl && info.url !== expectedUrl) {
    return { status: 'fail', name, detail: `вебхук указывает на ${info.url}, ожидается ${expectedUrl}`, fix: `npx tsx scripts/telegram/set-webhooks.ts ${expectedUrl.replace(/\/api\/telegram\/.*$/, '')}` }
  }
  if (lastError && (info.last_error_date ?? 0) * 1000 > Date.now() - 24 * 3600_000) {
    return { status: 'warn', name, detail: `${info.url}, в очереди ${pending};${lastError}`, fix: 'Проверьте Deployment Protection и логи функции /api/telegram/*' }
  }
  return { status: 'ok', name, detail: `${info.url}, в очереди ${pending}${lastError}` }
}

/** Migration files from 083 on (the ones the bots and the agents runtime depend on). */
export function requiredMigrations(files: string[]): string[] {
  return files.filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) >= 83).sort()
}

export function checkMigrations(required: string[], applied: Set<string>): Check {
  const missing = required.filter((f) => !applied.has(f))
  return missing.length === 0
    ? { status: 'ok', name: 'миграции', detail: `применены ${required.length} (${required[0] ?? '—'} … ${required[required.length - 1] ?? '—'})` }
    : { status: 'fail', name: 'миграции', detail: `не применены: ${missing.join(', ')}`, fix: 'По одной, по порядку: node scripts/apply-migration.js supabase/migrations/<файл>' }
}

export function summarize(checks: Check[]): { ok: boolean; failed: number; warned: number } {
  const failed = checks.filter((c) => c.status === 'fail').length
  const warned = checks.filter((c) => c.status === 'warn').length
  return { ok: failed === 0, failed, warned }
}

export function formatCheck(c: Check): string {
  const mark = { ok: '✓', fail: '✗', warn: '!', skip: '—' }[c.status]
  return `${mark} ${c.name}: ${c.detail}${c.fix && c.status !== 'ok' ? `\n    → ${c.fix}` : ''}`
}
