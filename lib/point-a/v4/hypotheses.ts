/**
 * lib/point-a/v4/hypotheses.ts — AI estimate of a Point A block that lacks
 * data (spec 2026-10-12 §2.3): a block below the coverage threshold that still
 * has SOME answered checks gets a hypothesis — score, rationale, confidence
 * ≤ 0.4 — shown with the «гипотеза» badge and never counted as a FACT or in
 * the overall score. A block without any data gets none: there is nothing to
 * estimate from. Reused while the block's checks stay the same (inputsHash).
 */
import { z } from 'zod'
import type { V4Block, V4Hypothesis } from './engine'
import { CHECK_LABELS } from './check-inputs'

export const MAX_HYPOTHESIS_CONFIDENCE = 0.4

/** Blocks that need a hypothesis: no score, but something to go on. */
export function blocksNeedingHypothesis(blocks: readonly V4Block[]): V4Block[] {
  return blocks.filter((b) => b.status === 'insufficient_data' && !b.informational && b.coverage > 0 && !b.hypothesis)
}

/** Hypotheses of the previous snapshot whose block inputs did not change. */
export function carryOverHypotheses(blocks: readonly V4Block[], prev: readonly V4Block[] | null | undefined): V4Block[] {
  if (!prev?.length) return [...blocks]
  const byKey = new Map(prev.map((b) => [b.key, b]))
  return blocks.map((b) => {
    const p = byKey.get(b.key)
    return b.status === 'insufficient_data' && p?.hypothesis && p.inputsHash === b.inputsHash ? { ...b, hypothesis: p.hypothesis } : b
  })
}

export function hypothesisConfidence(coverage: number): number {
  return Math.round(Math.min(MAX_HYPOTHESIS_CONFIDENCE, 0.15 + coverage * 0.6) * 100) / 100
}

export const HypothesisSchema = z.object({
  score: z.number().int().min(0).max(100),
  rationale: z.string().min(10).max(600),
})

export function hypothesisPrompt(block: V4Block, context: { industry: string | null; otherBlocks: Array<{ title: string; score: number | null }> }): { system: string; user: string } {
  const answered = block.checks.filter((c) => c.answered && !c.excluded)
  const facts = answered.map((c) => `- ${CHECK_LABELS[c.id] ?? c.id}: ${c.earned}/${c.max}${c.issue ? ` (проблема: ${c.issue})` : ''}`).join('\n')
  const missing = block.checks.filter((c) => !c.answered && !c.excluded).map((c) => `- ${CHECK_LABELS[c.id] ?? c.id}`).join('\n')
  const others = context.otherBlocks.filter((b) => b.score !== null).map((b) => `${b.title}: ${b.score}`).join(', ')
  return {
    system:
      'Ты бизнес-аналитик. По неполным данным оцени состояние ОДНОГО блока бизнеса малого/среднего предприятия по шкале 0–100. ' +
      'Это гипотеза, а не факт: опирайся только на приведённые данные, не придумывай цифры, честно отрази неопределённость. ' +
      'Ответ — JSON {"score": целое 0..100, "rationale": "2–3 предложения на русском: на чём основана оценка и что нужно, чтобы её подтвердить"}.',
    user: [
      `Блок: «${block.title}».`,
      context.industry ? `Отрасль: ${context.industry}.` : null,
      `Известно (балл проверки / максимум):\n${facts || '- нет'}`,
      `Неизвестно:\n${missing || '- нет'}`,
      others ? `Баллы других блоков: ${others}.` : null,
    ].filter(Boolean).join('\n\n'),
  }
}

export interface HypothesisDeps {
  generate: (o: { system: string; user: string; userId: string }) => Promise<{ score: number; rationale: string } | null>
  now?: () => Date
}

export const defaultHypothesisDeps: HypothesisDeps = {
  generate: async ({ system, user, userId }) => {
    const { generateObjectViaOpenRouter } = await import('@/lib/ai/structured')
    return generateObjectViaOpenRouter({
      feature: 'point_a_hypothesis', userId, system, user, schema: HypothesisSchema,
      complexity: 'low', maxTokens: 500, temperature: 0.2, timeoutMs: 30_000, label: 'point-a:hypothesis',
    })
  },
}

/** Hypotheses for the blocks that need one; blocks are returned with `hypothesis` set where generated. */
export async function generateHypotheses(
  blocks: readonly V4Block[],
  ctx: { industry: string | null; userId: string },
  deps: HypothesisDeps = defaultHypothesisDeps,
): Promise<{ blocks: V4Block[]; generated: number }> {
  const need = blocksNeedingHypothesis(blocks)
  if (!need.length) return { blocks: [...blocks], generated: 0 }
  const otherBlocks = blocks.map((b) => ({ title: b.title, score: b.score }))
  const made = new Map<string, V4Hypothesis>()
  for (const b of need) {
    const { system, user } = hypothesisPrompt(b, { industry: ctx.industry, otherBlocks })
    const r = await deps.generate({ system, user, userId: ctx.userId }).catch(() => null)
    if (!r) continue
    made.set(b.key, {
      score: Math.max(0, Math.min(100, Math.round(r.score))),
      confidence: hypothesisConfidence(b.coverage),
      rationale: r.rationale.trim(),
      generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
    })
  }
  return { blocks: blocks.map((b) => (made.has(b.key) ? { ...b, hypothesis: made.get(b.key) } : b)), generated: made.size }
}
