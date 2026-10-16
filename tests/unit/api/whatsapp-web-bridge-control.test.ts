import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  createSignedBridgeHeaders,
  WHATSAPP_WEB_PORTAL_AUDIENCE,
} from '@/lib/omnichannel/whatsapp-web-signature'
import { memoryStore } from '../omnichannel/_bridge-control-store'

const holder = vi.hoisted(() => ({ store: null as unknown }))
const actor = vi.hoisted(() => ({ getGigaActor: vi.fn() }))
const audit = vi.hoisted(() => ({ logAudit: vi.fn() }))
const limiter = vi.hoisted(() => ({ isRateLimitedKey: vi.fn() }))
const qr = vi.hoisted(() => ({ toDataURL: vi.fn() }))
const fetchSpy = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => {
    throw new Error('no database in unit tests')
  },
}))
vi.mock('@/lib/omnichannel/whatsapp-bridge-control', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/omnichannel/whatsapp-bridge-control')>()
  return { ...actual, createSupabaseBridgeControlStore: () => holder.store }
})
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { ...actor, requireGiga: makeRequireGiga(() => actor.getGigaActor()) }
})
vi.mock('@/lib/audit', () => audit)
vi.mock('@/lib/rate-limit', () => limiter)
vi.mock('qrcode', () => ({ default: { toDataURL: qr.toDataURL } }))

import { POST as pushStatus } from '@/app/api/webhooks/whatsapp-web/session/route'
import { POST as claim } from '@/app/api/webhooks/whatsapp-web/commands/claim/route'
import { POST as ack } from '@/app/api/webhooks/whatsapp-web/commands/ack/route'
import { GET as gigaGet, POST as gigaPost } from '@/app/api/giga-admin/omnichannel/whatsapp-web/route'
import { resetBridgeStatusThrottle } from '@/lib/omnichannel/whatsapp-bridge-control'

const secret = 'portal-inbound-secret-0123456789abcdef'
const SESSION = '/api/webhooks/whatsapp-web/session'
const CLAIM = '/api/webhooks/whatsapp-web/commands/claim'
const ACK = '/api/webhooks/whatsapp-web/commands/ack'

