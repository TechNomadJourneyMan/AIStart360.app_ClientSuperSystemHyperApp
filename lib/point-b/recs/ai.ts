/**
 * lib/point-b/recs/ai.ts — recommendations drafted by the AI, grounded in the numbers of the model
 * (spec §12; plan Ф6a, Task 4). The AI never decides a number and never decides a status:
 *
 *   - it gets only the context of buildRecsContext (numbers of the model + rule findings; user text fenced);
 *   - the answer is a Zod schema WITHOUT numeric fields (enums only); unknown keys are dropped;
 *   - EVERY number written in an item's texts must be one of `context.allowedNumbers` — an item with a
 *     number from elsewhere is DROPPED (warning «…отброшена: число не из данных»), never «fixed»;
 *   - at most 5 items (the rest is cut, with a warning), lengths cut, profanity masked, refs only from the
 *     closed list of the context, a repeated title dropped;
 *   - the result are DRAFTS: the caller stores them as pending_review (store.ts) — an expert verifies.
 *
 * Cost discipline: at most one call per company in 10 minutes (`lastAiRunAt`, the caller also holds a shared
 * rate key), the daily AI budget of the actor (`point_b_recs`), the gateway's timeout and retries. A missing
 * key, a refused budget, a gateway error or a broken answer → { items: [], warnings: [code] }, never a throw,
 * and no second call (a dropped item does not cost a retry).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { assertAiBudget, isAiBudgetError } from '@/lib/ai/budget'
import { callLlmJson, hasLlmKey, UNTRUSTED_DATA_RULES, type LlmUsage } from '@/lib/ai/gateway'
import { recordAiUsage } from '@/lib/ai/usage'
import { maskProfanity } from '@/lib/moderation/profanity'
import { foreignNumbers } from '../insights/numbers'
import type { RecsContext } from './context'
import type { RecDraft, RecKind, RecSourceRef } from './types'

export const RECS_AI_MAX_ITEMS = 5
export const RECS_AI_INTERVAL_MS = 10 * 60_000
const KINDS = ['lever', 'risk', 'action', 'contradiction', 'constraint'] as const

/** Field limits of an item (characters). */
export const RECS_AI_LIMITS = Object.freeze({
  title: 120, essence: 600, reason: 600, expectedEffect: 400, resources: 300, confidenceReason: 300, risks: 400, nextAction: 300,
})
type TextField = keyof typeof RECS_AI_LIMITS
const TEXT_FIELDS = Object.keys(RECS_AI_LIMITS) as TextField[]
const OPTIONAL_FIELDS: TextField[] = ['expectedEffect', 'resources', 'confidenceReason', 'risks', 'nextAction']

/** Run-level warning codes (item-level warnings are Russian sentences). */
export type RecsAiWarningCode = 'too_soon' | 'no_api_key' | 'budget_exceeded' | 'timeout' | 'rate_limited' | 'provider_error' | 'invalid_output'

export const RECS_AI_WARNING_TEXT: Record<RecsAiWarningCode, string> = {
  too_soon: 'ИИ уже запускался для этого клиента меньше 10 минут назад — подождите.',
  no_api_key: 'ИИ не подключён: нет ключа модели. Рекомендации правил сохранены.',
  budget_exceeded: 'Дневной лимит ИИ исчерпан — попробуйте завтра.',
  timeout: 'Модель не ответила вовремя — попробуйте позже.',
  rate_limited: 'Модель перегружена — попробуйте позже.',
  provider_error: 'Ошибка модели — попробуйте позже.',
  invalid_output: 'Модель вернула ответ не по формату — ничего не сохранено.',
}

/** The answer of the model. No numeric fields: a number can only be text, and the text is checked. */
const ItemSchema = z.object({
  kind: z.enum(KINDS),
  title: z.string().min(1),
  essence: z.string(),
  reason: z.string(),
  expectedEffect: z.string().nullable().optional(),
  resources: z.string().nullable().optional(),
  confidence: z.enum(['low', 'medium', 'high']),
  confidenceReason: z.string().nullable().optional(),
  risks: z.string().nullable().optional(),
  nextAction: z.string().nullable().optional(),
  refs: z.array(z.string()).optional(),
})
export const RecsAnswerSchema = z.object({ items: z.array(z.unknown()).max(50) })
type Item = z.infer<typeof ItemSchema>

