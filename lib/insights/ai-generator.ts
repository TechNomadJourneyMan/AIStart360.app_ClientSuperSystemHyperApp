/**
 * AI generator for the Point A "Уточняющие вопросы" feed.
 *
 * Pulls the latest Point A snapshot for the user (diagnostics + survey_answers
 * + recent metrics) and asks OpenRouter's Claude Sonnet 4.5 to emit a small
 * batch of clarifying questions, each with a *predicted* answer the client
 * is invited to confirm. Output is validated with Zod before it leaves
 * this module.
 *
 * Never throws — returns `{ ok: false, error }` on any failure so route
 * handlers can degrade gracefully.
 */
import { z } from 'zod'
import {
  chatWithOpenRouter,
  extractJson,
  hasOpenRouterKey,
  OPENROUTER_MODELS,
} from '@/lib/ai/openrouter'
import type { SupabaseClient } from '@supabase/supabase-js'

export const INSIGHTS_PROMPT_VERSION = 'point-a-insights-v1'
export const INSIGHTS_MODEL = OPENROUTER_MODELS.sonnet

/**
 * Canonical Russian categories the UI knows how to render. The model is
 * instructed to pick from this list; if it returns something else we still
 * pass it through (front-end falls back to a default bucket).
 */
export const INSIGHT_CATEGORIES = [
  'ВЫРУЧКА',
  'СТРАТЕГИЯ',
  'ВОРОНКА',
  'КЛИЕНТЫ',
  'ОРГСТРУКТУРА',
  'КОНКУРЕНТЫ',
  'ФИНАНСЫ',
  'МАРКЕТИНГ',
  'ПРОДУКТ',
  'ОПЕРАЦИИ',
] as const

// ---------------------------------------------------------------------------
// Zod schema for the model response
// ---------------------------------------------------------------------------

const insightItemSchema = z.object({
  category: z.string().min(1).max(64),
  question_text: z.string().min(8).max(600),
  predicted_answer: z.string().min(1).max(1200),
  confidence: z.number().min(0).max(1).optional().default(0.5),
})

const insightsResponseSchema = z.object({
  items: z.array(insightItemSchema).min(1).max(8),
})

export type AiInsightItem = z.infer<typeof insightItemSchema>

// ---------------------------------------------------------------------------
// Snapshot loader
// ---------------------------------------------------------------------------

interface Snapshot {
  diagnostic: Record<string, unknown> | null
  surveyAnswers: Array<{ question_key: string; answer: unknown }>
  recentMetrics: Array<{
    metric_key: string
    value_numeric: number | null
    value_text: string | null
    period_year: number | null
    period_quarter: number | null
  }>
  company: Record<string, unknown> | null
}

