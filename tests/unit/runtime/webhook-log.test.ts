/**
 * INT-01 / INT-02 / R-138 — refused / failed webhook deliveries are logged as one structured line:
 * route, status, reason code, request id; never content, header values or error messages.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { logWebhookRejection, webhookRefusal, webhookRequestId } from '@/lib/runtime/webhook-log'

afterEach(() => vi.restoreAllMocks())

describe('INT-01 webhook rejection log', () => {
  it('writes route, status, reason and request id; 5xx as an error, 4xx as a warning', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logWebhookRejection({ route: 'webhooks/meta', status: 401, reason: 'bad_signature', requestId: 'r-1' })
    logWebhookRejection({ route: 'webhooks/meta', status: 500, reason: 'enqueue_failed', requestId: 'r-2', error: Object.assign(new Error('phone +77001234567 text hello'), { code: 'P2002' }) })
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({ event: 'webhook_rejected', route: 'webhooks/meta', status: 401, reason: 'bad_signature', request_id: 'r-1' })
    const line = String(error.mock.calls[0][0])
    expect(JSON.parse(line)).toEqual({ event: 'webhook_rejected', route: 'webhooks/meta', status: 500, reason: 'enqueue_failed', request_id: 'r-2', error: 'P2002' })
    expect(line).not.toContain('77001234567')
    expect(line).not.toContain('hello')
  })

  it('takes the platform request id when it is a plain token, else makes one', () => {
    expect(webhookRequestId(new Request('http://x/', { headers: { 'x-railway-request-id': 'abc-123' } }))).toBe('abc-123')
    const made = webhookRequestId(new Request('http://x/', { headers: { 'x-request-id': '<script>alert(1)</script>' } }))
    expect(made).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('webhookRefusal logs once per call with a stable request id and returns the route response', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const refuse = webhookRefusal('webhooks/whatsapp-web', new Request('http://x/', { headers: { 'x-request-id': 'req-9' } }))
    const res = refuse(403, 'session_mismatch', (s) => ({ status: s }))
    expect(res).toEqual({ status: 403 })
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ route: 'webhooks/whatsapp-web', status: 403, reason: 'session_mismatch', request_id: 'req-9' })
  })
})
