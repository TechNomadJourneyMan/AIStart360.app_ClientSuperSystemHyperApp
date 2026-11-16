/**
 * lib/point-b/strategy/ai-wording.ts — the AI rewords the DRAFT strategy tree built by the rules (R3, M1). It is a
 * draft for staff only: nothing here reaches the client until Admin / Super Admin approve the version.
 *
 * The AI never decides the tree, a number, a date, a KPI or a level:
 *   - it gets the data part of the recommendations context (numbers of the model + rule findings; user text fenced)
 *     and the nodes (key, level, title, description);
 *   - it answers { items: [{ key, title, description }] } — text only, a closed list of keys;
 *   - a node's new text is taken only when EVERY number in it is in `allowed` (the context's numbers plus the
 *     numbers of the rule texts) — otherwise the rule text stays and a warning says why («число не из данных»);
 *   - lengths are cut, profanity masked, an unknown key ignored.
 * Cost discipline: the daily AI budget of the actor (`point_b_strategy`), the gateway's timeout; a missing key, a
 * refused budget or a broken answer → the rule tree as it is with a warning code, never a throw, no retry.
 */
import { z } from 'zod'
import { assertAiBudget, isAiBudgetError } from '@/lib/ai/budget'
import { callLlmJson, hasLlmKey, UNTRUSTED_DATA_RULES, type LlmUsage } from '@/lib/ai/gateway'
import { recordAiUsage } from '@/lib/ai/usage'
import { maskProfanity } from '@/lib/moderation/profanity'
import { allowedNumbers, foreignNumbers } from '../insights/numbers'
import type { RecsContext } from '../recs/context'
import { STRATEGY_LIMITS, type PlanStrategy } from './types'

export type WordingWarningCode = 'no_api_key' | 'budget_exceeded' | 'timeout' | 'rate_limited' | 'provider_error' | 'invalid_output'

export const WORDING_WARNING_TEXT: Record<WordingWarningCode, string> = {
  no_api_key: 'ИИ не подключён: стратегия собрана правилами без переформулировки.',
  budget_exceeded: 'Дневной лимит ИИ исчерпан: стратегия собрана правилами без переформулировки.',
  timeout: 'Модель не ответила вовремя: стратегия собрана правилами без переформулировки.',
  rate_limited: 'Модель перегружена: стратегия собрана правилами без переформулировки.',
  provider_error: 'Ошибка модели: стратегия собрана правилами без переформулировки.',
  invalid_output: 'Модель вернула ответ не по формату: стратегия собрана правилами без переформулировки.',
}

const LLM_CODE: Record<string, WordingWarningCode> = {
  NO_API_KEY: 'no_api_key', TIMEOUT: 'timeout', RATE_LIMITED: 'rate_limited', PROVIDER_ERROR: 'provider_error',
  INVALID_OUTPUT: 'invalid_output', BUDGET_EXCEEDED: 'budget_exceeded',
}

const AnswerSchema = z.object({
  items: z.array(z.object({ key: z.string(), title: z.string(), description: z.string().nullable().optional() }).passthrough()).max(400),
})

export const WORDING_SYSTEM = [
  'Ты — стратег платформы AIStart360. Переформулируй черновик стратегии плана роста понятным языком для владельца бизнеса. Черновик проверит и поправит эксперт.',
  'ЖЁСТКИЕ ПРАВИЛА:',
  '1. Не меняй смысл, уровень и состав узлов: только формулировки названия и описания. Ключи (key) — ровно те, что даны.',
  '2. Числа бери ТОЛЬКО из блока «Данные» или из текста самого узла — в том виде, как они там написаны. Не придумывай чисел, процентов, сумм, сроков, дат и лет.',
  '3. Если нужного числа нет — пиши словами без числа.',
  '4. Название — до 120 символов, описание — одно-два коротких предложения на русском.',
  UNTRUSTED_DATA_RULES,
  'Ответь одним JSON-объектом без markdown: {"items":[{"key":string,"title":string,"description":string|null}]}',
].join('\n')

