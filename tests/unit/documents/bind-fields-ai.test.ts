/**
 * Tests for `lib/documents/bind-fields-ai.ts`.
 *
 * The AI binder is mocked at the OpenRouter boundary — we control every
 * `chatWithOpenRouter` response so the tests are deterministic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the OpenRouter module — the module-under-test imports these
// symbols by name, so the mock must export the same shape.
vi.mock('@/lib/ai/openrouter', () => {
  const chatWithOpenRouter = vi.fn(async (_opts: unknown): Promise<string | null> => null)
  return {
    chatWithOpenRouter,
    hasOpenRouterKey: () => Boolean(process.env.OPENROUTER_API_KEY),
    extractJson: <T,>(text: string): T | null => {
      if (!text) return null
      try {
        const first = text.indexOf('{')
        const last = text.lastIndexOf('}')
        const candidate = first !== -1 && last > first ? text.slice(first, last + 1) : text
        return JSON.parse(candidate) as T
      } catch {
        return null
      }
    },
    OPENROUTER_MODELS: {
      sonnet: 'anthropic/claude-sonnet-4.5',
      haiku: 'anthropic/claude-haiku-4.5',
    },
  }
})

import { chatWithOpenRouter } from '@/lib/ai/openrouter'
import type { ParsedDataField } from '@/lib/documents/extract'
import {
  __resetAiBindCache,
  bindFieldWithAI,
  bindFieldsWithAI,
  jaccardSimilarity,
  rankCandidates,
  tokenize,
} from '@/lib/documents/bind-fields-ai'
import { getMetricRegistry } from '@/lib/metrics/registry'

const mockChat = chatWithOpenRouter as unknown as ReturnType<typeof vi.fn>

const originalKey = process.env.OPENROUTER_API_KEY

function withApiKey() {
  process.env.OPENROUTER_API_KEY = 'test-key-xxx'
}

function withoutApiKey() {
  delete process.env.OPENROUTER_API_KEY
}

beforeEach(() => {
  __resetAiBindCache()
  mockChat.mockReset()
  withApiKey()
})

afterEach(() => {
  if (originalKey !== undefined) process.env.OPENROUTER_API_KEY = originalKey
  else delete process.env.OPENROUTER_API_KEY
})

// ─── helpers ─────────────────────────────────────────────────

function makeField(overrides: Partial<ParsedDataField> = {}): ParsedDataField {
  return {
    key: 'revenue_2024',
    label: 'Выручка 2024',
    value: 84_200_000,
    target_tab: 'Финансы',
    target_parameter: 'Выручка',
    source: 'Выручка 2024 составила 84.2 млн ₸',
    confidence: 0.85,
    ...overrides,
  }
}

function aiReply(metricId: string | null, confidence: number, reasoning = 'тест'): string {
  return JSON.stringify({ metric_id: metricId, confidence, reasoning })
}

// ─── tokenize / similarity ───────────────────────────────────

describe('tokenize', () => {
  it('handles ё / е normalization (case 11)', () => {
    const a = tokenize('Учёт Объём')
    const b = tokenize('Учет Объем')
    expect(a).toEqual(b)
  })

  it('drops 1-char tokens and lowercases', () => {
    expect(tokenize('A bc DE')).toEqual(['bc', 'de'])
  })

  it('returns [] for empty / falsy input', () => {
    expect(tokenize('')).toEqual([])
    // @ts-expect-error guard against undefined
    expect(tokenize(undefined)).toEqual([])
  })
})

describe('jaccardSimilarity', () => {
  it('returns 1 for identical strings (case 12)', () => {
    expect(jaccardSimilarity('выручка год', 'выручка год')).toBe(1)
  })

  it('returns 0 for disjoint token sets (case 12)', () => {
    expect(jaccardSimilarity('кошка собака', 'machine learning')).toBe(0)
  })

  it('returns a value in (0,1) for partial overlap', () => {
    const s = jaccardSimilarity('выручка год', 'выручка месяц')
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
  })
})

// ─── rankCandidates ──────────────────────────────────────────

describe('rankCandidates', () => {
  it('doc-type filtering: candidates with matching doc_type are boosted (case 8)', () => {
    const registry = getMetricRegistry()
    const field = makeField({
      key: 'random_field',
      label: 'Какое-то поле',
      target_parameter: 'Что-то',
    })

    const withMatch = rankCandidates(field, 'p&l', registry, 5)
    const withoutMatch = rankCandidates(field, '', registry, 5)

    // The doc-type boost should at least change the top ordering OR raise
    // the top score relative to no-doc-type pass.
    expect(withMatch.length).toBeGreaterThan(0)
    expect(withoutMatch.length).toBeGreaterThan(0)
    // Boosted top distance must be >= un-boosted top distance for same input
    // (because the boost is additive and never negative).
    expect(withMatch[0].distance).toBeGreaterThanOrEqual(withoutMatch[0].distance)
  })

  it('russian field labels are properly normalized for similarity (case 9)', () => {
    const registry = getMetricRegistry()
    const field = makeField({
      key: 'revenue',
      label: 'Выручка',
      target_parameter: 'Выручка',
    })
    const ranked = rankCandidates(field, 'p&l', registry, 5)
    // The top candidate's label should plausibly relate to "Выручка".
    const topLabels = ranked.slice(0, 5).map((c) => c.label.toLowerCase())
    expect(topLabels.some((l) => l.includes('выручк'))).toBe(true)
  })
})

// ─── bindFieldWithAI ─────────────────────────────────────────

describe('bindFieldWithAI', () => {
  it('passes through already-bound field unchanged (case 1)', async () => {
    const field = makeField()
    ;(field as ParsedDataField & { metric_id: string }).metric_id = 'biz.finance.vyruchka'

    const result = await bindFieldWithAI(field, 'p&l')

    expect(result).not.toBeNull()
    expect(result!.bound).toBe(true)
    expect(result!.metricId).toBe('biz.finance.vyruchka')
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('skips low-confidence field — no AI call (case 2)', async () => {
    const field = makeField({ confidence: 0.5 })
    const result = await bindFieldWithAI(field, 'p&l')

    expect(result).not.toBeNull()
    expect(result!.bound).toBe(false)
    expect(result!.metricId).toBeNull()
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('returns valid bind when AI returns high-confidence valid JSON (case 3)', async () => {
    const registry = getMetricRegistry()
    const realId = registry[0]!.id
    mockChat.mockResolvedValueOnce(aiReply(realId, 0.92, 'точное совпадение по выручке'))

    const result = await bindFieldWithAI(makeField(), 'p&l')

    expect(result).not.toBeNull()
    expect(result!.bound).toBe(true)
    expect(result!.metricId).toBe(realId)
    expect(result!.confidence).toBeCloseTo(0.92)
    expect(
      (result!.field as ParsedDataField & { metric_id?: string | null }).metric_id
    ).toBe(realId)
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('does NOT set metric_id when AI confidence below 0.6 (case 4)', async () => {
    const registry = getMetricRegistry()
    const realId = registry[0]!.id
    mockChat.mockResolvedValueOnce(aiReply(realId, 0.45, 'слабое совпадение'))

    const result = await bindFieldWithAI(makeField(), 'p&l')

    expect(result).not.toBeNull()
    expect(result!.bound).toBe(false)
    expect(result!.metricId).toBeNull()
    expect(
      (result!.field as ParsedDataField & { metric_id?: string | null }).metric_id
    ).toBeNull()
    expect(result!.confidence).toBeCloseTo(0.45)
  })

  it('returns field unchanged with note when AI returns invalid JSON (case 5)', async () => {
    mockChat.mockResolvedValueOnce('не-json мусор без скобок')

    const result = await bindFieldWithAI(makeField(), 'p&l')

    expect(result).not.toBeNull()
    expect(result!.bound).toBe(false)
    expect(result!.metricId).toBeNull()
    expect(result!.reasoning).toMatch(/невалидн/i)
  })

  it('returns null when OPENROUTER_API_KEY missing (case 6)', async () => {
    withoutApiKey()
    const result = await bindFieldWithAI(makeField(), 'p&l')
    expect(result).toBeNull()
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('cache hit on repeated calls — chatWithOpenRouter called once (case 7)', async () => {
    const registry = getMetricRegistry()
    const realId = registry[0]!.id
    mockChat.mockResolvedValueOnce(aiReply(realId, 0.9, 'first hit'))

    const field = makeField()
    const r1 = await bindFieldWithAI(field, 'p&l', { cacheKey: 'doc-1' })
    const r2 = await bindFieldWithAI(field, 'p&l', { cacheKey: 'doc-1' })

    expect(mockChat).toHaveBeenCalledTimes(1)
    expect(r1!.metricId).toBe(realId)
    expect(r2!.metricId).toBe(realId)
  })

  it('discards hallucinated metric ids not in candidate list', async () => {
    mockChat.mockResolvedValueOnce(
      aiReply('biz.totally.fake_id_that_does_not_exist', 0.99, 'выдуманный id')
    )

    const result = await bindFieldWithAI(makeField(), 'p&l')

    expect(result!.bound).toBe(false)
    expect(result!.metricId).toBeNull()
  })
})

// ─── bindFieldsWithAI (batched) ──────────────────────────────

describe('bindFieldsWithAI (batched)', () => {
  it('processes 10 fields in parallel (case 10)', async () => {
    const registry = getMetricRegistry()
    const realId = registry[0]!.id

    // Every call returns the same valid bind.
    mockChat.mockImplementation(async () => aiReply(realId, 0.8, 'батч-тест'))

    const fields = Array.from({ length: 10 }, (_, i) =>
      makeField({
        key: `field_${i}`,
        label: `Поле ${i}`,
        confidence: 0.85,
      })
    )

    const out = await bindFieldsWithAI(fields, 'p&l', { cacheKey: 'doc-batch' })

    expect(out).toHaveLength(10)
    expect(mockChat).toHaveBeenCalledTimes(10)
    for (const f of out) {
      expect(
        (f as ParsedDataField & { metric_id?: string | null }).metric_id
      ).toBe(realId)
    }
  })

  it('mixed batch: low-confidence + already-bound pass through unchanged', async () => {
    const registry = getMetricRegistry()
    const realId = registry[0]!.id
    mockChat.mockImplementation(async () => aiReply(realId, 0.85, 'ok'))

    const a = makeField({ key: 'a', label: 'A', confidence: 0.85 })
    const b = makeField({ key: 'b', label: 'B', confidence: 0.3 }) // low conf — skip
    const c: ParsedDataField & { metric_id?: string } = {
      ...makeField({ key: 'c', label: 'C' }),
      metric_id: 'biz.preset.id',
    }

    const out = await bindFieldsWithAI([a, b, c], 'p&l', { cacheKey: 'doc-mixed' })

    // Only one field (a) should have triggered an AI call.
    expect(mockChat).toHaveBeenCalledTimes(1)
    expect(
      (out[0] as ParsedDataField & { metric_id?: string | null }).metric_id
    ).toBe(realId)
    expect(
      (out[1] as ParsedDataField & { metric_id?: string | null }).metric_id ?? null
    ).toBeNull()
    expect(
      (out[2] as ParsedDataField & { metric_id?: string | null }).metric_id
    ).toBe('biz.preset.id')
  })

  it('returns input fields untouched when no API key is set', async () => {
    withoutApiKey()
    const fields = [makeField()]
    const out = await bindFieldsWithAI(fields, 'p&l')
    expect(out).toHaveLength(1)
    expect(
      (out[0] as ParsedDataField & { metric_id?: string | null }).metric_id ?? null
    ).toBeNull()
    expect(mockChat).not.toHaveBeenCalled()
  })
})
