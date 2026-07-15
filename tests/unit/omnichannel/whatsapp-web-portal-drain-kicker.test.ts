import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import {
  buildPortalJobDrainRequest,
  parsePortalJobDrainUrl,
  PortalJobDrainKicker,
} from '../../../services/whatsapp-web-bridge/portal-job-drain-kicker.mjs'
import {
  verifySignedBridgeRequest,
  WHATSAPP_WEB_PORTAL_AUDIENCE,
} from '@/lib/omnichannel/whatsapp-web-signature'

const portalSecret = 'portal-job-drain-secret-with-32-bytes-minimum'
const webhookUrl = new URL(
  'https://portal.example.kz/api/webhooks/whatsapp-web',
)
const drainUrl = new URL(
  'https://portal.example.kz/api/webhooks/whatsapp-web/drain',
)

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function kicker(overrides: Record<string, unknown> = {}) {
  return new PortalJobDrainKicker({
    url: drainUrl,
    sessionId: 'primary',
    secret: portalSecret,
    keyId: 'primary',
    intervalMs: 10_000,
    timeoutMs: 5_000,
    fetchImpl: async () => new Response(null, { status: 202 }),
    ...overrides,
  })
}

describe('WhatsApp Web portal queue drain kicker', () => {
  it('is disabled when the opt-in URL is blank and safely resolves a same-origin path', () => {
    expect(
      parsePortalJobDrainUrl('', { portalWebhookUrl: webhookUrl }),
    ).toBeNull()
    expect(
      parsePortalJobDrainUrl(undefined, { portalWebhookUrl: webhookUrl }),
    ).toBeNull()
    expect(
      parsePortalJobDrainUrl('/api/webhooks/whatsapp-web/drain', {
        portalWebhookUrl: webhookUrl,
        nodeEnv: 'production',
      })?.href,
    ).toBe(drainUrl.href)
  })

  it('rejects a signing-oracle origin, credentials, query, fragment, and remote HTTP', () => {
    for (const value of [
      'https://attacker.example/drain',
      'https://user:pass@portal.example.kz/drain',
      'https://portal.example.kz/drain?token=value',
      'https://portal.example.kz/drain#fragment',
      'http://portal.example.kz/drain',
      webhookUrl.href,
    ]) {
      expect(() =>
        parsePortalJobDrainUrl(value, {
          portalWebhookUrl: webhookUrl,
          nodeEnv: 'production',
        }),
      ).toThrow(/PORTAL_JOB_DRAIN_URL/)
    }
  })

  it('permits local HTTP only under the explicit existing loopback rules', () => {
    const localWebhook = new URL(
      'http://127.0.0.1:3000/api/webhooks/whatsapp-web',
    )
    const path = '/api/webhooks/whatsapp-web/drain'
    expect(
      parsePortalJobDrainUrl(path, {
        portalWebhookUrl: localWebhook,
        nodeEnv: 'development',
      })?.href,
    ).toBe(`http://127.0.0.1:3000${path}`)
    expect(() =>
      parsePortalJobDrainUrl(path, {
        portalWebhookUrl: localWebhook,
        nodeEnv: 'production',
      }),
    ).toThrow(/PORTAL_JOB_DRAIN_URL/)
    expect(
      parsePortalJobDrainUrl(path, {
        portalWebhookUrl: localWebhook,
        nodeEnv: 'production',
        allowInsecureLocalhost: true,
      })?.href,
    ).toBe(`http://127.0.0.1:3000${path}`)
  })

  it('signs the exact path and exact control-only raw body for the portal verifier', () => {
    const request = buildPortalJobDrainRequest({
      url: drainUrl,
      sessionId: 'primary',
      secret: portalSecret,
      keyId: 'primary',
      timestampSeconds: 1_750_000_000,
      nonce: 'drain-nonce-12345',
    })

    expect(request.rawBody).toBe('{"version":1,"session_id":"primary"}')
    expect(request.rawBody).not.toMatch(/message|phone|jid|contact/i)
    expect(
      verifySignedBridgeRequest({
        method: 'POST',
        path: drainUrl.pathname,
        body: request.rawBody,
        headers: new Headers(request.headers),
        expectedAudience: WHATSAPP_WEB_PORTAL_AUDIENCE,
        secrets: { primary: portalSecret },
        nowSeconds: 1_750_000_030,
      }),
    ).toEqual({
      ok: true,
      timestamp: 1_750_000_000,
      nonce: 'drain-nonce-12345',
      keyId: 'primary',
    })
  })

  it('does not run until eligible and never overlaps fetches', async () => {
    let eligible = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let active = 0
    let maximumActive = 0
    const fetchImpl = vi.fn(async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await gate
      active -= 1
      return new Response(null, { status: 202 })
    })
    const instance = kicker({ fetchImpl, shouldRun: () => eligible })

    await expect(instance.trigger()).resolves.toEqual({
      kind: 'skipped',
      reason: 'not_ready',
    })
    expect(fetchImpl).not.toHaveBeenCalled()

    eligible = true
    const first = instance.trigger()
    const second = instance.trigger()
    const third = instance.trigger()
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
    release()
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      { kind: 'accepted', status: 202 },
      { kind: 'accepted', status: 202 },
      { kind: 'accepted', status: 202 },
    ])
    expect(maximumActive).toBe(1)
    expect(instance.snapshot()).toMatchObject({
      in_flight: false,
      consecutive_failures: 0,
    })
  })

  it('contains failures, emits only sanitized bounded diagnostics, and recovers', async () => {
    const log = vi.fn()
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(`private ${portalSecret} ${drainUrl.href}`),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const instance = kicker({ fetchImpl, log })

    await expect(instance.trigger()).resolves.toEqual({
      kind: 'retry_later',
      reason: 'transport_failure',
    })
    await expect(instance.trigger()).resolves.toEqual({
      kind: 'retry_later',
      reason: 'http_rejection',
      status: 503,
    })
    await expect(instance.trigger()).resolves.toEqual({
      kind: 'accepted',
      status: 204,
    })

    expect(log).toHaveBeenCalledWith('warn', 'portal_job_drain_failed', {
      kind: 'transport_failure',
      consecutive_failures: 1,
    })
    expect(log).toHaveBeenCalledWith('info', 'portal_job_drain_recovered', {
      previous_failures: 2,
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain(portalSecret)
    expect(JSON.stringify(log.mock.calls)).not.toContain(drainUrl.href)
  })

  it('clears its periodic timer on stop and skips all later triggers', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }))
    const instance = kicker({
      fetchImpl,
      intervalMs: 1_000,
    })

    instance.start()
    expect(instance.snapshot().running).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    instance.stop()
    expect(instance.snapshot().running).toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(instance.trigger()).resolves.toEqual({
      kind: 'skipped',
      reason: 'stopped',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('packages the kicker module into the production bridge image', async () => {
    const dockerfile = await readFile(
      new URL(
        '../../../services/whatsapp-web-bridge/Dockerfile',
        import.meta.url,
      ),
      'utf8',
    )
    expect(dockerfile).toContain('portal-job-drain-kicker.mjs')
  })
})
