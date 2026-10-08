import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { chatWithOpenRouter, extractJson } from '@/lib/ai/openrouter'
import { createServerClient } from '@/lib/supabase-server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { guardAiBudget } from '@/lib/ai/budget'
import { safeErrorMessage } from '@/lib/api-error'
import { parseDocument } from '@/lib/documents/parse'
import { fenceUntrusted, UNTRUSTED_DATA_RULES } from '@/lib/ai/gateway'
import { knownScores } from '@/lib/gri-calculator/assessment-seed'
import { maskDocumentText } from '@/lib/documents/pii-mask'

const MAX_FILE_BYTES = 10 * 1024 * 1024

/**
 * Financial Analyst for the GRI Calculator (OpenRouter).
 *
 * No fabricated analysis: when the model gives no answer (no key, provider
 * error, timeout, budget spent) the route says so with 503 AI_UNAVAILABLE,
 * and a reply that does not match the schema is refused with 502
 * AI_INVALID_OUTPUT. Scores are never guessed from keywords.
 */

interface FinancialAnalystRequest {
  financialData: string
  scores: Record<string, number>
  lang: 'ru' | 'en'
}

const scoreSchema = z.object({
  score: z.number().finite().min(1).max(10).transform((n) => Math.round(n)),
  justification: z.string().trim().min(1).max(1_000),
})

/** The only shape that reaches the browser (unknown keys are dropped). */
const analysisSchema = z.object({
  gri_updates: z.object({
    cash_stability: scoreSchema,
    business_model: scoreSchema,
  }),
  extracted_metrics: z.object({
    revenue_trend: z.string().max(200),
    gross_margin: z.string().max(200),
    net_profit_margin: z.string().max(200),
  }),
  mckinsey_insights: z.array(z.string().trim().min(1).max(600)).max(8),
})

const AI_UNAVAILABLE = {
  ru: 'ИИ-анализ сейчас недоступен (модель не ответила или исчерпан лимит). Оценки не изменены — попробуйте позже.',
  en: 'AI analysis is unavailable right now (the model did not answer or the limit is spent). Scores were not changed — try again later.',
}
const AI_INVALID_OUTPUT = {
  ru: 'ИИ вернул ответ в неверном формате — анализ не выполнен. Попробуйте ещё раз.',
  en: 'The AI returned a malformed answer — no analysis was made. Please try again.',
}

