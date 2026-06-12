/**
 * AI generator for «Анализ рынка» (50-question market checklist).
 *
 * Produces a per-question DRAFT answer for all 50 questions, GROUNDED in real
 * context (the user's survey + — when configured — the Mark-analytics upstream).
 * The model is instructed to answer «Данных недостаточно» whenever the context
 * doesn't support a real answer; those are saved too (clearly low-confidence).
 *
 * Never fabricates: if there is no OpenRouter key the caller returns a 503.
 */
import { z } from 'zod'
import {
  chatWithOpenRouter,
  extractJson,
  OPENROUTER_MODELS,
} from '@/lib/ai/openrouter'
import { ALL_QUESTIONS, ALL_QUESTION_KEYS } from './questions'
import { INSUFFICIENT_DATA } from './snapshot'

export const MARKET_GEN_MODEL = OPENROUTER_MODELS.sonnet

// ---------------------------------------------------------------------------
// Context that grounds the generation
// ---------------------------------------------------------------------------

export interface MarketGenContext {
  industry: string | null
  niche: string | null
  city: string | null
  regions: string[]
  competitors: string[]
  /** Optional upstream blobs (analytics overview, distribution, companies, news). */
  upstream?: {
    analyticsOverview?: unknown
    industryDistribution?: unknown
    companies?: unknown
    news?: unknown
  }
}

// ---------------------------------------------------------------------------
// Zod schema for the model response
// ---------------------------------------------------------------------------

const answerItemSchema = z.object({
  key: z.string().min(2).max(4),
  answer: z.string().min(1).max(1200),
  confidence: z.number().min(0).max(1).optional().default(0.3),
})

const responseSchema = z.object({
  answers: z.array(answerItemSchema).min(1),
})

