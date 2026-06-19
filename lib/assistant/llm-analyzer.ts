/**
 * lib/assistant/llm-analyzer.ts — Layer 3 (optional) LLM semantic analysis.
 *
 *   analyzeWithLlm(ctx)   → LlmAnalysis | null   (full situational analysis)
 *   llmSemanticChecks(ctx)→ ValidationIssue[]    (contradiction/vagueness issues)
 *
 * ANTI-HALLUCINATION BOUNDARY (non-negotiable): the prompt is built from the
 * curated {@link AssistantContext} snapshot ONLY (see lib/assistant/context.ts) —
 * never a raw DB row. The model is instructed to use ONLY the provided fields,
 * mark uncertainty, and — when key inputs are absent — set `insufficient_data:
 * true` and list exactly what is missing in `missing_data` rather than invent
 * numbers. On a missing key, request failure, or schema-parse failure we return
 * `null` honestly (mirrors lib/ai/point-a-analyzer.ts). All narrative is Russian.
 *
 * Routing/perf: generateObjectViaOpenRouter(complexity:'high' → Sonnet). Output
 * is bounded (short arrays, one-sentence strings) for speed and to keep the
 * single Sonnet call well under the latency budget.
 */

import { z } from 'zod'
import { generateObjectViaOpenRouter, hasOpenRouterKey } from '@/lib/ai/structured'
import type { AssistantContext, LlmAnalysis, ValidationIssue } from './types'

// ─── Zod schema — matches LlmAnalysis in types.ts field-for-field ────────────

const escalationSchema = z.object({
  recommended: z.boolean().describe('true если ситуация требует ручного разбора экспертом'),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  reason: z.string().describe('Одно предложение: почему нужен (или не нужен) эксперт'),
})

const llmAnalysisSchema = z.object({
  situation_summary: z
    .string()
    .describe('2–4 предложения: объективная картина бизнеса по предоставленным данным'),
  strengths: z.array(z.string()).max(5).describe('Сильные стороны (только из данных)'),
  weaknesses: z.array(z.string()).max(5).describe('Слабые стороны (только из данных)'),
  risks: z.array(z.string()).max(5).describe('Ключевые риски'),
  opportunities: z.array(z.string()).max(5).describe('Возможности роста'),
  missing_data: z
    .array(z.string())
    .max(8)
    .describe('Каких именно данных не хватает для уверенного вывода'),
  next_actions: z.array(z.string()).max(5).describe('Конкретные следующие шаги'),
  questions_for_user: z
    .array(z.string())
    .max(5)
    .describe('Вопросы пользователю, чтобы закрыть пробелы в данных'),
  expert_escalation: escalationSchema,
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Уверенность 0–1 с учётом полноты данных'),
  insufficient_data: z
    .boolean()
    .describe('true если ключевых входных данных недостаточно для анализа'),
})

// The model occasionally returns the float as a string or 0–100 — coerce/clamp
// so a single off-format field never collapses the whole analysis to null.
const llmAnalysisSchemaLoose = llmAnalysisSchema.extend({
  confidence: z
    .preprocess((v) => {
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(n)) return 0
      return n > 1 ? n / 100 : n
    }, z.number().min(0).max(1)),
})

// ─── Prompt building (FROM THE CURATED SNAPSHOT ONLY) ────────────────────────

