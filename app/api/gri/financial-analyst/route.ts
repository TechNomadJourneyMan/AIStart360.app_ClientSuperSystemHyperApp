import { NextRequest, NextResponse } from 'next/server'
import { chatWithOpenRouter, extractJson } from '@/lib/ai/openrouter'
import { createServerClient } from '@/lib/supabase-server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { safeErrorMessage } from '@/lib/api-error'
import { parseDocument } from '@/lib/documents/parse'

const MAX_FILE_BYTES = 10 * 1024 * 1024

/**
 * Financial Analyst for the GRI Calculator.
 * Uses OpenRouter (Claude Sonnet 4.5) if OPENROUTER_API_KEY is set,
 * else returns a heuristic analysis.
 */

interface FinancialAnalystRequest {
  financialData: string
  scores: Record<string, number>
  lang: 'ru' | 'en'
}

function buildStaticAnalysis(data: string, lang: 'ru' | 'en') {
  // Simple heuristic looking for numbers/keywords in the pasted data
  const hasRevenue = /revenue|выручк|доход/i.test(data)
  const hasLoss = /loss|убыт|отрицат/i.test(data)
  const hasGrowth = /growth|рост|\+\d+%/i.test(data)

  const cashScore = hasLoss ? 3 : hasRevenue && hasGrowth ? 7 : 5
  const bmScore = hasGrowth ? 7 : 5

  if (lang === 'ru') {
    return {
      gri_updates: {
        cash_stability: {
          score: cashScore,
          justification: hasLoss
            ? 'Обнаружены признаки убытков в данных. Требуется ревизия расходов и работа с кассовым потоком.'
            : 'Базовая оценка на основе общих метрик. Для точного анализа подключите AI через OPENROUTER_API_KEY.',
        },
        business_model: {
          score: bmScore,
          justification: hasGrowth
            ? 'Видны признаки роста выручки — модель демонстрирует масштабируемость.'
            : 'Модель работает, но нет явных признаков роста. Проверьте монетизацию и CAC/LTV.',
        },
      },
      extracted_metrics: {
        revenue_trend: hasGrowth ? 'Рост' : 'Нет данных',
        gross_margin: 'Нет данных',
        net_profit_margin: hasLoss ? 'Отрицательная' : 'Нет данных',
      },
      mckinsey_insights: [
        'Для детального анализа добавьте переменную окружения OPENROUTER_API_KEY.',
        hasLoss
          ? 'Приоритет: стабилизация cash flow и сокращение непроизводительных расходов.'
          : 'Приоритет: зафиксировать юнит-экономику и масштабировать ROI-каналы.',
      ],
    }
  }

  return {
    gri_updates: {
      cash_stability: {
        score: cashScore,
        justification: hasLoss
          ? 'Signs of losses detected. Expense review and cash flow work required.'
          : 'Baseline score from overall metrics. For a precise analysis, set OPENROUTER_API_KEY.',
      },
      business_model: {
        score: bmScore,
        justification: hasGrowth
          ? 'Revenue growth signals visible — model shows scalability.'
          : 'Model is running, but no clear growth. Review monetization and CAC/LTV.',
      },
    },
    extracted_metrics: {
      revenue_trend: hasGrowth ? 'Growth' : 'No data',
      gross_margin: 'No data',
      net_profit_margin: hasLoss ? 'Negative' : 'No data',
    },
    mckinsey_insights: [
      'For a detailed analysis, set the OPENROUTER_API_KEY environment variable.',
      hasLoss
        ? 'Priority: stabilize cash flow and cut non-productive expenses.'
        : 'Priority: lock in unit economics and scale ROI-positive channels.',
    ],
  }
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

    // Two intake paths: a real file upload (multipart) that we parse server-side
    // into text, and the legacy JSON path (pasted data). Everything downstream
    // works off the resulting financialData/scores/lang.
    const contentType = request.headers.get('content-type') ?? ''
    let financialData: string
    let scores: Record<string, number> | undefined
    let lang: 'ru' | 'en' | undefined

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
        ? `Вы — Старший Финансовый Аналитик (уровня McKinsey) и AI-агент платформы AIStart360. Ваша задача — проанализировать сырые финансовые данные и перевести их в оценки Growth Readiness Index.`
        : `You are a Senior Financial Analyst (McKinsey-level) and AI agent of the AIStart360 platform. Analyze raw financial data and translate it into Growth Readiness Index assessments.`

    const scoresDescription = Object.entries(scores)
      .map(([key, value]) => `${key}: ${value}/10`)
      .join('\n')

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

FINANCIAL DATA:
${financialData}

CURRENT GRI SCORES:
${scoresDescription}`

    const aiResponse = await chatWithOpenRouter({
      system: systemPrompt,
      user: userPrompt,
      maxTokens: 2000,
      jsonMode: true,
    })

    if (aiResponse) {
      const parsed = extractJson(aiResponse)
      if (parsed) return NextResponse.json(parsed)
    }

    return NextResponse.json(buildStaticAnalysis(financialData, lang))
  } catch (error) {
    // BE-09: never return the raw error to the client in production.
    return NextResponse.json({ error: safeErrorMessage(error, 'Не удалось выполнить финансовый анализ') }, { status: 500 })
  }
}
