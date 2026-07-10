import { describe, expect, it } from 'vitest'
import {
  buildTelegramPersonalLink,
  buildTelegramDeepLink,
  createTelegramPersonalLinkCode,
  createTelegramLinkToken,
  extractTelegramLinkToken,
  hashTelegramLinkToken,
  isPrivateTextMessage,
  parseTelegramCommand,
  splitTelegramText,
} from '@/lib/telegram/private-bot'

describe('telegram private bot helpers', () => {
  it('creates opaque link tokens and stores only deterministic hashes', () => {
    const token = createTelegramLinkToken()

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeGreaterThanOrEqual(30)
    expect(hashTelegramLinkToken(token)).toBe(hashTelegramLinkToken(token))
    expect(hashTelegramLinkToken(token)).not.toBe(token)
  })

  it('creates human-sendable personal account link codes', () => {
    const code = createTelegramPersonalLinkCode()

    expect(code).toMatch(/^AISTART-[A-F0-9]{10}$/)
    expect(extractTelegramLinkToken(code)).toBe(code)
    expect(extractTelegramLinkToken(`/link ${code.toLowerCase()}`)).toBe(code)
    expect(extractTelegramLinkToken('обычный вопрос')).toBeNull()
  })

  it('parses bot commands with optional bot username', () => {
    expect(parseTelegramCommand('/start abc123')).toEqual({ command: 'start', argsText: 'abc123' })
    expect(parseTelegramCommand('/help@aistart360_bot')).toEqual({ command: 'help', argsText: '' })
    expect(parseTelegramCommand('обычный вопрос')).toBeNull()
  })

  it('accepts only private text messages from humans', () => {
    expect(
      isPrivateTextMessage({
        message_id: 1,
        chat: { id: 1, type: 'private' },
        from: { id: 1, is_bot: false },
        text: 'Привет',
      }),
    ).toBe(true)

    expect(
      isPrivateTextMessage({
        message_id: 1,
        chat: { id: -1, type: 'group' },
        from: { id: 1, is_bot: false },
        text: 'Привет',
      }),
    ).toBe(false)

    expect(
      isPrivateTextMessage({
        message_id: 1,
        chat: { id: 1, type: 'private' },
        from: { id: 1, is_bot: true },
        text: 'Привет',
      }),
    ).toBe(false)
  })

  it('builds deep links and splits long Telegram messages safely', () => {
    expect(buildTelegramDeepLink('@aistart360_bot', 'abc 123')).toBe(
      'https://t.me/aistart360_bot?start=abc%20123',
    )
    expect(buildTelegramPersonalLink('@renat')).toBe('https://t.me/renat')

    const chunks = splitTelegramText('x '.repeat(5000), 100)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true)
  })
})
