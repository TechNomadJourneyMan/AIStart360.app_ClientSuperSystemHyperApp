import { describe, expect, it, vi } from 'vitest'
import {
  parseClaimedCommand,
  parsePortalControlUrls,
  PortalSessionControl,
} from '../../../services/whatsapp-web-bridge/portal-session-control.mjs'
import {
  verifySignedBridgeRequest,
  WHATSAPP_WEB_PORTAL_AUDIENCE,
} from '@/lib/omnichannel/whatsapp-web-signature'

const secret = 'portal-control-secret-with-at-least-32-bytes'
const commandId = '00000000-0000-4000-8000-000000000001'
const leaseToken = '00000000-0000-4000-8000-000000000002'
const urls = parsePortalControlUrls(new URL('https://portal.example.kz/api/webhooks/whatsapp-web'))

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

type Call = { path: string; body: Record<string, unknown> }

function harness(options: {
  status?: Record<string, unknown>
  respond?: (call: Call) => Response | Promise<Response>
  execute?: (input: { action: string }) => Promise<unknown>
} = {}) {
  const calls: Call[] = []
  const logs: string[] = []
  const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input))
    const raw = String(init?.body)
    const verified = verifySignedBridgeRequest({
      method: 'POST',
      path: url.pathname,
      body: raw,
      headers: new Headers(init?.headers as Record<string, string>),
      expectedAudience: WHATSAPP_WEB_PORTAL_AUDIENCE,
      secrets: { primary: secret },
    })
    if (!verified.ok) return json({ ok: false }, 401)
    const call = { path: url.pathname, body: JSON.parse(raw) as Record<string, unknown> }
    calls.push(call)
    if (options.respond) return options.respond(call)
    if (url.pathname.endsWith('/claim')) return json({ ok: true, command: null })
    if (url.pathname.endsWith('/ack')) return json({ ok: true, accepted: true })
    return json({ ok: true })
  })
  const execute = vi.fn(options.execute ?? (async () => ({ outcome: 'succeeded' })))
  const control = new PortalSessionControl({
    urls,
    sessionId: 'primary',
    secret,
    bridgeVersion: '1.0.0',
    getStatus: () => options.status ?? {
      state: 'connected',
      connected: true,
      updated_at: '2026-10-16T10:00:00.000Z',
      qr: null,
      qr_expires_at: null,
      error_code: null,
    },
    execute,
    fetchImpl,
    log: (_level: string, event: string, details?: unknown) => {
      logs.push(`${event} ${JSON.stringify(details ?? {})}`)
    },
  })
  return { control, calls, execute, fetchImpl, logs }
}