function signed(path: string, payload: unknown, options: { secret?: string; nonce?: string; signed?: boolean; timestamp?: number } = {}): NextRequest {
  const rawBody = JSON.stringify(payload)
  return new NextRequest(`https://portal.example.kz${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.signed === false
        ? {}
        : createSignedBridgeHeaders({
            method: 'POST',
            path,
            body: rawBody,
            secret: options.secret ?? secret,
            audience: WHATSAPP_WEB_PORTAL_AUDIENCE,
            nonce: options.nonce ?? crypto.randomUUID(),
            timestamp: options.timestamp,
          })),
    },
    body: rawBody,
  })
}

function gigaRequest(method: 'GET' | 'POST', body?: unknown): NextRequest {
  return new Request('http://localhost/api/giga-admin/omnichannel/whatsapp-web', {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }) as unknown as NextRequest
}

function statusBody(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    session_id: 'primary',
    state: 'connected',
    connected: true,
    updated_at: new Date().toISOString(),
    qr: null,
    qr_expires_at: null,
    error_code: null,
    bridge_version: '1.0.0',
    ...overrides,
  }
}

let mem: ReturnType<typeof memoryStore>

describe('WhatsApp Web bridge pull control', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('WHATSAPP_WEB_BRIDGE_ENABLED', 'true')
    vi.stubEnv('WHATSAPP_WEB_BRIDGE_CONTROL', 'pull')
    vi.stubEnv('WHATSAPP_WEB_BRIDGE_URL', '')
    vi.stubEnv('WHATSAPP_WEB_BRIDGE_SESSION_ID', 'primary')
    vi.stubEnv('WHATSAPP_WEB_BRIDGE_API_SECRET', 'bridge-outbound-secret-0123456789abcdef')
    vi.stubEnv('WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET', secret)
    // The pull-control endpoints must not depend on the direct Postgres adapter.
    vi.stubEnv('OMNICHANNEL_PERSISTENCE', '')
    vi.stubEnv('OMNICHANNEL_DIRECT_POSTGRES_ENABLED', '')
    mem = memoryStore()
    holder.store = mem.store
    resetBridgeStatusThrottle()
    actor.getGigaActor.mockResolvedValue({ id: 'admin-1', kind: 'session' })
    limiter.isRateLimitedKey.mockResolvedValue(false)
    audit.logAudit.mockResolvedValue(undefined)
    qr.toDataURL.mockResolvedValue('data:image/png;base64,qr')
    vi.stubGlobal('fetch', fetchSpy)
  })

  describe('signed bridge endpoints', () => {
    it('reject unsigned, wrongly signed and expired requests before touching storage', async () => {
      expect((await pushStatus(signed(SESSION, statusBody(), { signed: false }))).status).toBe(401)
      expect((await claim(signed(CLAIM, { version: 1, session_id: 'primary' }, { secret: 'another-secret-with-more-than-32-bytes!!' }))).status).toBe(401)
      expect((await claim(signed(CLAIM, { version: 1, session_id: 'primary' }, { timestamp: Math.floor(Date.now() / 1000) - 600 }))).status).toBe(401)
      expect(mem.calls.upsertStatus).toBe(0)
    })

    it('rejects a replayed nonce', async () => {
      const nonce = crypto.randomUUID()
      expect((await claim(signed(CLAIM, { version: 1, session_id: 'primary' }, { nonce }))).status).toBe(200)
      expect((await claim(signed(CLAIM, { version: 1, session_id: 'primary' }, { nonce }))).status).toBe(409)
    })

    it('a signature for one endpoint does not verify on another', async () => {
      const payload = { version: 1, session_id: 'primary' }
      const raw = JSON.stringify(payload)
      const headers = createSignedBridgeHeaders({
        method: 'POST', path: CLAIM, body: raw, secret, audience: WHATSAPP_WEB_PORTAL_AUDIENCE,
      })
      const req = new NextRequest(`https://portal.example.kz${ACK}`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw,
      })
      expect((await ack(req)).status).toBe(401)
    })

    it('do not exist outside pull-control mode', async () => {
      vi.stubEnv('WHATSAPP_WEB_BRIDGE_CONTROL', '')
      expect((await pushStatus(signed(SESSION, statusBody()))).status).toBe(404)
      expect((await claim(signed(CLAIM, { version: 1, session_id: 'primary' }))).status).toBe(404)
    })

    it('reject another session and a QR outside the pairing state', async () => {
      expect((await claim(signed(CLAIM, { version: 1, session_id: 'other' }))).status).toBe(403)
      expect((await pushStatus(signed(SESSION, statusBody({ qr: 'raw-qr' })))).status).toBe(400)
      expect(mem.calls.upsertStatus).toBe(0)
    })

    it('stores a pushed status without echoing the QR', async () => {
      const response = await pushStatus(signed(SESSION, statusBody({
        state: 'qr',
        connected: false,
        qr: 'raw-secret-qr',
        qr_expires_at: new Date(Date.now() + 60_000).toISOString(),
      })))
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).not.toContain('raw-secret-qr')
      expect(mem.statuses.get('primary')).toMatchObject({ state: 'qr', qr: 'raw-secret-qr', connected: false })
    })

    it('runs the command lifecycle: GIGA issue → bridge claim → ack', async () => {
      expect((await claim(signed(CLAIM, { version: 1, session_id: 'primary' }))).status).toBe(200)

      const issued = await gigaPost(gigaRequest('POST', { action: 'connect' }))
      expect(issued.status).toBe(200)
      const issuedJson = await issued.json()
      expect(issuedJson.bridge.pending_command).toMatchObject({ action: 'connect', status: 'pending' })
      // Bridge never pushed: the admin is told the command will wait.
      expect(issuedJson.warning).toBeTruthy()
      expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'omnichannel.whatsapp_web_connect_requested',
      }))

      const claimed = await (await claim(signed(CLAIM, { version: 1, session_id: 'primary' }))).json()
      expect(claimed.command).toMatchObject({ action: 'connect' })
      expect(Object.keys(claimed.command).sort()).toEqual(['action', 'command_id', 'expires_at', 'lease_token'])

      const busy = await gigaPost(gigaRequest('POST', { action: 'logout' }))
      expect(busy.status).toBe(409)

      const acked = await (await ack(signed(ACK, {
        version: 1,
        session_id: 'primary',
        command_id: claimed.command.command_id,
        lease_token: claimed.command.lease_token,
        outcome: 'succeeded',
      }))).json()
      expect(acked).toEqual({ ok: true, accepted: true })
      expect(mem.commands[0].status).toBe('succeeded')

      const fenced = await (await ack(signed(ACK, {
        version: 1,
        session_id: 'primary',
        command_id: claimed.command.command_id,
        lease_token: claimed.command.lease_token,
        outcome: 'failed',
        error_code: 'connect_failed',
      }))).json()
      expect(fenced).toEqual({ ok: true, accepted: false })
    })
  })

  describe('GIGA status in pull-control mode', () => {
    it('is configured without a bridge URL and never calls the bridge', async () => {
      const response = await gigaGet(gigaRequest('GET'))
      const json = await response.json()
      expect(json.configuration).toMatchObject({ enabled: true, configured: true, controlMode: 'pull', missing: [] })
      expect(json.status).toMatchObject({ state: 'offline', connected: false, error_code: 'bridge_never_seen' })
      expect(json.bridge).toMatchObject({ control: 'pull', online: false, last_seen_at: null })
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('renders the pushed QR while pairing and «connected» from the last push', async () => {
      await pushStatus(signed(SESSION, statusBody({
        state: 'qr', connected: false, qr: 'raw-secret-qr', qr_expires_at: new Date(Date.now() + 60_000).toISOString(),
      })))
      const pairing = await (await gigaGet(gigaRequest('GET'))).json()
      expect(qr.toDataURL).toHaveBeenCalledWith('raw-secret-qr', expect.any(Object))
      expect(pairing.status).toMatchObject({ state: 'qr', qr_data_url: 'data:image/png;base64,qr' })
      expect(pairing.bridge.online).toBe(true)

      await pushStatus(signed(SESSION, statusBody({ updated_at: new Date().toISOString() })))
      const connected = await (await gigaGet(gigaRequest('GET'))).json()
      expect(connected.status).toMatchObject({ state: 'connected', connected: true, qr_data_url: null })
      expect(mem.statuses.get('primary')?.qr).toBeNull()
    })

    it('shows «offline» with the last-seen time when the push is older than 90 s', async () => {
      const lastSeen = new Date(Date.now() - 120_000).toISOString()
      await mem.store.upsertStatus({
        session_id: 'primary', state: 'connected', connected: true, qr: null, qr_expires_at: null,
        error_code: null, bridge_updated_at: lastSeen, bridge_version: '1.0.0', last_seen_at: lastSeen,
      })
      const json = await (await gigaGet(gigaRequest('GET'))).json()
      expect(json.status).toMatchObject({ state: 'offline', connected: false })
      expect(json.bridge).toMatchObject({ online: false, last_seen_at: lastSeen })
    })

    it('keeps the GIGA rate limit in pull mode', async () => {
      limiter.isRateLimitedKey.mockResolvedValueOnce(true)
      expect((await gigaPost(gigaRequest('POST', { action: 'connect' }))).status).toBe(429)
      expect(mem.commands).toHaveLength(0)
    })
  })
})
