import { describe, it, expect } from 'vitest'
import { runAnswerValidation } from '@/lib/ai/validation'
import { getTemplate, renderTemplate, TEMPLATE_IDS } from '@/lib/ai/validation/templates'

describe('templates library', () => {
  it('defines the 17 safe-response templates, each with non-empty text', () => {
    expect(TEMPLATE_IDS).toHaveLength(17)
    for (const id of TEMPLATE_IDS) {
      const t = getTemplate(id)
      expect(t).not.toBeNull()
      expect(t!.text.length).toBeGreaterThan(10)
    }
  })

  it('fills placeholders when rendering', () => {
    const text = renderTemplate('T1', { missing: 'финансовые данные' })
    expect(text).toContain('финансовые данные')
  })
})

describe('runAnswerValidation — deterministic only (no LLM)', () => {
  it('approves a clean answer and returns it verbatim (after cleaning)', async () => {
    const r = await runAnswerValidation({ answer: 'По вашим данным маржа 25%. Первый шаг: пересчитать себестоимость.' })
    expect(r.status).toBe('approved')
    expect(r.finalAnswer).toContain('маржа 25%')
    expect(r.usedLlm).toBe(false)
  })

  it('blocks a diagnosis with the psychological template T10', async () => {
    const r = await runAnswerValidation({ answer: 'У вас выгорание и депрессия.' })
    expect(r.status).toBe('blocked')
    expect(r.templateId).toBe('T10')
    expect(r.finalAnswer).toBe(renderTemplate('T10'))
  })

  it('blocks a leaked secret with the safe-refusal template T16', async () => {
    const r = await runAnswerValidation({ answer: 'Ключ sk-or-v1-abcdef123456.' })
    expect(r.status).toBe('blocked')
    expect(r.templateId).toBe('T16')
  })

  it('falls back to the cautious template when a guarantee cannot be rewritten', async () => {
    const r = await runAnswerValidation({ answer: 'Гарантирую рост выручки на 40%.' })
    expect(r.status).toBe('needs_revision')
    expect(r.finalAnswer).not.toContain('Гарантирую')
    expect(r.finalAnswer).toBe(renderTemplate('T2'))
  })
})

describe('runAnswerValidation — with an injected LLM validator', () => {
  it('uses the LLM rewrite when it fixes a flagged answer', async () => {
    const r = await runAnswerValidation(
      { answer: 'Гарантирую рост выручки на 40%.' },
      {
        llmValidate: async () => ({ status: 'needs_revision', rewrittenAnswer: 'Возможен рост, но зависит от рынка.' }),
      },
    )
    expect(r.usedLlm).toBe(true)
    expect(r.finalAnswer).toBe('Возможен рост, но зависит от рынка.')
  })

  it('lets the LLM escalate a subtly-wrong answer to blocked', async () => {
    const r = await runAnswerValidation(
      { answer: 'Обычный ответ.' },
      { llmValidate: async () => ({ status: 'blocked', templateId: 'T16' }) },
    )
    expect(r.status).toBe('blocked')
    expect(r.finalAnswer).toBe(renderTemplate('T16'))
  })

  it('degrades safely when the LLM validator throws on a high-risk answer', async () => {
    const r = await runAnswerValidation(
      { answer: 'Возможно, стоит взять кредит для покрытия разрыва.' }, // financial → medium risk
      { llmValidate: async () => { throw new Error('LLM down') } },
    )
    // On a risk≥medium answer, a failed validator must not pass the raw answer.
    expect(r.status).not.toBe('approved')
    expect(r.finalAnswer).toBe(renderTemplate('T2'))
  })

  it('does not call the LLM for a clearly clean, low-risk answer (cost control)', async () => {
    let called = false
    const r = await runAnswerValidation(
      { answer: 'Хороший вопрос. Первый шаг — записать текущие расходы.' },
      { llmValidate: async () => { called = true; return { status: 'approved' } }, llmMode: 'risk_based' },
    )
    expect(called).toBe(false)
    expect(r.status).toBe('approved')
  })
})