async function loadSnapshot(sb: SupabaseClient, userId: string): Promise<Snapshot> {
  // Diagnostic (current row only).
  const { data: diagnostic } = await sb
    .from('diagnostics')
    .select('overall_score, stage, finance_score, marketing_score, operations_score, strategy_score, sales_score, risks, insights, quick_wins, data_gaps')
    .eq('user_id', userId)
    .eq('is_current', true)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Survey answers — all rows for this user (one row per question_key).
  const { data: survey } = await sb
    .from('survey_answers')
    .select('question_key, answer')
    .eq('user_id', userId)
    .order('answered_at', { ascending: false })
    .limit(120)

  // Company snapshot (revenue targets / vertical / branding live here).
  const { data: company } = await sb
    .from('companies')
    .select('id, name, vertical, employee_count, monthly_revenue, target_revenue_12m, target_revenue_3y')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  // Recent metrics — keep payload tight, the model just needs signal.
  let recentMetrics: Snapshot['recentMetrics'] = []
  if (company?.id) {
    const { data: metrics } = await sb
      .from('metrics')
      .select('metric_key, value_numeric, value_text, period_year, period_quarter')
      .eq('company_id', company.id)
      .order('period_year', { ascending: false })
      .order('period_quarter', { ascending: false })
      .limit(40)
    recentMetrics = (metrics ?? []) as Snapshot['recentMetrics']
  }

  return {
    diagnostic: (diagnostic as Record<string, unknown> | null) ?? null,
    surveyAnswers: (survey ?? []) as Snapshot['surveyAnswers'],
    recentMetrics,
    company: (company as Record<string, unknown> | null) ?? null,
  }
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Ты — старший бизнес-аналитик AIStart360. Твоя задача — сгенерировать 3-6 уточняющих вопросов, которые помогут клиенту дозаполнить "Точку А" своего бизнеса (текущее состояние). Каждый вопрос должен сопровождаться ПРЕДПОЛАГАЕМЫМ ответом, который клиент сможет подтвердить или скорректировать одним кликом.

Жёсткие требования:
1. ВСЁ возвращай на русском языке. Никаких английских слов, кроме общеупотребимых аббревиатур (CRM, KPI, LTV, CAC).
2. Выбирай категорию из списка: ВЫРУЧКА, СТРАТЕГИЯ, ВОРОНКА, КЛИЕНТЫ, ОРГСТРУКТУРА, КОНКУРЕНТЫ, ФИНАНСЫ, МАРКЕТИНГ, ПРОДУКТ, ОПЕРАЦИИ.
3. Вопрос должен быть КОНКРЕТНЫМ (числа, периоды, проценты, имена систем). Никаких "Расскажите подробнее о вашем бизнесе".
4. predicted_answer — это конкретное предположение, основанное на данных пользователя, в форме "Скорее всего, X — Y" или просто утвердительное предложение. 1-3 предложения.
5. Не повторяй информацию, которая уже есть в survey_answers / diagnostic / metrics. Закрывай пробелы, не дублируй известное.
6. confidence — твоя уверенность 0..1. Чем меньше данных — тем ниже.
7. Возвращай СТРОГО JSON без markdown-обёртки, по схеме: {"items":[{"category":"…","question_text":"…","predicted_answer":"…","confidence":0.7}, …]}.`

function buildUserPrompt(snapshot: Snapshot): string {
  const lines: string[] = []
  lines.push('Снимок данных клиента:')
  lines.push('')

  if (snapshot.company) {
    lines.push('## Компания')
    lines.push(JSON.stringify(snapshot.company, null, 2))
    lines.push('')
  } else {
    lines.push('## Компания\n(нет данных)\n')
  }

  if (snapshot.diagnostic) {
    lines.push('## Диагностика (текущая)')
    lines.push(JSON.stringify(snapshot.diagnostic, null, 2))
    lines.push('')
  } else {
    lines.push('## Диагностика\n(не проводилась)\n')
  }

  if (snapshot.surveyAnswers.length > 0) {
    lines.push(`## Ответы опросника (${snapshot.surveyAnswers.length} шт.)`)
    // Cap to keep token budget sane — first 40 are usually the most informative.
    const slice = snapshot.surveyAnswers.slice(0, 40)
    for (const row of slice) {
      const ans =
        typeof row.answer === 'string'
          ? row.answer
          : JSON.stringify(row.answer)
      lines.push(`- ${row.question_key}: ${ans}`)
    }
    lines.push('')
  } else {
    lines.push('## Ответы опросника\n(нет данных)\n')
  }

  if (snapshot.recentMetrics.length > 0) {
    lines.push(`## Свежие метрики (${snapshot.recentMetrics.length} шт.)`)
    for (const m of snapshot.recentMetrics.slice(0, 30)) {
      const period = m.period_quarter
        ? `${m.period_year}Q${m.period_quarter}`
        : m.period_year ?? '—'
      const value = m.value_numeric ?? m.value_text ?? '—'
      lines.push(`- [${period}] ${m.metric_key} = ${value}`)
    }
    lines.push('')
  } else {
    lines.push('## Свежие метрики\n(нет данных)\n')
  }

  lines.push(
    'Сгенерируй 3-6 уточняющих вопросов с предполагаемыми ответами. Верни строго JSON по описанной схеме.'
  )
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface GenerateOk {
  ok: true
  items: AiInsightItem[]
  meta: {
    model: string
    prompt_version: string
  }
}

export interface GenerateErr {
  ok: false
  error: string
}

export type GenerateResult = GenerateOk | GenerateErr

export async function generatePointAInsights(
  sb: SupabaseClient,
  userId: string
): Promise<GenerateResult> {
  if (!hasOpenRouterKey()) {
    return { ok: false, error: 'AI key not configured' }
  }

  let snapshot: Snapshot
  try {
    snapshot = await loadSnapshot(sb, userId)
  } catch {
    // Do not leak DB error text — could carry PII (emails, ids).
    return { ok: false, error: 'Failed to load Point A snapshot' }
  }

  const userPrompt = buildUserPrompt(snapshot)

  const raw = await chatWithOpenRouter({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    model: INSIGHTS_MODEL,
    maxTokens: 1800,
    temperature: 0.6,
    jsonMode: true,
  })

  if (!raw) {
    return { ok: false, error: 'AI service unavailable' }
  }

  const parsed = extractJson<unknown>(raw)
  if (!parsed) {
    return { ok: false, error: 'AI returned non-JSON output' }
  }

  // extractJson returns the first {...} block — but our schema is { items: [...] }.
  // If the model wrapped the array directly, coerce.
  const normalized =
    Array.isArray(parsed) ? { items: parsed } : (parsed as Record<string, unknown>)

  const validated = insightsResponseSchema.safeParse(normalized)
  if (!validated.success) {
    return { ok: false, error: 'AI output failed schema validation' }
  }

  return {
    ok: true,
    items: validated.data.items,
    meta: {
      model: INSIGHTS_MODEL,
      prompt_version: INSIGHTS_PROMPT_VERSION,
    },
  }
}
