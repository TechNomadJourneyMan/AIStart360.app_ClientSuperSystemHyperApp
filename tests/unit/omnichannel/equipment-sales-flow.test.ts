import { describe, expect, it } from 'vitest'
import {
  EQUIPMENT_FLOW_CHOICE_IDS,
  equipmentSalesFlowConfigSchema,
  planEquipmentSalesFlow,
  type EquipmentSalesFlowConfig,
} from '@/lib/omnichannel/equipment-sales-flow'
import type { OmnichannelMessage } from '@/lib/omnichannel/types'

const now = '2026-07-13T15:00:00.000Z'

const config: EquipmentSalesFlowConfig = {
  version: 1,
  opt_in_revision: 1,
  enabled: true,
  messages: {
    welcome: 'Здравствуйте! Спасибо за интерес к Honor Club 🙌\nПодскажите, пожалуйста, из какого вы города?',
    ask_city: 'Подскажите, пожалуйста, из какого вы города?',
    ask_interest: 'Отлично! Что вас интересует?',
    options_prompt: 'Выберите вариант — можно ответить номером или своими словами 😊',
    handoff: 'Отлично! Менеджер поможет вам с выбором 🙌',
    handoff_by_choice: {
      summer: 'Отлично! Менеджер поможет подобрать экипировку на лето 🙌',
      autumn_winter: 'Отлично! Менеджер поможет подобрать экипировку на осень и зиму 🙌',
      catalog: 'Отлично! Менеджер отправит актуальный каталог и поможет с выбором 🙌',
      beginner: 'Конечно! Менеджер поможет подобрать экипировку с нуля 🙌',
      manager: 'Хорошо! Передаю вас менеджеру 🙌',
    },
  },
  choices: [
    { id: 'summer', label: 'Экипировка на лето', button_label: 'На лето' },
    { id: 'autumn_winter', label: 'Экипировка на осень–зиму', button_label: 'Осень–зима' },
    { id: 'catalog', label: 'Посмотреть каталог', button_label: 'Каталог' },
    { id: 'beginner', label: 'Я новичок, нужна помощь', button_label: 'Я новичок' },
    { id: 'manager', label: 'Связаться с менеджером', button_label: 'Менеджер' },
  ],
  city_routes: [
    { id: 'astana', label: 'Астана', aliases: ['астана', 'астаны', 'астане', 'астану', 'нур-султан'], manager_phone: '77054057775' },
    { id: 'ust_kamenogorsk', label: 'Усть-Каменогорск', aliases: ['усть-каменогорск', 'усть-каменогорска', 'өскемен', 'өскеменде', 'оскемен', 'оскемена'], manager_phone: '77714057775' },
    { id: 'other', label: 'Другой город', aliases: ['другой город'], manager_phone: '77714057775' },
  ],
  fallback_route_id: 'other',
  community: {
    text: 'Новинки и акции — в нашем сообществе:',
    url: 'https://chat.whatsapp.com/JDaVNsnloFMF0RpOtLSDRW?mode=gi_t',
  },
  catalog: {
    text: 'Конечно! Посмотреть каталог можно здесь:',
    url: 'https://myhonor.shop/catalog',
  },
}

const automationConfig = { equipment_sales_flow: config }

function message(input: {
  id: string
  text: string
  direction?: 'in' | 'out'
  messageType?: OmnichannelMessage['messageType']
  metadata?: OmnichannelMessage['metadata']
  occurredAt?: string
}): OmnichannelMessage {
  return {
    id: input.id,
    conversationId: 'conversation-1',
    channel: 'instagram',
    externalMessageId: `provider-${input.id}`,
    direction: input.direction ?? 'in',
    messageType: input.messageType ?? 'text',
    text: input.text,
    status: input.direction === 'out' ? 'sent' : 'received',
    replyToExternalId: null,
    aiDraft: null,
    aiConfidence: null,
    aiReason: null,
    aiGenerated: input.direction === 'out',
    metadata: input.metadata ?? {},
    occurredAt: input.occurredAt ?? now,
    processedAt: null,
  }
}

function plan(history: OmnichannelMessage[]) {
  const currentMessage = [...history].reverse().find((item) => item.direction === 'in')!
  return planEquipmentSalesFlow({ currentMessage, history, automationConfig })
}

function planWith(input: {
  history: OmnichannelMessage[]
  conversationMetadata?: OmnichannelMessage['metadata']
  forceDraft?: boolean
  configOverride?: EquipmentSalesFlowConfig
}) {
  const currentMessage = [...input.history].reverse().find((item) => item.direction === 'in')!
  return planEquipmentSalesFlow({
    currentMessage,
    history: input.history,
    automationConfig: { equipment_sales_flow: input.configOverride ?? config },
    conversationMetadata: input.conversationMetadata,
    forceDraft: input.forceDraft,
  })
}

