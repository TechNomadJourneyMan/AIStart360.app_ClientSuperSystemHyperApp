import { describe, it, expect } from 'vitest'
import {
  computeDecisiveBets,
  GENERIC_EFFECT,
  GENERIC_FIRST_STEP,
} from '@/lib/gri/decisive-bets'

// Канонический Top5Limit — как его пишет app/api/v1/gri/assessment/route.ts.
const CANONICAL_LIMITS = [
  {
    criterionId: 'op-1',
    criterionText: 'Систематизация процессов',
    blockId: 'operations',
    blockName: 'Operations (Операции)',
    score: 2,
  },
  {
    criterionId: 'bm-1',
    criterionText: 'Юнит-экономика',
    blockId: 'business-model',
    blockName: 'Business Model (Бизнес-модель)',
    score: 3,
  },
]

const AVGS: Record<string, number> = {
  'product-demand': 6.5,
  'trust-positioning': 5.8,
  'business-model': 4.2,
  'cash-stability': 5.0,
  operations: 3.1,
  team: 6.0,
  'owner-readiness': 7.2,
}

// Числа из строки эффекта: '+0.3–0.5 к GRI' → [0.3, 0.5]
const effectNumbers = (s: string): number[] =>
  (s.match(/\d+\.\d+/g) ?? []).map(Number)

describe('computeDecisiveBets — «5 решающих ставок»', () => {
  it('мусорный вход → пустой массив', () => {
    expect(computeDecisiveBets(null)).toEqual([])
    expect(computeDecisiveBets(undefined)).toEqual([])
    expect(computeDecisiveBets('not-array')).toEqual([])
    expect(computeDecisiveBets({ top: 1 })).toEqual([])
    expect(computeDecisiveBets([null, 42, 'x', {}])).toEqual([])
  })

  it('каноническая форма (criterionText + blockId): ставка, RU-блок, числовой эффект', () => {
    const bets = computeDecisiveBets(CANONICAL_LIMITS, AVGS)
    expect(bets).toHaveLength(2)
    expect(bets[0].bet).toBe('Систематизация процессов')
    // Распознанный blockId → чистая русская подпись.
    expect(bets[0].block).toBe('Операции')
    // Балл блока известен → эффект в честном числовом формате «+x.x–y.y к GRI».
    expect(bets[0].expectedEffect).toMatch(/^\+\d+\.\d+–\d+\.\d+ к GRI$/)
  })

  it('толерантен к форме {title, block} — альтернативные ключи работают', () => {
    const bets = computeDecisiveBets(
      [{ title: 'Слабый оффер', block: 'Продукт и спрос' }],
      AVGS,
    )
    expect(bets).toHaveLength(1)
    expect(bets[0].bet).toBe('Слабый оффер')
    expect(bets[0].block).toBe('Продукт и спрос')
    // RU-подпись блока распозналась → балл взят из section_avgs → числовой эффект.
    expect(bets[0].expectedEffect).toMatch(/к GRI$/)
  })

  it('честность: score неизвестен → словесная формулировка без чисел', () => {
    const bets = computeDecisiveBets(
      [{ title: 'Неизвестное ограничение', block: 'Какой-то блок' }],
      {},
    )
    expect(bets).toHaveLength(1)
    expect(bets[0].expectedEffect).toBe(GENERIC_EFFECT)
    expect(bets[0].expectedEffect).not.toMatch(/\d/)
    expect(bets[0].firstStep).toBe(GENERIC_FIRST_STEP)
  })

  it('чем ниже балл блока — тем больше потенциальный эффект', () => {
    const bets = computeDecisiveBets(
      [
        { title: 'Слабый блок', blockId: 'operations' }, // 3.1
        { title: 'Сильный блок', blockId: 'owner-readiness' }, // 7.2
      ],
      AVGS,
    )
    const weak = effectNumbers(bets[0].expectedEffect)
    const strong = effectNumbers(bets[1].expectedEffect)
    expect(weak.length).toBeGreaterThan(0)
    expect(strong.length).toBeGreaterThan(0)
    // Верхняя граница эффекта у слабого блока строго больше.
    expect(Math.max(...weak)).toBeGreaterThan(Math.max(...strong))
  })

  it('без section_avgs использует score критерия как приближение (реальный балл, не выдумка)', () => {
    const bets = computeDecisiveBets([{ title: 'Критерий', block: 'X', score: 2 }])
    expect(bets[0].expectedEffect).toMatch(/к GRI$/)
  })

  it('блок у максимума → честное «эффект небольшой», без чисел роста', () => {
    const bets = computeDecisiveBets(
      [{ title: 'Почти идеально', blockId: 'team' }],
      { team: 9.8 },
    )
    expect(bets[0].expectedEffect).not.toMatch(/\+\d/)
    expect(bets[0].expectedEffect).toContain('небольшой')
  })

  it('режет до 5 ставок и учитывает rank при сортировке', () => {
    const seven = [
      { title: 'G', block: 'x', rank: 7 },
      { title: 'A', block: 'x', rank: 1 },
      { title: 'C', block: 'x', rank: 3 },
      { title: 'B', block: 'x', rank: 2 },
      { title: 'E', block: 'x', rank: 5 },
      { title: 'D', block: 'x', rank: 4 },
      { title: 'F', block: 'x', rank: 6 },
    ]
    const bets = computeDecisiveBets(seven, {})
    expect(bets).toHaveLength(5)
    expect(bets.map((b) => b.bet)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('элементы без title/criterionText пропускаются, остальные остаются', () => {
    const bets = computeDecisiveBets(
      [{ score: 3, blockId: 'team' }, { title: 'Валидная ставка', blockId: 'team' }],
      AVGS,
    )
    expect(bets).toHaveLength(1)
    expect(bets[0].bet).toBe('Валидная ставка')
  })

  it('первый шаг берётся из action_plan_90d по совпадению limitation', () => {
    const plan = {
      days_1_30: [
        {
          priority: 'Критично',
          limitation: 'Систематизация процессов (Operations (Операции))',
          focus: 'Устранить красные зоны (критические ограничения роста)',
          horizon: '1-30',
        },
      ],
      days_31_60: [],
      days_61_90: [],
    }
    const bets = computeDecisiveBets(CANONICAL_LIMITS, AVGS, plan)
    expect(bets[0].firstStep).toContain('1–30 дней')
    expect(bets[0].firstStep).toContain('Устранить красные зоны')
    // Вторая ставка в плане не упомянута → честный generic.
    expect(bets[1].firstStep).toBe(GENERIC_FIRST_STEP)
  })

  it('кривой action_plan_90d не ломает трансформер', () => {
    for (const plan of [null, 'str', 42, { days_1_30: 'oops' }, []]) {
      const bets = computeDecisiveBets(CANONICAL_LIMITS, AVGS, plan)
      expect(bets).toHaveLength(2)
      expect(bets[0].firstStep).toBe(GENERIC_FIRST_STEP)
    }
  })
})
