/**
 * lib/assistant/answer.ts — answerUserQuestion().
 *
 * Free-text Q&A over the curated {@link AssistantContext} snapshot. The user
 * types a question about THEIR business; the model answers using ONLY the
 * provided snapshot (the same anti-hallucination boundary as llm-analyzer.ts).
 * When the question is off-topic, unclear, or cannot be answered confidently
 * from the data, the model sets `needs_expert: true` and the caller routes the
 * question to a human expert instead of inventing an answer.
 *
 * ANTI-HALLUCINATION BOUNDARY (non-negotiable): the prompt is built from the
 * curated snapshot ONLY (via buildUserPrompt-style serialization, reusing the
 * same compact renderers). Never hand a raw DB row to the model. On a missing
 * key, request failure, or schema-parse failure we return `null` honestly —
 * and the caller treats `null` exactly like `needs_expert: true`.
 */

import { z } from 'zod'
import { generateObjectViaOpenRouter, hasOpenRouterKey } from '@/lib/ai/structured'
import type { Locale } from '@/lib/i18n/locale'
import { mascotPersona } from './mascot/system-prompt'
import { filterModelOutput } from './mascot/output-filter'
import { sanitizeQualitative } from './mascot/sanitize'
import { computeCompletion } from './completion'
import type { AssistantContext, CompletionReport } from './types'

// ─── Result schema ───────────────────────────────────────────────────────────

