import { describe, expect, it } from 'vitest'
import {
  createCatchUpLimiter,
  createUnreadHistoryAccumulator,
  HISTORY_SYNC_TYPE,
  isCatchUpTimestampAllowed,
  selectUnreadHistoryMessages,
} from '../../../services/whatsapp-web-bridge/catch-up-policy.mjs'

function historyMessage({
  id,
  chat = '77000000001@s.whatsapp.net',
  timestamp,
  fromMe = false,
  remoteJidAlt,
  message = { conversation: id },
}: {
  id: string
  chat?: string
  timestamp: number
  fromMe?: boolean
  remoteJidAlt?: string
  message?: Record<string, unknown> | null
}) {
  return {
    key: {
      id,
      remoteJid: chat,
      fromMe,
      ...(remoteJidAlt ? { remoteJidAlt } : {}),
    },
    messageTimestamp: timestamp,
    message,
  }
}

describe('WhatsApp Web catch-up policy', () => {
  it('enforces both the total and per-chat budgets across batches', () => {
    const limiter = createCatchUpLimiter({ maxTotal: 4, maxPerChat: 2 })

    expect(limiter.tryAccept('chat-a')).toBe(true)
    expect(limiter.tryAccept('chat-a')).toBe(true)
    expect(limiter.tryAccept('chat-a')).toBe(false)
    expect(limiter.tryAccept('chat-b')).toBe(true)
    expect(limiter.tryAccept('chat-c')).toBe(true)
    expect(limiter.tryAccept('chat-d')).toBe(false)
    expect(limiter.snapshot()).toEqual({
      acceptedTotal: 4,
      chats: 3,
      duplicatesSkipped: 0,
      limitedSkipped: 2,
      maxTotal: 4,
      maxPerChat: 2,
    })
  })

  it('deduplicates provider IDs and merges late PN/LID aliases for quota', () => {
    const phone = '77000000001@s.whatsapp.net'
    const lid = '123456789012345@lid'
    const limiter = createCatchUpLimiter({ maxTotal: 5, maxPerChat: 2 })

    expect(limiter.tryAcceptMessage({ chatId: phone, messageId: 'message-1' }))
      .toBe('accepted')
    expect(limiter.tryAcceptMessage({ chatId: lid, messageId: 'message-2' }))
      .toBe('accepted')
    expect(limiter.tryAcceptMessage({ chatId: lid, messageId: 'message-1' }))
      .toBe('duplicate')
    expect(limiter.registerAliases([phone, lid])).toBe(true)
    expect(limiter.tryAcceptMessage({
      chatId: lid,
      messageId: 'message-3',
      aliases: [phone],
    })).toBe('limited')

    expect(limiter.snapshot()).toEqual({
      acceptedTotal: 2,
      chats: 1,
      duplicatesSkipped: 1,
      limitedSkipped: 1,
      maxTotal: 5,
      maxPerChat: 2,
    })
  })

  it('accepts only timestamps inside the bounded offline window', () => {
    const nowMs = 1_750_000_000_000
    const maxAgeSeconds = 14 * 24 * 60 * 60
    const allowed = (timestampMs: number) => isCatchUpTimestampAllowed({
      timestampMs,
      nowMs,
      maxAgeSeconds,
      futureSkewSeconds: 60,
    })

    expect(allowed(nowMs - maxAgeSeconds * 1000)).toBe(true)
    expect(allowed(nowMs - maxAgeSeconds * 1000 - 1)).toBe(false)
    expect(allowed(nowMs + 60_000)).toBe(true)
    expect(allowed(nowMs + 60_001)).toBe(false)
  })

  it('rejects invalid limiter configuration', () => {
    expect(() => createCatchUpLimiter({ maxTotal: 0, maxPerChat: 2 })).toThrow()
    expect(() => createCatchUpLimiter({ maxTotal: 2, maxPerChat: 0 })).toThrow()
  })

  it('selects only the newest unread inbound messages and returns them chronologically', () => {
    const chatA = '77000000001@s.whatsapp.net'
    const chatB = '77000000002@s.whatsapp.net'
    const messages = [
      historyMessage({ id: 'a-newest', chat: chatA, timestamp: 500 }),
      historyMessage({ id: 'read-chat', chat: '77000000003@s.whatsapp.net', timestamp: 490 }),
      historyMessage({ id: 'a-second', chat: chatA, timestamp: 400 }),
      historyMessage({ id: 'b-unread', chat: chatB, timestamp: 350 }),
      historyMessage({ id: 'a-already-read', chat: chatA, timestamp: 300 }),
      historyMessage({ id: 'b-already-read', chat: chatB, timestamp: 250 }),
    ]

    const selected = selectUnreadHistoryMessages({
      chats: [
        { id: chatA, unreadCount: 2 },
        { id: chatB, unreadCount: 1 },
        { id: '77000000003@s.whatsapp.net', unreadCount: 0 },
      ],
      messages,
    })

    expect(selected.map(({ message }) => message.key.id)).toEqual([
      'b-unread',
      'a-second',
      'a-newest',
    ])
    expect(messages.map((message) => message.key.id)).toEqual([
      'a-newest',
      'read-chat',
      'a-second',
      'b-unread',
      'a-already-read',
      'b-already-read',
    ])
  })

  it('rejects groups, status, self, protocol, malformed, and duplicate history messages', () => {
    const chat = '77000000001@s.whatsapp.net'
    const selected = selectUnreadHistoryMessages({
      chats: [
        { id: chat, unreadCount: 10 },
        { id: '120363000000000000@g.us', unreadCount: 10 },
        { id: 'status@broadcast', unreadCount: 10 },
      ],
      messages: [
        historyMessage({ id: 'valid', chat, timestamp: 900 }),
        historyMessage({ id: 'valid', chat, timestamp: 900 }),
        historyMessage({ id: 'self', chat, timestamp: 800, fromMe: true }),
        historyMessage({
          id: 'protocol',
          chat,
          timestamp: 700,
          message: { protocolMessage: { type: 5 } },
        }),
        historyMessage({
          id: 'wrapped-protocol',
          chat,
          timestamp: 600,
          message: { ephemeralMessage: { message: { protocolMessage: { type: 5 } } } },
        }),
        historyMessage({ id: 'group', chat: '120363000000000000@g.us', timestamp: 500 }),
        historyMessage({ id: 'status', chat: 'status@broadcast', timestamp: 400 }),
        historyMessage({ id: 'no-content', chat, timestamp: 300, message: null }),
        historyMessage({ id: 'bad-time', chat, timestamp: 0 }),
      ],
    })

    expect(selected.map(({ message }) => message.key.id)).toEqual(['valid'])
  })

  it('does not replace a non-importable unread event with an older read message', () => {
    const chat = '77000000001@s.whatsapp.net'
    const selected = selectUnreadHistoryMessages({
      chats: [{ id: chat, unreadCount: 1 }],
      messages: [
        historyMessage({
          id: 'newest-unread-protocol',
          chat,
          timestamp: 200,
          message: { protocolMessage: { type: 5 } },
        }),
        historyMessage({ id: 'older-already-read', chat, timestamp: 100 }),
      ],
    })

    expect(selected).toEqual([])
  })

  it('matches LID/phone aliases while sharing one unread quota', () => {
    const lid = '123456789012345@lid'
    const phone = '77000000001@s.whatsapp.net'
    const selected = selectUnreadHistoryMessages({
      chats: [{ id: lid, pnJid: phone, unreadCount: 2 }],
      messages: [
        historyMessage({ id: 'phone-new', chat: phone, remoteJidAlt: lid, timestamp: 300 }),
        historyMessage({ id: 'lid-middle', chat: lid, remoteJidAlt: phone, timestamp: 200 }),
        historyMessage({ id: 'phone-old-read', chat: phone, remoteJidAlt: lid, timestamp: 100 }),
      ],
    })

    expect(selected.map(({ chatId, message }) => [chatId, message.key.id])).toEqual([
      [lid, 'lid-middle'],
      [lid, 'phone-new'],
    ])
  })

  it('uses reverse-history position as the stable timestamp tie-breaker', () => {
    const chat = '77000000001@s.whatsapp.net'
    const selected = selectUnreadHistoryMessages({
      chats: [{ id: chat, unreadCount: 2 }],
      messages: [
        historyMessage({ id: 'newer-in-input', chat, timestamp: 100 }),
        historyMessage({ id: 'older-in-input', chat, timestamp: 100 }),
        historyMessage({ id: 'outside-quota', chat, timestamp: 100 }),
      ],
    })

    expect(selected.map(({ message }) => message.key.id)).toEqual([
      'older-in-input',
      'newer-in-input',
    ])
  })

  describe('unread history accumulator', () => {
    const initial = HISTORY_SYNC_TYPE.INITIAL_BOOTSTRAP
    const recent = HISTORY_SYNC_TYPE.RECENT
    const ids = (result: ReturnType<ReturnType<typeof createUnreadHistoryAccumulator>['add']>) =>
      result.selected.map(({ message }: { message: { key: { id: string } } }) => message.key.id)

    it('applies a repeated unread quota once across all chunks', () => {
      const chat = '77000000001@s.whatsapp.net'
      const accumulator = createUnreadHistoryAccumulator()

      expect(accumulator.add({
        syncType: initial,
        progress: 100,
        chats: [{ id: chat, unreadCount: 1 }],
        messages: [historyMessage({ id: 'older', chat, timestamp: 100 })],
      }).status).toBe('buffering')

      const ready = accumulator.add({
        syncType: recent,
        progress: 100,
        chats: [{ id: chat, unreadCount: 1 }],
        messages: [historyMessage({ id: 'newest', chat, timestamp: 200 })],
      })
      expect(ready.status).toBe('ready')
      expect(ids(ready)).toEqual(['newest'])
      expect(accumulator.add({
        syncType: recent,
        progress: 100,
        chats: [],
        messages: [],
      }).status).toBe('closed')
    })

    it('selects the same newest unread message when chunk arrival is reversed', () => {
      const chat = '77000000001@s.whatsapp.net'
      const run = (first: ReturnType<typeof historyMessage>, last: ReturnType<typeof historyMessage>) => {
        const accumulator = createUnreadHistoryAccumulator()
        accumulator.add({
          syncType: recent,
          progress: 50,
          chats: [{ id: chat, unreadCount: 1 }],
          messages: [first],
        })
        return accumulator.add({
          syncType: recent,
          progress: 100,
          chats: [],
          messages: [last],
        })
      }
      const older = historyMessage({ id: 'older', chat, timestamp: 100 })
      const newer = historyMessage({ id: 'newer', chat, timestamp: 200 })

      expect(ids(run(older, newer))).toEqual(['newer'])
      expect(ids(run(newer, older))).toEqual(['newer'])
    })

    it('deduplicates the same provider message across chunks', () => {
      const chat = '77000000001@s.whatsapp.net'
      const duplicate = historyMessage({ id: 'same-id', chat, timestamp: 200 })
      const accumulator = createUnreadHistoryAccumulator()
      accumulator.add({
        syncType: initial,
        chats: [{ id: chat, unreadCount: 2 }],
        messages: [duplicate],
      })
      const ready = accumulator.add({
        syncType: recent,
        progress: 100,
        chats: [],
        messages: [duplicate],
      })

      expect(ids(ready)).toEqual(['same-id'])
    })

    it('lets a newer non-importable event consume the unread slot across chunks', () => {
      const chat = '77000000001@s.whatsapp.net'
      const accumulator = createUnreadHistoryAccumulator()
      accumulator.add({
        syncType: recent,
        progress: 40,
        chats: [{ id: chat, unreadCount: 1 }],
        messages: [historyMessage({ id: 'older-text', chat, timestamp: 100 })],
      })
      const ready = accumulator.add({
        syncType: recent,
        progress: 100,
        chats: [],
        messages: [historyMessage({
          id: 'newer-protocol',
          chat,
          timestamp: 200,
          message: { protocolMessage: { type: 5 } },
        })],
      })

      expect(ids(ready)).toEqual([])
    })

    it('merges PN/LID aliases into one quota across chunks', () => {
      const lid = '123456789012345@lid'
      const phone = '77000000001@s.whatsapp.net'
      const accumulator = createUnreadHistoryAccumulator()
      accumulator.add({
        syncType: initial,
        chats: [{ id: lid, unreadCount: 1 }],
        lidPnMappings: [{ lid, pn: phone }],
        messages: [historyMessage({ id: 'older-phone', chat: phone, timestamp: 100 })],
      })
      const ready = accumulator.add({
        syncType: recent,
        progress: 100,
        chats: [],
        messages: [historyMessage({ id: 'newer-lid', chat: lid, timestamp: 200 })],
      })

      expect(ids(ready)).toEqual(['newer-lid'])
    })

    it('clamps later unread zero and imports nothing', () => {
      const chat = '77000000001@s.whatsapp.net'
      const accumulator = createUnreadHistoryAccumulator()
      accumulator.add({
        syncType: initial,
        chats: [{ id: chat, unreadCount: 2 }],
        messages: [historyMessage({ id: 'candidate', chat, timestamp: 100 })],
      })
      const ready = accumulator.add({
        syncType: recent,
        progress: 100,
        chats: [{ id: chat, unreadCount: 0 }],
        messages: [],
      })

      expect(ids(ready)).toEqual([])
    })

    it('reports sanitized partial coverage without claiming all unread', () => {
      const chat = '77000000001@s.whatsapp.net'
      const accumulator = createUnreadHistoryAccumulator()
      const ready = accumulator.add({
        syncType: recent,
        progress: 100,
        chats: [{ id: chat, unreadCount: 3 }],
        messages: [
          historyMessage({ id: 'visible', chat, timestamp: 200 }),
          historyMessage({
            id: 'filtered-protocol',
            chat,
            timestamp: 100,
            message: { protocolMessage: { type: 5 } },
          }),
        ],
      })

      expect(ready.status).toBe('ready')
      expect(ids(ready)).toEqual(['visible'])
      expect(ready.summary).toMatchObject({
        mode: 'unread_snapshot',
        partial: true,
        received: { chunks: 1, chats: 1, messages: 2 },
        unread: { declared: 3, candidates: 2, selected: 1, missing: 1 },
        filtered: { messages: 0, unread: 1, duplicates: 0 },
      })
      const serialized = JSON.stringify(ready.summary)
      expect(serialized).not.toContain(chat)
      expect(serialized).not.toContain('visible')
      expect(serialized).not.toContain('filtered-protocol')
    })

    it('keeps an apparently complete companion snapshot marked partial', () => {
      const chat = '77000000001@s.whatsapp.net'
      const accumulator = createUnreadHistoryAccumulator()
      const ready = accumulator.add({
        syncType: recent,
        progress: 100,
        chats: [{ id: chat, unreadCount: 1 }],
        messages: [historyMessage({ id: 'only-visible', chat, timestamp: 100 })],
      })

      expect(ready.summary).toMatchObject({
        partial: true,
        received: { chunks: 1, chats: 1, messages: 1 },
        unread: { declared: 1, candidates: 1, selected: 1, missing: 0 },
        filtered: { messages: 0, unread: 0, duplicates: 0 },
      })
    })

    it('keeps buffering after a complete status until RECENT progress reaches 100', () => {
      const chat = '77000000001@s.whatsapp.net'
      const accumulator = createUnreadHistoryAccumulator()
      accumulator.add({
        syncType: initial,
        chats: [{ id: chat, unreadCount: 1 }],
        messages: [historyMessage({ id: 'candidate', chat, timestamp: 100 })],
      })

      const milestone = accumulator.handleStatus({
        syncType: recent,
        status: 'complete',
        explicit: true,
      })
      expect(milestone).toMatchObject({
        status: 'status_observed',
        reason: 'complete_waiting_for_payload',
      })
      expect(accumulator.snapshot()).toMatchObject({
        closed: false,
        chats: 1,
        messages: 1,
      })

      const ready = accumulator.add({
        syncType: recent,
        progress: 100,
        chats: [],
        messages: [],
      })
      expect(ready.status).toBe('ready')
      expect(ids(ready)).toEqual(['candidate'])
    })

    it('fails closed on a paused history status and never releases a late payload', () => {
      const chat = '77000000001@s.whatsapp.net'
      const accumulator = createUnreadHistoryAccumulator()
      accumulator.add({
        syncType: recent,
        progress: 80,
        chats: [{ id: chat, unreadCount: 1 }],
        messages: [historyMessage({ id: 'must-not-release', chat, timestamp: 100 })],
      })

      const paused = accumulator.handleStatus({
        syncType: recent,
        status: 'paused',
        explicit: false,
      })
      expect(paused).toMatchObject({
        status: 'closed',
        reason: 'history_status_paused',
        selected: [],
        summary: { partial: true },
      })
      expect(accumulator.snapshot()).toMatchObject({
        closed: true,
        closureReason: 'history_status_paused',
        chats: 0,
        messages: 0,
      })

      const late = accumulator.add({
        syncType: recent,
        progress: 100,
        chats: [],
        messages: [],
      })
      expect(late).toMatchObject({ status: 'closed', selected: [] })
    })

    it.each([
      ['chunks', { maxChunks: 1, maxChats: 10, maxMessages: 10 }],
      ['chats', { maxChunks: 10, maxChats: 1, maxMessages: 10 }],
      ['messages', { maxChunks: 10, maxChats: 10, maxMessages: 1 }],
    ])('fails closed when the bounded %s budget is exceeded', (_dimension, limits) => {
      const chat = '77000000001@s.whatsapp.net'
      const accumulator = createUnreadHistoryAccumulator(limits)
      const first = accumulator.add({
        syncType: recent,
        progress: 50,
        chats: [{ id: chat, unreadCount: 2 }],
        messages: [historyMessage({ id: 'first', chat, timestamp: 100 })],
      })
      expect(first.status).toBe('buffering')

      const exceeded = accumulator.add({
        syncType: recent,
        progress: 100,
        chats: [{ id: chat, unreadCount: 2 }],
        messages: [historyMessage({ id: 'second', chat, timestamp: 200 })],
      })
      expect(exceeded).toMatchObject({
        status: 'closed',
        reason: 'history_buffer_limit_exceeded',
        selected: [],
        summary: { partial: true },
      })
      expect(accumulator.snapshot()).toMatchObject({
        closed: true,
        chats: 0,
        messages: 0,
      })
    })

    it('accepts bounded FULL chunks only in explicit maintenance mode', () => {
      const chat = '77000000001@s.whatsapp.net'
      const fullEvent = {
        syncType: HISTORY_SYNC_TYPE.FULL,
        progress: 50,
        chats: [{ id: chat, unreadCount: 0 }],
        messages: [historyMessage({ id: 'full-one', chat, timestamp: 100 })],
      }
      const normal = createUnreadHistoryAccumulator()
      expect(normal.add(fullEvent)).toMatchObject({
        status: 'ignored',
        reason: 'full_maintenance_disabled',
        selected: [],
        summary: { mode: 'full_maintenance', partial: true },
      })

      const maintenance = createUnreadHistoryAccumulator({
        allowFullSync: true,
        maxChunks: 1,
        maxChats: 2,
        maxMessages: 1,
      })
      const accepted = maintenance.add(fullEvent)
      expect(accepted.status).toBe('full_ready')
      expect(ids(accepted)).toEqual(['full-one'])
      expect(accepted.summary).toMatchObject({
        mode: 'full_maintenance',
        partial: true,
        received: { chunks: 1, chats: 1, messages: 1 },
        unread: null,
      })

      const second = maintenance.add({
        ...fullEvent,
        progress: 100,
        messages: [historyMessage({ id: 'full-two', chat, timestamp: 200 })],
      })
      expect(second).toMatchObject({
        status: 'closed',
        reason: 'history_buffer_limit_exceeded',
        selected: [],
      })
    })

    it('never re-adds a FULL message after conflicting duplicate timestamps', () => {
      const chat = '77000000001@s.whatsapp.net'
      const accumulator = createUnreadHistoryAccumulator({
        allowFullSync: true,
        maxChunks: 1,
        maxChats: 1,
        maxMessages: 3,
      })
      const result = accumulator.add({
        syncType: HISTORY_SYNC_TYPE.FULL,
        chats: [{ id: chat, unreadCount: 0 }],
        messages: [
          historyMessage({ id: 'conflict', chat, timestamp: 100 }),
          historyMessage({ id: 'conflict', chat, timestamp: 200 }),
          historyMessage({ id: 'conflict', chat, timestamp: 300 }),
        ],
      })

      expect(result.status).toBe('full_ready')
      expect(result.selected).toEqual([])
      expect(result.summary).toMatchObject({
        partial: true,
        filtered: { messages: 1, duplicates: 2 },
      })
    })

    it('rejects invalid accumulator bounds and maintenance configuration', () => {
      expect(() => createUnreadHistoryAccumulator({ maxChunks: 0 })).toThrow()
      expect(() => createUnreadHistoryAccumulator({ maxChats: 0 })).toThrow()
      expect(() => createUnreadHistoryAccumulator({ maxMessages: 0 })).toThrow()
      expect(() => createUnreadHistoryAccumulator({ allowFullSync: 'yes' as never }))
        .toThrow()
    })

    it('ignores unsafe sync types and fails closed without explicit RECENT 100', () => {
      const chat = '77000000001@s.whatsapp.net'
      const accumulator = createUnreadHistoryAccumulator()
      for (const syncType of [1, 2, 4, 5, 6]) {
        expect(accumulator.add({
          syncType,
          progress: 100,
          chats: [{ id: chat, unreadCount: 1 }],
          messages: [historyMessage({ id: `ignored-${syncType}`, chat, timestamp: 100 })],
        }).status).toBe('ignored')
      }
      expect(accumulator.add({
        syncType: initial,
        progress: 100,
        chats: [{ id: chat, unreadCount: 1 }],
        messages: [historyMessage({ id: 'buffered', chat, timestamp: 100 })],
      }).status).toBe('buffering')
      expect(accumulator.snapshot()).toMatchObject({
        closed: false,
        acceptedChunks: 1,
        messages: 1,
      })

      accumulator.discard()
      expect(accumulator.snapshot()).toMatchObject({ closed: true, messages: 0 })
    })
  })
})
