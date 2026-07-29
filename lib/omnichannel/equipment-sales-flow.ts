import { z } from 'zod'
import { isConfirmedOutboundMessage } from './delayed-reply-policy'
import type { OmnichannelMessage, JsonObject } from './types'

export const EQUIPMENT_FLOW_CHOICE_IDS = [
  'summer',
  'autumn_winter',
  'catalog',
  'beginner',
  'manager',
] as const

export type EquipmentFlowChoiceId = (typeof EQUIPMENT_FLOW_CHOICE_IDS)[number]

const choiceIdSchema = z.enum(EQUIPMENT_FLOW_CHOICE_IDS)
const safePhoneSchema = z
  .string()
  .regex(/^[1-9]\d{9,14}$/, 'manager_phone must contain 10–15 international digits')

const communityUrlSchema = z.string().max(500).url().refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'chat.whatsapp.com'
  } catch {
    return false
  }
}, 'community URL must use https://chat.whatsapp.com')

const catalogUrlSchema = z.string().max(500).url().refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && (url.hostname === 'myhonor.shop' || url.hostname === 'www.myhonor.shop')
      && /^\/catalog\/?$/u.test(url.pathname)
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
  } catch {
    return false
  }
}, 'catalog URL must use the myhonor.shop catalog page')

export const equipmentSalesFlowConfigSchema = z
  .object({
    version: z.literal(1),
    opt_in_revision: z.literal(1),
    enabled: z.boolean(),
    messages: z.object({
      welcome: z.string().trim().min(1).max(1_000),
      ask_city: z.string().trim().min(1).max(500),
      ask_interest: z.string().trim().min(1).max(500),
      options_prompt: z.string().trim().min(1).max(200),
      handoff: z.string().trim().min(1).max(500),
      handoff_by_choice: z.object({
        summer: z.string().trim().min(1).max(500),
        autumn_winter: z.string().trim().min(1).max(500),
        catalog: z.string().trim().min(1).max(500),
        beginner: z.string().trim().min(1).max(500),
        manager: z.string().trim().min(1).max(500),
      }).optional(),
    }),
    choices: z
      .array(z.object({
        id: choiceIdSchema,
        label: z.string().trim().min(1).max(72),
        button_label: z.string().trim().min(1).max(20),
      }))
      .length(EQUIPMENT_FLOW_CHOICE_IDS.length),
    city_routes: z
      .array(z.object({
        id: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/),
        label: z.string().trim().min(1).max(80),
        aliases: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
        manager_phone: safePhoneSchema,
      }))
      .min(1)
      .max(20),
    fallback_route_id: z.string().trim().min(1).max(40),
    community: z.object({
      text: z.string().trim().min(1).max(500),
      url: communityUrlSchema,
    }),
    catalog: z.object({
      text: z.string().trim().min(1).max(500),
      url: catalogUrlSchema,
    }).optional(),
  })
  .superRefine((config, ctx) => {
    const choiceIds = config.choices.map((choice) => choice.id)
    if (new Set(choiceIds).size !== choiceIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['choices'], message: 'choice ids must be unique' })
    }
    for (const requiredId of EQUIPMENT_FLOW_CHOICE_IDS) {
      if (!choiceIds.includes(requiredId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['choices'],
          message: `missing required choice: ${requiredId}`,
        })
      }
    }

    const routeIds = config.city_routes.map((route) => route.id)
    if (new Set(routeIds).size !== routeIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['city_routes'], message: 'route ids must be unique' })
    }
    if (!routeIds.includes(config.fallback_route_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fallback_route_id'],
        message: 'fallback route must reference an existing city route',
      })
    }

    const renderedChoices = `${config.messages.options_prompt}\n${config.choices
      .map((choice, index) => `${index + 1}. ${choice.label}`)
      .join('\n')}`
    const community = `${config.community.text}\n${config.community.url}`
    const handoffs = config.messages.handoff_by_choice
      ? Object.values(config.messages.handoff_by_choice)
      : [config.messages.handoff]
    const renderedBodies = [
      config.messages.welcome,
      `${config.messages.welcome}\n\n${community}`,
      ...(config.catalog ? [
        `${config.messages.welcome}\n\n${community}\n\n${config.catalog.text}\n${config.catalog.url}`,
      ] : []),
      `${config.messages.ask_interest}\n\n${renderedChoices}`,
      config.messages.ask_city,
      ...(config.catalog ? [`${config.catalog.text}\n${config.catalog.url}`] : []),
      ...handoffs.map((handoff) =>
        `${handoff}\n\nНаписать менеджеру: https://wa.me/000000000000000\n\n${community}`,
      ),
    ]
    if (renderedBodies.some((body) => body.length > 1_000)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messages'],
        message: 'rendered flow messages must fit the 1000 character provider limit',
      })
    }
  })

export type EquipmentSalesFlowConfig = z.infer<typeof equipmentSalesFlowConfigSchema>

export const omnichannelAutomationConfigSchema = z
  .object({
    equipment_sales_flow: equipmentSalesFlowConfigSchema.optional(),
  })
  .passthrough()

export interface EquipmentFlowOption {
  id: string
  title: string
  description?: string
}

export interface EquipmentSalesFlowPlan {
  stage: 'welcome' | 'awaiting_city' | 'awaiting_interest' | 'routed'
  answer: string
  reason: string
  summary: string
  leadScore: number
  presentation:
    | { kind: 'text' }
    | { kind: 'choices'; options: EquipmentFlowOption[] }
  cityRouteId: string | null
  cityLabel: string | null
  choiceId: EquipmentFlowChoiceId | null
  choiceLabel: string | null
  managerUrl: string | null
  handoffAfterSend: boolean
  communityIncluded: boolean
  outboundMetadata: JsonObject
}

interface CityMatch {
  routeId: string
  routeLabel: string
  customerLabel: string
  managerPhone: string
}

const KNOWN_OTHER_CITIES = [
  'алматы', 'шымкент', 'караганда', 'қарағанды', 'павлодар', 'костанай', 'қостанай',
  'кокшетау', 'көкшетау', 'петропавловск', 'семей', 'тараз', 'талдыкорган',
  'талдықорған', 'туркестан', 'түркістан', 'кызылорда', 'қызылорда', 'атырау',
  'актау', 'ақтау', 'актобе', 'ақтөбе', 'уральск', 'орал', 'жезказган', 'жезқазған',
  'экибастуз', 'рудный', 'темиртау', 'балхаш', 'жанаозен', 'жаңаөзен',
  'есик', 'иссык',
] as const

