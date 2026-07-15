import { describe, expect, it, vi } from 'vitest'
import {
  backfillInstagramConversations,
  getWhatsAppHistory,
  INSTAGRAM_BACKFILL_REQUEST_INTERVAL_MS,
} from '@/lib/omnichannel/instagram-backfill'
import type { MetaEnvironment, MetaFetch } from '@/lib/omnichannel/meta-client'

const env: MetaEnvironment = {
  INSTAGRAM_ACCESS_TOKEN: 'history-secret',
  INSTAGRAM_ACCOUNT_ID: 'ig-business',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Instagram conversations backfill', () => {
  it('paginates on graph.instagram.com and normalizes inbound/outbound messages chronologically', async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = []
    const fetchMock: MetaFetch = async (input, init) => {
      const url = new URL(String(input))
      calls.push({ url, init })

      if (url.pathname.endsWith('/conversations') && !url.searchParams.has('after')) {
        return jsonResponse({
          data: [
            {
              id: 'provider-thread-a',
              messages: {
                data: [
                  { id: 'message-new', created_time: '2026-07-13T12:00:00+0000' },
                  { id: 'message-middle', created_time: '2026-07-13T11:00:00+0000' },
                ],
              },
            },
          ],
          paging: {
            next:
              'https://graph.instagram.com/v25.0/ig-business/conversations?platform=instagram&fields=messages&after=cursor-2&access_token=history-secret',
          },
        })
      }
      if (url.pathname.endsWith('/conversations') && url.searchParams.get('after') === 'cursor-2') {
        return jsonResponse({
          data: [
            {
              id: 'provider-thread-b',
              messages: {
                data: [{ id: 'message-old', created_time: '2026-07-13T10:00:00+0000' }],
              },
            },
          ],
        })
      }

      const id = url.pathname.split('/').at(-1)
      const details: Record<string, unknown> = {
        'message-new': {
          id: 'message-new',
          created_time: '2026-07-13T12:00:00+0000',
          from: { id: 'ig-business', username: 'aistart360' },
          to: { data: [{ id: 'contact-a', username: 'aliya' }] },
          message: 'Мы можем помочь.',
        },
        'message-middle': {
          id: 'message-middle',
          created_time: '2026-07-13T11:00:00+0000',
          from: { id: 'contact-a', username: 'aliya' },
          to: { data: [{ id: 'ig-business', username: 'aistart360' }] },
          message: 'Расскажите о диагностике',
        },
        'message-old': {
          id: 'message-old',
          created_time: '2026-07-13T10:00:00+0000',
          from: { id: 'contact-b', username: 'bolat' },
          to: { data: [{ id: 'ig-business', username: 'aistart360' }] },
          message: 'Hello',
        },
      }
      return jsonResponse(details[id ?? ''])
    }
    const sleep = vi.fn(async () => undefined)

    const result = await backfillInstagramConversations({
      env,
      fetch: fetchMock,
      sleep,
      maxConversations: 2,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result).toMatchObject({
      conversationsScanned: 2,
      messagesFetched: 3,
      truncated: false,
      partialErrors: [],
    })
    expect(result.messages.map((message) => message.externalMessageId)).toEqual([
      'message-old',
      'message-middle',
      'message-new',
    ])
    expect(result.messages.map((message) => message.direction)).toEqual(['in', 'in', 'out'])
    expect(result.messages.map((message) => message.conversationExternalId)).toEqual([
      'contact-b',
      'contact-a',
      'contact-a',
    ])
    expect(result.messages[1]).toMatchObject({
      accountExternalId: 'ig-business',
      contactExternalId: 'contact-a',
      contactName: 'aliya',
      status: 'imported',
      messageType: 'text',
      occurredAt: '2026-07-13T11:00:00.000Z',
      metadata: { providerConversationId: 'provider-thread-a' },
    })

    const conversationCalls = calls.filter((call) => call.url.pathname.endsWith('/conversations'))
    expect(conversationCalls).toHaveLength(2)
    expect(conversationCalls[0].url.origin).toBe('https://graph.instagram.com')
    expect(conversationCalls[0].url.searchParams.get('platform')).toBe('instagram')
    expect(conversationCalls[0].url.searchParams.get('fields')).toBe('messages')
    expect(conversationCalls[1].url.searchParams.has('access_token')).toBe(false)
    expect(calls.every((call) => call.init?.method === 'GET')).toBe(true)
    expect(
      calls.every(
        (call) => new Headers(call.init?.headers).get('Authorization') === 'Bearer history-secret',
      ),
    ).toBe(true)
    expect(sleep).toHaveBeenCalledTimes(calls.length - 1)
    expect(sleep).toHaveBeenCalledWith(INSTAGRAM_BACKFILL_REQUEST_INTERVAL_MS)
  })

  it('globally caps detail calls at the newest 20 IDs and reports truncation', async () => {
    const refs = Array.from({ length: 23 }, (_, index) => ({
      id: `message-${index + 1}`,
      // Deliberately oldest-first: selection must use created_time, not array position.
      created_time: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
    }))
    const detailIds: string[] = []
    const fetchMock: MetaFetch = async (input) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/conversations')) {
        return jsonResponse({
          data: [{ id: 'provider-thread', messages: { data: refs } }],
        })
      }
      const id = url.pathname.split('/').at(-1) ?? ''
      detailIds.push(id)
      const ref = refs.find((candidate) => candidate.id === id)
      return jsonResponse({
        id,
        created_time: ref?.created_time,
        from: { id: 'contact-1', username: 'customer' },
        to: { data: [{ id: 'ig-business' }] },
        message: id,
      })
    }
    const sleep = vi.fn(async () => undefined)

    const result = await backfillInstagramConversations({ env, fetch: fetchMock, sleep })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.messagesFetched).toBe(20)
    expect(detailIds).toHaveLength(20)
    expect(detailIds).toContain('message-23')
    expect(detailIds).toContain('message-4')
    expect(detailIds).not.toContain('message-3')
    expect(result.truncated).toBe(true)
    expect(result.partialErrors.join(' ')).toContain('capped at 20 new IDs')
    // One conversations call plus twenty detail calls, spaced at 2 requests/sec.
    expect(sleep).toHaveBeenCalledTimes(20)

    const importedFirstBatch = [...detailIds]
    detailIds.length = 0
    sleep.mockClear()
    const nextBatch = await backfillInstagramConversations({
      env,
      fetch: fetchMock,
      sleep,
      excludeMessageIds: importedFirstBatch,
    })
    expect(nextBatch.ok).toBe(true)
    if (!nextBatch.ok) throw new Error(nextBatch.error)
    expect(detailIds.sort()).toEqual(['message-1', 'message-2', 'message-3'])
    expect(nextBatch.messagesFetched).toBe(3)
    expect(nextBatch.truncated).toBe(false)
  })

  it('keeps detail failures partial and never leaks a token from Meta error text', async () => {
    const fetchMock: MetaFetch = async (input) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/conversations')) {
        return jsonResponse({
          data: [
            {
              id: 'thread-1',
              messages: { data: [{ id: 'broken-message' }] },
            },
          ],
        })
      }
      return jsonResponse(
        { error: { code: 4, message: 'Rate limited token history-secret' } },
        429,
      )
    }

    const result = await backfillInstagramConversations({
      env,
      fetch: fetchMock,
      sleep: async () => undefined,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.messagesFetched).toBe(0)
    expect(result.messages).toEqual([])
    expect(result.partialErrors.join(' ')).toContain('[REDACTED]')
    expect(JSON.stringify(result)).not.toContain('history-secret')
  })
})

describe('WhatsApp history', () => {
  it('returns an explicit unsupported result instead of pretending Cloud API can backfill', async () => {
    await expect(getWhatsAppHistory()).resolves.toEqual({
      ok: false,
      unsupported: true,
      code: 'whatsapp_history_unsupported',
      reason: 'cloud_api_has_no_history_endpoint',
      error:
        'WhatsApp Cloud API does not provide a normal message-history endpoint; ingest new messages from signed webhooks instead.',
    })
  })
})
