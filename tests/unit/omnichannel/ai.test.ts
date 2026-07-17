import { beforeEach, describe, expect, it, vi } from 'vitest'

const structured = vi.hoisted(() => ({
  generateObjectViaOpenRouter: vi.fn(),
}))

vi.mock('@/lib/ai/structured', () => ({
  generateObjectViaOpenRouter: structured.generateObjectViaOpenRouter,
}))

import { OPENROUTER_MODELS } from '@/lib/ai/openrouter'
import { generateOmnichannelReply } from '@/lib/omnichannel/ai'

const validReply = {
  answer: 'Подскажите, пожалуйста, можно фото, ссылку или артикул товара?',
  intent: 'lead' as const,
  sentiment: 'neutral' as const,
  language: 'ru' as const,
  confidence: 0.91,
  risk: 'low' as const,
  needs_human: false,
  reason: 'safe_clarification',
  lead_score: 55,
  conversation_summary: 'Клиенту нужно уточнить товар.',
  grounding: 'customer_clarification' as const,
  business_facts_used: [],
}

describe('omnichannel AI generation', () => {
  beforeEach(() => {
    structured.generateObjectViaOpenRouter.mockReset()
    structured.generateObjectViaOpenRouter.mockResolvedValue(validReply)
  })

  it('uses Sonnet 5 only for free-form generation and keeps the system brand-neutral', async () => {
    await expect(generateOmnichannelReply({
      channel: 'whatsapp',
      businessContext: 'Honor Group — Outdoor · Hunt · Fish.',
      currentMessage: 'Что это за товар?',
      history: [],
    })).resolves.toMatchObject({
      ...validReply,
      risk: 'medium',
      reason: expect.stringContaining('free_form_draft_only'),
    })

    const options = structured.generateObjectViaOpenRouter.mock.calls[0]?.[0] as {
      model?: string
      complexity?: string
      temperature?: number | null
      system?: string
    }
    expect(options.model).toBe(OPENROUTER_MODELS.sonnet5)
    expect(options.complexity).toBeUndefined()
    expect(options.temperature).toBeNull()
    expect(options.system).not.toContain('AIStart360')
    expect(options.system).toContain('business defined exclusively in BUSINESS_CONTEXT')
  })

  it('fails closed without trusted business context', async () => {
    await expect(generateOmnichannelReply({
      channel: 'whatsapp',
      businessContext: '   ',
      currentMessage: 'Здравствуйте',
      history: [],
    })).resolves.toBeNull()

    expect(structured.generateObjectViaOpenRouter).not.toHaveBeenCalled()
  })

  it('includes the latest message once and preserves the whole unanswered burst', async () => {
    const current = 'CURRENT_UNIQUE_MESSAGE_42'
    await generateOmnichannelReply({
      channel: 'whatsapp',
      businessContext: 'Honor Group — Outdoor · Hunt · Fish.',
      currentMessage: current,
      history: [
        { direction: 'in', text: 'Старый вопрос', actor: 'customer' },
        { direction: 'out', text: 'На старый вопрос ответили', actor: 'human' },
        { direction: 'in', text: 'Вся экипировка', actor: 'customer' },
        // Defense in depth: callers that accidentally include current must
        // still not duplicate it in the model prompt.
        { direction: 'in', text: current, actor: 'customer' },
      ],
    })

    const options = structured.generateObjectViaOpenRouter.mock.calls[0]?.[0] as {
      user?: string
    }
    const prompt = options.user ?? ''
    expect(prompt.match(new RegExp(current, 'g'))).toHaveLength(1)
    expect(prompt).toContain('<EARLIER_CONVERSATION')
    expect(prompt).toContain('HUMAN_AGENT: На старый вопрос ответили')
    expect(prompt).toContain('<UNANSWERED_CUSTOMER_BURST')
    expect(prompt).toContain('CUSTOMER: Вся экипировка')
    expect(prompt).toContain(`CUSTOMER [LATEST]: ${current}`)
  })

  it('treats product examples as facts and instructs a safe clarification', async () => {
    await generateOmnichannelReply({
      channel: 'instagram',
      businessContext: 'Honor Group — Outdoor · Hunt · Fish.',
      currentMessage: 'Расскажите подробнее',
      history: [],
    })

    const options = structured.generateObjectViaOpenRouter.mock.calls[0]?.[0] as {
      system?: string
    }
    const system = options.system ?? ''
    expect(system).toContain('product category')
    expect(system).toContain('Never generate illustrative product lists')
    expect(system).toContain('photo, product link, or article/SKU')
    expect(system).toContain('neutral clarification')
    expect(system).toContain('needs_human=false')
    expect(system).toContain('confidence measures how safe')
    expect(system).toContain('short courtesy')
    expect(system).toContain('Do not begin with "this is not a group"')
    expect(system).toContain('Business facts may come only from BUSINESS_CONTEXT')
    expect(system).toContain("customer's unverified wording")
  })

  it('forces human review when the model invents product availability', async () => {
    structured.generateObjectViaOpenRouter.mockResolvedValue({
      ...validReply,
      answer: 'У нас есть шлемы, куртки и перчатки.',
      grounding: 'business_context',
      business_facts_used: ['Honor Group — Outdoor · Hunt · Fish.'],
    })

    await expect(generateOmnichannelReply({
      channel: 'whatsapp',
      businessContext: 'Honor Group — Outdoor · Hunt · Fish.',
      currentMessage: 'Всего понемногу',
      history: [],
    })).resolves.toMatchObject({
      risk: 'high',
      needs_human: true,
      reason: expect.stringContaining('grounding_business_fact_mismatch'),
    })
  })

  it('rejects a business claim disguised as a customer clarification', async () => {
    structured.generateObjectViaOpenRouter.mockResolvedValue({
      ...validReply,
      answer: 'У нас есть подходящий товар. Пришлите фото?',
      grounding: 'customer_clarification',
      business_facts_used: [],
    })

    await expect(generateOmnichannelReply({
      channel: 'whatsapp',
      businessContext: 'Honor Group — Outdoor · Hunt · Fish.',
      currentMessage: 'Что за шлем?',
      history: [],
    })).resolves.toMatchObject({
      risk: 'high',
      needs_human: true,
      reason: expect.stringContaining('grounding_clarification_contains_business_claim'),
    })
  })

  it('keeps even an exactly cited free-form business answer in draft-only risk', async () => {
    const fact = 'Каталог: https://myhonor.shop/catalog'
    structured.generateObjectViaOpenRouter.mockResolvedValue({
      ...validReply,
      answer: 'Каталог доступен здесь: https://myhonor.shop/catalog',
      grounding: 'business_context',
      business_facts_used: [fact],
    })

    await expect(generateOmnichannelReply({
      channel: 'whatsapp',
      businessContext: fact,
      currentMessage: 'Где каталог?',
      history: [],
    })).resolves.toMatchObject({
      risk: 'medium',
      needs_human: false,
      reason: expect.stringContaining('free_form_draft_only'),
    })
  })

  it.each([
    'У нас, в Honor Group, есть шлемы.',
    'Honor Group предлагает шлемы.',
  ])('never auto-approves a free-form factual claim even with a loosely related citation: %s', async (answer) => {
    structured.generateObjectViaOpenRouter.mockResolvedValue({
      ...validReply,
      answer,
      grounding: 'business_context',
      business_facts_used: ['Honor Group — Outdoor · Hunt · Fish.'],
    })

    const result = await generateOmnichannelReply({
      channel: 'whatsapp',
      businessContext: 'Honor Group — Outdoor · Hunt · Fish.',
      currentMessage: 'Что у вас есть?',
      history: [],
    })

    expect(result?.risk).not.toBe('low')
    expect(result?.reason).toMatch(/(?:grounding_business_fact_mismatch|free_form_draft_only)/u)
  })

  it('keeps an apparently neutral free-form clarification in draft', async () => {
    structured.generateObjectViaOpenRouter.mockResolvedValue({
      ...validReply,
      answer: 'Похоже на шлем. Пришлите фото?',
      grounding: 'customer_clarification',
      business_facts_used: [],
    })

    await expect(generateOmnichannelReply({
      channel: 'whatsapp',
      businessContext: 'Honor Group — Outdoor · Hunt · Fish.',
      currentMessage: 'Что это?',
      history: [],
    })).resolves.toMatchObject({
      risk: 'medium',
      needs_human: false,
      reason: expect.stringContaining('free_form_draft_only'),
    })
  })

  it('blocks a link that is absent from the trusted business context', async () => {
    structured.generateObjectViaOpenRouter.mockResolvedValue({
      ...validReply,
      answer: 'Каталог: https://example.invalid/catalog',
      grounding: 'business_context',
      business_facts_used: ['Honor Group — Outdoor · Hunt · Fish.'],
    })

    await expect(generateOmnichannelReply({
      channel: 'whatsapp',
      businessContext: 'Honor Group — Outdoor · Hunt · Fish.',
      currentMessage: 'Где каталог?',
      history: [],
    })).resolves.toMatchObject({
      risk: 'high',
      needs_human: true,
      reason: expect.stringContaining('grounding_untrusted_url'),
    })
  })
})