const NON_CITY_REPLIES = new Set([
  'да', 'нет', 'привет', 'здравствуйте', 'добрый день', 'спасибо', 'ок', 'хорошо',
  'добрый вечер', 'доброе утро', 'пожалуйста', 'где', 'когда', 'как', 'что', 'почему',
  'можно', 'есть', 'сколько', 'лето', 'осень', 'зима', 'каталог', 'менеджер', 'новичок',
  'цена', 'стоимость', 'доставка', 'размер', 'размеры', 'наличие', 'скидка', 'адрес',
  'магазин', 'график', 'оплата', 'рассрочка', 'товар', 'модель', 'фото', 'видео', 'ссылка', 'сайт',
  'помощь', 'вопрос', 'подскажите', 'расскажите', 'покажите', 'помогите', 'посоветуйте', 'уточните',
  'напишите', 'позвоните', 'можете', 'подбор', 'скидки', 'price', 'delivery', 'size', 'available', 'availability',
])

const EXPLICIT_CITY_STOP_WORDS = new Set([
  'и', 'а', 'но', 'или', 'хочу', 'хотел', 'хотела', 'нужен', 'нужна', 'нужно', 'интересует',
  'подбираю', 'выбираю', 'давайте', 'каталог', 'менеджер', 'лето', 'осень', 'зима',
])