describe('equipment sales flow config', () => {
  it('accepts the configured manager phones and WhatsApp community URL', () => {
    expect(equipmentSalesFlowConfigSchema.safeParse(config).success).toBe(true)
  })

  it('requires the explicit opt-in safety revision', () => {
    const withoutMarker: Record<string, unknown> = { ...config }
    delete withoutMarker.opt_in_revision
    expect(equipmentSalesFlowConfigSchema.safeParse(withoutMarker).success).toBe(false)
  })

  it('rejects unsafe community hosts and duplicate choice ids', () => {
    const parsed = equipmentSalesFlowConfigSchema.safeParse({
      ...config,
      community: { ...config.community, url: 'https://evil.example/invite' },
      choices: config.choices.map((choice, index) =>
        index === 1 ? { ...choice, id: 'summer' } : choice,
      ),
    })
    expect(parsed.success).toBe(false)
  })

  it.each([
    'http://myhonor.shop/catalog',
    'https://example.com/catalog',
    'https://myhonor.shop/',
    'https://myhonor.shop/catalogue',
    'https://myhonor.shop:444/catalog',
    'https://myhonor.shop/catalog?redirect=1',
  ])('rejects an unsafe catalog URL: %s', (url) => {
    expect(equipmentSalesFlowConfigSchema.safeParse({
      ...config,
      catalog: { ...config.catalog, url },
    }).success).toBe(false)
  })

  it.each([
    '770540577',
    '7705405777512345',
    '+77054057775',
    '07054057775',
    '7705 405 7775',
    ' 77054057775 ',
  ])('rejects an unsafe manager phone: %s', (managerPhone) => {
    expect(equipmentSalesFlowConfigSchema.safeParse({
      ...config,
      city_routes: config.city_routes.map((route, index) =>
        index === 0 ? { ...route, manager_phone: managerPhone } : route,
      ),
    }).success).toBe(false)
  })

  it('requires every city route to have at least one non-empty alias', () => {
    const emptyList = equipmentSalesFlowConfigSchema.safeParse({
      ...config,
      city_routes: config.city_routes.map((route, index) =>
        index === 0 ? { ...route, aliases: [] } : route,
      ),
    })
    const blankAlias = equipmentSalesFlowConfigSchema.safeParse({
      ...config,
      city_routes: config.city_routes.map((route, index) =>
        index === 0 ? { ...route, aliases: ['   '] } : route,
      ),
    })

    expect(emptyList.success).toBe(false)
    expect(blankAlias.success).toBe(false)
  })

  it.each([
    ['club invitation', {
      messages: {
        ...config.messages,
        welcome: 'П'.repeat(900),
      },
      community: { ...config.community, text: 'Ч'.repeat(100) },
      catalog: { ...config.catalog, text: 'К'.repeat(100) },
    }],
    ['awaiting interest', {
      messages: {
        ...config.messages,
        ask_interest: 'И'.repeat(500),
        options_prompt: 'П'.repeat(200),
      },
      choices: config.choices.map((choice, index) => ({
        ...choice,
        label: `${index + 1}${'В'.repeat(71)}`,
      })),
    }],
    ['routed handoff', {
      messages: {
        ...config.messages,
        handoff_by_choice: {
          summer: 'М'.repeat(500),
          autumn_winter: 'М'.repeat(500),
          catalog: 'М'.repeat(500),
          beginner: 'М'.repeat(500),
          manager: 'М'.repeat(500),
        },
      },
      choices: config.choices.map((choice, index) =>
        index === 0 ? { ...choice, label: 'В'.repeat(72) } : choice,
      ),
      city_routes: config.city_routes.map((route, index) =>
        index === 0 ? { ...route, label: 'Г'.repeat(80) } : route,
      ),
      community: { ...config.community, text: 'Ч'.repeat(500) },
    }],
  ] as const)('rejects an overlong rendered %s branch', (_branch, overrides) => {
    expect(equipmentSalesFlowConfigSchema.safeParse({
      ...config,
      ...overrides,
    }).success).toBe(false)
  })

  it('rejects an overlong club invitation when no catalog is configured', () => {
    const { catalog: _catalog, ...configWithoutCatalog } = config
    expect(equipmentSalesFlowConfigSchema.safeParse({
      ...configWithoutCatalog,
      messages: {
        ...configWithoutCatalog.messages,
        welcome: 'П'.repeat(900),
      },
      community: {
        ...configWithoutCatalog.community,
        text: 'Ч'.repeat(100),
      },
    }).success).toBe(false)
  })
})