describe('WhatsApp Web portal session control (bridge side)', () => {
  it('derives three same-origin portal endpoints', () => {
    expect(urls.status.href).toBe('https://portal.example.kz/api/webhooks/whatsapp-web/session')
    expect(urls.claim.href).toBe('https://portal.example.kz/api/webhooks/whatsapp-web/commands/claim')
    expect(urls.ack.href).toBe('https://portal.example.kz/api/webhooks/whatsapp-web/commands/ack')
    expect(() => parsePortalControlUrls('https://portal.example.kz/x/api/webhooks/whatsapp-web')).toThrow()
  })

  it('refuses heartbeats below 15 s', () => {
    expect(() => new PortalSessionControl({
      urls, sessionId: 'primary', secret, getStatus: () => ({}), execute: async () => ({}), heartbeatMs: 5_000,
    })).toThrow(/heartbeat/)
  })

  it('pushes a signed status; the QR travels only while pairing and is never logged', async () => {
    const pairing = harness({
      status: {
        state: 'qr',
        connected: false,
        updated_at: '2026-10-16T10:00:00.000Z',
        qr: 'raw-secret-qr',
        qr_expires_at: '2026-10-16T10:01:00.000Z',
        error_code: null,
      },
    })
    await pairing.control.pushNow()
    pairing.control.stop()
    expect(pairing.calls[0]).toEqual({
      path: '/api/webhooks/whatsapp-web/session',
      body: {
        version: 1,
        session_id: 'primary',
        state: 'qr',
        connected: false,
        updated_at: '2026-10-16T10:00:00.000Z',
        qr: 'raw-secret-qr',
        qr_expires_at: '2026-10-16T10:01:00.000Z',
        error_code: null,
        bridge_version: '1.0.0',
      },
    })

    const connected = harness({
      status: { state: 'connected', connected: true, updated_at: null, qr: 'stale-qr', qr_expires_at: 'x', error_code: null },
    })
    await connected.control.pushNow()
    connected.control.stop()
    expect(connected.calls[0].body).toMatchObject({ state: 'connected', qr: null, qr_expires_at: null })

    const failing = harness({
      status: { state: 'qr', qr: 'raw-secret-qr', qr_expires_at: '2026-10-16T10:01:00.000Z' },
      respond: () => json({ ok: false }, 503),
    })
    await failing.control.pushNow()
    failing.control.stop()
    expect(failing.logs.join('\n')).not.toContain('raw-secret-qr')
  })

  it('claims a command, executes it once and acks under the lease token', async () => {
    let claims = 0
    const h = harness({
      respond: (call) => {
        if (call.path.endsWith('/claim')) {
          claims += 1
          return json({
            ok: true,
            command: claims === 1
              ? { command_id: commandId, action: 'connect', lease_token: leaseToken, expires_at: '2026-10-16T10:02:00.000Z' }
              : null,
          })
        }
        if (call.path.endsWith('/ack')) return json({ ok: true, accepted: true })
        return json({ ok: true })
      },
    })
    expect(await h.control.pollNow()).toEqual({ kind: 'executed' })
    expect(h.execute).toHaveBeenCalledWith({ action: 'connect' })
    const ackCall = h.calls.find((call) => call.path.endsWith('/ack'))
    expect(ackCall?.body).toEqual({
      version: 1,
      session_id: 'primary',
      command_id: commandId,
      lease_token: leaseToken,
      outcome: 'succeeded',
    })
    expect(await h.control.pollNow()).toEqual({ kind: 'idle' })
    h.control.stop()
  })

  it('a re-leased command is acked from the cache, not executed again', async () => {
    let n = 0
    const h = harness({
      respond: (call) => {
        if (call.path.endsWith('/claim')) {
          n += 1
          return json({
            ok: true,
            command: { command_id: commandId, action: 'logout', lease_token: `00000000-0000-4000-8000-00000000000${n}`, expires_at: '2026-10-16T10:02:00.000Z' },
          })
        }
        return json({ ok: true, accepted: true })
      },
    })
    await h.control.pollNow()
    await h.control.pollNow()
    h.control.stop()
    expect(h.execute).toHaveBeenCalledTimes(1)
    expect(h.calls.filter((call) => call.path.endsWith('/ack'))).toHaveLength(2)
  })

  it('reports a failed command with a safe error code', async () => {
    let claimed = false
    const h = harness({
      execute: async () => ({ outcome: 'failed', error_code: 'connect_rate_limited' }),
      respond: (call) => {
        if (call.path.endsWith('/claim')) {
          const command = claimed ? null : { command_id: commandId, action: 'connect', lease_token: leaseToken, expires_at: '2026-10-16T10:02:00.000Z' }
          claimed = true
          return json({ ok: true, command })
        }
        return json({ ok: true, accepted: true })
      },
    })
    await h.control.pollNow()
    h.control.stop()
    expect(h.calls.find((call) => call.path.endsWith('/ack'))?.body).toMatchObject({
      outcome: 'failed',
      error_code: 'connect_rate_limited',
    })
  })

  it('keeps an unacknowledged result and flushes it before the next claim', async () => {
    let ackAttempts = 0
    let claims = 0
    const h = harness({
      respond: (call) => {
        if (call.path.endsWith('/ack')) {
          ackAttempts += 1
          return ackAttempts === 1 ? json({ ok: false }, 503) : json({ ok: true, accepted: true })
        }
        if (call.path.endsWith('/claim')) {
          claims += 1
          return json({
            ok: true,
            command: claims === 1
              ? { command_id: commandId, action: 'connect', lease_token: leaseToken, expires_at: '2026-10-16T10:02:00.000Z' }
              : null,
          })
        }
        return json({ ok: true })
      },
    })
    expect(await h.control.pollNow()).toEqual({ kind: 'ack_pending' })
    expect(h.control.snapshot().ack_pending).toBe(true)
    expect(await h.control.pollNow()).toEqual({ kind: 'idle' })
    h.control.stop()
    const paths = h.calls.map((call) => call.path.split('/').pop())
    expect(paths).toEqual(['claim', 'ack', 'ack', 'claim'])
    expect(h.execute).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed claim responses', () => {
    expect(() => parseClaimedCommand({ ok: true, command: { command_id: commandId, action: 'wipe', lease_token: leaseToken, expires_at: '2026-10-16T10:02:00.000Z' } })).toThrow()
    expect(() => parseClaimedCommand({ ok: true, command: { command_id: commandId, action: 'connect', lease_token: leaseToken, expires_at: '2026-10-16T10:02:00.000Z', extra: 1 } })).toThrow()
    expect(parseClaimedCommand({ ok: true, command: null })).toBeNull()
  })
})