function isGreetingText(text: string): boolean {
  return /^(?:привет(?:ик|ствую)?|здравствуй(?:те)?|добрый\s+(?:день|вечер)|доброе\s+утро|салам|с[әа]лем|hello|hi|hey)$/iu.test(text)
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function metadataString(message: OmnichannelMessage, key: string): string | null {
  const value = message.metadata[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function canonicalChoicePayload(choiceId: EquipmentFlowChoiceId): string {
  return `equipment_v1:interest:${choiceId}`
}

function choiceFromPayload(value: string | null): EquipmentFlowChoiceId | null {
  if (!value) return null
  const normalized = value.trim().toLocaleLowerCase('en-US')
  const match = normalized.match(/^equipment_v1:interest:([a-z_]+)$/)
  if (!match) return null
  const direct = match[1]
  return EQUIPMENT_FLOW_CHOICE_IDS.includes(direct as EquipmentFlowChoiceId)
    ? direct as EquipmentFlowChoiceId
    : null
}

function isNegatedChoiceMention(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 40), start).trimEnd()
  const after = text.slice(end, Math.min(text.length, end + 40))
  return /(?:^|\s)не(?:\s+(?:хочу|надо|нуж\p{L}*|интерес\p{L}*|выбира\p{L}*|на|этот|эту)){0,4}\s*$/iu.test(before)
    || /^(?:\s+\p{L}+){0,2}\s*не\s+(?:хочу|надо|нуж\p{L}*|интерес\p{L}*)/iu.test(after)
}

function comprehensiveChoiceFromFreeText(text: string): EquipmentFlowChoiceId | null {
  return /^(?:(?:мне|хочу|нужен|нужна|нужно|давайте|интересует)\s+)*(?:все|вся\s+(?:экипировк\p{L}*|одежд\p{L}*)|весь\s+комплект\p{L}*|полн\p{L}*\s+(?:комплект\p{L}*|экипировк\p{L}*)|всего\s+(?:(?:по\s*)?немно(?:г|ж)\p{L}*|по\s+чуть\s+чуть)|(?:(?:по\s*)?немно(?:г|ж)\p{L}*|по\s+чуть\s+чуть)\s+всего)(?:\s+(?:пожалуйста|сразу))?$/iu.test(text)
    ? 'manager'
    : null
}

function isInformationalChoiceQuestion(raw: string, normalized: string): boolean {
  // Questions are not button selections, even when they include words such as
  // “хочу” (“хочу узнать, есть ли каталог?”). Let the AI create a reviewed
  // draft instead of auto-routing on a noun inside the question.
  if (
    /[?]/u.test(raw)
    || /(?:^|\s)хочу\s+(?:узнать|спросить|уточнить)(?=$|\s)/iu.test(normalized)
    || /(?:^|\s)(?:есть\s+ли|где|сколько|какие|какой|какая)(?=$|\s)/iu.test(normalized)
  ) {
    return true
  }
  const explicitSelection = /(?:^|\s)(?:хочу|выбираю|давайте|интересует|нужен|нужна|нужно|покажите|отправьте|откройте|позовите|подключите)(?=$|\s)/iu.test(normalized)
  if (explicitSelection) return false
  return /^(?:а\s+)?(?:есть(?:\s+ли)?|где|что|какие|какой|какая|сколько|продаете(?:\s+ли)?)(?=$|\s)/iu.test(normalized)
    || /(?:^|\s)есть(?=$|\s)/iu.test(normalized)
}

function isSelectionCancellation(message: OmnichannelMessage): boolean {
  const normalized = normalizeText(message.text ?? '')
  if (!normalized) return false
  return /(?:^|\s)(?:передумал\p{L}*|отмена|не\s+актуально)(?=$|\s)/iu.test(normalized)
    || /^(?:(?:нет|спасибо)\s+)?(?:уже\s+)?не\s+(?:надо|нужно)(?:\s+(?:спасибо|благодарю))?$/iu.test(normalized)
    || /^ничего\s+не\s+(?:надо|нужно)(?:\s+(?:спасибо|благодарю))?$/iu.test(normalized)
    || /^не\s+нуж(?:ен|на|но|ны)(?:\s+.+)?$/iu.test(normalized)
}

function choiceFromFreeText(text: string): EquipmentFlowChoiceId | null {
  const comprehensive = comprehensiveChoiceFromFreeText(text)
  if (comprehensive) return comprehensive

  const definitions: Array<{ id: EquipmentFlowChoiceId; pattern: RegExp }> = [
    { id: 'summer', pattern: /(?:^|\s)(?:лето|летн\p{L}*)(?=$|\s)/giu },
    { id: 'autumn_winter', pattern: /(?:^|\s)(?:осен\p{L}*|зим\p{L}*)(?=$|\s)/giu },
    { id: 'catalog', pattern: /(?:^|\s)каталог\p{L}*(?=$|\s)/giu },
    { id: 'beginner', pattern: /(?:^|\s)нович\p{L}*(?=$|\s)/giu },
    {
      id: 'manager',
      pattern: /(?:^|\s)(?:менеджер\p{L}*|оператор\p{L}*|(?:(?:позовите|подключите|соедините|переведите|дайте)(?:\s+(?:меня|пожалуйста)){0,2}(?:\s+(?:с|на|к))?\s+(?:\d+\s+)?(?:(?:жив\p{L}*|реальн\p{L}*)\s+)?человек\p{L}*)|(?:(?:хочу|нужен|нужна|нужно)\s+(?:(?:жив\p{L}*|реальн\p{L}*)\s+)?человек\p{L}*))(?=$|\s)/giu,
    },
  ]
  const mentions: Array<{
    id: EquipmentFlowChoiceId
    index: number
    end: number
    negated: boolean
  }> = []
  for (const definition of definitions) {
    for (const match of text.matchAll(definition.pattern)) {
      const full = match[0]
      const leadingSpace = /^\s/u.test(full) ? 1 : 0
      const start = (match.index ?? 0) + leadingSpace
      const end = (match.index ?? 0) + full.length
      mentions.push({
        id: definition.id,
        index: start,
        end,
        negated: isNegatedChoiceMention(text, start, end),
      })
    }
  }
  const positive = mentions.filter((mention) => !mention.negated)
  const ids = new Set(positive.map((mention) => mention.id))
  if (ids.size !== 1) return null

  const negated = mentions.filter((mention) => mention.negated)
  if (negated.length > 0) {
    const affirmed = positive.some((mention) => {
      const before = text.slice(Math.max(0, mention.index - 40), mention.index)
      if (/(?:^|\s)(?:хочу|выбираю|давайте|лучше|вместо|позовите)\s*$/iu.test(before)) return true

      const previousNegated = [...negated]
        .filter((candidate) => candidate.end <= mention.index)
        .sort((left, right) => right.end - left.end)[0]
      if (!previousNegated) return false
      const between = text.slice(previousNegated.end, mention.index)
      return /(?:^|\s)(?:а|но|лучше|вместо|хочу|выбираю|давайте|позовите)(?:\s|$)/iu.test(between)
    })
    if (!affirmed) return null
  }
  return positive.sort((a, b) => b.index - a.index)[0]?.id ?? null
}

function choiceFromMessage(
  message: OmnichannelMessage,
  config: EquipmentSalesFlowConfig,
  allowUnknownLegacyCity = false,
): EquipmentFlowChoiceId | null {
  for (const key of ['quickReplyPayload', 'postbackPayload', 'buttonPayload', 'interactiveId']) {
    const fromPayload = choiceFromPayload(metadataString(message, key))
    if (fromPayload) return fromPayload
  }

  const text = normalizeText(message.text ?? '')
  if (!text) return null
  const numbered = text.match(/^(?:вариант\s*)?([1-5])$/u)?.[1]
  if (numbered) return config.choices[Number(numbered) - 1]?.id ?? null

  for (const choice of config.choices) {
    if (text === normalizeText(choice.label) || text === normalizeText(choice.button_label)) {
      return choice.id
    }
  }
  if (isInformationalChoiceQuestion(message.text ?? '', text)) return null
  const fromFreeText = choiceFromFreeText(text)
  if (fromFreeText) return fromFreeText

  // The previous live prompt invited replies in the form “city, number”. Keep
  // that exact format compatible without treating quantities in ordinary
  // product questions as menu selections. A written choice always wins.
  const legacyNumber = legacyCombinedChoiceNumber(
    message.text?.trim() ?? '',
    config,
    allowUnknownLegacyCity,
  )
  if (legacyNumber) {
    return config.choices[Number(legacyNumber) - 1]?.id ?? null
  }
  return null
}

function latestChoice(
  inbound: OmnichannelMessage[],
  config: EquipmentSalesFlowConfig,
  allowUnknownLegacyCity = false,
): EquipmentFlowChoiceId | null {
  for (const message of [...inbound].reverse()) {
    // Cancellation wins over any menu word contained in the same message.
    // This also prevents a later courtesy from reviving an older selection.
    if (isSelectionCancellation(message)) return null
    const choice = choiceFromMessage(message, config, allowUnknownLegacyCity)
    if (choice) return choice
  }
  return null
}

function isCatalogRequestCancellation(message: OmnichannelMessage): boolean {
  const normalized = normalizeText(message.text ?? '')
  if (!normalized) return false
  const rejectVerb = '(?:хочу|надо|нужно|нужен|нужна|присылайте|отправляйте|скидывайте|показывайте|открывайте|давайте)'
  const catalog = 'каталог\\p{L}*'
  const modifier = '(?:мне|этот|эта|эту|эти|тот|та|такой|такую|ваш|ваша|вашу|ваши|наш|наша|нашу|весь|пожалуйста|больше|совсем|вообще|уже|посмотреть|смотреть|открыть|открывать|ознакомиться|получить|ссылку|на|с)'
  const between = `(?:\\s+${modifier}){0,5}`
  const leading = '(?:(?:я|мне)\\s+)?(?:(?:больше|совсем|вообще|уже)\\s+)?'
  return new RegExp(`(?:^|\\s)${leading}не\\s+${rejectVerb}${between}\\s+${catalog}(?=$|\\s)`, 'iu')
    .test(normalized)
    || new RegExp(`(?:^|\\s)(?:(?:я|мне)\\s+)?(?:(?:этот|эта|эту|эти|тот|та|такой|такую)\\s+)?${catalog}${between}\\s+не\\s+${rejectVerb}(?=$|\\s)`, 'iu')
      .test(normalized)
    || new RegExp(`(?:^|\\s)без(?:\\s+(?:этого|данного))?\\s+${catalog}(?=$|\\s)`, 'iu')
      .test(normalized)
    || new RegExp(`(?:^|\\s)не\\s+(?:могу\\s+)?(?:посмотр\\p{L}*|смотр\\p{L}*|откр\\p{L}*|ознаком\\p{L}*|получ\\p{L}*)(?:\\s+с)?\\s+${catalog}(?=$|\\s)`, 'iu')
      .test(normalized)
    || new RegExp(`(?:^|\\s)не\\s+(?:открывается|загружается|работает)\\s+${catalog}(?=$|\\s)`, 'iu')
      .test(normalized)
    || new RegExp(`(?:^|\\s)${catalog}(?:\\s+(?:у\\s+меня|сейчас|почему))?\\s+не\\s+(?:открывается|загружается|работает)(?=$|\\s)`, 'iu')
      .test(normalized)
    || /(?:^|\s)(?:уже\s+)?(?:посмотрел\p{L}*|открыл\p{L}*)\s+каталог\p{L}*(?=$|\s)/iu.test(normalized)
    || /(?:^|\s)каталог\p{L}*\s+уже\s+(?:посмотрел\p{L}*|открыл\p{L}*)(?=$|\s)/iu.test(normalized)
    || /(?:^|\s)(?:отмена|отмените)\s+каталог\p{L}*(?=$|\s)/iu.test(normalized)
}

function isCourtesyOnly(message: OmnichannelMessage): boolean {
  const normalized = normalizeText(message.text ?? '')
  return /^(?:спасибо|благодарю|пожалуйста|ок|хорошо|жду|thanks|thank you)$/iu.test(normalized)
}

function isCanonicalCatalogSelection(
  message: OmnichannelMessage,
  config: EquipmentSalesFlowConfig,
): boolean {
  for (const key of ['quickReplyPayload', 'postbackPayload', 'buttonPayload', 'interactiveId']) {
    if (choiceFromPayload(metadataString(message, key)) === 'catalog') return true
  }

  const raw = message.text?.trim() ?? ''
  const normalized = normalizeText(raw)
  if (!normalized) return false
  const numbered = normalized.match(/^(?:вариант\s*)?([1-5])$/u)?.[1]
  if (numbered && config.choices[Number(numbered) - 1]?.id === 'catalog') return true

  const catalogChoice = config.choices.find((choice) => choice.id === 'catalog')
  if (
    catalogChoice
    && (
      normalized === normalizeText(catalogChoice.label)
      || normalized === normalizeText(catalogChoice.button_label)
    )
  ) {
    return true
  }

  const legacyNumber = legacyCombinedChoiceNumber(raw, config, false)
  return Boolean(
    legacyNumber
    && config.choices[Number(legacyNumber) - 1]?.id === 'catalog',
  )
}

function isDirectCatalogRequest(
  message: OmnichannelMessage,
  config: EquipmentSalesFlowConfig,
): boolean {
  const raw = message.text?.trim() ?? ''
  const normalized = normalizeText(raw)
  if (!normalized || isSelectionCancellation(message) || isCatalogRequestCancellation(message)) {
    return false
  }
  if (isCanonicalCatalogSelection(message, config)) return true
  if (
    /(?:^|\s)каталог\p{L}*(?=$|\s)/iu.test(normalized)
    && /(?:^|\s)(?:и|или)\s+менеджер\p{L}*(?=$|\s)/iu.test(normalized)
  ) {
    return false
  }

  const catalogMention = /(?:^|\s)каталог\p{L}*(?=$|\s)/iu.test(normalized)
  if (catalogMention) {
    return /^(?:каталог\p{L}*)(?:\s+пожалуйста)?$/iu.test(normalized)
      || /(?:^|\s)(?:хочу|хотел(?:а)?(?:\s+бы)?|нужен|нужна|нужно|можно|где|покажите|показать|посмотреть|посмотрю|ознакомиться|скиньте|пришлите|отправьте|дайте|откройте)(?:\s+(?:мне|пожалуйста|посмотреть|открыть|получить|ознакомиться|с|ваш|вашу|этот|эту|ссылку|на)){0,5}\s+каталог\p{L}*(?=$|\s)/iu.test(normalized)
      || /(?:^|\s)ссылк\p{L}*(?:\s+на)?\s+каталог\p{L}*(?=$|\s)/iu.test(normalized)
      || /(?:^|\s)(?:(?:а\s+)?есть(?:\s+ли)?(?:\s+у\s+вас)?|у\s+вас\s+есть)\s+каталог\p{L}*(?=$|\s)/iu.test(normalized)
      || /(?:^|\s)(?:посмотр\p{L}*|ознаком\p{L}*|откр\p{L}*|получ\p{L}*)\s+каталог\p{L}*(?=$|\s)/iu.test(normalized)
  }

  const siteRequest = /(?:^|\s)(?:сайт|ссылк\p{L}*)(?=$|\s)/iu.test(normalized)
    && (
      /^(?:ваш\s+)?(?:сайт|ссылка)(?:\s+пожалуйста)?$/iu.test(normalized)
      || /(?:^|\s)(?:дайте|скиньте|пришлите|отправьте|покажите|показать|откройте|где|хочу|можно)(?:\s+(?:мне|пожалуйста|ваш|вашу|этот|эту|ссылку|на)){0,5}\s+(?:сайт|ссылк\p{L}*)(?=$|\s)/iu.test(normalized)
      || /(?:^|\s)(?:(?:а\s+)?есть(?:\s+ли)?(?:\s+у\s+вас)?|у\s+вас\s+есть)\s+(?:сайт|ссылка)(?=$|\s)/iu.test(normalized)
    )
  if (siteRequest) return true

  const products = /(?:^|\s)(?:товар\p{L}*|ассортимент\p{L}*)(?=$|\s)/iu.test(normalized)
  return products && (
    /^(?:товар\p{L}*|ассортимент\p{L}*)(?:\s+пожалуйста)?$/iu.test(normalized)
    || /(?:^|\s)(?:покажите|показать|посмотреть|ознакомиться|откройте|где|какие|хочу)(?:\s+(?:мне|пожалуйста|посмотреть|открыть|ознакомиться|с|ваши|ваш|эти|этот)){0,5}\s+(?:товар\p{L}*|ассортимент\p{L}*)(?=$|\s)/iu.test(normalized)
  )
}

function hasDirectCatalogRequest(
  inbound: OmnichannelMessage[],
  config: EquipmentSalesFlowConfig,
): boolean {
  const reversed = [...inbound].reverse()
  for (let index = 0; index < reversed.length; index += 1) {
    const message = reversed[index]
    if (isSelectionCancellation(message) || isCatalogRequestCancellation(message)) return false
    if (isDirectCatalogRequest(message, config)) return true
    // Preserve a substantive catalog request when the customer immediately
    // follows it with short courtesies during the configured quiet window.
    if (isCourtesyOnly(message)) continue
    return false
  }
  return false
}

function isNegatedCityMention(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 30), start).trimEnd()
  const after = text.slice(end, Math.min(text.length, end + 30))
  return /(?:^|\s)не(?:\s+(?:из|в|городе|город|это|живу|нахожусь|проживаю)){0,4}\s*$/iu.test(before)
    || /^\s*не\s+(?:подход\p{L}*|нуж\p{L}*|мой|наш)/iu.test(after)
}

