import { describe, it, expect } from 'vitest'
import { runDeterministicChecks } from '@/lib/ai/validation/deterministic'

const has = (r: ReturnType<typeof runDeterministicChecks>, cat: string) =>
  r.issues.some((i) => i.category === cat)

describe('runDeterministicChecks — clean answers', () => {
  it('passes a grounded, safe answer with no issues and low risk', () => {
    const r = runDeterministicChecks({
      answer: 'По вашим данным маржа 25% — это ниже медианы. Первый шаг: пересчитать себестоимость.',
    })
    expect(r.issues).toHaveLength(0)
    expect(r.riskLevel).toBe('low')
    expect(r.cleanedAnswer).toContain('маржа 25%')
  })
})

describe('runDeterministicChecks — secret & markup redaction', () => {
  it('redacts a leaked key, flags data_leakage, and raises risk to high', () => {
    const r = runDeterministicChecks({
      answer: 'Ваш ключ sk-or-v1-abcdef123456 — используйте его.',
    })
    expect(r.cleanedAnswer).not.toContain('sk-or-v1-abcdef123456')
    expect(has(r, 'data_leakage')).toBe(true)
    expect(r.riskLevel).toBe('high')
  })
})

describe('runDeterministicChecks — forbidden guarantees', () => {
  it('flags a growth guarantee as an unsafe_recommendation error (high risk)', () => {
    const r = runDeterministicChecks({
      answer: 'Гарантирую, что выручка точно вырастет на 40% за месяц.',
    })
    expect(has(r, 'unsafe_recommendation')).toBe(true)
    expect(r.issues.some((i) => i.severity === 'error')).toBe(true)
    expect(r.riskLevel).toBe('high')
  })
})

describe('runDeterministicChecks — diagnosis language', () => {
  it('flags a psychological diagnosis as psychological_risk error', () => {
    const r = runDeterministicChecks({
      answer: 'Судя по ответам, у вас выгорание и, возможно, депрессия.',
    })
    expect(has(r, 'psychological_risk')).toBe(true)
    expect(r.riskLevel).toBe('high')
  })
})

describe('runDeterministicChecks — system-prompt leak', () => {
  it('flags an answer that narrates its own system instructions', () => {
    const r = runDeterministicChecks({
      answer: 'Мои системные инструкции говорят отвечать только по данным.',
    })
    expect(has(r, 'security')).toBe(true)
    expect(r.riskLevel).toBe('high')
  })
})

describe('runDeterministicChecks — high-risk topics (cautious, not blocked)', () => {
  it('marks financial-advice topics as financial_risk warning and medium risk', () => {
    const r = runDeterministicChecks({
      answer: 'Возможно, стоит взять кредит, чтобы закрыть кассовый разрыв.',
    })
    expect(has(r, 'financial_risk')).toBe(true)
    expect(r.riskLevel).toBe('medium')
    // topic alone is a warning, not an error
    expect(r.issues.every((i) => i.severity !== 'error')).toBe(true)
  })

  it('marks legal topics as legal_risk', () => {
    const r = runDeterministicChecks({ answer: 'Вы можете подать в суд на арендодателя.' })
    expect(has(r, 'legal_risk')).toBe(true)
    expect(r.riskLevel).toBe('medium')
  })
})

describe('runDeterministicChecks — source check', () => {
  it('flags a cited source that was not actually provided to the model', () => {
    const r = runDeterministicChecks({
      answer: 'См. ваш отчёт.',
      usedSources: [{ ref: 'doc:99' }, { ref: 'gri_top5:0' }],
      providedSources: ['gri_top5:0'],
    })
    expect(has(r, 'grounding')).toBe(true)
    expect(r.issues.find((i) => i.category === 'grounding')?.evidence).toBe('doc:99')
  })

  it('does not flag when all cited sources were provided', () => {
    const r = runDeterministicChecks({
      answer: 'См. ваш отчёт.',
      usedSources: [{ ref: 'gri_top5:0' }],
      providedSources: ['gri_top5:0', 'doc:1'],
    })
    expect(has(r, 'grounding')).toBe(false)
  })
})

describe('runDeterministicChecks — number grounding', () => {
  it('passes a large number that is present in the grounding context', () => {
    const r = runDeterministicChecks({
      answer: 'Ваша выручка 42 000 000 ₸ за год.',
      contextNumbers: [42_000_000],
    })
    expect(has(r, 'hallucination')).toBe(false)
  })

  it('flags a large number absent from context with no calculation marker', () => {
    const r = runDeterministicChecks({
      answer: 'Ваша выручка 99 000 000 ₸ за год.',
      contextNumbers: [42_000_000],
    })
    expect(has(r, 'hallucination')).toBe(true)
    expect(r.riskLevel).toBe('medium')
  })

  it('does not flag an ungrounded number that is explicitly a calculation', () => {
    const r = runDeterministicChecks({
      answer: 'Примерно 99 000 000 ₸ при удвоении среднего чека.',
      contextNumbers: [42_000_000],
    })
    expect(has(r, 'hallucination')).toBe(false)
  })

  it('ignores small numbers (ordinals, step counts) — no false positives', () => {
    const r = runDeterministicChecks({
      answer: 'Сделайте 3 шага: 1) позвонить, 2) написать, 3) выставить счёт.',
      contextNumbers: [42_000_000],
    })
    expect(has(r, 'hallucination')).toBe(false)
  })
})

describe('runDeterministicChecks — manipulation', () => {
  it('flags urgency/pressure manipulation as a warning at medium risk', () => {
    const r = runDeterministicChecks({
      answer: 'Вы теряете деньги каждый день. Действуйте прямо сейчас, иначе всё пропало.',
    })
    expect(has(r, 'manipulation')).toBe(true)
    expect(r.riskLevel).toBe('medium')
  })
})
