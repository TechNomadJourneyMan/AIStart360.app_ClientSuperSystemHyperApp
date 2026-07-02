/**
 * tests/unit/assistant-mascot/gree-chat.test.ts — the dialogue-memory core:
 * history sanitization and budget trimming (the safety half of the chat).
 */

import { describe, expect, it } from 'vitest'
import { HISTORY_LIMITS, prepareHistory, type ChatTurn } from '@/lib/assistant/gree-chat'

const turn = (role: ChatTurn['role'], content: string): ChatTurn => ({ role, content })

describe('prepareHistory', () => {
  it('keeps at most the last N turns, newest win', () => {
    const history = Array.from({ length: 15 }, (_, i) => turn('user', `сообщение ${i}`))
    const out = prepareHistory(history)
    expect(out.length).toBeLessThanOrEqual(HISTORY_LIMITS.maxTurns)
    expect(out[out.length - 1].content).toBe('сообщение 14')
  })

  it('PII-masks USER turns but leaves assistant turns intact', () => {
    const out = prepareHistory([
      turn('user', 'мой телефон +7 777 123-45-67, пишите'),
      turn('assistant', 'Записал контекст, продолжаем про GRI 6.2.'),
    ])
    expect(out[0].content).toContain('[телефон скрыт]')
    expect(out[1].content).toContain('GRI 6.2')
  })

  it('caps each turn and the total character budget', () => {
    const long = 'щ'.repeat(2000)
    const out = prepareHistory([
      turn('user', long),
      turn('assistant', long),
      turn('user', long),
      turn('assistant', long),
      turn('user', long),
      turn('assistant', long),
      turn('user', long),
      turn('assistant', long),
    ])
    for (const t of out) {
      expect(t.content.length).toBeLessThanOrEqual(HISTORY_LIMITS.maxTurnChars)
    }
    const total = out.reduce((n, t) => n + t.content.length, 0)
    expect(total).toBeLessThanOrEqual(HISTORY_LIMITS.totalBudgetChars)
    // The newest turn always survives the trim.
    expect(out[out.length - 1].role).toBe('assistant')
  })

  it('drops empty turns', () => {
    const out = prepareHistory([turn('user', '   '), turn('assistant', 'ответ')])
    expect(out).toHaveLength(1)
    expect(out[0].content).toBe('ответ')
  })
})