describe('equipment sales flow planning', () => {
  it('starts with one concise city question and no premature links or choices', () => {
    const result = plan([message({ id: 'in-1', text: 'Здравствуйте' })])

    expect(result).toMatchObject({
      stage: 'welcome',
      choiceId: null,
      cityRouteId: null,
      presentation: { kind: 'text' },
      communityIncluded: false,
    })
    expect(result?.answer).toBe(config.messages.welcome)
    expect(result?.answer).not.toContain('1.')
    expect(result?.answer).not.toContain(config.community.url)
  })

  it('asks for a city after an Instagram quick-reply choice', () => {
    const result = plan([message({
      id: 'in-1',
      text: 'Да, на лето',
      messageType: 'button',
      metadata: { quickReplyPayload: 'equipment_v1:interest:summer' },
    })])

    expect(result).toMatchObject({
      stage: 'awaiting_city',
      choiceId: 'summer',
      presentation: { kind: 'text' },
    })
    expect(result?.answer).toContain('из какого вы города')
  })

  it.each([
    ['1', 'summer'],
    ['на лето', 'summer'],
    ['2', 'autumn_winter'],
    ['осень-зима', 'autumn_winter'],
    ['4', 'beginner'],
    ['я новичок', 'beginner'],
    ['5', 'manager'],
    ['позовите менеджера', 'manager'],
  ] as const)('recognizes the text fallback %s as %s', (text, choiceId) => {
    expect(plan([message({ id: 'in-1', text })])).toMatchObject({
      stage: 'awaiting_city',
      choiceId,
    })
  })

  it.each([
    '3',
    'Каталог',
    'хочу каталог',
    'Хочу ознакомиться с каталогом',
    'Есть каталог в Астане?',
    'Хочу узнать, есть ли каталог в Астане?',
    'Хочу спросить, где каталог?',
    'Покажите товары',
    'Где посмотреть ассортимент?',
    'Дайте ссылку на сайт',
  ])('sends the direct website link immediately for a catalog request: %s', (text) => {
    const result = plan([message({ id: `catalog-direct-${text}`, text })])

    expect(result).toMatchObject({
      stage: 'welcome',
      reason: 'deterministic_equipment_flow_catalog_direct',
      choiceId: null,
      cityRouteId: null,
      managerUrl: null,
      handoffAfterSend: false,
      communityIncluded: false,
      outboundMetadata: expect.objectContaining({
        equipmentFlowCatalogShared: true,
      }),
    })
    expect(result?.answer).toBe(
      'Конечно! Посмотреть каталог можно здесь:\nhttps://myhonor.shop/catalog',
    )
    expect(result?.answer).not.toContain('wa.me')
    expect(result?.answer).not.toContain('chat.whatsapp.com')
  })

  it('keeps the catalog request when a courtesy follows in the same quiet-window burst', () => {
    const result = plan([
      message({ id: 'catalog-before-thanks', text: 'Покажите каталог' }),
      message({ id: 'thanks-after-catalog', text: 'Спасибо' }),
    ])

    expect(result).toMatchObject({
      reason: 'deterministic_equipment_flow_catalog_direct',
      managerUrl: null,
    })
    expect(result?.answer).toContain('https://myhonor.shop/catalog')
  })

  it('keeps the catalog request through several courtesy messages in one burst', () => {
    const result = plan([
      message({ id: 'catalog-before-courtesies', text: 'Покажите каталог' }),
      message({ id: 'thanks-after-catalog', text: 'Спасибо' }),
      message({ id: 'waiting-after-thanks', text: 'Жду' }),
    ])

    expect(result).toMatchObject({
      reason: 'deterministic_equipment_flow_catalog_direct',
      managerUrl: null,
    })
    expect(result?.answer).toContain('https://myhonor.shop/catalog')
  })

  it('does not ignore a newer substantive message after a catalog request', () => {
    expect(plan([
      message({ id: 'catalog-before-delivery', text: 'Покажите каталог' }),
      message({ id: 'delivery-after-catalog', text: 'А доставка сколько стоит?' }),
    ])).toBeNull()
  })

  it.each([
    'Есть товар 2033?',
    'Цена товара?',
    'Товары пришли повреждёнными',
    'Что за шлем?',
    'Каталог уже посмотрел',
    'Каталог плохой?',
    'Сайт не открывается?',
    'Каталог не работает',
    'В каталоге неверная цена?',
    'Почему в каталоге нет товара?',
    'Мне не нужен этот каталог',
    'Не присылайте каталог',
    'Не отправляйте мне этот каталог',
    'Не скидывайте каталог',
    'Не показывайте каталог',
    'Не давайте каталог',
    'Каталог мне совсем не нужен',
    'Не хочу больше каталог',
    'Больше не хочу каталог',
    'Есть ли в каталоге куртка?',
    'В каталоге есть доставка?',
    'Куртка, 3',
    'Флиска, 3',
    'Не хочу покупать через каталог',
    'В каталоге хочу узнать цену',
    'На сайте дайте цену',
    'Товары плохие, где возврат?',
    'Не хочу посмотреть каталог',
    'Не хочу открывать каталог',
    'Не хочу ознакомиться с каталогом',
    'Не открывается каталог',
    'Не могу открыть каталог',
    'Каталог у меня не загружается',
    'Не хочу посмотреть ваш каталог',
    'Не хочу получить ссылку на каталог',
  ])('does not replace a product-specific question or complaint with the catalog: %s', (text) => {
    expect(plan([message({ id: `not-catalog-${text}`, text })])).toBeNull()
  })

  it.each([
    ['Не хочу каталог', null],
    ['Не нужен менеджер', null],
    ['Лето или зима', null],
    ['Каталог или менеджер', null],
    ['Не хочу на лето, лучше зиму', 'autumn_winter'],
    ['Каталог не нужен, позовите менеджера', 'manager'],
    ['Не хочу каталог и менеджера', null],
  ] as const)('handles negated or multiple interests conservatively: %s', (text, choiceId) => {
    const result = plan([message({ id: 'in-negated', text })])
    if (choiceId === null) {
      expect(result).toBeNull()
    } else {
      expect(result).toMatchObject({ stage: 'awaiting_city', choiceId })
    }
  })

  it('accepts only the exact canonical payload and lets it override display text', () => {
    expect(plan([message({
      id: 'valid-payload',
      text: 'Не хочу летнюю экипировку',
      messageType: 'interactive',
      metadata: { interactiveId: 'equipment_v1:interest:summer' },
    })])).toMatchObject({ stage: 'awaiting_city', choiceId: 'summer' })

    for (const invalidPayload of [
      'summer',
      'prefix:equipment_v1:interest:summer',
      'equipment_v1:interest:summer:suffix',
      'equipment_v1:interest:not_a_choice',
    ]) {
      expect(plan([message({
        id: `invalid-${invalidPayload}`,
        text: 'Не хочу летнюю экипировку',
        messageType: 'interactive',
        metadata: { interactiveId: invalidPayload },
      })])).toBeNull()
    }
  })

  it.each([
    'Что за шлем?',
    'Не хочу экипировку',
    'Дайте одежду на 2 человека',
  ])('keeps an ordinary product phrase outside the lead CTA flow: %s', (text) => {
    expect(plan([message({ id: `ordinary-product-${text}`, text })])).toBeNull()
  })

  it.each([
    'всё',
    'вся экипировка',
    'полный комплект',
    'всего понемногу',
    'всего по немножку',
    'хочу всё сразу',
  ])('routes a comprehensive-selection request to a manager: %s', (text) => {
    expect(plan([message({ id: `full-selection-${text}`, text })])).toMatchObject({
      stage: 'awaiting_city',
      choiceId: 'manager',
    })
  })

  it.each([
    ['Что входит в полный комплект?', null],
    ['Всё понятно, спасибо', null],
    ['Не полный комплект, хочу на лето', 'summer'],
  ] as const)('does not confuse a full-kit question or negation with selection: %s', (text, choiceId) => {
    const result = plan([message({ id: `full-selection-edge-${text}`, text })])
    if (choiceId === null) {
      expect(result).toBeNull()
    } else {
      expect(result).toMatchObject({ stage: 'awaiting_city', choiceId })
    }
  })

  it('keeps the city when it arrives before the equipment choice', () => {
    const result = plan([message({ id: 'in-1', text: 'Астана' })])

    expect(result).toMatchObject({
      stage: 'awaiting_interest',
      cityRouteId: 'astana',
      cityLabel: 'Астана',
      presentation: { kind: 'choices' },
    })
    expect(result?.answer).toContain('1. Экипировка на лето')
    expect(result?.answer).toContain('5. Связаться с менеджером')
    expect(result?.answer).not.toContain(config.community.url)
    expect(result?.presentation.kind === 'choices' ? result.presentation.options[2] : null).toEqual({
      id: 'equipment_v1:interest:catalog',
      title: 'Каталог',
      description: 'Посмотреть каталог',
    })
  })

  it('understands a city in a natural Russian phrase without falling back', () => {
    const result = plan([
      message({ id: 'in-city', text: 'Я из Астаны' }),
      message({ id: 'in-choice', text: 'Да, на лето' }),
    ])
    expect(result).toMatchObject({
      stage: 'routed',
      cityRouteId: 'astana',
      managerUrl: 'https://wa.me/77054057775',
    })
  })

  it.each([
    ['Я в Астане', 'astana', 'https://wa.me/77054057775'],
    ['Еду в Астану', 'astana', 'https://wa.me/77054057775'],
    ['Я из Усть-Каменогорска', 'ust_kamenogorsk', 'https://wa.me/77714057775'],
    ['Я в Өскеменде', 'ust_kamenogorsk', 'https://wa.me/77714057775'],
    ['Я из Оскемена', 'ust_kamenogorsk', 'https://wa.me/77714057775'],
    ['Я живу в Караганде', 'other', 'https://wa.me/77714057775'],
  ] as const)('understands an inflected city phrase: %s', (cityText, routeId, managerUrl) => {
    const result = plan([
      message({ id: 'in-city', text: cityText }),
      message({
        id: 'in-choice',
        text: 'Да, на лето',
        messageType: 'button',
        metadata: { quickReplyPayload: 'equipment_v1:interest:summer' },
      }),
    ])
    expect(result).toMatchObject({ stage: 'routed', cityRouteId: routeId, managerUrl })
  })

  it('keeps only the inflected city name when city and interest share one sentence', () => {
    const result = plan([message({
      id: 'city-and-choice',
      text: 'Я живу в Караганде и хочу каталог',
    })])

    expect(result).toMatchObject({
      stage: 'awaiting_interest',
      reason: 'deterministic_equipment_flow_catalog_direct',
      cityRouteId: 'other',
      cityLabel: 'Караганде',
      choiceId: null,
      managerUrl: null,
    })
    expect(result?.answer).toContain('https://myhonor.shop/catalog')
  })

  it.each([
    ['Алматы, 1', 'summer', 'other'],
    ['Өскемен, 5', 'manager', 'ust_kamenogorsk'],
  ] as const)('keeps legacy combined city and numeric choice replies: %s', (text, choiceId, routeId) => {
    expect(plan([message({ id: `combined-${text}`, text })])).toMatchObject({
      stage: 'routed',
      cityRouteId: routeId,
      choiceId,
    })
  })

  it('answers a legacy combined catalog choice with the direct website link', () => {
    expect(plan([message({ id: 'legacy-catalog-combined', text: 'Астана — вариант 3' })]))
      .toMatchObject({
        stage: 'awaiting_interest',
        reason: 'deterministic_equipment_flow_catalog_direct',
        cityRouteId: 'astana',
        choiceId: null,
        managerUrl: null,
      })
  })

  it('does not treat an unrelated inline number as a menu choice', () => {
    expect(plan([message({ id: 'product-count', text: 'Хочу 2 товара' })])).toBeNull()
    expect(plan([message({ id: 'shops-count', text: 'В Астане есть 2 магазина?' })])).toBeNull()
    expect(plan([message({ id: 'size-number', text: 'Астана, размер: 5' })])).toBeNull()
    expect(plan([message({ id: 'address-number', text: 'В Астане адрес: 3' })])).toBeNull()
  })

  it.each([
    'В Астане есть 2 магазина?',
    'Астана, размер: 5',
    'В Астане адрес: 3',
    'Где магазин?',
  ])('does not consume an ordinary city question while awaiting a city: %s', (text) => {
    expect(planWith({
      history: [message({ id: `active-city-question-${text}`, text })],
      conversationMetadata: {
        equipmentSalesFlow: {
          version: 1,
          stage: 'awaiting_city',
          choiceId: 'summer',
          updatedAt: now,
        },
      },
    })).toBeNull()
  })

  it('prefers a written choice over an unrelated quantity', () => {
    expect(plan([message({
      id: 'catalog-for-two',
      text: 'Астана, хочу каталог на 2 человека',
    })])).toMatchObject({
      stage: 'awaiting_interest',
      reason: 'deterministic_equipment_flow_catalog_direct',
      cityRouteId: 'astana',
      choiceId: null,
    })
  })

  it.each([
    'Позовите 1 человека',
    'Соедините с 1 человеком',
    'Соедините меня с живым человеком',
    'Позовите живого человека',
    'Переведите на человека',
  ])('keeps a direct request for a human: %s', (text) => {
    expect(plan([message({ id: `human-request-${text}`, text })])).toMatchObject({
      stage: 'awaiting_city',
      choiceId: 'manager',
    })
  })

  it('does not confuse a product quantity with a human handoff', () => {
    expect(plan([message({ id: 'clothes-for-two', text: 'Дайте одежду на 2 человека' })])).toBeNull()
  })

  it.each([
    'Я не из Астаны',
    'Не Астана',
    'Я не в Өскемене',
  ])('does not route a negated city mention: %s', (cityText) => {
    expect(plan([
      message({ id: 'in-city', text: cityText }),
      message({ id: 'in-choice', text: 'Да, на лето' }),
    ])).toMatchObject({ stage: 'awaiting_city', cityRouteId: null })
  })

  const routingMatrix = ([
    ['Астана', 'https://wa.me/77054057775', 'astana'],
    ['Өскемен', 'https://wa.me/77714057775', 'ust_kamenogorsk'],
    ['Алматы', 'https://wa.me/77714057775', 'other'],
  ] as const).flatMap(([city, managerUrl, routeId]) =>
    EQUIPMENT_FLOW_CHOICE_IDS.filter((choiceId) => choiceId !== 'catalog').map((choiceId) =>
      [city, choiceId, managerUrl, routeId] as const,
    ),
  )

  it.each(routingMatrix)('routes %s and %s to the configured manager', (city, choiceId, managerUrl, routeId) => {
    const result = plan([
      message({ id: 'in-city', text: city }),
      message({
        id: 'in-choice',
        text: choiceId,
        messageType: 'interactive',
        metadata: { interactiveId: `equipment_v1:interest:${choiceId}` },
      }),
    ])

    expect(result).toMatchObject({
      stage: 'routed',
      cityRouteId: routeId,
      choiceId,
      managerUrl,
      handoffAfterSend: true,
    })
    expect(result?.answer).toContain(managerUrl)
    expect(result?.answer).toContain(config.community.url)
  })

  it('uses a choice-specific handoff instead of repeating form-like fields', () => {
    const result = plan([
      message({ id: 'in-city', text: 'Алматы' }),
      message({ id: 'in-choice', text: '1' }),
    ])

    expect(result).toMatchObject({ stage: 'routed', choiceId: 'summer' })
    expect(result?.answer).toContain('Менеджер поможет подобрать экипировку на лето')
    expect(result?.answer).not.toContain('Ваш запрос:')
    expect(result?.answer).not.toContain('Город:')
  })

  it('does not repeat the community invite after it was logged outbound', () => {
    const result = plan([
      message({
        id: 'out-welcome',
        direction: 'out',
        text: `${config.messages.welcome}\n${config.community.url}`,
        metadata: {
          source: 'omnichannel_equipment_sales_flow',
          equipmentFlowStage: 'welcome',
          equipmentFlowCommunityIncluded: true,
        },
      }),
      message({ id: 'in-city', text: 'Астана' }),
      message({ id: 'in-choice', text: '1' }),
    ])

    expect(result?.stage).toBe('routed')
    expect(result?.answer.match(/chat\.whatsapp\.com/g)).toBeNull()
  })

  it('adds the club destinations without repeating a welcome that provider history confirms was sent', () => {
    const result = plan([
      message({
        id: 'out-welcome-history',
        direction: 'out',
        text: config.messages.welcome,
        metadata: { catchUp: true, fromMe: true },
      }),
      message({ id: 'new-club-cta', text: 'Хочу в Клуб' }),
    ])

    expect(result).toMatchObject({
      stage: 'welcome',
      reason: 'deterministic_equipment_flow_resume_without_repeating_welcome',
    })
    expect(result?.answer).not.toContain(config.messages.welcome)
    expect(result?.answer).toContain(config.messages.ask_city)
    expect(result?.answer).toContain(config.community.url)
    expect(result?.answer).toContain(config.catalog?.url)
    expect(result).toMatchObject({
      communityIncluded: true,
      outboundMetadata: expect.objectContaining({
        equipmentFlowCommunityIncluded: true,
        equipmentFlowCatalogShared: true,
      }),
    })
  })

  it('does not reset an active choice when the customer sends another greeting', () => {
    const history = [
      message({
        id: 'out-awaiting-city',
        direction: 'out',
        text: config.messages.ask_city,
        metadata: {
          source: 'omnichannel_equipment_sales_flow',
          equipmentFlowStage: 'awaiting_city',
          equipmentFlowChoiceId: 'catalog',
        },
      }),
      message({ id: 'repeat-greeting', text: 'Привет' }),
    ]
    const conversationMetadata = {
      equipmentSalesFlow: {
        version: 1,
        stage: 'awaiting_city',
        choiceId: 'catalog',
        updatedAt: '2026-07-13T14:59:00.000Z',
      },
    }

    expect(planWith({ history, conversationMetadata })).toBeNull()
    expect(planWith({
      history: [...history, message({ id: 'city-after-greeting', text: 'Астана' })],
      conversationMetadata,
    })).toMatchObject({
      stage: 'awaiting_interest',
      reason: 'deterministic_equipment_flow_catalog_direct',
      cityRouteId: 'astana',
      choiceId: null,
      managerUrl: null,
    })
  })

  it('resumes an active welcome with missing club destinations', () => {
    const result = planWith({
      history: [
        message({
          id: 'out-active-welcome',
          direction: 'out',
          text: config.messages.welcome,
          metadata: {
            source: 'omnichannel_equipment_sales_flow',
            equipmentFlowStage: 'welcome',
          },
        }),
        message({ id: 'repeat-club-cta', text: 'Хочу в Клуб' }),
      ],
      conversationMetadata: {
        equipmentSalesFlow: {
          version: 1,
          stage: 'welcome',
          updatedAt: '2026-07-13T14:59:00.000Z',
        },
      },
    })

    expect(result).toMatchObject({
      stage: 'welcome',
      reason: 'deterministic_equipment_flow_resume_without_repeating_welcome',
      choiceId: null,
      cityRouteId: null,
      communityIncluded: true,
      outboundMetadata: expect.objectContaining({
        equipmentFlowCommunityIncluded: true,
        equipmentFlowCatalogShared: true,
      }),
    })
    expect(result?.answer).toContain(config.messages.ask_city)
    expect(result?.answer).toContain(config.community.url)
    expect(result?.answer).toContain(config.catalog?.url)
  })

  it.each([
    ['Конаев, 2', 'Конаев'],
    ['Я из Караганды, 2', 'Караганды'],
  ] as const)('keeps unknown cities in a legacy combined reply: %s', (text, cityLabel) => {
    const result = planWith({
      history: [message({ id: `legacy-unknown-${text}`, text })],
      conversationMetadata: {
        equipmentSalesFlow: {
          version: 1,
          stage: 'welcome',
          updatedAt: '2026-07-13T14:59:00.000Z',
        },
      },
    })

    expect(result).toMatchObject({
      stage: 'routed',
      cityRouteId: 'other',
      cityLabel,
      choiceId: 'autumn_winter',
    })
  })

  it.each(['Куртка, 2', 'Шлем, 2'])(
    'does not replace a saved city with a product and quantity: %s',
    (text) => {
      const result = planWith({
        history: [message({ id: `product-after-city-${text}`, text })],
        conversationMetadata: {
          equipmentSalesFlow: {
            version: 1,
            stage: 'awaiting_interest',
            cityRouteId: 'astana',
            cityLabel: 'Астана',
            updatedAt: '2026-07-13T14:59:00.000Z',
          },
        },
      })

      expect(result).toBeNull()
    },
  )

  it('does not let a failed welcome suppress the real reply', () => {
    const failedWelcome = message({
      id: 'failed-welcome',
      direction: 'out',
      text: config.messages.welcome,
    })
    failedWelcome.status = 'failed'

    expect(plan([
      failedWelcome,
      message({ id: 'new-club-cta', text: 'Хочу в Клуб' }),
    ])).toMatchObject({ stage: 'welcome' })
  })

  it('does not repeat a manager link that provider history confirms was sent', () => {
    const result = plan([
      message({
        id: 'out-manager-history',
        direction: 'out',
        text: 'Напишите менеджеру: https://wa.me/77054057775',
        metadata: { catchUp: true, fromMe: true },
      }),
      message({ id: 'new-request', text: 'Астана, хочу каталог' }),
    ])

    expect(result).toBeNull()
  })

  it('does not restart a completed flow', () => {
    const result = plan([
      message({
        id: 'out-route',
        direction: 'out',
        text: 'Напишите менеджеру',
        metadata: {
          source: 'omnichannel_equipment_sales_flow',
          equipmentFlowStage: 'routed',
        },
      }),
      message({ id: 'in-2', text: 'Спасибо' }),
    ])
    expect(result).toBeNull()
  })

  it('treats an ambiguous city answer conservatively', () => {
    const result = plan([
      message({ id: 'in-city', text: 'Астана или Алматы' }),
      message({ id: 'in-choice', text: 'Да, на лето' }),
    ])
    expect(result).toMatchObject({ stage: 'awaiting_city', cityRouteId: null })
  })

  it('uses the fallback manager for a free-form city after the city prompt', () => {
    const result = plan([
      message({ id: 'out-prompt', direction: 'out', text: config.messages.ask_city, metadata: {
        source: 'omnichannel_equipment_sales_flow',
        equipmentFlowStage: 'awaiting_city',
      } }),
      message({ id: 'in-choice', text: 'Да, на лето' }),
      message({ id: 'in-city', text: 'Конаев' }),
    ])
    expect(result).toMatchObject({
      stage: 'routed',
      cityRouteId: 'other',
      cityLabel: 'Конаев',
      managerUrl: 'https://wa.me/77714057775',
    })
  })

  it.each(['Привет', 'Приветик', 'Приветствую', 'Салам', 'Сәлем', 'Hello', 'Hi']) (
    'never treats a greeting as an unknown city while awaiting a city: %s',
    (greeting) => {
      const result = planWith({
        history: [message({ id: `greeting-${greeting}`, text: greeting })],
        conversationMetadata: {
          equipmentSalesFlow: {
            version: 1,
            stage: 'awaiting_city',
            choiceId: 'summer',
            updatedAt: now,
          },
        },
      })
      expect(result).toBeNull()
    },
  )

  it('ignores stale city and choice history when a new conversation starts', () => {
    const result = plan([
      message({ id: 'old-city', text: 'Астана', occurredAt: '2025-01-01T00:00:00.000Z' }),
      message({ id: 'old-choice', text: 'Да, на лето', occurredAt: '2025-01-01T00:01:00.000Z' }),
      message({ id: 'new-greeting', text: 'Здравствуйте' }),
    ])

    expect(result).toMatchObject({
      stage: 'welcome',
      cityRouteId: null,
      choiceId: null,
      managerUrl: null,
    })
  })

  it.each([
    'Хочу в Клуб',
    'хочу в клуб',
    'Клуб',
    'Привет, хочу в клуб',
    'Здравствуйте! Хо',
    'I want to join the club',
  ]) (
    'starts the equipment welcome flow for the campaign CTA: %s',
    (text) => {
      const result = plan([message({ id: `club-${text}`, text })])
      expect(result).toMatchObject({
        stage: 'welcome',
        reason: 'deterministic_equipment_flow_club_invite',
        cityRouteId: null,
        choiceId: null,
        managerUrl: null,
        communityIncluded: true,
        outboundMetadata: expect.objectContaining({
          equipmentFlowCommunityIncluded: true,
          equipmentFlowCatalogShared: true,
        }),
      })
      expect(result?.answer).toContain(config.messages.welcome)
      expect(result?.answer).toContain(config.community.url)
      expect(result?.answer).toContain(config.catalog?.url)
    },
  )

  it('does not repeat confirmed club destinations on a repeated CTA', () => {
    const result = plan([
      message({
        id: 'out-club-destinations',
        direction: 'out',
        text: [
          config.messages.welcome,
          config.community.url,
          config.catalog?.url,
        ].join('\n'),
        metadata: {
          source: 'omnichannel_equipment_sales_flow',
          equipmentFlowStage: 'welcome',
          equipmentFlowCommunityIncluded: true,
          equipmentFlowCatalogShared: true,
        },
      }),
      message({ id: 'repeat-club-with-destinations', text: 'Хочу в Клуб' }),
    ])

    expect(result).toMatchObject({
      stage: 'welcome',
      reason: 'deterministic_equipment_flow_resume_without_repeating_welcome',
      communityIncluded: false,
    })
    expect(result?.answer).toBe(config.messages.ask_city)
    expect(result?.answer).not.toContain(config.community.url)
    expect(result?.answer).not.toContain(config.catalog?.url)
  })

  it('does not duplicate a catalog URL already present in the configured welcome', () => {
    const catalogInWelcome = {
      ...config,
      messages: {
        ...config.messages,
        welcome: `${config.messages.welcome}\n\nИнтернет-магазин: ${config.catalog?.url}`,
      },
    }
    const result = planWith({
      history: [message({ id: 'club-with-catalog-in-welcome', text: 'Хочу в Клуб' })],
      configOverride: catalogInWelcome,
    })

    expect(result).toMatchObject({
      reason: 'deterministic_equipment_flow_club_invite',
      communityIncluded: true,
      outboundMetadata: expect.objectContaining({
        equipmentFlowCommunityIncluded: true,
        equipmentFlowCatalogShared: true,
      }),
    })
    expect(result?.answer.match(/https:\/\/myhonor\.shop\/catalog/gu)).toHaveLength(1)
    expect(result?.answer).toContain(config.community.url)
  })

  it('restores a recent active choice from conversation metadata', () => {
    const result = planWith({
      history: [message({ id: 'new-city', text: 'Конаев' })],
      conversationMetadata: {
        equipmentSalesFlow: {
          version: 1,
          stage: 'awaiting_city',
          choiceId: 'catalog',
          communitySentAt: '2026-07-13T14:59:00.000Z',
          updatedAt: '2026-07-13T14:59:00.000Z',
        },
      },
    })

    expect(result).toMatchObject({
      stage: 'awaiting_interest',
      reason: 'deterministic_equipment_flow_catalog_direct',
      cityRouteId: 'other',
      cityLabel: 'Конаев',
      choiceId: null,
      managerUrl: null,
      communityIncluded: false,
    })
    expect(result?.answer).not.toContain(config.community.url)
  })

  it('restores a recent active city from conversation metadata', () => {
    const result = planWith({
      history: [message({
        id: 'new-choice',
        text: 'Открыть каталог',
        messageType: 'interactive',
        metadata: { interactiveId: 'equipment_v1:interest:catalog' },
      })],
      conversationMetadata: {
        equipmentSalesFlow: {
          version: 1,
          stage: 'awaiting_interest',
          cityRouteId: 'ust_kamenogorsk',
          cityLabel: 'Өскемен',
          updatedAt: '2026-07-13T14:59:00.000Z',
        },
      },
    })

    expect(result).toMatchObject({
      stage: 'awaiting_interest',
      reason: 'deterministic_equipment_flow_catalog_direct',
      cityRouteId: 'ust_kamenogorsk',
      cityLabel: 'Өскемен',
      choiceId: null,
      managerUrl: null,
    })
  })

  it('keeps the substantive full-selection request when a courtesy follows in the same burst', () => {
    const result = planWith({
      history: [
        message({ id: 'full-selection-before-thanks', text: 'Всего понемногу' }),
        message({ id: 'courtesy-after-selection', text: 'Спасибо' }),
      ],
      conversationMetadata: {
        equipmentSalesFlow: {
          version: 1,
          stage: 'awaiting_interest',
          cityRouteId: 'astana',
          cityLabel: 'Астана',
          updatedAt: now,
        },
      },
    })

    expect(result).toMatchObject({
      stage: 'routed',
      cityRouteId: 'astana',
      choiceId: 'manager',
      managerUrl: 'https://wa.me/77054057775',
    })
    expect(result?.answer).not.toMatch(/шлем|куртк|перчат/iu)
  })

  it.each([
    'Есть каталог в Астане?',
    'А есть каталог?',
    'Хочу узнать, есть ли каталог в Астане?',
    'Хочу спросить, где каталог?',
  ])('answers an informational catalog question with the direct link: %s', (text) => {
    expect(plan([message({ id: `catalog-question-${text}`, text })])).toMatchObject({
      reason: 'deterministic_equipment_flow_catalog_direct',
      choiceId: null,
      managerUrl: null,
    })
    expect(planWith({
      history: [message({ id: `active-catalog-question-${text}`, text })],
      conversationMetadata: {
        equipmentSalesFlow: {
          version: 1,
          stage: 'awaiting_interest',
          cityRouteId: 'astana',
          cityLabel: 'Астана',
          updatedAt: now,
        },
      },
    })).toMatchObject({
      reason: 'deterministic_equipment_flow_catalog_direct',
      choiceId: null,
      managerUrl: null,
    })
  })

  it('does not revive an earlier choice when a cancellation mentions a menu item and a courtesy follows', () => {
    expect(planWith({
      history: [
        message({ id: 'selection-before-menu-cancel', text: 'Всего понемногу' }),
        message({ id: 'menu-cancel', text: 'Отмена каталога' }),
        message({ id: 'courtesy-after-menu-cancel', text: 'Спасибо' }),
      ],
      conversationMetadata: {
        equipmentSalesFlow: {
          version: 1,
          stage: 'awaiting_interest',
          cityRouteId: 'astana',
          cityLabel: 'Астана',
          updatedAt: now,
        },
      },
    })).toBeNull()
  })

  it.each([
    'Нет, уже не надо, спасибо',
    'Передумал',
    'Ничего не нужно',
  ])('honors a cancellation after an earlier full-selection request: %s', (text) => {
    expect(planWith({
      history: [
        message({ id: `selection-before-cancel-${text}`, text: 'Всего понемногу' }),
        message({ id: `selection-cancel-${text}`, text }),
      ],
      conversationMetadata: {
        equipmentSalesFlow: {
          version: 1,
          stage: 'awaiting_interest',
          cityRouteId: 'astana',
          cityLabel: 'Астана',
          updatedAt: now,
        },
      },
    })).toBeNull()
  })

  it('routes a typo-tolerant Esik location to the shared manager', () => {
    expect(planWith({
      history: [message({ id: 'esik-location', text: 'Алматинская область г.Есик' })],
      conversationMetadata: {
        equipmentSalesFlow: {
          version: 1,
          stage: 'awaiting_city',
          choiceId: 'catalog',
          updatedAt: now,
        },
      },
    })).toMatchObject({
      stage: 'awaiting_interest',
      reason: 'deterministic_equipment_flow_catalog_direct',
      cityRouteId: 'other',
      cityLabel: 'Есик',
      choiceId: null,
      managerUrl: null,
    })
  })

  it('does not restore expired or completed flow state', () => {
    const current = message({ id: 'current-city', text: 'Конаев' })
    expect(planWith({
      history: [current],
      conversationMetadata: {
        equipmentSalesFlow: {
          version: 1,
          stage: 'awaiting_city',
          choiceId: 'summer',
          updatedAt: '2026-07-12T14:59:59.000Z',
        },
      },
    })).toBeNull()
    expect(planWith({
      history: [current],
      conversationMetadata: {
        equipmentSalesFlow: {
          version: 1,
          stage: 'routed',
          choiceId: 'summer',
          cityRouteId: 'astana',
          updatedAt: '2026-07-13T14:59:00.000Z',
        },
      },
    })).toBeNull()
  })

  it.each(['цена', 'доставка', 'размер', 'наличие', 'подскажите']) (
    'does not interpret an off-script single word as a fallback city: %s',
    (text) => {
      expect(planWith({
        history: [message({ id: `off-script-${text}`, text })],
        conversationMetadata: {
          equipmentSalesFlow: {
            version: 1,
            stage: 'awaiting_city',
            choiceId: 'summer',
            updatedAt: now,
          },
        },
      })).toBeNull()
    },
  )

  it('stays off-script for unrelated text and disabled config', () => {
    expect(plan([message({ id: 'unrelated', text: 'Сколько стоит доставка?' })])).toBeNull()
    expect(planWith({
      history: [message({ id: 'disabled', text: 'Здравствуйте' })],
      configOverride: { ...config, enabled: false },
    })).toBeNull()
  })

  it('uses the deterministic equipment playbook for a historical draft', () => {
    expect(planWith({
      history: [message({ id: 'backfill', text: 'Здравствуйте' })],
      forceDraft: true,
    })).toMatchObject({
      stage: 'welcome',
      reason: 'deterministic_equipment_flow_welcome',
    })
  })
})
