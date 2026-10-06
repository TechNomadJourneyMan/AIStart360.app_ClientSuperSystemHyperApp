/**
 * matchSynonym is memoised (sorted scan entries built once, results cached
 * per normalised input). Its answers must be exactly those of the original
 * algorithm: exact normalised match, else the longest synonym (3+ chars)
 * contained as whole words, ties in index order.
 */
import { describe, expect, it } from 'vitest'
import { METRIC_SYNONYMS, getSynonymIndex, matchSynonym, normalizeForMatch } from '@/lib/documents/synonyms'

/** The pre-memoisation implementation, verbatim in behaviour. */
function reference(input: string): string | null {
  const norm = normalizeForMatch(input)
  if (!norm) return null
  const idx = getSynonymIndex()
  const exact = idx.get(norm)
  if (exact) return exact
  const entries = Array.from(idx.entries()).sort((a, b) => b[0].length - a[0].length)
  for (const [syn, canonical] of entries) {
    if (syn.length < 3) continue
    if (` ${norm} `.includes(` ${syn} `)) return canonical
  }
  return null
}

describe('matchSynonym memoisation keeps every answer', () => {
  const synonyms = Object.entries(METRIC_SYNONYMS).flatMap(([k, list]) => [k, k.replace(/_/g, ' '), ...list])
  const corpus = [
    ...synonyms,
    ...synonyms.map((s) => `Итого ${s} 2025 (₸)`),
    ...synonyms.map((s) => `${s.toUpperCase()}, факт`),
    ...synonyms.slice(0, 200).map((s, i) => `${s} ${synonyms[(i * 7) % synonyms.length]}`),
    'Выручка 2025 (₸)', 'revenue per seller', 'Неизвестный параметр учёта 7', 'колонка 12', '', '   ', 'a', '№', 'ё-моё выручка',
  ]

  it(`matches the reference on ${corpus.length} inputs, twice (cold and cached)`, () => {
    const expected = corpus.map(reference)
    expect(corpus.map((s) => matchSynonym(s))).toEqual(expected)
    expect(corpus.map((s) => matchSynonym(s))).toEqual(expected)
    expect(expected.filter((x) => x !== null).length).toBeGreaterThan(500)
  })
})
