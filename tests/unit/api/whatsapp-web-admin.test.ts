import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const actor = vi.hoisted(() => ({ getGigaActor: vi.fn() }))
const audit = vi.hoisted(() => ({ logAudit: vi.fn() }))
const limiter = vi.hoisted(() => ({ isRateLimitedKey: vi.fn() }))
const bridge = vi.hoisted(() => ({
  getWhatsAppWebBridgeConfigurationHealth: vi.fn(),
  getStatus: vi.fn(),
  connect: vi.fn(),
  logout: vi.fn(),
}))
const qr = vi.hoisted(() => ({ toDataURL: vi.fn() }))

vi.mock('@/lib/admin/giga-actor', () => actor)
vi.mock('@/lib/audit', () => audit)
vi.mock('@/lib/rate-limit', () => limiter)
vi.mock('@/lib/omnichannel/whatsapp-web-client', () => ({
  getWhatsAppWebBridgeConfigurationHealth: bridge.getWhatsAppWebBridgeConfigurationHealth,
  createWhatsAppWebClient: () => ({
    getStatus: bridge.getStatus,
    connect: bridge.connect,
    logout: bridge.logout,
  }),
}))
vi.mock('qrcode', () => ({ default: { toDataURL: qr.toDataURL } }))

import { GET, POST } from '@/app/api/giga-admin/omnichannel/whatsapp-web/route'

const originalBreakGlass = process.env.WHATSAPP_WEB_BRIDGE_ALLOW_BREAK_GLASS_PAIRING

function request(method: 'GET' | 'POST', body?: unknown): NextRequest {
  return new Request('http://localhost/api/giga-admin/omnichannel/whatsapp-web', {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }) as unknown as NextRequest
}

const configured = {
  enabled: true,
  configured: true,
  missing: [],
  sessionIdConfigured: true,
  accountExternalId: 'waweb:primary',
}

describe('/api/giga-admin/omnichannel/whatsapp-web', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    delete process.env.WHATSAPP_WEB_BRIDGE_ALLOW_BREAK_GLASS_PAIRING
    actor.getGigaActor.mockResolvedValue({ id: 'admin-1', kind: 'session' })
    bridge.getWhatsAppWebBridgeConfigurationHealth.mockReturnValue(configured)
    bridge.getStatus.mockResolvedValue({
      ok: true,
      rawStatus: 200,
      status: {
        state: 'connected',
        connected: true,
        qr: null,
        updatedAt: '2026-07-14T10:00:00.000Z',
        errorCode: null,
      },
    })
    bridge.connect.mockResolvedValue({
      ok: true,
      rawStatus: 202,
      status: {
        state: 'connecting',
        connected: false,
        qr: null,
        updatedAt: null,
        errorCode: null,
      },
    })
    bridge.logout.mockResolvedValue({
      ok: true,
      rawStatus: 200,
      status: {
        state: 'disconnected',
        connected: false,
        qr: null,
        updatedAt: null,
        errorCode: null,
      },
    })
    limiter.isRateLimitedKey.mockResolvedValue(false)
    audit.logAudit.mockResolvedValue(undefined)
    qr.toDataURL.mockResolvedValue('data:image/png;base64,qr')
  })

  afterEach(() => {
    if (originalBreakGlass === undefined) {
      delete process.env.WHATSAPP_WEB_BRIDGE_ALLOW_BREAK_GLASS_PAIRING
    } else {
      process.env.WHATSAPP_WEB_BRIDGE_ALLOW_BREAK_GLASS_PAIRING = originalBreakGlass
    }
  })

  it('requires a super-admin actor', async () => {
    actor.getGigaActor.mockResolvedValue(null)
    expect((await GET(request('GET'))).status).toBe(403)
    expect((await POST(request('POST', { action: 'connect' }))).status).toBe(403)
  })

  it('returns a disabled status without contacting the bridge', async () => {
    bridge.getWhatsAppWebBridgeConfigurationHealth.mockReturnValue({
      ...configured,
      enabled: false,
      configured: false,
      missing: ['WHATSAPP_WEB_BRIDGE_ENABLED'],
    })
    const response = await GET(request('GET'))
    expect(response.status).toBe(200)
    expect((await response.json()).status.state).toBe('disabled')
    expect(bridge.getStatus).not.toHaveBeenCalled()
  })

  it('renders a transient bridge QR only for the authenticated response', async () => {
    bridge.getStatus.mockResolvedValue({
      ok: true,
      rawStatus: 200,
      status: {
        state: 'qr',
        connected: false,
        qr: 'raw-secret-qr-payload',
        updatedAt: null,
        errorCode: null,
      },
    })
    const response = await GET(request('GET'))
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(qr.toDataURL).toHaveBeenCalledWith('raw-secret-qr-payload', expect.any(Object))
    expect(json.status).toMatchObject({
      state: 'qr',
      connected: false,
      qr_data_url: 'data:image/png;base64,qr',
    })
  })

  it('blocks break-glass pairing unless explicitly enabled', async () => {
    actor.getGigaActor.mockResolvedValue({ id: 'giga:super_admin', kind: 'break_glass' })
    const response = await POST(request('POST', { action: 'connect' }))
    expect(response.status).toBe(403)
    expect(bridge.connect).not.toHaveBeenCalled()
  })

  it('rate-limits and audits personal-admin connect actions', async () => {
    limiter.isRateLimitedKey.mockResolvedValueOnce(true)
    expect((await POST(request('POST', { action: 'connect' }))).status).toBe(429)
    expect(bridge.connect).not.toHaveBeenCalled()

    limiter.isRateLimitedKey.mockResolvedValueOnce(false)
    const response = await POST(request('POST', { action: 'connect' }))
    expect(response.status).toBe(200)
    expect(bridge.connect).toHaveBeenCalledWith(expect.stringMatching(/^omnichannel:bridge:connect:/))
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'omnichannel.whatsapp_web_connect_requested',
      performedBy: 'admin-1',
    }))
  })
})
