/**
 * tests/unit/gri/og-params.test.ts — parseOgGriParams: санитизация query для
 * OG-картинки GRI (/api/og/gri). Инварианты: score ∈ [0..10] c шагом 0.1,
 * ровно 7 блоков, мусор → 0, лишнее отбрасывается.
 */
import { describe, it, expect } from 'vitest'
import {
  parseOgGriParams,
  OG_GRI_SECTION_COUNT,
  OG_GRI_BLOCK_LABELS,
} from '@/lib/gri/og-params'

const sp = (q: string) => new URLSearchParams(q)

describe('parseOgGriParams', () => {
  it('парсит валидные score и 7 блоков', () => {
    const { score, sections } = parseOgGriParams(
      sp('score=7.2&s=5,6,7,4,8,6,7'),
    )
    expect(score).toBe(7.2)
    expect(sections).toEqual([5, 6, 7, 4, 8, 6, 7])
  })

  it('дефолты при пустом query: score=0 и 7 нулей', () => {
    const { score, sections } = parseOgGriParams(sp(''))
    expect(score).toBe(0)
    expect(sections).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(sections).toHaveLength(OG_GRI_SECTION_COUNT)
  })

  it('клампит score сверху и снизу', () => {
    expect(parseOgGriParams(sp('score=99')).score).toBe(10)
    expect(parseOgGriParams(sp('score=-3')).score).toBe(0)
    expect(parseOgGriParams(sp('score=10.0001')).score).toBe(10)
  })

  it('округляет до одной десятой', () => {
    expect(parseOgGriParams(sp('score=7.25')).score).toBe(7.3)
    expect(parseOgGriParams(sp('score=7.24')).score).toBe(7.2)
    expect(parseOgGriParams(sp('s=1.11,2.26')).sections.slice(0, 2)).toEqual([
      1.1, 2.3,
    ])
  })

  it('мусор в score → 0 (строки, Infinity, NaN)', () => {
    expect(parseOgGriParams(sp('score=abc')).score).toBe(0)
    expect(parseOgGriParams(sp('score=Infinity')).score).toBe(0)
    expect(parseOgGriParams(sp('score=NaN')).score).toBe(0)
    expect(parseOgGriParams(sp('score=')).score).toBe(0)
  })

  it('мусорные элементы s заменяются на 0 поэлементно, валидные остаются', () => {
    const { sections } = parseOgGriParams(sp('s=5,abc,7,,-2,99,3.5'))
    expect(sections).toEqual([5, 0, 7, 0, 0, 10, 3.5])
  })

  it('недостающие блоки дополняются нулями до 7', () => {
    const { sections } = parseOgGriParams(sp('s=8,6'))
    expect(sections).toEqual([8, 6, 0, 0, 0, 0, 0])
  })

  it('лишние блоки отбрасываются (всегда ровно 7)', () => {
    const { sections } = parseOgGriParams(sp('s=1,2,3,4,5,6,7,8,9,10'))
    expect(sections).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('терпит пробелы вокруг чисел', () => {
    const { sections } = parseOgGriParams(sp('s=5, 6 ,7,4,8,6,7'))
    expect(sections).toEqual([5, 6, 7, 4, 8, 6, 7])
  })

  it('подписи блоков согласованы с числом блоков', () => {
    expect(OG_GRI_BLOCK_LABELS).toHaveLength(OG_GRI_SECTION_COUNT)
  })
})