export interface GeneratedAnswer {
  key: string
  answer: string
  confidence: number
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Ты — старший аналитик рынка AIStart360. Твоя задача — заполнить чек-лист оценки рынка из 50 вопросов (6 блоков: A. TAM/SAM/SOM, B. Рост рынка, C. Тренды, D. Барьеры входа, E. Конкуренты и их слабости, F. Сегменты ×10).

Жёсткие требования:
1. Отвечай ТОЛЬКО на основе предоставленного контекста (анкета пользователя и данные рыночной аналитики). НИЧЕГО НЕ ВЫДУМЫВАЙ.
2. Если контекст НЕ позволяет дать обоснованный ответ на вопрос — верни ровно строку «${INSUFFICIENT_DATA}» в поле answer и confidence не выше 0.2. Это нормально и ожидаемо для многих вопросов.
3. Все ответы — на русском языке, кратко и по делу (1–3 предложения). Для числовых вопросов (TAM/SAM/SOM, CAGR, CAC) указывай конкретную цифру с единицей ТОЛЬКО если она есть в контексте; иначе — «${INSUFFICIENT_DATA}».
4. confidence (0..1) — твоя уверенность, основанная на полноте контекста. Чем меньше данных, тем ниже.
5. Верни СТРОГО JSON без markdown-обёртки по схеме: {"answers":[{"key":"A1","answer":"…","confidence":0.6}, …]}. ОБЯЗАТЕЛЬНО ответь на все 50 ключей.`

function buildUserPrompt(ctx: MarketGenContext): string {
  const lines: string[] = []
  lines.push('# Контекст бизнеса (из анкеты)')
  lines.push(`Отрасль: ${ctx.industry || '(не указано)'}`)
  lines.push(`Ниша: ${ctx.niche || '(не указано)'}`)
  lines.push(`Город: ${ctx.city || '(не указано)'}`)
  lines.push(`Регионы: ${ctx.regions.length ? ctx.regions.join(', ') : '(не указано)'}`)
  lines.push(
    `Конкуренты (по словам пользователя): ${ctx.competitors.length ? ctx.competitors.join(', ') : '(не указано)'}`,
  )
  lines.push('')

  const u = ctx.upstream
  if (u && (u.analyticsOverview || u.industryDistribution || u.companies || u.news)) {
    lines.push('# Данные рыночной аналитики (реальные, из источника Mark-analytics)')
    if (u.analyticsOverview) {
      lines.push('## Обзор аналитики')
      lines.push(safeJson(u.analyticsOverview, 1500))
    }
    if (u.industryDistribution) {
      lines.push('## Распределение по отраслям')
      lines.push(safeJson(u.industryDistribution, 1200))
    }
    if (u.companies) {
      lines.push('## Компании отрасли (топ)')
      lines.push(safeJson(u.companies, 2000))
    }
    if (u.news) {
      lines.push('## Свежие новости отрасли')
      lines.push(safeJson(u.news, 2000))
    }
    lines.push('')
  } else {
    lines.push('# Данные рыночной аналитики\n(источник недоступен — опирайся только на анкету; для большинства вопросов это означает «' + INSUFFICIENT_DATA + '»)\n')
  }

  lines.push('# Вопросы чек-листа (ответь на каждый по его ключу)')
  for (const q of ALL_QUESTIONS) {
    lines.push(`${q.key}. ${q.text}`)
  }
  lines.push('')
  lines.push(
    `Верни строго JSON: {"answers":[{"key":"…","answer":"…","confidence":0..1}, …]} для всех ${ALL_QUESTION_KEYS.length} ключей.`,
  )
  return lines.join('\n')
}

function safeJson(v: unknown, max: number): string {
  let s: string
  try {
    s = JSON.stringify(v)
  } catch {
    return '(нечитаемо)'
  }
  return s.length > max ? `${s.slice(0, max)}…(обрезано)` : s
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export type GenResult =
  | { ok: true; answers: GeneratedAnswer[]; model: string }
  | { ok: false; error: string }

/**
 * Calls OpenRouter once (retry once on parse failure) and returns validated
 * per-question draft answers. Assumes the caller has already verified the key.
 */
export async function generateMarketAnswers(
  ctx: MarketGenContext,
): Promise<GenResult> {
  const userPrompt = buildUserPrompt(ctx)

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chatWithOpenRouter({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      model: MARKET_GEN_MODEL,
      maxTokens: 6000,
      temperature: 0.3,
      jsonMode: true,
    })
    if (!raw) {
      if (attempt === 0) continue
      return { ok: false, error: 'ai_unavailable' }
    }

    const parsed = extractJson<unknown>(raw)
    const normalized = Array.isArray(parsed) ? { answers: parsed } : parsed
    const validated = responseSchema.safeParse(normalized)
    if (!validated.success) {
      if (attempt === 0) continue
      return { ok: false, error: 'ai_invalid_output' }
    }

    // Keep only known keys; dedupe by key (first wins).
    const valid = new Set<string>(ALL_QUESTION_KEYS)
    const seen = new Set<string>()
    const answers: GeneratedAnswer[] = []
    for (const item of validated.data.answers) {
      const key = item.key.trim().toUpperCase()
      if (!valid.has(key) || seen.has(key)) continue
      seen.add(key)
      answers.push({
        key,
        answer: item.answer.trim(),
        confidence: clampConfidence(item.answer, item.confidence),
      })
    }
    if (answers.length === 0) {
      if (attempt === 0) continue
      return { ok: false, error: 'ai_invalid_output' }
    }
    return { ok: true, answers, model: MARKET_GEN_MODEL }
  }

  return { ok: false, error: 'ai_unavailable' }
}

/** «Данных недостаточно» answers are forced to a low confidence ceiling. */
function clampConfidence(answer: string, c: number): number {
  const isInsufficient = /данных\s+недостаточно/i.test(answer.trim())
  const bounded = Math.max(0, Math.min(1, c))
  return isInsufficient ? Math.min(bounded, 0.2) : bounded
}
