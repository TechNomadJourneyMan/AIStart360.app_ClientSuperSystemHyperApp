import { z } from 'zod'
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
    const longestChoice = config.choices.reduce(
      (longest, choice) => choice.label.length > longest.length ? choice.label : longest,
      '',
    )
    // A free-form fallback city is intentionally capped at 80 characters and
    // can be longer than every configured route label.
    const longestCity = 'Г'.repeat(80)
    const renderedBodies = [
      `${config.messages.welcome}\n\n${renderedChoices}\n\n${community}`,
      `${config.messages.ask_interest}\n\n${renderedChoices}\n\n${community}`,
      `${config.messages.ask_city}\n\n${community}`,
      `${config.messages.handoff}\n\nВаш запрос: ${longestChoice}\nГород: ${longestCity}\nНапишите менеджеру: https://wa.me/000000000000000\n\n${community}`,
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

function choiceFromFreeText(text: string): EquipmentFlowChoiceId | null {
  const definitions: Array<{ id: EquipmentFlowChoiceId; pattern: RegExp }> = [
    { id: 'summer', pattern: /(?:^|\s)(?:лето|летн\p{L}*)(?=$|\s)/giu },
    { id: 'autumn_winter', pattern: /(?:^|\s)(?:осен\p{L}*|зим\p{L}*)(?=$|\s)/giu },
    { id: 'catalog', pattern: /(?:^|\s)каталог\p{L}*(?=$|\s)/giu },
    { id: 'beginner', pattern: /(?:^|\s)нович\p{L}*(?=$|\s)/giu },
    { id: 'manager', pattern: /(?:^|\s)(?:менеджер\p{L}*|оператор\p{L}*|человек\p{L}*)(?=$|\s)/giu },
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
  return choiceFromFreeText(text)
}

function latestChoice(
  inbound: OmnichannelMessage[],
  config: EquipmentSalesFlowConfig,
): EquipmentFlowChoiceId | null {
  for (const message of [...inbound].reverse()) {
    const choice = choiceFromMessage(message, config)
    if (choice) return choice
  }
  return null
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

function cityFromMessage(
  message: OmnichannelMessage,
  config: EquipmentSalesFlowConfig,
  allowStandaloneOther: boolean,
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

  const explicitPatterns = [
    /(?:^|\s)(?:я\s+)?(?:живу|нахожусь|проживаю)\s+в[\s:,-]+([\p{L}-]+(?:\s+[\p{L}-]+){0,2})/iu,
    /(?:^|\s)(?:я\s+)?из[\s:,-]+([\p{L}-]+(?:\s+[\p{L}-]+){0,2})/iu,
    /^(?:я\s+)?в[\s:,-]+([\p{L}-]+(?:\s+[\p{L}-]+){0,2})/iu,
    /(?:^|\s)(?:я\s+)?(?:город(?:а|е)?|г\.?)[\s:,-]+([\p{L}-]+(?:\s+[\p{L}-]+){0,2})/iu,
  ]
  const explicit = explicitPatterns
    .map((pattern) => raw.match(pattern)?.[1] ?? null)
    .find((value): value is string => Boolean(value)) ?? null
  const explicitLabel = explicit ? cleanExplicitCityLabel(explicit) : null
  const normalizedExplicit = explicitLabel ? normalizeText(explicitLabel) : ''
  const explicitIndex = normalizedExplicit ? normalized.lastIndexOf(normalizedExplicit) : -1
  if (
    explicitLabel
    && explicitIndex >= 0
    && !isNegatedCityMention(normalized, explicitIndex, explicitIndex + normalizedExplicit.length)
  ) {
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
): CityMatch | null {
  for (const message of [...inbound].reverse()) {
    const city = cityFromMessage(message, config, allowStandaloneOther)
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
}): JsonObject {
  return {
    source: 'omnichannel_equipment_sales_flow',
    equipmentFlowVersion: 1,
    equipmentFlowStage: input.stage,
    equipmentFlowChoiceId: input.choiceId ?? null,
    equipmentFlowCityRouteId: input.city?.routeId ?? null,
    equipmentFlowCityLabel: input.city?.customerLabel ?? null,
    equipmentFlowCommunityIncluded: input.communityIncluded,
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
  const outbound = [...history].reverse().find((message) => message.direction === 'out')
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
    if (message.direction === 'out') lastOutboundIndex = index
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

function isLeadOpeningMessage(message: OmnichannelMessage): boolean {
  const normalized = normalizeText(message.text ?? '')
  if (!normalized) return false
  if (isGreetingText(normalized)) return true
  // The active WhatsApp campaign uses “Хочу в Клуб” as its lead CTA. Treat
  // that provider text as the same deterministic opening as a greeting so it
  // can never fall through to an unrelated generic business context.
  return /(?:^|\s)(?:клуб\p{L}*|club|экипиров\p{L}*|одежд\p{L}*|мотокуртк\p{L}*|мотошлем\p{L}*|шлем\p{L}*)(?=$|\s)/iu.test(normalized)
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
  const referenceMs = parseTime(input.currentMessage.occurredAt) ?? Date.now()
  const stored = stateFromConversation(input.conversationMetadata, config, referenceMs)
  const historyState = flowStateFromLatestOutbound(history, config, referenceMs)
  if (stored.completed || historyState.completed) return null

  const active = stored.active ? stored : historyState
  const inbound = recentInboundBurst(history, input.currentMessage)
  const newChoiceId = latestChoice(inbound, config)
  const newCity = latestCity(
    inbound,
    config,
    Boolean(newChoiceId || (active.choiceId && !active.city) || active.active),
  )
  const hasNewSignal = Boolean(newChoiceId || newCity)
  if (!active.active && !hasNewSignal && !isLeadOpeningMessage(input.currentMessage)) return null
  if (active.active && !hasNewSignal) return null

  const choiceId = newChoiceId ?? active.choiceId
  const city = newCity ?? active.city
  const outbound = history.filter((message) => message.direction === 'out')
  const hasCommunity = stored.communitySent || historyState.communitySent || outbound.some((message) =>
    message.text?.includes(config.community.url)
    || message.metadata.equipmentFlowCommunityIncluded === true,
  )
  const choice = choiceId ? config.choices.find((item) => item.id === choiceId) ?? null : null

  if (city && choice) {
    const managerUrl = `https://wa.me/${city.managerPhone}`
    const base = `${config.messages.handoff}\n\nВаш запрос: ${choice.label}\nГород: ${city.customerLabel}\nНапишите менеджеру: ${managerUrl}`
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
    const answer = withCommunity(config.messages.ask_city, config, hasCommunity)
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
      communityIncluded: !hasCommunity,
      outboundMetadata: buildMetadata({
        stage: 'awaiting_city', choiceId, communityIncluded: !hasCommunity,
      }),
    }
  }

  const base = city && !choice
    ? `${config.messages.ask_interest}\n\n${choicesText(config)}`
    : `${config.messages.welcome}\n\n${choicesText(config)}`
  const answer = withCommunity(base, config, hasCommunity)
  const stage = city ? 'awaiting_interest' as const : 'welcome' as const
  return {
    stage,
    answer,
    reason: city
      ? 'deterministic_equipment_flow_awaiting_interest'
      : 'deterministic_equipment_flow_welcome',
    summary: city
      ? `Клиент из города ${city.customerLabel}; ожидается выбор экипировки.`.slice(0, 500)
      : 'Новый запрос по экипировке; ожидаются город и интерес.',
    leadScore: city ? 60 : 40,
    presentation: { kind: 'choices', options: choiceOptions(config) },
    cityRouteId: city?.routeId ?? null,
    cityLabel: city?.customerLabel ?? null,
    choiceId: null,
    choiceLabel: null,
    managerUrl: null,
    handoffAfterSend: false,
    communityIncluded: !hasCommunity,
    outboundMetadata: buildMetadata({ stage, city, communityIncluded: !hasCommunity }),
  }
}