function routeMatchesText(text: string, aliases: readonly string[]): boolean {
  const normalized = normalizeText(text)
  return aliases.some((alias) => {
    const normalizedAlias = normalizeText(alias)
    if (!normalizedAlias) return false
    let offset = 0
    while (offset <= normalized.length - normalizedAlias.length) {
      const index = normalized.indexOf(normalizedAlias, offset)
      if (index < 0) return false
      const beforeBoundary = index === 0 || normalized[index - 1] === ' '
      const end = index + normalizedAlias.length
      const afterBoundary = end === normalized.length || normalized[end] === ' '
      if (beforeBoundary && afterBoundary && !isNegatedCityMention(normalized, index, end)) {
        return true
      }
      offset = index + normalizedAlias.length
    }
    return false
  })
}

function isRecognizedCityReply(
  text: string,
  config: EquipmentSalesFlowConfig,
  allowUnknown: boolean,
): boolean {
  const normalized = normalizeText(text)
    .replace(/^(?:(?:я\s+)?(?:из|в|город|г)|(?:я\s+)?(?:живу|нахожусь|проживаю)\s+в)\s+/iu, '')
  if (!normalized) return false
  const configured = config.city_routes.some((route) =>
    route.aliases.some((alias) => normalizeText(alias) === normalized),
  ) || KNOWN_OTHER_CITIES.some((city) => normalizeText(city) === normalized)
  if (configured) return true
  return allowUnknown && Boolean(
    standaloneCityCandidate(text) || explicitCityLabelFromText(text),
  )
}