export const RECS_SYSTEM = [
  'Ты — стратег платформы AIStart360. Формулируешь рекомендации по плану роста компании для эксперта, который их проверит.',
  'ЖЁСТКИЕ ПРАВИЛА:',
  '1. Числа бери ТОЛЬКО из блока «Данные» — в том виде, как они там написаны. Не придумывай чисел, не пересчитывай, не округляй по-своему, не нумеруй пункты цифрами, не называй годы и даты.',
  '2. Если нужного числа в данных нет — пиши словами без числа.',
  '3. Ограничивающий фактор и противоречия уже найдены правилами — объясняй их, не ищи новые.',
  `4. Не больше ${RECS_AI_MAX_ITEMS} рекомендаций. Каждое поле — одно-два коротких предложения на русском.`,
  '5. В поле refs укажи id источников из списка «Допустимые id источников» — только из него.',
  UNTRUSTED_DATA_RULES,
  'Ответь одним JSON-объектом без markdown:',
  '{"items":[{"kind":"lever"|"risk"|"action"|"contradiction"|"constraint","title":string,"essence":string,"reason":string,"expectedEffect":string|null,"resources":string|null,"confidence":"low"|"medium"|"high","confidenceReason":string|null,"risks":string|null,"nextAction":string|null,"refs":[string]}]}',
].join('\n')

const RECS_TASK = 'Задача: предложи до пяти рекомендаций — что сделать, чтобы дойти до цели: суть, причина, ожидаемый результат, ресурсы, уверенность с обоснованием, риски, следующее действие, ссылки на источники.'

export interface GenerateInput {
  sb: SupabaseClient
  companyId: string
  /** The actor whose AI budget is spent (the expert who pressed the button). */
  userId: string
  context: RecsContext
  /** The previous AI run for this company (ISO); null = none known. */
  lastAiRunAt: string | null
  now: Date
}

export interface GenerateResult {
  items: RecDraft[]
  /** Run-level codes (RecsAiWarningCode) and item-level sentences. */
  warnings: string[]
  usage: LlmUsage | null
}

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** Masks profanity and cuts a text field; null for an empty optional one. */
function cleanText(v: string | null | undefined, n: number): { full: string | null; text: string | null; masked: boolean; cut: boolean } {
  const t = typeof v === 'string' ? v.trim() : ''
  if (!t) return { full: null, text: null, masked: false, cut: false }
  const masked = maskProfanity(t)
  return { full: masked, text: cut(masked, n), masked: masked !== t, cut: masked.length > n }
}

/** The numbers of an item that are not in the context; [] = the item is grounded. */
export function guardNumbers(item: Partial<Record<TextField, string | null>>, allowed: ReadonlySet<string>): string[] {
  return TEXT_FIELDS.flatMap((f) => foreignNumbers(item[f] ?? null, allowed))
}

function failure(code: RecsAiWarningCode, usage: LlmUsage | null = null): GenerateResult {
  return { items: [], warnings: [code], usage }
}

const LLM_CODE: Record<string, RecsAiWarningCode> = {
  NO_API_KEY: 'no_api_key', TIMEOUT: 'timeout', RATE_LIMITED: 'rate_limited', PROVIDER_ERROR: 'provider_error',
  INVALID_OUTPUT: 'invalid_output', BUDGET_EXCEEDED: 'budget_exceeded',
}

