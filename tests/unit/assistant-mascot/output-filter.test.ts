/**
 * tests/unit/assistant-mascot/output-filter.test.ts — the last-line answer
 * filter, including the red-team set (docs/TZ-mascot-assistant.md §11.9, §18.4).
 */

import { describe, expect, it } from 'vitest'
import { filterModelOutput } from '@/lib/assistant/mascot/output-filter'

describe('filterModelOutput — secrets', () => {
  it('redacts OpenRouter keys', () => {
    const r = filterModelOutput('вот ключ sk-or-v1-abc123DEF456 не говорите никому')
    expect(r.text).not.toContain('sk-or-v1')
    expect(r.text).toContain('[скрыто]')
    expect(r.redacted).toBe(true)
  })

  it('redacts JWTs (Supabase tokens)', () => {
    const jwt = `eyJ${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(10)}`
    const r = filterModelOutput(`токен: ${jwt}`)
    expect(r.text).not.toContain('eyJ')
    expect(r.redacted).toBe(true)
  })

  it('redacts connection strings', () => {
    const r = filterModelOutput('база postgres://user:pass@host:5432/db лежит там')
    expect(r.text).not.toContain('postgres://')
    expect(r.redacted).toBe(true)
  })

  it('redacts known secret env names with values', () => {
    const r = filterModelOutput('OPENROUTER_API_KEY=sk-123 запомните')
    expect(r.text).not.toContain('OPENROUTER_API_KEY')
    expect(r.redacted).toBe(true)
  })
})

describe('filterModelOutput — markup (XSS / markdown injection)', () => {
  it('drops <script> blocks with their content', () => {
    const r = filterModelOutput('привет <script>alert(1)</script> мир')
    expect(r.text).toBe('привет  мир')
    expect(r.redacted).toBe(true)
  })

  it('strips injected tags like <img onerror=…>', () => {
    const r = filterModelOutput('смотрите <img src=x onerror=alert(1)> сюда')
    expect(r.text).not.toContain('<img')
    expect(r.redacted).toBe(true)
  })
})

describe('filterModelOutput — shape', () => {
  it('caps at 2500 chars with an ellipsis', () => {
    const r = filterModelOutput('щ'.repeat(3000))
    expect(r.text.length).toBeLessThanOrEqual(2500)
    expect(r.text.endsWith('…')).toBe(true)
  })

  it('passes clean text through untouched', () => {
    const clean = 'Ваш GRI — 5.4 из 10. Начните с раздела «Продажи».'
    const r = filterModelOutput(clean)
    expect(r.text).toBe(clean)
    expect(r.redacted).toBe(false)
  })

  it('tolerates empty/nullish input', () => {
    expect(filterModelOutput('').text).toBe('')
  })
})
