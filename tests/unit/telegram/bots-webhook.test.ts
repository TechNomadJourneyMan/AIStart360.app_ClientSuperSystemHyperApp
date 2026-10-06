/**
 * Webhook front door of the admin / expert bots: fail closed without the
 * secret, constant-time secret check (401), dedupe by update_id, garbage and
 * handler errors acknowledged with 200.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Router } from '@/lib/telegram/bots/dispatcher'
import { processWebhook, secretMatches } from '@/lib/telegram/bots/webhook'
import { recordingFetch, testDeps } from './_bot-harness'

const ENV = ['TELEGRAM_ADMIN_BOT_TOKEN', 'TELEGRAM_ADMIN_WEBHOOK_SECRET', 'TELEGRAM_EXPERT_BOT_TOKEN', 'TELEGRAM_EXPERT_WEBHOOK_SECRET']
const saved: Record<string, string | undefined> = {}

function stubRouter(run: (ctx: unknown) => Promise<void> = vi.fn(async () => {})): Router<{ userId: string }> {
  return {
    bot: 'admin',
    resolve: async () => ({ userId: 'u1' }),
    authorize: () => true,
    unlinkedText: 'no',
    welcome: async (ctx) => { await run(ctx) },
    commands: {}, menu: {}, callbacks: {}, confirmed: {}, steps: {},
  }
}

function headers(secret?: string) {
  return new Headers(secret === undefined ? {} : { 'x-telegram-bot-api-secret-token': secret })
}

describe('bot webhook', () => {
  beforeEach(() => {
    for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] }
  })
  afterEach(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  })

  it('fails closed while the bot token or webhook secret is not configured', async () => {
    const run = vi.fn(async (_ctx: unknown) => {})
    const { deps } = testDeps(recordingFetch().fetchImpl)
    const body = vi.fn(async () => ({ update_id: 1, message: { message_id: 1, chat: { id: 1, type: 'private' }, from: { id: 1 }, text: 'hi' } }))
    process.env.TELEGRAM_ADMIN_BOT_TOKEN = 'tkn'
    const r = await processWebhook({ bot: 'admin', headers: headers('anything'), body, router: () => stubRouter(run), deps, seen: async () => true })
    expect(r).toEqual({ status: 503, outcome: 'not_configured' })
    expect(body).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a wrong or missing secret with 401 and never reads the update', async () => {
    process.env.TELEGRAM_ADMIN_BOT_TOKEN = 'tkn'
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 's3cr3t'
    const { deps } = testDeps(recordingFetch().fetchImpl)
    const body = vi.fn(async () => ({}))
    for (const h of [headers(), headers('nope'), headers('s3cr3T'), headers('s3cr3t-longer')]) {
      const r = await processWebhook({ bot: 'admin', headers: h, body, router: () => stubRouter(), deps, seen: async () => true })
      expect(r.status).toBe(401)
    }
    expect(body).not.toHaveBeenCalled()
    expect(secretMatches('abc', 'abc')).toBe(true)
    expect(secretMatches('abc', 'abd')).toBe(false)
    expect(secretMatches('abc', null)).toBe(false)
  })

  it('dispatches once per update_id and answers 200 to replays, garbage and handler errors', async () => {
    process.env.TELEGRAM_ADMIN_BOT_TOKEN = 'tkn'
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 's3cr3t'
    const tg = recordingFetch()
    const { deps } = testDeps(tg.fetchImpl)
    const seenIds = new Set<string>()
    const seen = async (bot: string, id: unknown) => {
      const k = `${bot}:${id}`
      if (seenIds.has(k)) return false
      seenIds.add(k)
      return true
    }
    const run = vi.fn(async (_ctx: unknown) => {})
    const update = { update_id: 77, message: { message_id: 5, chat: { id: 9, type: 'private' }, from: { id: 9 }, text: 'привет' } }
    const first = await processWebhook({ bot: 'admin', headers: headers('s3cr3t'), body: async () => update, router: () => stubRouter(run), deps, seen })
    const replay = await processWebhook({ bot: 'admin', headers: headers('s3cr3t'), body: async () => update, router: () => stubRouter(run), deps, seen })
    expect(first).toEqual({ status: 200, outcome: 'welcome' })
    expect(replay).toEqual({ status: 200, outcome: 'duplicate' })
    expect(run).toHaveBeenCalledTimes(1)

    const garbage = await processWebhook({ bot: 'admin', headers: headers('s3cr3t'), body: async () => { throw new SyntaxError('bad json') }, router: () => stubRouter(run), deps, seen })
    expect(garbage).toEqual({ status: 200, outcome: 'bad_json' })

    const broken: Router<{ userId: string }> = { ...stubRouter(), resolve: async () => { throw new Error('db down') } }
    const err = await processWebhook({ bot: 'admin', headers: headers('s3cr3t'), body: async () => ({ ...update, update_id: 78 }), router: () => broken, deps, seen })
    expect(err).toEqual({ status: 200, outcome: 'error' })
  })

  it('route handlers: 503 without configuration, 401 on a bad secret', async () => {
    const { POST: admin } = await import('@/app/api/telegram/admin/route')
    const { POST: expert } = await import('@/app/api/telegram/expert/route')
    const req = (secret?: string) => new Request('http://localhost/api/telegram/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) },
      body: JSON.stringify({ update_id: 1 }),
    }) as never
    expect((await admin(req('x'))).status).toBe(503)
    expect((await expert(req('x'))).status).toBe(503)
    process.env.TELEGRAM_ADMIN_BOT_TOKEN = 'tkn'
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'right'
    process.env.TELEGRAM_EXPERT_BOT_TOKEN = 'tkn2'
    process.env.TELEGRAM_EXPERT_WEBHOOK_SECRET = 'right2'
    expect((await admin(req('wrong'))).status).toBe(401)
    expect((await admin(req())).status).toBe(401)
    expect((await expert(req('right'))).status).toBe(401)
  })
})