export async function generateRecommendations(input: GenerateInput): Promise<GenerateResult> {
  const { context, now } = input
  const last = input.lastAiRunAt ? Date.parse(input.lastAiRunAt) : NaN
  if (Number.isFinite(last) && now.getTime() - last < RECS_AI_INTERVAL_MS) return failure('too_soon')
  if (!hasLlmKey()) return failure('no_api_key')
  try {
    await assertAiBudget(input.userId, 'point_b_recs')
  } catch (err) {
    if (isAiBudgetError(err)) return failure('budget_exceeded')
    // any other failure of the meter is fail-open, like the budget itself
  }

  const started = now.getTime()
  let res: Awaited<ReturnType<typeof callLlmJson<z.infer<typeof RecsAnswerSchema>>>>
  try {
    res = await callLlmJson({
      tier: 'standard', system: RECS_SYSTEM, user: `${context.text}\n\n${RECS_TASK}`, maxTokens: 2500, temperature: 0.2,
      timeoutMs: 45_000, label: 'point-b:recs', schema: RecsAnswerSchema,
    })
  } catch (err) {
    console.error('[point-b/recs/ai] gateway threw', err instanceof Error ? err.message : err)
    return failure('provider_error')
  }
  await recordAiUsage({
    feature: 'point_b_recs', model: res.usage?.model ?? 'unknown', promptTokens: res.usage?.tokensIn ?? null,
    completionTokens: res.usage?.tokensOut ?? null, providerCostUsd: res.usage?.costUsd ?? null,
    latencyMs: res.usage?.latencyMs ?? Date.now() - started, ok: res.ok, userId: input.userId,
  })
  if (!res.ok) return failure(LLM_CODE[res.error] ?? 'provider_error', res.usage)

  const warnings: string[] = []
  const raw = res.data.items
  if (raw.length > RECS_AI_MAX_ITEMS) warnings.push(`ИИ вернул ${raw.length} рекомендаций — оставлены первые ${RECS_AI_MAX_ITEMS}.`)
  const items: RecDraft[] = []
  const titles = new Set<string>()
  for (const candidate of raw.slice(0, RECS_AI_MAX_ITEMS)) {
    const parsed = ItemSchema.safeParse(candidate)
    if (!parsed.success) {
      warnings.push('Рекомендация отброшена: ответ модели не по формату.')
      continue
    }
    const draft = toDraft(parsed.data, context, warnings)
    if (!draft) continue
    const key = draft.title.toLowerCase().replace(/\s+/g, ' ')
    if (titles.has(key)) {
      warnings.push(`Рекомендация «${draft.title}» отброшена: повтор.`)
      continue
    }
    titles.add(key)
    items.push(draft)
  }
  return { items, warnings, usage: res.usage }
}

function toDraft(item: Item, context: RecsContext, warnings: string[]): RecDraft | null {
  const text: Partial<Record<TextField, string | null>> = {}
  const full: Partial<Record<TextField, string | null>> = {}
  let masked = false
  let trimmed = false
  for (const f of TEXT_FIELDS) {
    const c = cleanText(item[f] as string | null | undefined, RECS_AI_LIMITS[f])
    text[f] = c.text
    full[f] = c.full
    masked ||= c.masked
    trimmed ||= c.cut
  }
  const title = text.title
  if (!title) {
    warnings.push('Рекомендация отброшена: нет названия.')
    return null
  }
  // The number guard reads the FULL texts: cutting could split a number («1 250 000» → «1 25…»).
  const foreign = guardNumbers(full, context.allowedNumbers)
  if (foreign.length) {
    warnings.push(`Рекомендация «${title}» отброшена: число не из данных (${[...new Set(foreign)].slice(0, 3).join(', ')}).`)
    return null
  }
  if (masked) warnings.push(`В рекомендации «${title}» скрыта нецензурная лексика.`)
  if (trimmed) warnings.push(`Рекомендация «${title}» сокращена до допустимой длины.`)

  const refs: RecSourceRef[] = []
  for (const id of item.refs ?? []) {
    const r = Object.prototype.hasOwnProperty.call(context.refs, id) ? context.refs[id] : undefined
    if (r && !refs.some((x) => x.type === r.type && x.ref === r.ref)) refs.push(r)
  }
  if (!refs.length && context.refs.model) refs.push(context.refs.model)

  const opt = (f: TextField): string | null => (OPTIONAL_FIELDS.includes(f) ? text[f] ?? null : null)
  return {
    kind: item.kind as RecKind,
    title,
    essence: text.essence ?? '',
    reason: text.reason ?? '',
    expectedEffect: opt('expectedEffect'),
    resources: opt('resources'),
    confidence: item.confidence,
    confidenceReason: opt('confidenceReason'),
    risks: opt('risks'),
    nextAction: opt('nextAction'),
    sourceRefs: refs,
    generatedBy: 'ai',
    inputsHash: context.inputsHash,
  }
}
