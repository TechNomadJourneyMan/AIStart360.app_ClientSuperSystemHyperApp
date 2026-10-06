/**
 * Bot go-live checks (scripts/telegram/go-live-check.ts): each missing piece
 * fails with what to do, Deployment Protection is told apart from the app's
 * own 401, and no check ever echoes a token or secret value.
 */
import { describe, expect, it } from 'vitest'
import {
  checkBotEnv, checkMigrations, checkPlatformEnv, classifyWebhookInfo, classifyWebhookProbe,
  encryptionKeyValid, requiredMigrations, summarize,
} from '@/lib/telegram/bots/go-live'

const TOKEN = '1234567890:AAH' + 'x'.repeat(32)
const SECRET = 'a'.repeat(64)
const ADMIN_ENV = {
  TELEGRAM_ADMIN_BOT_TOKEN: TOKEN,
  TELEGRAM_ADMIN_BOT_USERNAME: '@Command_panel_aistart360_bot',
  TELEGRAM_ADMIN_WEBHOOK_SECRET: SECRET,
}

describe('checkBotEnv', () => {
  it('a complete admin env passes and never echoes the token or secret', () => {
    const checks = checkBotEnv('admin', ADMIN_ENV)
    expect(checks.map((c) => c.status)).toEqual(['ok', 'ok', 'ok'])
    const text = JSON.stringify(checks)
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain(SECRET)
    expect(text).toContain('@Command_panel_aistart360_bot')
  })

  it('missing values fail with the env name to set', () => {
    const checks = checkBotEnv('expert', {})
    expect(checks.every((c) => c.status === 'fail')).toBe(true)
    const fixes = checks.map((c) => c.fix).join(' ')
    for (const name of ['TELEGRAM_EXPERT_BOT_TOKEN', 'TELEGRAM_EXPERT_BOT_USERNAME', 'TELEGRAM_EXPERT_WEBHOOK_SECRET']) expect(fixes).toContain(name)
  })

  it('a malformed token, a short secret and a secret Telegram rejects are reported', () => {
    const [token, , secret] = checkBotEnv('admin', { ...ADMIN_ENV, TELEGRAM_ADMIN_BOT_TOKEN: 'not-a-token', TELEGRAM_ADMIN_WEBHOOK_SECRET: 'short' })
    expect(token.status).toBe('fail')
    expect(secret.status).toBe('warn')
    expect(checkBotEnv('admin', { ...ADMIN_ENV, TELEGRAM_ADMIN_WEBHOOK_SECRET: 'has spaces and !' })[2].status).toBe('fail')
  })
})

describe('checkPlatformEnv', () => {
  it('accepts 64 hex or base64 of 32 bytes and rejects other lengths', () => {
    expect(encryptionKeyValid('ab'.repeat(32))).toBe(true)
    expect(encryptionKeyValid(Buffer.alloc(32, 7).toString('base64'))).toBe(true)
    expect(encryptionKeyValid('ab'.repeat(16))).toBe(false)
    expect(encryptionKeyValid('')).toBe(false)
  })

  it('flags the missing encryption key and Supabase env', () => {
    const checks = checkPlatformEnv({})
    expect(checks.map((c) => [c.name, c.status])).toEqual([
      ['SECRETS_ENCRYPTION_KEY', 'fail'],
      ['NEXT_PUBLIC_SUPABASE_URL', 'fail'],
      ['SUPABASE_SERVICE_ROLE_KEY', 'fail'],
    ])
  })
})

describe('classifyWebhookProbe', () => {
  const url = 'https://app.example.com/api/telegram/admin'
  it('JSON 401 from the app is the healthy answer to a wrong secret', () => {
    expect(classifyWebhookProbe('admin', url, 401, 'application/json', '{"ok":false}').status).toBe('ok')
  })
  it('HTML 401 is Deployment Protection, not the app', () => {
    const c = classifyWebhookProbe('admin', url, 401, 'text/html; charset=utf-8', '<!doctype html><title>Authentication Required</title>')
    expect(c.status).toBe('fail')
    expect(c.fix).toMatch(/Deployment Protection/)
  })
  it('JSON 503 means the bot env is missing on that deployment', () => {
    const c = classifyWebhookProbe('admin', url, 503, 'application/json', '{"ok":false}')
    expect(c.status).toBe('fail')
    expect(c.fix).toMatch(/TELEGRAM_ADMIN_BOT_TOKEN/)
  })
  it('404 and an unreachable host fail', () => {
    expect(classifyWebhookProbe('admin', url, 404, 'text/html', '').status).toBe('fail')
    expect(classifyWebhookProbe('admin', url, 0, '', '').status).toBe('fail')
  })
})

describe('classifyWebhookInfo', () => {
  const expected = 'https://app.example.com/api/telegram/admin'
  it('no webhook or a webhook elsewhere fails with the set-webhooks command', () => {
    expect(classifyWebhookInfo('admin', expected, {}).fix).toMatch(/set-webhooks/)
    const other = classifyWebhookInfo('admin', expected, { url: 'https://old.example.com/api/telegram/admin' })
    expect(other.status).toBe('fail')
    expect(other.fix).toContain('https://app.example.com')
  })
  it('a recent delivery error is a warning, an old one is reported but ok', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(classifyWebhookInfo('admin', expected, { url: expected, last_error_message: 'Wrong response from the webhook: 401', last_error_date: now - 60 }).status).toBe('warn')
    expect(classifyWebhookInfo('admin', expected, { url: expected, last_error_message: 'x', last_error_date: now - 3 * 86400 }).status).toBe('ok')
  })
})

describe('migrations and summary', () => {
  it('requires every file from 083 on and names the missing ones', () => {
    const req = requiredMigrations(['082_a.sql', '083_b.sql', '095_c.sql', 'README.md', '100_d.sql'])
    expect(req).toEqual(['083_b.sql', '095_c.sql', '100_d.sql'])
    const c = checkMigrations(req, new Set(['083_b.sql']))
    expect(c.status).toBe('fail')
    expect(c.detail).toContain('095_c.sql, 100_d.sql')
    expect(checkMigrations(req, new Set(req)).status).toBe('ok')
  })
  it('warnings do not block, failures do', () => {
    expect(summarize([{ status: 'ok', name: 'a', detail: '' }, { status: 'warn', name: 'b', detail: '' }])).toEqual({ ok: true, failed: 0, warned: 1 })
    expect(summarize([{ status: 'fail', name: 'a', detail: '' }]).ok).toBe(false)
  })
})
