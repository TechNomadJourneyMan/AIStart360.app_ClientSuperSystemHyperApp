/**
 * Telegram update → normalized inbox message (lib/omnichannel/telegram-webhook.ts).
 */
import { describe, expect, it } from 'vitest'
import {
  parseTelegramInboxUpdate,
  telegramAccountExternalId,
  telegramUpdateEventHash,
} from '@/lib/omnichannel/telegram-webhook'

const BUSINESS = { kind: 'business_bot' as const, botId: '7000000001', botUsername: 'honor_shop_bot' }
const CLIENT = { kind: 'client_bot' as const, botId: '6000000002', botUsername: 'aistart360_bot' }
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)
const DATE = Math.floor(NOW / 1000) - 30

function update(message: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    update_id: 501,
    message: {
      message_id: 77,
      date: DATE,
      chat: { id: 123456789, type: 'private' },
      from: { id: 123456789, is_bot: false, first_name: 'Айгерим', last_name: 'К.', username: 'aigerim' },
      ...message,
    },
    ...extra,
  }
}

describe('parseTelegramInboxUpdate', () => {
  it('maps a private text message of the business bot', () => {
    const parsed = parseTelegramInboxUpdate(update({ text: '  Здравствуйте, есть куртки?  ' }), BUSINESS, NOW)
    expect(parsed).not.toBeNull()
    const m = parsed!.message
    expect(m.channel).toBe('telegram')
    expect(m.accountExternalId).toBe('tgbot:7000000001')
    expect(m.conversationExternalId).toBe('123456789')
    expect(m.contactExternalId).toBe('tgbot:7000000001:123456789')
    expect(m.externalMessageId).toBe('tgbot:7000000001:123456789:77')
    expect(m.text).toBe('Здравствуйте, есть куртки?')
    expect(m.messageType).toBe('text')
    expect(m.contactName).toBe('Айгерим К.')
    expect(m.contactUsername).toBe('aigerim')
    expect(m.contactPhone).toBeNull()
    expect(m.occurredAt).toBe(new Date(DATE * 1000).toISOString())
    expect(m.metadata).toMatchObject({
      transport: 'telegram_bot',
      telegramSource: 'business_bot',
      telegramBotId: '7000000001',
      telegramBotUsername: 'honor_shop_bot',
      telegramChatId: '123456789',
      telegramMessageId: 77,
      telegramUpdateId: 501,
    })
  })

  it('a photo caption becomes text of an image message', () => {
    const parsed = parseTelegramInboxUpdate(update({ photo: [{ file_id: 'x' }], caption: 'Такой размер есть?' }), BUSINESS, NOW)
    expect(parsed?.message.messageType).toBe('image')
    expect(parsed?.message.text).toBe('Такой размер есть?')
  })

  it('media without caption is kept as a typed message with no text', () => {
    const parsed = parseTelegramInboxUpdate(update({ voice: { file_id: 'v' } }), BUSINESS, NOW)
    expect(parsed?.message.messageType).toBe('audio')
    expect(parsed?.message.text).toBeNull()
  })

  it('ignores groups, bots, service messages and malformed updates', () => {
    expect(parseTelegramInboxUpdate(update({ text: 'hi', chat: { id: -100, type: 'supergroup' } }), BUSINESS, NOW)).toBeNull()
    expect(parseTelegramInboxUpdate(update({ text: 'hi', from: { id: 5, is_bot: true } }), BUSINESS, NOW)).toBeNull()
    expect(parseTelegramInboxUpdate(update({ new_chat_title: 'x' }), BUSINESS, NOW)).toBeNull()
    expect(parseTelegramInboxUpdate({ update_id: 'x', message: {} }, BUSINESS, NOW)).toBeNull()
    expect(parseTelegramInboxUpdate(null, BUSINESS, NOW)).toBeNull()
  })

  it('rejects a provider timestamp from the future', () => {
    const future = Math.floor(NOW / 1000) + 3600
    expect(parseTelegramInboxUpdate(update({ text: 'hi', date: future }), BUSINESS, NOW)).toBeNull()
  })

  it('an edited message gets its own id (dedupe-safe) and the edit flag', () => {
    const parsed = parseTelegramInboxUpdate(
      { update_id: 502, edited_message: { ...update({ text: 'исправил' }).message, edit_date: DATE + 10 } },
      BUSINESS,
      NOW,
    )
    expect(parsed?.edited).toBe(true)
    expect(parsed?.message.externalMessageId).toBe(`tgbot:7000000001:123456789:77:edit:${DATE + 10}`)
    expect(parsed?.message.metadata.edited).toBe(true)
  })

  it('the client bot source uses its own account namespace', () => {
    const parsed = parseTelegramInboxUpdate(update({ text: 'Здравствуйте' }), CLIENT, NOW)
    expect(parsed?.message.accountExternalId).toBe('tgclient:6000000002')
    expect(parsed?.message.metadata.transport).toBe('telegram_client_bot')
    expect(parsed?.message.metadata.telegramSource).toBe('client_bot')
  })

  it('the update event hash is stable per bot account and update id', () => {
    const a = telegramUpdateEventHash(telegramAccountExternalId(BUSINESS), 501)
    expect(a).toBe(telegramUpdateEventHash('tgbot:7000000001', 501))
    expect(a).not.toBe(telegramUpdateEventHash('tgclient:7000000001', 501))
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })
})