const SYSTEM = `Ты — старший бизнес-аналитик платформы AIStart360 (Казахстан).
Тебе дают КУРИРОВАННЫЙ структурированный снимок данных компании (Точка А по 5 блокам, Точка Б: разрыв/реализм/достаточность данных, GRI топ-ограничения, цели по выручке, текущая выручка). Это ЕДИНСТВЕННЫЙ источник — других данных у тебя нет.

ЖЁСТКИЕ ПРАВИЛА ЧЕСТНОСТИ (анти-галлюцинация):
- Используй ТОЛЬКО поля из снимка. НИКОГДА не выдумывай числа, проценты, выручку, бенчмарки или факты, которых нет в данных.
- Если поле равно null/пусто — считай, что данных НЕТ. Не подставляй догадку.
- Если ключевых входных данных не хватает (нет диагностики Точки А, нет целей, нет выручки) — установи "insufficient_data": true, перечисли пробелы в "missing_data" и снизь "confidence". Не притворяйся, что вывод полный.
- "confidence" отражает полноту данных: мало данных → низкая уверенность.
- Можно опираться на качественные ответы анкеты (текстовые), но без придуманной конкретики.

КРАТКОСТЬ ОБЯЗАТЕЛЬНА: каждый элемент массива — одно предложение до 18 слов. "situation_summary" — 2–4 предложения. Массивы короткие (0–5 пунктов; missing_data до 8). Будь плотным и конкретным, без воды.
Эскалация эксперту: recommended=true при критических рисках, нереалистичной цели или явных противоречиях; иначе false.
Пиши строго по-русски. Верни ОДИН валидный минифицированный JSON-объект и ничего больше.`

/** Render a number or '—' for the prompt (never fabricate when null). */
function n(v: number | null | undefined): string {
  return v == null || !Number.isFinite(Number(v)) ? '—' : String(v)
}

/** Compact a string array for the prompt; '—' when empty. */
function list(arr: Array<string | undefined | null> | undefined, max = 8): string {
  if (!arr || arr.length === 0) return '—'
  const items = arr.filter((x): x is string => !!x && String(x).trim().length > 0).slice(0, max)
  return items.length ? items.join('; ') : '—'
}

/**
 * Pull a small set of qualitative survey answers (already unwrapped to
 * answer.value in the snapshot) so the model has narrative context WITHOUT a raw
 * row dump. We read a curated allow-list of keys, not the whole answers map.
 */
function qualitativeAnswers(answers: Record<string, unknown>): string {
  const keys: Array<[string, string]> = [
    ['s2n_goal_12m_what', 'Цель 12 мес'],
    ['s2n_what_blocks_growth', 'Что мешает росту'],
    ['s3n_client_problem', 'Проблема клиента'],
    ['s3n_competitor_why_us', 'Почему мы, а не конкуренты'],
    ['s9n_financial_blockers', 'Финансовые барьеры'],
    ['s10_what_depts_lack', 'Чего не хватает отделам'],
  ]
  const lines = keys
    .map(([key, label]) => {
      const v = answers?.[key]
      if (v == null) return null
      const s = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? '' : String(v)
      const t = s.trim()
      return t ? `- ${label}: ${t.slice(0, 280)}` : null
    })
    .filter((x): x is string => x !== null)
  return lines.length ? lines.join('\n') : '— (качественные ответы не заполнены)'
}

/**
 * Build the user prompt from the curated snapshot ONLY. Every numeric slot is
 * rendered via n()/list() so a null surfaces as '—' (honest gap), never a guess.
 */
