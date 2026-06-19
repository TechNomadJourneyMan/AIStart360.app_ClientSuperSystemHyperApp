import { z } from 'zod'
import { generateObjectViaOpenRouter, hasOpenRouterKey } from './structured'
import { buildPointBAiContext, type PointBV2 } from '@/lib/point-b/engine'
import type { PointBStrategy } from '@/types/point-b'
import type { Locale } from '@/lib/i18n/locale'

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
//
// The priority ENUM is localized so the model emits the labels that match the
// portal locale ('Приоритет N' for ru, 'Priority N' for en); both label sets are
// part of PointBStrategy.gap_bridge.priority. The milestone status enum stays the
// literal 'current'|'planned'|'future' union (it is a key, not user-facing copy).
// Schema field DESCRIPTIONS follow the locale too — they steer the generated copy.

const PRIORITY_ENUM = {
  ru: ['Приоритет 1', 'Приоритет 2', 'Приоритет 3'] as const,
  en: ['Priority 1', 'Priority 2', 'Priority 3'] as const,
}

function buildPointBStrategySchema(locale: Locale) {
  const en = locale === 'en'
  return z.object({
    strategic_bridge_summary: z
      .string()
      .describe(
        en
          ? 'Overview of the transition from the current state to the goal (3-5 sentences, no concrete revenue figures)'
          : 'Обзор перехода из текущего состояния к цели (3-5 предложений, без конкретных цифр выручки)',
      ),
    gap_bridge: z
      .array(
        z.object({
          block: z
            .string()
            .describe(
              en
                ? 'Weak block or TOP-5 limit (e.g. "Finance" or "No CRM")'
                : 'Слабый блок или ограничение из TOP-5 (например, «Финансы» или «Нет CRM»)',
            ),
          gap: z
            .string()
            .describe(
              en
                ? 'What exactly the gap is — in words, no numbers'
                : 'В чём именно заключается разрыв — словами, без цифр',
            ),
          action: z
            .string()
            .describe(
              en
                ? 'Concrete action that closes the gap'
                : 'Конкретное действие для закрытия разрыва',
            ),
          priority: z.enum(en ? PRIORITY_ENUM.en : PRIORITY_ENUM.ru),
        }),
      )
      .min(1)
      .max(8)
      .describe(
        en
          ? 'One entry per weak block / TOP-5 limit'
          : 'По одному пункту на слабый блок / ограничение из TOP-5',
      ),
    milestones: z
      .array(
        z.object({
          q: z
            .string()
            .describe(
              en
                ? 'Horizon/quarter label (e.g. "Quarter 1" or "Q2")'
                : 'Метка горизонта/квартала (например, «Квартал 1» или «Q2»)',
            ),
          title: z.string().describe(en ? 'Short milestone title' : 'Короткий заголовок вехи'),
          desc: z
            .string()
            .describe(
              en
                ? 'What must be achieved — in words, no revenue figures'
                : 'Что должно быть достигнуто — словами, без цифр выручки',
            ),
          status: z.enum(['current', 'planned', 'future']),
        }),
      )
      .min(2)
      .max(8)
      .describe(
        en
          ? 'Milestones ordered by horizons / TOP-5 limits'
          : 'Вехи, упорядоченные по горизонтам/TOP-5 ограничениям',
      ),
    risk_mitigations: z
      .array(
        z.object({
          risk: z
            .string()
            .describe(
              en
                ? 'Risk factor (taken from the provided risk factors)'
                : 'Фактор риска (взять из переданных факторов риска)',
            ),
          mitigation: z
            .string()
            .describe(en ? 'How to mitigate this risk' : 'Как этот риск снизить'),
        }),
      )
      .min(0)
      .max(8)
      .describe(
        en
          ? 'One mitigation per risk factor from the realism calculation'
          : 'По одной мере на каждый фактор риска из расчёта реалистичности',
      ),
  })
}

// ─── System prompt ────────────────────────────────────────────────────────────
//
// Russian by default; switched to English when locale==='en'. The anti-fabrication
// rules are preserved verbatim in both languages, and the JSON example uses the
// locale's priority labels so the model emits the matching enum.