const answerSchema = z.object({
  can_answer: z
    .boolean()
    .describe('true если на вопрос можно уверенно ответить по предоставленным данным'),
  answer: z
    .string()
    .describe('Ответ пользователю на его языке, только по данным снимка; пусто если ответить нельзя'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('Уверенность в ответе с учётом полноты данных'),
  needs_expert: z
    .boolean()
    .describe('true если вопрос не по теме, неясен, или ответить уверенно по данным нельзя'),
})

export type UserAnswer = z.infer<typeof answerSchema>

// ─── Prompt building (FROM THE CURATED SNAPSHOT ONLY) ────────────────────────

function buildSystem(locale: Locale): string {
  // «Гри» persona + hard safety rules first (single source: mascot/system-prompt.ts),
  // then the anti-hallucination rules and the JSON output contract below.
  const persona = mascotPersona(locale)

  if (locale === 'en') {
    return `${persona}

DATA: answer the user's question about THEIR business relying STRICTLY on the provided data snapshot (the context) — you have no other source.

STRICT HONESTY RULES (anti-hallucination):
- Use ONLY the fields from the snapshot. NEVER invent numbers, percentages, revenue, benchmarks, or facts that are not in the data.
- If a field is null/empty — treat it as NO data. Do not substitute a guess.
- If the question is off-topic, unclear, or you cannot answer it confidently from the data — set "needs_expert": true, set "can_answer": false, and do NOT make anything up.
- "confidence" reflects how well the data supports the answer: thin data → "low".
- Be concise (2–5 sentences), specific, and grounded in the snapshot values.

Write strictly in English. Return ONE valid minified JSON object and nothing else.`
  }

  return `${persona}

ДАННЫЕ: отвечай на вопрос пользователя о ЕГО бизнесе, опираясь ТОЛЬКО на предоставленный снимок данных (контекст) — других источников у тебя нет.

ЖЁСТКИЕ ПРАВИЛА ЧЕСТНОСТИ (анти-галлюцинация):
- Используй ТОЛЬКО поля из снимка. НИКОГДА не выдумывай числа, проценты, выручку, бенчмарки или факты, которых нет в данных.
- Если поле равно null/пусто — считай, что данных НЕТ. Не подставляй догадку.
- Если вопрос не по теме, неясен, или ты не можешь ответить уверенно по данным — поставь "needs_expert": true, "can_answer": false и ничего не выдумывай.
- "confidence" отражает, насколько данные подкрепляют ответ: мало данных → "low".
- Будь кратким (2–5 предложений), конкретным и опирайся на значения из снимка.

Пиши строго по-русски. Верни ОДИН валидный минифицированный JSON-объект и ничего больше.`
}

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
 * Pull a small curated allow-list of qualitative survey answers so the model has
 * narrative context WITHOUT a raw row dump (mirrors llm-analyzer.ts).
 */
function qualitativeAnswers(answers: Record<string, unknown>, locale: Locale): string {
  const en = locale === 'en'
  const keys: Array<[string, string]> = [
    ['s2n_goal_12m_what', en ? '12-month goal' : 'Цель 12 мес'],
    ['s2n_what_blocks_growth', en ? 'What blocks growth' : 'Что мешает росту'],
    ['s3n_client_problem', en ? 'Client problem' : 'Проблема клиента'],
    ['s3n_competitor_why_us', en ? 'Why us, not competitors' : 'Почему мы, а не конкуренты'],
    ['s9n_financial_blockers', en ? 'Financial blockers' : 'Финансовые барьеры'],
    ['s10_what_depts_lack', en ? 'What departments lack' : 'Чего не хватает отделам'],
  ]
  const lines = keys
    .map(([key, label]) => {
      const v = answers?.[key]
      if (v == null) return null
      const s = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? '' : String(v)
      // Free text typed by the user — PII-mask (emails/phones/links) + cap
      // before it enters the prompt (mascot/sanitize.ts).
      const t = sanitizeQualitative(s)
      return t ? `- ${label}: ${t}` : null
    })
    .filter((x): x is string => x !== null)
  if (lines.length) return lines.join('\n')
  return en ? '— (qualitative answers not filled in)' : '— (качественные ответы не заполнены)'
}

/**
 * Serialize the curated snapshot into the canonical prompt block. Exported so
 * the multi-turn Гри chat (lib/assistant/gree-chat.ts) feeds the model the
 * exact same whitelisted view of the data as single-shot answers do.
 */
/**
 * GRI-02: render survey progress (completion %, sections done, next incomplete
 * section) so the assistant answers "мой прогресс" from real data, not guesses.
 */
export function formatSurveyProgress(completion: CompletionReport, locale: Locale): string {
  const en = locale === 'en'
  const sorted = [...completion.sections].sort((s1, s2) => s1.step - s2.step)
  const next = sorted.find((s) => s.pct < 100) ?? null
  const done = completion.sections.filter((s) => s.pct === 100).length
  const total = completion.sections.length
  return en
    ? `--- SURVEY PROGRESS ---
Filled: ${completion.overall_pct}% (${done}/${total} sections; status: ${completion.status})
Next incomplete section: ${next ? `${next.label} (step ${next.step}, ${next.pct}%)` : 'all sections complete'}`
    : `--- ПРОГРЕСС АНКЕТЫ ---
Заполнено: ${completion.overall_pct}% (${done}/${total} разделов; статус: ${completion.status})
Следующий незавершённый раздел: ${next ? `${next.label} (шаг ${next.step}, ${next.pct}%)` : 'все разделы заполнены'}`
}

export function serializeSnapshot(ctx: AssistantContext, locale: Locale): string {
  const en = locale === 'en'
  const c = ctx.company
  const a = ctx.pointA
  const b = ctx.pointB
  const g = ctx.gri
  const m = ctx.metrics

  const blockLines = a.blocks
    .map((bl) => `  - ${bl.label} (${bl.key}): ${n(bl.score)}/100 [${bl.status}]`)
    .join('\n')

  const weakest = a.weakest_blocks.map((bl) => `${bl.label} ${n(bl.score)}`).join(', ') || '—'
  const progressBlock = formatSurveyProgress(computeCompletion(ctx), locale)

  return `${en ? 'COMPANY DATA SNAPSHOT (curated — no other source).' : 'СНИМОК ДАННЫХ КОМПАНИИ (курированный — другого источника нет).'}

--- ${en ? 'COMPANY' : 'КОМПАНИЯ'} ---
${en ? 'Name' : 'Название'}: ${c.name ?? '—'}
${en ? 'Industry' : 'Отрасль'}: ${c.industry ?? '—'}
${en ? 'Stage' : 'Стадия'}: ${c.stage ?? '—'}
${en ? 'Employees' : 'Сотрудников'}: ${n(c.employee_count)}
${en ? '12-month revenue goal (₸)' : 'Цель выручки 12 мес (₸)'}: ${n(c.target_revenue_12m_kzt)}
${en ? '3-year revenue goal (₸)' : 'Цель выручки 3 года (₸)'}: ${n(c.target_revenue_3y_kzt)}

--- ${en ? 'POINT A (diagnostics)' : 'ТОЧКА А (диагностика)'} ---
${en ? 'Has diagnostics' : 'Есть диагностика'}: ${a.has_diagnostic ? (en ? 'yes' : 'да') : en ? 'no' : 'нет'}
${en ? 'Overall score' : 'Общий балл'}: ${n(a.overall_score)}/100 | Health Index: ${n(a.health_index)}/100 | ${en ? 'Stage' : 'Стадия'}: ${a.stage ?? '—'}
${en ? 'Blocks' : 'Блоки'}:
${blockLines}
${en ? 'Weakest blocks' : 'Слабейшие блоки'}: ${weakest}
${en ? 'Risks' : 'Риски'}: ${list(a.risks.map((r) => `[${r.level}] ${r.area}: ${r.text}`), 6)}
${en ? 'Data gaps (Point A)' : 'Пробелы в данных (Точка А)'}: ${list(a.data_gaps.map((x) => x.field), 8)}

--- ${en ? 'POINT B (goal / gap / realism)' : 'ТОЧКА Б (цель / разрыв / реализм)'} ---
${en ? 'Has goal' : 'Есть цель'}: ${b.has_goal ? (en ? 'yes' : 'да') : en ? 'no' : 'нет'}
${en ? 'Current revenue/year (₸)' : 'Текущая выручка/год (₸)'}: ${n(b.current_revenue_year)}
${en ? '12m goal (₸)' : 'Цель 12 мес (₸)'}: ${n(b.goal_12m_revenue_year)} | ${en ? '3y goal (₸)' : 'Цель 3 года (₸)'}: ${n(b.goal_3y_revenue_year)}
${en ? 'Gap' : 'Разрыв'}: ${en ? 'multiplier' : 'множитель'} ${n(b.gap.multiplier)}x | ${en ? 'required CAGR' : 'требуемый CAGR'} ${n(b.gap.required_cagr)}%
${en ? 'Goal realism' : 'Реализм цели'}: "${b.realism.level}", ${en ? 'score' : 'балл'} ${n(b.realism.score)}; ${en ? 'rationale' : 'обоснование'}: ${list(b.realism.rationale, 4)}
${en ? 'Data sufficiency' : 'Достаточность данных'}: ${b.data_sufficiency.sufficient ? (en ? 'sufficient' : 'достаточно') : en ? 'INSUFFICIENT' : 'НЕДОСТАТОЧНО'}
  ${en ? 'Missing' : 'Не хватает'}: ${list(b.data_sufficiency.missing, 8)}
${en ? 'Growth levers' : 'Рычаги роста'}: ${list(b.levers.map((l) => `${l.label}${l.data_available ? '' : en ? ' (no data)' : ' (нет данных)'}`), 6)}

--- GRI ---
${en ? 'Has GRI assessment' : 'Есть оценка GRI'}: ${g.has_assessment ? (en ? 'yes' : 'да') : en ? 'no' : 'нет'} | ${en ? 'GRI index (0–10)' : 'Индекс GRI (0–10)'}: ${n(g.gri_index)}
${en ? 'Top-5 GRI limits' : 'Топ-5 ограничений GRI'}: ${list(g.top_5_limits.map((t) => `${t.rank}. ${t.title} [${t.block}]`), 5)}

--- ${en ? 'METRICS' : 'МЕТРИКИ'} ---
${en ? 'Canonical revenue (₸)' : 'Каноническая выручка (₸)'}: ${n(m.revenue)} (${en ? 'year' : 'год'}: ${n(m.revenue_year)})

${progressBlock}

--- ${en ? 'QUALITATIVE ANSWERS (from the survey)' : 'КАЧЕСТВЕННЫЕ ОТВЕТЫ (из анкеты)'} ---
${qualitativeAnswers(ctx.answers ?? {}, locale)}`
}

/**
 * Build the user prompt from the curated snapshot ONLY + the user's question.
 * Every numeric slot is rendered via n()/list() so a null surfaces as '—'.
 */
function buildUserPrompt(ctx: AssistantContext, question: string, locale: Locale): string {
  const en = locale === 'en'
  const snapshot = serializeSnapshot(ctx, locale)

  const task = en
    ? `--- USER QUESTION ---
"${question}"

--- TASK ---
Answer the question using ONLY the snapshot above. If the question is off-topic for this business data, unclear, or cannot be answered confidently from the data — set "needs_expert": true and "can_answer": false, leave "answer" empty, and do not invent anything.

--- OUTPUT FORMAT ---
Return ONE valid minified JSON object (no markdown, no comments):`
    : `--- ВОПРОС ПОЛЬЗОВАТЕЛЯ ---
"${question}"

--- ЗАДАЧА ---
Ответь на вопрос ТОЛЬКО по снимку выше. Если вопрос не по теме этих данных о бизнесе, неясен, или ответить уверенно по данным нельзя — поставь "needs_expert": true и "can_answer": false, оставь "answer" пустым и ничего не выдумывай.

--- ФОРМАТ ВЫВОДА ---
Верни ОДИН валидный минифицированный JSON-объект (без markdown, без комментариев):`

  return `${snapshot}

${task}
{
  "can_answer": true,
  "answer": "${en ? 'string' : 'строка'}",
  "confidence": "high",
  "needs_expert": false
}`
}

// ─── answerUserQuestion ──────────────────────────────────────────────────────

/**
 * Answer a free-text user question over the curated snapshot.
 *
 * Returns the validated {@link UserAnswer}, or `null` honestly when there is no
 * OPENROUTER_API_KEY or the request/parse fails after the structured helper's
 * internal retry. The caller MUST treat `null` exactly like `needs_expert: true`
 * (escalate to a human) — never fabricate an answer.
 *
 * Never throws.
 */
export async function answerUserQuestion(
  ctx: AssistantContext,
  question: string,
  locale: Locale = 'ru',
): Promise<UserAnswer | null> {
  if (!hasOpenRouterKey()) {
    console.warn('[assistant:answer] No OPENROUTER_API_KEY — escalating to expert')
    return null
  }

  try {
    const result = await generateObjectViaOpenRouter({
      label: 'assistant:answer',
      complexity: 'high', // reasoning over the snapshot to decide can_answer/needs_expert.
      maxTokens: 700, // bounded: a short answer + the verdict flags.
      temperature: 0.2, // low: keep it grounded in the snapshot.
      schema: answerSchema,
      system: buildSystem(locale),
      user: buildUserPrompt(ctx, question, locale),
    })

    if (!result) return null

    // Last-line output filter: redact secret-shaped substrings / markup the
    // model may have been tricked into echoing (mascot/output-filter.ts).
    const filtered = filterModelOutput(result.answer)
    if (filtered.redacted) {
      console.warn('[assistant:answer] output filter redacted model answer content')
    }
    return { ...result, answer: filtered.text }
  } catch (error) {
    console.error('[assistant:answer] failed:', error)
    return null
  }
}
