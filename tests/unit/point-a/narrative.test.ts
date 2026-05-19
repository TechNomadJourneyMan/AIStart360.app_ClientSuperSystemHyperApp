import { describe, it, expect, beforeEach, vi } from 'vitest'

// Make sure the openrouter module sees a key, so `hasOpenRouterKey()` returns true
// without us mocking it. We mock the chat function itself.
process.env.OPENROUTER_API_KEY ??= 'test-key-for-vitest'

vi.mock('@/lib/ai/openrouter', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/openrouter')>(
    '@/lib/ai/openrouter',
  )
  return {
    ...actual,
    chatWithOpenRouter: vi.fn(),
    hasOpenRouterKey: () => true,
  }
})

import { chatWithOpenRouter, OPENROUTER_MODELS } from '@/lib/ai/openrouter'
import { generateNarrative, type NarrativeInput } from '@/lib/point-a/narrative'
import type { PointA } from '@/types/onboarding'

const mockedChat = chatWithOpenRouter as unknown as ReturnType<typeof vi.fn>

function makePointA(): PointA {
  return {
    overall_score: 62,
    health_index: 58,
    stage: 'growth',
    blocks: {
      finance:    { score: 70, status: 'strong',   top_issues: ['Низкая маржа'],   recommendations: [] },
      marketing:  { score: 40, status: 'weak',     top_issues: ['Нет аналитики'],  recommendations: [] },
      operations: { score: 65, status: 'average',  top_issues: [],                  recommendations: [] },
      strategy:   { score: 55, status: 'average',  top_issues: [],                  recommendations: [] },
      sales:      { score: 80, status: 'strong',   top_issues: [],                  recommendations: [] },
    },
    risks: [
      { level: 'critical', area: 'finance', text: 'Кассовый разрыв', impact: 'Остановка операций' },
    ],
    insights: [{ area: 'sales', text: 'Сильный sales-канал' }],
    quick_wins: [{ action: 'Подключить аналитику', timeline: '30 дней', area: 'marketing' }],
    data_gaps: [],
  }
}

function makeInput(overrides: Partial<NarrativeInput> = {}): NarrativeInput {
  return {
    pointA: makePointA(),
    companyName: 'ТОО Тестовая Компания',
    industry: 'Розничная торговля',
    stage: 'Growth',
    ...overrides,
  }
}

const VALID_BODY = {
  executive_summary: 'Компания на стадии роста с устойчивыми продажами и слабым маркетингом.',
  strengths_text: 'Сильные продажи и приемлемые финансы…',
  weaknesses_text: 'Маркетинг отстаёт, метрики не собираются…',
  risks_text: 'Главный риск — кассовый разрыв из-за сезонности…',
  opportunities_text: 'Есть возможность роста за счёт цифрового маркетинга…',
  next_steps: [
    'Подключить веб-аналитику в течение 30 дней',
    'Внедрить дашборд по финансам — 60 дней',
    'Запустить программу лояльности — 90 дней',
  ],
}

describe('generateNarrative', () => {
  beforeEach(() => {
    mockedChat.mockReset()
  })

  it('returns a parsed PointANarrative on a valid JSON response', async () => {
    mockedChat.mockResolvedValueOnce(JSON.stringify(VALID_BODY))

    const out = await generateNarrative(makeInput())

    expect(out).not.toBeNull()
    expect(out?.executive_summary).toBe(VALID_BODY.executive_summary)
    expect(out?.strengths_text).toBe(VALID_BODY.strengths_text)
    expect(out?.weaknesses_text).toBe(VALID_BODY.weaknesses_text)
    expect(out?.risks_text).toBe(VALID_BODY.risks_text)
    expect(out?.opportunities_text).toBe(VALID_BODY.opportunities_text)
    expect(out?.next_steps).toEqual(VALID_BODY.next_steps)
    expect(out?.model_used).toBe(OPENROUTER_MODELS.sonnet)
    expect(out?.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // Verify the call used the expected options.
    expect(mockedChat).toHaveBeenCalledTimes(1)
    const args = mockedChat.mock.calls[0][0] as {
      jsonMode?: boolean
      temperature?: number
      maxTokens?: number
      model?: string
      system?: string
      user?: string
    }
    expect(args.jsonMode).toBe(true)
    expect(args.temperature).toBe(0.5)
    expect(args.maxTokens).toBe(2500)
    expect(args.model).toBe(OPENROUTER_MODELS.sonnet)
    expect(args.system).toContain('AIStart360')
    expect(args.user).toContain('ТОО Тестовая Компания')
  })

  it('returns null on malformed JSON', async () => {
    mockedChat.mockResolvedValueOnce('this is not json at all, just prose')

    const out = await generateNarrative(makeInput())
    expect(out).toBeNull()
  })

  it('returns null when required fields are missing (Zod fails)', async () => {
    const incomplete = {
      executive_summary: 'Кратко',
      // strengths_text intentionally missing
      weaknesses_text: 'Слабо',
      risks_text: 'Риски',
      opportunities_text: 'Возможности',
      next_steps: ['шаг 1', 'шаг 2', 'шаг 3'],
    }
    mockedChat.mockResolvedValueOnce(JSON.stringify(incomplete))

    const out = await generateNarrative(makeInput())
    expect(out).toBeNull()
  })

  it('returns null when next_steps has fewer than 3 items', async () => {
    mockedChat.mockResolvedValueOnce(
      JSON.stringify({ ...VALID_BODY, next_steps: ['только один'] }),
    )

    const out = await generateNarrative(makeInput())
    expect(out).toBeNull()
  })

  it('returns null when chatWithOpenRouter returns null', async () => {
    mockedChat.mockResolvedValueOnce(null)

    const out = await generateNarrative(makeInput())
    expect(out).toBeNull()
  })
})