function buildSystem(locale: Locale): string {
  if (locale === 'en') {
    return `You are the lead strategist of the AIStart360 platform (Kazakhstan). Your role is to build a clear bridge between the current state of the business and the owner's REAL goal.

You are given a DETERMINISTIC calculation (gap, required growth rate, realism, weak blocks, levers, TOP-5 limits, planning horizons) as the SINGLE SOURCE OF TRUTH.

STRICT RULES:
1. Never state or invent revenue figures, target amounts, growth percentages, multipliers, or money-based timelines. All numbers are already computed by the engine — your job is ONLY NARRATIVE and SEQUENCING.
2. gap_bridge — one entry per weak block and/or TOP-5 limit.
3. milestones — order them by planning horizons and TOP-5 limits (from nearest to strategic).
4. risk_mitigations — one mitigation per EACH provided risk factor (if there are no risk factors — return an empty array).
5. Be extremely specific and rely on the provided data. Do not repeat verbatim what the engine already stated.
6. BREVITY IS MANDATORY: every string field is one sentence, at most ~22 words. strategic_bridge_summary — at most 3 sentences. Dense and to the point, no filler.
7. Output language — ENGLISH.

Respond STRICTLY with one valid minified JSON object per the schema, no markdown or explanations:
{"strategic_bridge_summary": string, "gap_bridge": [{"block": string, "gap": string, "action": string, "priority": "Priority 1"|"Priority 2"|"Priority 3"}], "milestones": [{"q": string, "title": string, "desc": string, "status": "current"|"planned"|"future"}], "risk_mitigations": [{"risk": string, "mitigation": string}]}`
  }

  return `Ты — ведущий стратег платформы AIStart360 (Казахстан). Твоя роль — построить понятный мост между текущим состоянием бизнеса и РЕАЛЬНОЙ целью владельца.

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
}

// ─── Main analyzer ────────────────────────────────────────────────────────────

export async function analyzePointBStrategy(
  pointB: PointBV2,
  company: { name?: string | null; industry?: string | null; stage?: string | null } | null,
  locale: Locale = 'ru',
): Promise<PointBStrategy | null> {
  // Honest degradation — never fabricate a strategy without an LLM.
  if (!hasOpenRouterKey()) {
    console.warn('[point-b-analyzer] No OPENROUTER_API_KEY — skipping AI strategy analysis')
    return null
  }

  const en = locale === 'en'

  const companyLine = en
    ? `--- COMPANY ---
Name: ${company?.name || '—'}
Industry: ${company?.industry || '—'}
Stage: ${company?.stage || '—'}`
    : `--- КОМПАНИЯ ---
Название: ${company?.name || '—'}
Отрасль: ${company?.industry || '—'}
Стадия: ${company?.stage || '—'}`

  const task = en
    ? `--- TASK ---
Based on the calculation above, produce a NARRATIVE strategy for the transition to the goal:
- strategic_bridge_summary: 3–5 sentences on how to close the gap (no concrete figures).
- gap_bridge: one entry per weak block / TOP-5 limit (what the gap is and which action closes it).
- milestones: a sequence of milestones from the nearest horizons to strategic ones, based on the horizons and TOP-5.
- risk_mitigations: one mitigation per each provided risk factor.
Remember: NO revenue, target, or growth-rate numbers — only words and sequencing.`
    : `--- ЗАДАЧА ---
На основе расчёта выше сформируй НАРРАТИВНУЮ стратегию перехода к цели:
- strategic_bridge_summary: 3–5 предложений о том, как закрыть разрыв (без конкретных цифр).
- gap_bridge: по пункту на каждый слабый блок / ограничение из TOP-5 (что за разрыв и какое действие его закрывает).
- milestones: последовательность вех от ближайших горизонтов к стратегическим, опираясь на горизонты и TOP-5.
- risk_mitigations: по одной мере на каждый переданный фактор риска.
Помни: НИКАКИХ чисел выручки, целей или темпов роста — только слова и последовательность.`

  const context = `${companyLine}

${buildPointBAiContext(pointB)}

${task}`

  // The strategic narrative is quality-sensitive → route to Sonnet ('high').
  return generateObjectViaOpenRouter<PointBStrategy>({
    label: 'point-b:strategy',
    complexity: 'high',
    maxTokens: 2200,
    schema: buildPointBStrategySchema(locale),
    system: buildSystem(locale),
    user: context,
  })
}
