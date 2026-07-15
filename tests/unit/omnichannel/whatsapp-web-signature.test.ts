import { describe, expect, it } from 'vitest'
import {
  createSignedBridgeHeaders,
  verifySignedBridgeRequest,
  WHATSAPP_WEB_BRIDGE_AUDIENCE,
} from '@/lib/omnichannel/whatsapp-web-signature'

const body = Buffer.from('{"hello":"world"}', 'utf8')
const secret = 'bridge-secret-with-enough-entropy'

function headers(overrides: Record<string, string> = {}): Headers {
  return new Headers({
    ...createSignedBridgeHeaders({
      method: 'POST',
      path: '/v1/messages',
      body,
      secret,
      audience: WHATSAPP_WEB_BRIDGE_AUDIENCE,
      timestamp: 1_750_000_000,
      nonce: 'nonce-12345678',
      keyId: 'primary',
    }),
    ...overrides,
  })
}

describe('WhatsApp Web bridge signatures', () => {
  it('verifies an exact method, path, audience and raw body', () => {
    expect(verifySignedBridgeRequest({
      method: 'POST',
      path: '/v1/messages',
      body,
      headers: headers(),
      expectedAudience: WHATSAPP_WEB_BRIDGE_AUDIENCE,
      secrets: { primary: secret },
      nowSeconds: 1_750_000_030,
    })).toEqual({
      ok: true,
      timestamp: 1_750_000_000,
      nonce: 'nonce-12345678',
      keyId: 'primary',
    })
  })

  it('rejects body, path and audience tampering', () => {
    for (const input of [
      { path: '/v1/session/status', body, audience: WHATSAPP_WEB_BRIDGE_AUDIENCE },
      { path: '/v1/messages', body: Buffer.from('{}'), audience: WHATSAPP_WEB_BRIDGE_AUDIENCE },
      { path: '/v1/messages', body, audience: 'different-audience' },
    ]) {
      expect(verifySignedBridgeRequest({
        method: 'POST',
        path: input.path,
        body: input.body,
        headers: headers(),
        expectedAudience: input.audience,
        secrets: { primary: secret },
        nowSeconds: 1_750_000_030,
      }).ok).toBe(false)
    }
  })

  it('rejects stale requests and unknown rotation keys', () => {
    expect(verifySignedBridgeRequest({
      method: 'POST',
      path: '/v1/messages',
      body,
      headers: headers(),
      expectedAudience: WHATSAPP_WEB_BRIDGE_AUDIENCE,
      secrets: { primary: secret },
      nowSeconds: 1_750_000_061,
      maxSkewSeconds: 60,
    })).toEqual({ ok: false, reason: 'expired_timestamp' })

    expect(verifySignedBridgeRequest({
      method: 'POST',
      path: '/v1/messages',
      body,
      headers: headers({ 'x-wa-bridge-key-id': 'retired' }),
      expectedAudience: WHATSAPP_WEB_BRIDGE_AUDIENCE,
      secrets: { primary: secret },
      nowSeconds: 1_750_000_030,
    })).toEqual({ ok: false, reason: 'unknown_key' })
  })
})
