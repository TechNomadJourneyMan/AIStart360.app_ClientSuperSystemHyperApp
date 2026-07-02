/**
 * tests/unit/assistant-mascot/sanitize.test.ts — PII masking on LLM-bound
 * qualitative text (docs/TZ-mascot-assistant.md §11.5, §18.2).
 */

import { describe, expect, it } from 'vitest'
import { maskPii, sanitizeQualitative } from '@/lib/assistant/mascot/sanitize'

describe('maskPii', () => {
  it('masks emails', () => {
    expect(maskPii('пишите на ivan.petrov+1@mail.kz срочно')).toBe(
      'пишите на [email скрыт] срочно',
    )
  })

  it('masks +7 phone numbers with separators', () => {
    expect(maskPii('звоните +7 777 123-45-67 после обеда')).toContain('[телефон скрыт]')
    expect(maskPii('офис: 8(727)250-11-22')).toContain('[телефон скрыт]')
    expect(maskPii('моб 87771234567')).toContain('[телефон скрыт]')
  })

  it('leaves money amounts intact', () => {
    const s = 'выручка 12000000 тенге, цель 250000000'
    expect(maskPii(s)).toBe(s)
  })

  it('masks URLs before the phone pass', () => {
    expect(maskPii('сайт https://example.kz/page?id=87771234567')).toBe(
      'сайт [ссылка скрыта]',
    )
    expect(maskPii('см. www.example.com тут')).toBe('см. [ссылка скрыта] тут')
  })

  it('handles empty input', () => {
    expect(maskPii('')).toBe('')
  })
})

describe('sanitizeQualitative', () => {
  it('masks, trims and caps at the limit', () => {
    const long = `  ${'а'.repeat(400)} ivan@x.kz `
    const out = sanitizeQualitative(long)
    expect(out.length).toBeLessThanOrEqual(280)
    expect(out.startsWith('а')).toBe(true)
  })
})