export interface WordingInput {
  strategy: PlanStrategy
  context: RecsContext
  /** The staff member whose AI budget is spent. */
  actorId: string
  /** Test seam: the gateway call. */
  call?: typeof callLlmJson
}

export interface WordingResult {
  strategy: PlanStrategy
  /** Run-level codes (WordingWarningCode) and node-level Russian sentences. */
  warnings: string[]
  usage: LlmUsage | null
  /** How many nodes got the AI's text. */
  reworded: number
}

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

function same(input: WordingInput, warnings: string[], usage: LlmUsage | null = null): WordingResult {
  return { strategy: input.strategy, warnings, usage, reworded: 0 }
}

export async function wordStrategyWithAi(input: WordingInput): Promise<WordingResult> {
  const nodes = input.strategy.items
  if (!nodes.length) return same(input, [])
  if (!input.call && !hasLlmKey()) return same(input, ['no_api_key'])
  try {
    await assertAiBudget(input.actorId, 'point_b_strategy')
  } catch (err) {
    if (isAiBudgetError(err)) return same(input, ['budget_exceeded'])
    // any other failure of the meter is fail-open, like the budget itself
  }

  const listing = nodes.map((n) => `- key=${n.key}; уровень=${n.kind === 'strategy' ? 'стратегия' : n.kind === 'initiative' ? 'инициатива' : 'задача'}; название: ${n.title}${n.description ? `; описание: ${n.description}` : ''}`).join('\n')
  const user = [
    input.context.text,
    `Черновик стратегии (узлы):\n${listing}`,
    'Задача: переформулируй название и описание каждого узла. Верни все ключи.',
  ].join('\n\n')

  const started = Date.now()
  let res: Awaited<ReturnType<typeof callLlmJson<z.infer<typeof AnswerSchema>>>>
  try {
    res = await (input.call ?? callLlmJson)({
      tier: 'standard', system: WORDING_SYSTEM, user, maxTokens: 3000, temperature: 0.2,
      timeoutMs: 45_000, label: 'point-b:strategy-draft', schema: AnswerSchema,
    })
  } catch (err) {
    console.error('[point-b/strategy/ai] gateway threw', err instanceof Error ? err.message : err)
    return same(input, ['provider_error'])
  }
  await recordAiUsage({
    feature: 'point_b_strategy', model: res.usage?.model ?? 'unknown', promptTokens: res.usage?.tokensIn ?? null,
    completionTokens: res.usage?.tokensOut ?? null, providerCostUsd: res.usage?.costUsd ?? null,
    latencyMs: res.usage?.latencyMs ?? Date.now() - started, ok: res.ok, userId: input.actorId,
  })
  if (!res.ok) return same(input, [LLM_CODE[res.error] ?? 'provider_error'], res.usage)

  const byKey = new Map(nodes.map((n) => [n.key, n]))
  const answers = new Map<string, { title: string; description: string | null }>()
  for (const it of res.data.items) if (byKey.has(it.key) && !answers.has(it.key)) answers.set(it.key, { title: it.title, description: it.description ?? null })

  const warnings: string[] = []
  let reworded = 0
  const items = nodes.map((n) => {
    const a = answers.get(n.key)
    if (!a) return n
    const title = cut(maskProfanity(a.title.trim()), Math.min(120, STRATEGY_LIMITS.title))
    const description = a.description?.trim() ? cut(maskProfanity(a.description.trim()), 600) : null
    if (!title) return n
    // The node's own numbers (from the model, written by the rules) are allowed in its new text, nothing else.
    const allowed = allowedNumbers([n.title, n.description ?? ''], new Set(input.context.allowedNumbers))
    const foreign = [...foreignNumbers(a.title, allowed), ...foreignNumbers(a.description ?? null, allowed)]
    if (foreign.length) {
      warnings.push(`Узел «${n.title}»: формулировка ИИ отброшена — число не из данных (${[...new Set(foreign)].slice(0, 3).join(', ')}).`)
      return n
    }
    reworded += 1
    return { ...n, title, description: description ?? n.description }
  })
  return { strategy: { items, milestones: input.strategy.milestones }, warnings, usage: res.usage, reworded }
}
