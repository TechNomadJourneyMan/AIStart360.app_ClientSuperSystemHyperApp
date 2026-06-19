import { z } from 'zod'
import { generateObjectViaOpenRouter, hasOpenRouterKey } from './structured'
import { buildPointBAiContext, type PointBV2 } from '@/lib/point-b/engine'
import type { PointBStrategy } from '@/types/point-b'

/**
 * Point B AI strategy analyzer — narrative bridge from the current state to the
 * owner's REAL stated goal.
 *
 * Division of labour with the deterministic engine (`lib/point-b/engine.ts`):
 *   • The engine computes ALL numbers (gap multiplier, required CAGR/MoM/QoQ,
 *     realism level + risk factors + weak blocks, growth levers, TOP-5 limits,
 *     horizon plans). Those are serialized once by `buildPointBAiContext` and
 *     handed to the model as GROUND TRUTH.
 *   • This analyzer asks the model for NARRATIVE + SEQUENCING ONLY
 *     (strategic_bridge_summary, gap_bridge, milestones, risk_mitigations).
 *
 * Honest "no fabrication" guarantee: the Zod schema below contains NO numeric
 * fields, so even a hallucinated target/revenue number cannot leak through —
 * it would be dropped on parse. On a missing key or any parse failure we return
 * `null`, and the UI degrades honestly instead of inventing a strategy.
 */

// ─── Zod schema — NARRATIVE ONLY, deliberately no numeric/target fields ───────

const pointBStrategySchema = z.object({
  strategic_bridge_summary: z
    .string()
    .describe('Обзор перехода из текущего состояния к цели (3-5 предложений, без конкретных цифр выручки)'),
  gap_bridge: z
    .array(
      z.object({
        block: z.string().describe('Слабый блок или ограничение из TOP-5 (например, «Финансы» или «Нет CRM»)'),
        gap: z.string().describe('В чём именно заключается разрыв — словами, без цифр'),
        action: z.string().describe('Конкретное действие для закрытия разрыва'),
        priority: z.enum(['Приоритет 1', 'Приоритет 2', 'Приоритет 3']),
      }),
    )
    .min(1)
    .max(8)
    .describe('По одному пункту на слабый блок / ограничение из TOP-5'),
  milestones: z
    .array(
      z.object({
        q: z.string().describe('Метка горизонта/квартала (например, «Квартал 1» или «Q2»)'),
        title: z.string().describe('Короткий заголовок вехи'),
        desc: z.string().describe('Что должно быть достигнуто — словами, без цифр выручки'),
        status: z.enum(['current', 'planned', 'future']),
      }),
    )
    .min(2)
    .max(8)
    .describe('Вехи, упорядоченные по горизонтам/TOP-5 ограничениям'),
  risk_mitigations: z
    .array(
      z.object({
        risk: z.string().describe('Фактор риска (взять из переданных факторов риска)'),
        mitigation: z.string().describe('Как этот риск снизить'),
      }),
    )
    .min(0)
    .max(8)
    .describe('По одной мере на каждый фактор риска из расчёта реалистичности'),
})

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM = `Ты — ведущий стратег платформы AIStart360 (Казахстан). Твоя роль — построить понятный мост между текущим состоянием бизнеса и РЕАЛЬНОЙ целью владельца.

Тебе передают ДЕТЕРМИНИРОВАННЫЙ расчёт (разрыв, требуемый темп роста, реалистичность, слабые блоки, рычаги, TOP-5 ограничений, горизонты планирования) как ЕДИНСТВЕННЫЙ ИСТОЧНИК ИСТИНЫ.

ЖЁСТКИЕ ПРАВИЛА:
1. Никогда не называй и не выдумывай числа выручки, целевые суммы, проценты роста, множители или сроки в деньгах. Все цифры уже посчитаны движком — твоя работа только НАРРАТИВ и ПОСЛЕДОВАТЕЛЬНОСТЬ.
2. gap_bridge — по одному пункту на слабый блок и/или ограничение из TOP-5.
3. milestones — упорядочи их по горизонтам планирования и TOP-5 ограничениям (от ближайших к стратегическим).
4. risk_mitigations — по одной мере на КАЖДЫЙ переданный фактор риска (если факторов риска нет — верни пустой массив).
5. Будь предельно конкретен и опирайся на переданные данные. Не повторяй дословно то, что уже сказал движок.
6. КРАТКОСТЬ ОБЯЗАТЕЛЬНА: каждое строковое поле — одно предложение, максимум ~22 слова. strategic_bridge_summary — максимум 3 предложения. Плотно и по делу, без воды.
7. Язык вывода — РУССКИЙ.

Ответь СТРОГО одним валидным минифицированным JSON-объектом по схеме, без markdown и пояснений:
{"strategic_bridge_summary": string, "gap_bridge": [{"block": string, "gap": string, "action": string, "priority": "Приоритет 1"|"Приоритет 2"|"Приоритет 3"}], "milestones": [{"q": string, "title": string, "desc": string, "status": "current"|"planned"|"future"}], "risk_mitigations": [{"risk": string, "mitigation": string}]}`

// ─── Main analyzer ────────────────────────────────────────────────────────────

export async function analyzePointBStrategy(
  pointB: PointBV2,
  company: { name?: string | null; industry?: string | null; stage?: string | null } | null,
): Promise<PointBStrategy | null> {
  // Honest degradation — never fabricate a strategy without an LLM.
  if (!hasOpenRouterKey()) {
    console.warn('[point-b-analyzer] No OPENROUTER_API_KEY — skipping AI strategy analysis')
    return null
  }

  const companyLine = `--- КОМПАНИЯ ---
Название: ${company?.name || '—'}
Отрасль: ${company?.industry || '—'}
Стадия: ${company?.stage || '—'}`

  const context = `${companyLine}

${buildPointBAiContext(pointB)}

--- ЗАДАЧА ---
На основе расчёта выше сформируй НАРРАТИВНУЮ стратегию перехода к цели:
- strategic_bridge_summary: 3–5 предложений о том, как закрыть разрыв (без конкретных цифр).
- gap_bridge: по пункту на каждый слабый блок / ограничение из TOP-5 (что за разрыв и какое действие его закрывает).
- milestones: последовательность вех от ближайших горизонтов к стратегическим, опираясь на горизонты и TOP-5.
- risk_mitigations: по одной мере на каждый переданный фактор риска.
Помни: НИКАКИХ чисел выручки, целей или темпов роста — только слова и последовательность.`

  // The strategic narrative is quality-sensitive → route to Sonnet ('high').
  return generateObjectViaOpenRouter<PointBStrategy>({
    label: 'point-b:strategy',
    complexity: 'high',
    maxTokens: 2200,
    schema: pointBStrategySchema,
    system: SYSTEM,
    user: context,
  })
}
