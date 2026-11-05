import { describe, it, expect } from 'vitest'
import { pointAChecks, present, textAnswerKind } from '@/lib/point-a-engine'
import { calculatePointAV4 } from '@/lib/point-a/v4/engine'
import { DEFAULT_TEMPLATE, effectiveBlocks } from '@/lib/point-a/v4/config'

const blocks = effectiveBlocks(DEFAULT_TEMPLATE)
const v4 = (answers: Record<string, unknown>) => calculatePointAV4({ answers, blocks })
const check = (answers: Record<string, unknown>, block: string, id: string) =>
  v4(answers).blocks.find((b) => b.key === block)!.checks.find((c) => c.id === id)!

describe('textAnswerKind — PO 2026-11-02: «не знаю» = нет данных, «ничего» = проблема', () => {
  it('«не знаю», «не считали» and the like are no data', () => {
    for (const s of ['не знаю', 'Не знаю.', 'не знаю точно', 'Пока не считали', 'не рассчитывали', 'нет данных', 'Затрудняюсь ответить', 'неизвестно', '?'])
      expect(textAnswerKind(s), s).toBe('unknown')
  })

  it('«ничего», «нет», «в тетради» are an answer that names nothing', () => {
    for (const s of ['Ничего', 'нет', 'Нет.', 'пока нет', 'нету', 'никакой', 'отсутствует', 'не используем', 'в тетради', 'на бумаге', '—'])
      expect(textAnswerKind(s), s).toBe('none')
  })

  it('a real text is named; blanks and non-strings are empty', () => {
    expect(textAnswerKind('Не хватает заявок')).toBe('named')
    expect(textAnswerKind('Нет системы продаж')).toBe('named')
    expect(textAnswerKind('   ')).toBe('empty')
    expect(textAnswerKind(null)).toBe('empty')
    expect(textAnswerKind(42)).toBe('empty')
  })

  it('a typed «не знаю» is not an answer, like the «Не знаю» button', () => {
    expect(present('не знаю')).toBe(false)
    expect(present({ value: null, unknown: true })).toBe(false)
    expect(present('Ничего')).toBe(true)
  })
})

describe('checks read «не знаю» as no data and «ничего» as a finding', () => {
  it('main pain «не знаю» is not answered and earns nothing', () => {
    const c = check({ s6_main_pain: 'не знаю' }, 'strategy', 'main_pain')
    expect(c.answered).toBe(false)
    expect(c.earned).toBe(0)
  })

  it('break-even «пока не считали» is no data, «нет» is a finding', () => {
    expect(check({ s9n_breakeven_point: 'пока не считали' }, 'finance', 'breakeven').answered).toBe(false)
    const no = check({ s9n_breakeven_point: 'нет' }, 'finance', 'breakeven')
    expect(no.answered).toBe(true)
    expect(no.earned).toBe(0)
    expect(no.issue).toBe('Точка безубыточности неизвестна')
  })

  it('moat «Ничего» is a finding with 0, «не знаю» is no data', () => {
    const none = check({ s3n_cannot_copy: 'Ничего' }, 'product', 'moat')
    expect(none.answered).toBe(true)
    expect(none.earned).toBe(0)
    expect(none.issue).toBe('Нет защиты от копирования')
    expect(check({ s3n_cannot_copy: 'не знаю' }, 'product', 'moat').answered).toBe(false)
  })

  it('CRM in Excel / Google Sheets is a partial CRM with a finding, not a full one', () => {
    const crm = pointAChecks({ s12_crm_tool: 'excel' }).sales.find((c) => c.id === 'crm')!
    expect(crm.earned).toBe(8)
    expect(crm.issue).toBe('CRM в таблицах — сделки и касания теряются')
    expect(crm.rec).toBe('Перенести воронку в amoCRM или Bitrix24')
    expect(pointAChecks({ s3_has_crm: 'в тетради' }).sales.find((c) => c.id === 'crm')!.earned).toBe(0)
    expect(pointAChecks({ s12_crm_tool: 'amocrm' }).sales.find((c) => c.id === 'crm')!.earned).toBe(20)
  })

  it('audience «не знаю» is no data, «нет» is the «not described» finding', () => {
    expect(check({ s5_target_audience: 'не знаю' }, 'marketing', 'audience').answered).toBe(false)
    const no = check({ s5_target_audience: 'нет' }, 'marketing', 'audience')
    expect(no.answered).toBe(true)
    expect(no.issue).toBe('Целевая аудитория не описана')
  })
})