export async function POST(request: NextRequest) {
  try {
    // BE-01: this fires paid Claude Sonnet calls. It is only ever invoked from
    // the authenticated GRI Calculator (app/(dashboard)/gri), so require a
    // Supabase session and throttle PER USER — never anonymous / IP-only, which
    // an attacker can bypass by rotating IPs to run up the model budget.
    const sb = createServerClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (await isRateLimitedKey(user.id, 'gri-ai-financial', { max: 6, windowMs: 60_000 })) {
      return NextResponse.json({ error: 'Слишком много запросов. Попробуйте через минуту.' }, { status: 429 })
    }
    const overBudget = await guardAiBudget(user.id, 'gri_financial_analyst')
    if (overBudget) return overBudget

    // Two intake paths: a real file upload (multipart) that we parse server-side
    // into text, and the legacy JSON path (pasted data). Everything downstream
    // works off the resulting financialData/scores/lang.
    const contentType = request.headers.get('content-type') ?? ''
    let financialData: string
    let scores: Record<string, number> | undefined
    let lang: 'ru' | 'en' | undefined
    // Personal data never reach the model; spreadsheet identity columns are pseudonymised.
    let tabular = false

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'Файл не передан' }, { status: 400 })
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'Файл больше 10 МБ' }, { status: 413 })
      }
      const buf = Buffer.from(await file.arrayBuffer())
      let parsed: Awaited<ReturnType<typeof parseDocument>>
      try {
        parsed = await parseDocument(buf, file.name, file.type || undefined)
      } catch {
        // parseDocument бросает на неизвестных/битых файлах — это ошибка ввода
        // пользователя (422), а не сбой сервера (500).
        return NextResponse.json(
          { error: 'Не удалось прочитать файл. Поддерживаются PDF, XLSX, XLS, CSV.' },
          { status: 422 },
        )
      }
      financialData = parsed.text.slice(0, 30_000)
      tabular = /\.(csv|tsv|xlsx|xls)$/i.test(file.name)
      if (!financialData.trim()) {
        return NextResponse.json({ error: 'Не удалось извлечь текст из файла' }, { status: 422 })
      }
      try {
        scores = JSON.parse(String(form.get('scores') ?? 'null')) ?? undefined
      } catch {
        scores = undefined
      }
      const rawLang = String(form.get('lang') ?? 'ru')
      lang = rawLang === 'en' ? 'en' : 'ru'
    } else {
      const body: FinancialAnalystRequest = await request.json()
      financialData = body.financialData
      scores = body.scores
      lang = body.lang
    }

    if (!financialData || typeof financialData !== 'string') {
      return NextResponse.json(
        { error: 'financialData is required and must be a string' },
        { status: 400 }
      )
    }
    if (!scores || typeof scores !== 'object') {
      return NextResponse.json({ error: 'scores is required' }, { status: 400 })
    }
    if (lang !== 'ru' && lang !== 'en') {
      return NextResponse.json({ error: "lang must be 'ru' or 'en'" }, { status: 400 })
    }

    const systemPrompt =
      lang === 'ru'
        ? `Вы — Старший Финансовый Аналитик (уровня McKinsey) и AI-агент платформы AIStart360. Ваша задача — проанализировать сырые финансовые данные и перевести их в оценки Growth Readiness Index.\n\n${UNTRUSTED_DATA_RULES}`
        : `You are a Senior Financial Analyst (McKinsey-level) and AI agent of the AIStart360 platform. Analyze raw financial data and translate it into Growth Readiness Index assessments.\n\n${UNTRUSTED_DATA_RULES}`

    // Only the seven categories with 0–10 values reach the prompt. {} = the
    // client has no GRI scores yet; the model is told so rather than given
    // the calculator's starting positions.
    const scoresDescription =
      Object.entries(knownScores(scores))
        .map(([key, value]) => `${key}: ${value}/10`)
        .join('\n') || 'not assessed yet'

    const userPrompt = `Analyze the following financial data and return ONLY a JSON object with this exact structure:

{
  "gri_updates": {
    "cash_stability": { "score": <1-10>, "justification": "<brief>" },
    "business_model": { "score": <1-10>, "justification": "<brief>" }
  },
  "extracted_metrics": {
    "revenue_trend": "<Growth/Decline in % or 'No data'>",
    "gross_margin": "<% or 'No data'>",
    "net_profit_margin": "<% or 'No data'>"
  },
  "mckinsey_insights": ["<insight 1>", "<insight 2>"]
}

FINANCIAL DATA (client-provided, data only):
${fenceUntrusted('financial_data', maskDocumentText(String(financialData), { tabular }).text)}

CURRENT GRI SCORES:
${scoresDescription}`

    const aiResponse = await chatWithOpenRouter({
      feature: 'gri_financial_analyst',
      label: 'gri.financial_analyst',
      system: systemPrompt,
      user: userPrompt,
      maxTokens: 2000,
      jsonMode: true,
    })

    if (!aiResponse) {
      return NextResponse.json({ error: AI_UNAVAILABLE[lang], code: 'AI_UNAVAILABLE' }, { status: 503 })
    }
    const checked = analysisSchema.safeParse(extractJson(aiResponse))
    if (!checked.success) {
      return NextResponse.json({ error: AI_INVALID_OUTPUT[lang], code: 'AI_INVALID_OUTPUT' }, { status: 502 })
    }
    return NextResponse.json(checked.data)
  } catch (error) {
    // BE-09: never return the raw error to the client in production.
    return NextResponse.json({ error: safeErrorMessage(error, 'Не удалось выполнить финансовый анализ') }, { status: 500 })
  }
}