function buildUserPrompt(ctx: AssistantContext): string {
  const c = ctx.company
  const a = ctx.pointA
  const b = ctx.pointB
  const g = ctx.gri
  const m = ctx.metrics

  const blockLines = a.blocks
    .map((bl) => `  - ${bl.label} (${bl.key}): ${n(bl.score)}/100 [${bl.status}]`)
    .join('\n')

  const weakest = a.weakest_blocks.map((bl) => `${bl.label} ${n(bl.score)}`).join(', ') || '—'

  return `СНИМОК ДАННЫХ КОМПАНИИ (курированный — другого источника нет).

--- КОМПАНИЯ ---
Название: ${c.name ?? '—'}
Отрасль: ${c.industry ?? '—'}
Стадия: ${c.stage ?? '—'}
Сотрудников: ${n(c.employee_count)}
Цель выручки 12 мес (₸): ${n(c.target_revenue_12m_kzt)}
Цель выручки 3 года (₸): ${n(c.target_revenue_3y_kzt)}

--- ТОЧКА А (диагностика) ---
Есть диагностика: ${a.has_diagnostic ? 'да' : 'нет'}
Общий балл: ${n(a.overall_score)}/100 | Health Index: ${n(a.health_index)}/100 | Стадия: ${a.stage ?? '—'}
Блоки:
${blockLines}
Слабейшие блоки: ${weakest}
Риски: ${list(a.risks.map((r) => `[${r.level}] ${r.area}: ${r.text}`), 6)}
Пробелы в данных (Точка А): ${list(a.data_gaps.map((x) => x.field), 8)}
Быстрые победы: ${list(a.quick_wins.map((q) => q.action), 5)}

--- ТОЧКА Б (цель / разрыв / реализм) ---
Есть цель: ${b.has_goal ? 'да' : 'нет'}
Текущая выручка/год (₸): ${n(b.current_revenue_year)}
Цель 12 мес (₸): ${n(b.goal_12m_revenue_year)} | Цель 3 года (₸): ${n(b.goal_3y_revenue_year)}
Разрыв: множитель ${n(b.gap.multiplier)}x | требуемый CAGR ${n(b.gap.required_cagr)}% | требуемый рост MoM ${n(b.gap.required_mom_growth)}% | данные полны: ${b.gap.data_complete ? 'да' : 'нет'}
Реализм цели: уровень "${b.realism.level}", балл ${n(b.realism.score)}; обоснование: ${list(b.realism.rationale, 4)}; слабые блоки: ${list(b.realism.weak_blocks, 5)}
Достаточность данных: ${b.data_sufficiency.sufficient ? 'достаточно' : 'НЕДОСТАТОЧНО'} (уверенность ${n(b.data_sufficiency.confidence)})
  Не хватает: ${list(b.data_sufficiency.missing, 8)}
  Есть: ${list(b.data_sufficiency.have, 8)}
Рычаги роста: ${list(b.levers.map((l) => `${l.label}${l.data_available ? '' : ' (нет данных)'}`), 6)}
Топ-ограничения (Точка Б): ${list(b.top5_limits.map((t) => `${t.rank}. ${t.title} [${t.block}/${t.severity}]`), 5)}

--- GRI ---
Есть оценка GRI: ${g.has_assessment ? 'да' : 'нет'} | Индекс GRI (0–10): ${n(g.gri_index)}
Топ-5 ограничений GRI: ${list(g.top_5_limits.map((t) => `${t.rank}. ${t.title} [${t.block}] ${t.score == null ? '' : '— ' + t.score}`), 5)}

--- МЕТРИКИ ---
Каноническая выручка (₸): ${n(m.revenue)} (год: ${n(m.revenue_year)})

--- КАЧЕСТВЕННЫЕ ОТВЕТЫ (из анкеты) ---
${qualitativeAnswers(ctx.answers ?? {})}

--- ЗАДАЧА ---
Сделай объективный ситуационный анализ ТОЛЬКО по этим данным. Если значимых данных нет (нет диагностики, целей или выручки) — честно установи insufficient_data:true и перечисли пробелы. Не выдумывай числа и бенчмарки. Соблюдай лимиты краткости.

--- ФОРМАТ ВЫВОДА ---
Верни ОДИН валидный минифицированный JSON-объект (без markdown, без комментариев):
{
  "situation_summary": "строка",
  "strengths": ["строка"],
  "weaknesses": ["строка"],
  "risks": ["строка"],
  "opportunities": ["строка"],
  "missing_data": ["строка"],
  "next_actions": ["строка"],
  "questions_for_user": ["строка"],
  "expert_escalation": { "recommended": false, "priority": "low", "reason": "строка" },
  "confidence": 0.0,
  "insufficient_data": false
}`
}

// ─── analyzeWithLlm ──────────────────────────────────────────────────────────

/**
 * Run the optional Layer-3 LLM analysis over the curated snapshot.
 *
 * Returns the validated {@link LlmAnalysis}, or `null` honestly when:
 *   - there is no OPENROUTER_API_KEY (honest degradation, no fabrication), or
 *   - the request/parse fails after the structured helper's internal retry.
 *
 * Never throws. The model is forced to be honest about gaps via the system
 * rules + the schema (insufficient_data + missing_data).
 */