function legacyCombinedChoiceNumber(
  text: string,
  config: EquipmentSalesFlowConfig,
  allowUnknownCity: boolean,
): string | null {
  const parts = legacyCombinedReplyParts(text)
  if (!parts || !isRecognizedCityReply(parts.cityText, config, allowUnknownCity)) return null
  return parts.choiceNumber
}

function legacyCombinedReplyParts(
  text: string,
): { cityText: string; choiceNumber: string } | null {
  const match = text.match(/^(.+)\s*[,;:—-]\s*(?:вариант\s*)?([1-5])\s*[.!?]?$/iu)
  return match ? { cityText: match[1].trim(), choiceNumber: match[2] } : null
}

function cleanCustomerCityLabel(value: string): string | null {
  const label = value
    .replace(/^[\s,.:;\-]+|[\s,.:;!?\-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return label && /\p{L}/u.test(label) ? label : null
}

function cleanExplicitCityLabel(value: string): string | null {
  const words = value.trim().split(/\s+/u)
  const stopIndex = words.findIndex((word) => EXPLICIT_CITY_STOP_WORDS.has(normalizeText(word)))
  return cleanCustomerCityLabel((stopIndex < 0 ? words : words.slice(0, stopIndex)).join(' '))
}

function displayCityAlias(value: string): string {
  return value.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase('ru-RU'))
}

function standaloneCityCandidate(text: string): string | null {
  const cleaned = cleanCustomerCityLabel(text)
  if (!cleaned || cleaned.length > 50 || /[?!]/u.test(text)) return null
  const normalized = normalizeText(cleaned)
  if (!normalized || NON_CITY_REPLIES.has(normalized) || isGreetingText(normalized)) return null
  const words = normalized.split(' ')
  if (words.length !== 1 || !/^[\p{L}-]+$/u.test(cleaned)) return null
  if (/(?:^|\s)(?:хочу|нуж\p{L}*|интерес\p{L}*|подбира\p{L}*|экипиров\p{L}*|одежд\p{L}*|вопрос\p{L}*)(?=$|\s)/iu.test(normalized)) {
    return null
  }
  return cleaned
}

function explicitCityLabelFromText(raw: string): string | null {
  const normalized = normalizeText(raw)
  const explicitPatterns = [
    /(?:^|\s)(?:я\s+)?(?:живу|нахожусь|проживаю)\s+в[\s:,-]+([\p{L}-]+(?:\s+[\p{L}-]+){0,2})/iu,
    /(?:^|\s)(?:я\s+)?из[\s:,-]+([\p{L}-]+(?:\s+[\p{L}-]+){0,2})/iu,
    /^я\s+в[\s:,-]+([\p{L}-]+(?:\s+[\p{L}-]+){0,2})/iu,
    /(?:^|\s)(?:я\s+)?(?:город(?:а|е)?[\s:,-]+|г(?:\.[\s:,-]*|[\s:,-]+))([\p{L}-]+(?:\s+[\p{L}-]+){0,2})/iu,
  ]
  const explicit = explicitPatterns
    .map((pattern) => raw.match(pattern)?.[1] ?? null)
    .find((value): value is string => Boolean(value)) ?? null
  const label = explicit ? cleanExplicitCityLabel(explicit) : null
  const normalizedLabel = label ? normalizeText(label) : ''
  const index = normalizedLabel ? normalized.lastIndexOf(normalizedLabel) : -1
  return label
    && index >= 0
    && !isNegatedCityMention(normalized, index, index + normalizedLabel.length)
      ? label
      : null
}

function cityFromMessage(
  message: OmnichannelMessage,
  config: EquipmentSalesFlowConfig,
  allowStandaloneOther: boolean,
  allowUnknownLegacyCity: boolean,
  allowContextualMention: boolean,
): CityMatch | null {
  const raw = message.text?.trim() ?? ''
  if (!raw) return null
  const normalized = normalizeText(raw)
  const fallback = config.city_routes.find((route) => route.id === config.fallback_route_id)
  if (!fallback) return null

  const matchedRoutes = config.city_routes.filter((route) =>
    route.aliases.length > 0 && routeMatchesText(raw, route.aliases),
  )
  const knownOther = KNOWN_OTHER_CITIES.filter((city) => routeMatchesText(raw, [city]))
  const directCityReply = isRecognizedCityReply(raw, config, false)
    || Boolean(explicitCityLabelFromText(raw))
  if (
    !allowContextualMention
    && !directCityReply
    && (matchedRoutes.length > 0 || knownOther.length > 0)
  ) {
    return null
  }
  const routeIds = new Set(matchedRoutes.map((route) => route.id))
  if (knownOther.length > 0) routeIds.add(fallback.id)
  if (routeIds.size > 1) return null

  const matched = matchedRoutes[0]
  if (matched) {
    return {
      routeId: matched.id,
      routeLabel: matched.label,
      customerLabel: matched.id === fallback.id
        ? standaloneCityCandidate(raw) ?? matched.label
        : matched.label,
      managerPhone: matched.manager_phone,
    }
  }
  if (knownOther.length > 0) {
    return {
      routeId: fallback.id,
      routeLabel: fallback.label,
      customerLabel: displayCityAlias(knownOther[0]),
      managerPhone: fallback.manager_phone,
    }
  }

  const combined = legacyCombinedReplyParts(raw)
  if (allowUnknownLegacyCity) {
    const combinedLabel = combined
      ? standaloneCityCandidate(combined.cityText)
        ?? explicitCityLabelFromText(combined.cityText)
      : null
    if (combinedLabel) {
      return {
        routeId: fallback.id,
        routeLabel: fallback.label,
        customerLabel: combinedLabel,
        managerPhone: fallback.manager_phone,
      }
    }
  }

  // Unknown legacy replies ("city, number") are accepted only while the
  // active flow has not persisted either half of the answer. Otherwise a
  // product and quantity such as "Куртка, 2" would replace the city.
  const explicitLabel = combined && !allowUnknownLegacyCity
    ? null
    : explicitCityLabelFromText(raw)
  if (explicitLabel) {
    return {
      routeId: fallback.id,
      routeLabel: fallback.label,
      customerLabel: explicitLabel,
      managerPhone: fallback.manager_phone,
    }
  }

  // A canonical button/list reply is an interest signal, never a free-form
  // city. Direct city aliases above still win for messages that contain both.
  if (choiceFromMessage(message, config)) return null

  if (allowStandaloneOther) {
    const standalone = standaloneCityCandidate(raw)
    if (standalone && normalizeText(standalone) === normalized) {
      return {
        routeId: fallback.id,
        routeLabel: fallback.label,
        customerLabel: standalone,
        managerPhone: fallback.manager_phone,
      }
    }
  }
  return null
}

function latestCity(
  inbound: OmnichannelMessage[],
  config: EquipmentSalesFlowConfig,
  allowStandaloneOther: boolean,
  allowUnknownLegacyCity: boolean,
  allowContextualMention: boolean,
): CityMatch | null {
  for (const message of [...inbound].reverse()) {
    const city = cityFromMessage(
      message,
      config,
      allowStandaloneOther,
      allowUnknownLegacyCity,
      allowContextualMention,
    )
    if (city) return city
  }
  return null
}

function includesFlowMetadata(message: OmnichannelMessage, stage?: string): boolean {
  if (metadataString(message, 'source') !== 'omnichannel_equipment_sales_flow') return false
  return stage ? metadataString(message, 'equipmentFlowStage') === stage : true
}

function withCommunity(
  answer: string,
  config: EquipmentSalesFlowConfig,
  alreadySent: boolean,
): string {
  if (alreadySent) return answer
  return `${answer}\n\n${config.community.text}\n${config.community.url}`
}

function withClubDestinations(
  answer: string,
  config: EquipmentSalesFlowConfig,
  communityAlreadySent: boolean,
  catalogAlreadySent: boolean,
): {
  answer: string
  communityIncluded: boolean
  catalogShared: boolean
} {
  const sections = [answer]
  const communityIncluded = !communityAlreadySent
  const catalogShared = Boolean(config.catalog && !catalogAlreadySent)
  if (communityIncluded && !answer.includes(config.community.url)) {
    sections.push(`${config.community.text}\n${config.community.url}`)
  }
  if (config.catalog && catalogShared && !answer.includes(config.catalog.url)) {
    sections.push(`${config.catalog.text}\n${config.catalog.url}`)
  }
  return {
    answer: sections.join('\n\n'),
    communityIncluded,
    catalogShared,
  }
}

function choicesText(config: EquipmentSalesFlowConfig): string {
  const rows = config.choices.map((choice, index) => `${index + 1}. ${choice.label}`).join('\n')
  return `${config.messages.options_prompt}\n${rows}`
}

function choiceOptions(config: EquipmentSalesFlowConfig): EquipmentFlowOption[] {
  return config.choices.map((choice) => ({
    id: canonicalChoicePayload(choice.id),
    title: choice.button_label,
    ...(choice.button_label === choice.label ? {} : { description: choice.label }),
  }))
}

function buildMetadata(input: {
  stage: EquipmentSalesFlowPlan['stage']
  choiceId?: EquipmentFlowChoiceId | null
  city?: CityMatch | null
  communityIncluded: boolean
  catalogShared?: boolean
}): JsonObject {
  return {
    source: 'omnichannel_equipment_sales_flow',
    equipmentFlowVersion: 1,
    equipmentFlowStage: input.stage,
    equipmentFlowChoiceId: input.choiceId ?? null,
    equipmentFlowCityRouteId: input.city?.routeId ?? null,
    equipmentFlowCityLabel: input.city?.customerLabel ?? null,
    equipmentFlowCommunityIncluded: input.communityIncluded,
    ...(input.catalogShared ? { equipmentFlowCatalogShared: true } : {}),
  }
}

export function parseEquipmentSalesFlowConfig(
  automationConfig: JsonObject | null | undefined,
): EquipmentSalesFlowConfig | null {
  const parsedRoot = omnichannelAutomationConfigSchema.safeParse(automationConfig ?? {})
  if (!parsedRoot.success) return null
  const flow = parsedRoot.data.equipment_sales_flow
  return flow?.enabled ? flow : null
}

interface RestoredFlowState {
  active: boolean
  completed: boolean
  choiceId: EquipmentFlowChoiceId | null
  city: CityMatch | null
  communitySent: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function validChoiceId(value: unknown): EquipmentFlowChoiceId | null {
  return typeof value === 'string'
    && EQUIPMENT_FLOW_CHOICE_IDS.includes(value as EquipmentFlowChoiceId)
      ? value as EquipmentFlowChoiceId
      : null
}

function cityFromStoredState(
  state: Record<string, unknown>,
  config: EquipmentSalesFlowConfig,
): CityMatch | null {
  const routeId = typeof state.cityRouteId === 'string' ? state.cityRouteId : null
  const route = config.city_routes.find((item) => item.id === routeId)
  if (!route) return null
  const storedLabel = typeof state.cityLabel === 'string'
    ? cleanCustomerCityLabel(state.cityLabel)
    : null
  return {
    routeId: route.id,
    routeLabel: route.label,
    customerLabel: storedLabel ?? route.label,
    managerPhone: route.manager_phone,
  }
}

function stateFromConversation(
  metadata: JsonObject | null | undefined,
  config: EquipmentSalesFlowConfig,
  referenceMs: number,
): RestoredFlowState {
  const state = asRecord(metadata?.equipmentSalesFlow)
  if (!state || state.version !== 1) {
    return { active: false, completed: false, choiceId: null, city: null, communitySent: false }
  }
  const stage = typeof state.stage === 'string' ? state.stage : null
  const updatedAt = parseTime(state.updatedAt)
  const ageMs = updatedAt === null ? null : referenceMs - updatedAt
  const active = stage !== 'routed'
    && ageMs !== null
    && ageMs >= -5 * 60 * 1_000
    && ageMs <= 24 * 60 * 60 * 1_000
  return {
    active,
    completed: stage === 'routed',
    choiceId: active ? validChoiceId(state.choiceId) : null,
    city: active ? cityFromStoredState(state, config) : null,
    communitySent: parseTime(state.communitySentAt) !== null,
  }
}

function flowStateFromLatestOutbound(
  history: OmnichannelMessage[],
  config: EquipmentSalesFlowConfig,
  referenceMs: number,
): RestoredFlowState {
  const outbound = [...history].reverse().find(isConfirmedOutboundMessage)
  if (!outbound || !includesFlowMetadata(outbound)) {
    return { active: false, completed: false, choiceId: null, city: null, communitySent: false }
  }
  const occurredAt = parseTime(outbound.occurredAt)
  const ageMs = occurredAt === null ? null : referenceMs - occurredAt
  const stage = metadataString(outbound, 'equipmentFlowStage')
  const active = stage !== 'routed'
    && ageMs !== null
    && ageMs >= -5 * 60 * 1_000
    && ageMs <= 24 * 60 * 60 * 1_000
  const routeId = metadataString(outbound, 'equipmentFlowCityRouteId')
  const route = config.city_routes.find((item) => item.id === routeId)
  const cityLabel = metadataString(outbound, 'equipmentFlowCityLabel')
  return {
    active,
    completed: stage === 'routed',
    choiceId: active ? validChoiceId(metadataString(outbound, 'equipmentFlowChoiceId')) : null,
    city: active && route ? {
      routeId: route.id,
      routeLabel: route.label,
      customerLabel: cityLabel ? cleanCustomerCityLabel(cityLabel) ?? route.label : route.label,
      managerPhone: route.manager_phone,
    } : null,
    communitySent: outbound.metadata.equipmentFlowCommunityIncluded === true,
  }
}

function recentInboundBurst(
  history: OmnichannelMessage[],
  currentMessage: OmnichannelMessage,
): OmnichannelMessage[] {
  const currentMs = parseTime(currentMessage.occurredAt) ?? Date.now()
  let lastOutboundIndex = -1
  history.forEach((message, index) => {
    if (isConfirmedOutboundMessage(message)) lastOutboundIndex = index
  })
  const tail = history.slice(lastOutboundIndex + 1)
  const withCurrent = tail.some((message) => message.id === currentMessage.id)
    ? tail
    : [...tail, currentMessage]
  return withCurrent.filter((message) => {
    if (message.direction !== 'in') return false
    const occurredAt = parseTime(message.occurredAt)
    if (occurredAt === null) return message.id === currentMessage.id
    const ageMs = currentMs - occurredAt
    return ageMs >= -5 * 60 * 1_000 && ageMs <= 10 * 60 * 1_000
  })
}

function isClubOpeningMessage(message: OmnichannelMessage): boolean {
  const normalized = normalizeText(message.text ?? '')
  if (!normalized) return false
  const withoutGreeting = normalized.replace(
    /^(?:привет(?:ик|ствую)?|здравствуй(?:те)?|добрый\s+(?:день|вечер)|доброе\s+утро|салам|с[әа]лем|hello|hi|hey)\s+/iu,
    '',
  )
  // The active WhatsApp campaign uses “Хочу в Клуб” as its lead CTA. Treat
  // that provider text as the same deterministic opening as a greeting so it
  // can never fall through to an unrelated generic business context.
  return /^(?:(?:я\s+)?хочу\s+(?:вступить\s+в\s+|присоединиться\s+к\s+|в\s+)?|(?:я\s+)?(?:хотел|хотела)\s+бы\s+(?:вступить\s+в\s+|присоединиться\s+к\s+|в\s+)?|)(?:honor\s+)?клуб$/iu.test(withoutGreeting)
    // The current click-to-WhatsApp campaign also arrives from the provider
    // as this exact truncated lead text. Keep the match exact so ordinary
    // words beginning with “хо” cannot start the sales flow accidentally.
    || withoutGreeting === 'хо'
    || /^(?:i\s+(?:want|would\s+like)\s+to\s+join\s+(?:the\s+)?|)(?:honor\s+)?club$/iu.test(withoutGreeting)
}

function isLeadOpeningMessage(message: OmnichannelMessage): boolean {
  const normalized = normalizeText(message.text ?? '')
  return Boolean(normalized && (isGreetingText(normalized) || isClubOpeningMessage(message)))
}

function confirmedManagerHandoff(
  history: OmnichannelMessage[],
  config: EquipmentSalesFlowConfig,
): boolean {
  const managerPhones = config.city_routes.map((route) => route.manager_phone)
  return history.filter(isConfirmedOutboundMessage).some((message) =>
    includesFlowMetadata(message, 'routed')
    || managerPhones.some((phone) => message.text?.includes(`wa.me/${phone}`)),
  )
}

/** Used by the final send gate so a previously delivered manager link hands off to a person. */
export function hasConfirmedEquipmentManagerHandoff(input: {
  history: OmnichannelMessage[]
  automationConfig: JsonObject | null | undefined
}): boolean {
  const config = parseEquipmentSalesFlowConfig(input.automationConfig)
  return config ? confirmedManagerHandoff(input.history, config) : false
}

export function planEquipmentSalesFlow(input: {
  currentMessage: OmnichannelMessage
  history: OmnichannelMessage[]
  automationConfig: JsonObject | null | undefined
  conversationMetadata?: JsonObject | null
  forceDraft?: boolean
}): EquipmentSalesFlowPlan | null {
  const config = parseEquipmentSalesFlowConfig(input.automationConfig)
  // forceDraft controls the send policy, not which business playbook drafts
  // the answer. Backlog must use the same equipment facts and manager routes
  // as live traffic while remaining impossible to auto-send.
  if (!config || !input.currentMessage.text?.trim()) return null

  const history = input.history.some((message) => message.id === input.currentMessage.id)
    ? input.history
    : [...input.history, input.currentMessage]
  const outbound = history.filter(isConfirmedOutboundMessage)
  // Once a real provider send handed the lead to a manager, automation must not
  // emit the same handoff/link again. Drafted or failed rows do not count.
  if (confirmedManagerHandoff(history, config)) return null

  const referenceMs = parseTime(input.currentMessage.occurredAt) ?? Date.now()
  const stored = stateFromConversation(input.conversationMetadata, config, referenceMs)
  const historyState = flowStateFromLatestOutbound(history, config, referenceMs)
  if (stored.completed || historyState.completed) return null

  const active = stored.active ? stored : historyState
  const inbound = recentInboundBurst(history, input.currentMessage)
  // A latest explicit cancellation exits the active menu instead of being
  // misclassified as an unknown city or reviving an earlier choice in burst.
  if (isSelectionCancellation(input.currentMessage)) return null
  const directCatalogRequested = Boolean(
    config.catalog && hasDirectCatalogRequest(inbound, config),
  )
  const allowUnknownLegacyCity = active.active && !active.city && !active.choiceId
  const detectedChoiceId = latestChoice(inbound, config, allowUnknownLegacyCity)
  const newChoiceId = config.catalog
    && detectedChoiceId === 'catalog'
    && !directCatalogRequested
      ? null
      : detectedChoiceId
  const newCity = latestCity(
    inbound,
    config,
    Boolean(newChoiceId || (active.choiceId && !active.city) || active.active),
    allowUnknownLegacyCity,
    Boolean(newChoiceId),
  )
  if (
    config.catalog
    && (
      directCatalogRequested
      || (active.choiceId === 'catalog' && Boolean(newCity))
    )
  ) {
    const catalogCity = newCity ?? active.city
    const stage = catalogCity ? 'awaiting_interest' as const : 'welcome' as const
    return {
      stage,
      answer: `${config.catalog.text}\n${config.catalog.url}`,
      reason: 'deterministic_equipment_flow_catalog_direct',
      summary: catalogCity
        ? `Клиенту из города ${catalogCity.customerLabel} отправлена прямая ссылка на каталог.`.slice(0, 500)
        : 'Клиент запросил каталог; отправлена прямая ссылка на сайт.',
      leadScore: 55,
      presentation: { kind: 'text' },
      cityRouteId: catalogCity?.routeId ?? null,
      cityLabel: catalogCity?.customerLabel ?? null,
      choiceId: null,
      choiceLabel: null,
      managerUrl: null,
      handoffAfterSend: false,
      communityIncluded: false,
      outboundMetadata: buildMetadata({
        stage,
        city: catalogCity,
        communityIncluded: false,
        catalogShared: true,
      }),
    }
  }
  const hasNewSignal = Boolean(newChoiceId || newCity)
  if (!active.active && !hasNewSignal && !isLeadOpeningMessage(input.currentMessage)) return null
  const normalizedWelcome = normalizeText(config.messages.welcome)
  const normalizedWelcomeOpening = normalizeText(config.messages.welcome.split(/\n+/u)[0] ?? '')
  const hasConfirmedWelcome = outbound.some((message) =>
    includesFlowMetadata(message)
    || (
      normalizedWelcome.length > 0
      && normalizeText(message.text ?? '').includes(normalizedWelcome)
    )
    || (
      normalizedWelcomeOpening.length >= 12
      && normalizeText(message.text ?? '').includes(normalizedWelcomeOpening)
    ),
  )
  const hasCommunity = stored.communitySent || historyState.communitySent || outbound.some((message) =>
    message.text?.includes(config.community.url)
    || message.metadata.equipmentFlowCommunityIncluded === true,
  )
  const hasCatalog = Boolean(config.catalog && outbound.some((message) =>
    message.text?.includes(config.catalog!.url)
    || message.metadata.equipmentFlowCatalogShared === true,
  ))
  const clubRequested = isClubOpeningMessage(input.currentMessage)
  if (
    !hasNewSignal
    && !active.choiceId
    && !active.city
    && hasConfirmedWelcome
    && isLeadOpeningMessage(input.currentMessage)
  ) {
    const clubDestinations = clubRequested
      ? withClubDestinations(config.messages.ask_city, config, hasCommunity, hasCatalog)
      : null
    const answer = clubDestinations?.answer ?? config.messages.ask_city
    return {
      stage: 'welcome',
      answer,
      reason: 'deterministic_equipment_flow_resume_without_repeating_welcome',
      summary: 'Повторный запрос по экипировке; ожидается город.',
      leadScore: 45,
      presentation: { kind: 'text' },
      cityRouteId: null,
      cityLabel: null,
      choiceId: null,
      choiceLabel: null,
      managerUrl: null,
      handoffAfterSend: false,
      communityIncluded: clubDestinations?.communityIncluded ?? false,
      outboundMetadata: buildMetadata({
        stage: 'welcome',
        communityIncluded: clubDestinations?.communityIncluded ?? false,
        catalogShared: clubDestinations?.catalogShared ?? false,
      }),
    }
  }
  if (active.active && !hasNewSignal) return null

  const choiceId = newChoiceId ?? active.choiceId
  const city = newCity ?? active.city
  const choice = choiceId ? config.choices.find((item) => item.id === choiceId) ?? null : null

  if (city && choice) {
    const managerUrl = `https://wa.me/${city.managerPhone}`
    const handoff = config.messages.handoff_by_choice?.[choice.id]
      ?? config.messages.handoff
    const base = `${handoff}\n\nНаписать менеджеру: ${managerUrl}`
    const answer = withCommunity(base, config, hasCommunity)
    return {
      stage: 'routed',
      answer,
      reason: 'deterministic_equipment_flow_routed',
      summary: `Лид по экипировке: ${choice.label}; город ${city.customerLabel}; маршрут менеджера подготовлен.`.slice(0, 500),
      leadScore: 95,
      presentation: { kind: 'text' },
      cityRouteId: city.routeId,
      cityLabel: city.customerLabel,
      choiceId,
      choiceLabel: choice.label,
      managerUrl,
      handoffAfterSend: true,
      communityIncluded: !hasCommunity,
      outboundMetadata: buildMetadata({
        stage: 'routed', choiceId, city, communityIncluded: !hasCommunity,
      }),
    }
  }

  if (choice && !city) {
    const answer = config.messages.ask_city
    return {
      stage: 'awaiting_city',
      answer,
      reason: 'deterministic_equipment_flow_awaiting_city',
      summary: `Клиент выбрал «${choice.label}»; ожидается город.`.slice(0, 500),
      leadScore: 70,
      presentation: { kind: 'text' },
      cityRouteId: null,
      cityLabel: null,
      choiceId,
      choiceLabel: choice.label,
      managerUrl: null,
      handoffAfterSend: false,
      communityIncluded: false,
      outboundMetadata: buildMetadata({
        stage: 'awaiting_city', choiceId, communityIncluded: false,
      }),
    }
  }

  const base = city && !choice
    ? `${config.messages.ask_interest}\n\n${choicesText(config)}`
    : config.messages.welcome
  const clubDestinations = !city && clubRequested
    ? withClubDestinations(base, config, hasCommunity, hasCatalog)
    : null
  const answer = clubDestinations?.answer ?? base
  const stage = city ? 'awaiting_interest' as const : 'welcome' as const
  return {
    stage,
    answer,
    reason: city
      ? 'deterministic_equipment_flow_awaiting_interest'
      : clubRequested
        ? 'deterministic_equipment_flow_club_invite'
        : 'deterministic_equipment_flow_welcome',
    summary: city
      ? `Клиент из города ${city.customerLabel}; ожидается выбор экипировки.`.slice(0, 500)
      : clubRequested
        ? 'Клиенту отправлены ссылки на WhatsApp-сообщество и каталог; ожидается город.'
        : 'Новый запрос по экипировке; ожидается город.',
    leadScore: city ? 60 : 40,
    presentation: city
      ? { kind: 'choices', options: choiceOptions(config) }
      : { kind: 'text' },
    cityRouteId: city?.routeId ?? null,
    cityLabel: city?.customerLabel ?? null,
    choiceId: null,
    choiceLabel: null,
    managerUrl: null,
    handoffAfterSend: false,
    communityIncluded: clubDestinations?.communityIncluded ?? false,
    outboundMetadata: buildMetadata({
      stage,
      city,
      communityIncluded: clubDestinations?.communityIncluded ?? false,
      catalogShared: clubDestinations?.catalogShared ?? false,
    }),
  }
}