export async function analyzeWithLlm(ctx: AssistantContext): Promise<LlmAnalysis | null> {
  if (!hasOpenRouterKey()) {
    console.warn('[assistant:llm-analyzer] No OPENROUTER_API_KEY — skipping LLM analysis')
    return null
  }

  try {
    const result = await generateObjectViaOpenRouter({
      label: 'assistant:llm-analysis',
      complexity: 'high', // Sonnet — situational reasoning quality matters.
      maxTokens: 1600, // bounded for speed (short arrays + one-sentence strings).
      temperature: 0.3, // low: keep it grounded in the snapshot.
      schema: llmAnalysisSchemaLoose,
      system: SYSTEM,
      user: buildUserPrompt(ctx),
    })

    if (!result) return null
    // Schema-validated; the loose `confidence` preprocess already normalized it.
    return result as LlmAnalysis
  } catch (error) {
    console.error('[assistant:llm-analyzer] LLM analysis failed:', error)
    return null
  }
}

// ─── llmSemanticChecks — optional Layer-3 validation issues ──────────────────

const semanticCheckSchema = z.object({
  issues: z
    .array(
      z.object({
        severity: z.enum(['error', 'warning', 'info']),
        section: z
          .string()
          .describe('id секции (finance/sales/operations/marketing/strategy/goals/company/general)'),
        field: z.string().optional().describe('question_key, если применимо'),
        code: z
          .string()
          .describe('стабильный код: contradiction | vague_answer | inconsistent_metric'),
        message_ru: z.string().describe('Одно предложение: суть проблемы'),
        hint_ru: z.string().optional().describe('Одно предложение: что уточнить/исправить'),
      }),
    )
    .max(8),
})

const SEMANTIC_SYSTEM = `Ты — контролёр качества данных AIStart360. Тебе дают курированный снимок данных компании. Найди СЕМАНТИЧЕСКИЕ проблемы, которые не ловят формальные проверки:
- противоречия между разделами (например, амбициозная цель при пустой команде и нулевой выручке);
- расплывчатые/малосодержательные качественные ответы (общие слова без конкретики);
- несогласованные метрики (значения, которые логически не сходятся).

ПРАВИЛА: опирайся ТОЛЬКО на данные снимка; не выдумывай. Если поле null — это не проблема (об этом уже знает формальная проверка), не дублируй «поле пустое». Сообщай только реальные смысловые проблемы. Если их нет — верни пустой массив issues. Каждое message_ru/hint_ru — одно предложение до 18 слов, по-русски. Верни ОДИН JSON-объект {"issues":[...]} и ничего больше.`

/**
 * Optional Layer-3 semantic checks feeding the validator pipeline. Surfaces
 * contradictions / vagueness the deterministic + rule layers can't see. Every
 * returned issue carries `source:'llm'`. Returns `[]` (never throws) when there
 * is no key, the call fails, or nothing semantic is found — so the validator
 * orchestrator can always merge it safely.
 */
export async function llmSemanticChecks(ctx: AssistantContext): Promise<ValidationIssue[]> {
  if (!hasOpenRouterKey()) return []

  try {
    const result = await generateObjectViaOpenRouter({
      label: 'assistant:llm-semantic',
      complexity: 'medium', // Haiku — cheaper/faster; pattern-spotting over a small snapshot.
      maxTokens: 1000,
      temperature: 0.2,
      schema: semanticCheckSchema,
      system: SEMANTIC_SYSTEM,
      user: buildUserPrompt(ctx),
    })

    if (!result) return []

    return result.issues.map((it, i) => ({
      id: `llm-${it.code}-${it.section}-${i}`,
      severity: it.severity,
      section: it.section,
      field: it.field,
      code: it.code,
      message_ru: it.message_ru,
      hint_ru: it.hint_ru,
      source: 'llm' as const,
    }))
  } catch (error) {
    console.error('[assistant:llm-analyzer] semantic checks failed:', error)
    return []
  }
}
