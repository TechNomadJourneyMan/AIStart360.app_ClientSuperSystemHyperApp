/**
 * Point A — AI Executive Narrative
 *
 * Generates a Russian-language executive summary (3–5 paragraphs + next steps)
 * for a Point A diagnostic via OpenRouter Claude Sonnet 4.5.
 *
 * - Uses `chatWithOpenRouter` from `@/lib/ai/openrouter` (jsonMode).
 * - Validates the response with Zod.
 * - Returns `null` on any failure. Never throws.
 */

import { z } from 'zod'
import {
  chatWithOpenRouter,
  extractJson,
  hasOpenRouterKey,
  OPENROUTER_MODELS,
} from '@/lib/ai/openrouter'
import type { PointA, BlockScore } from '@/types/onboarding'

// ─── Public types ────────────────────────────────────────────────────────────

export interface NarrativeInput {
  pointA: PointA
  companyName: string
  industry: string | null
  stage: string | null
  resolvedMetricsSummary?: {
    coverage: number
    topStrengths: Array<{ label: string; value: number | string | null; unit: string }>
    topGaps: Array<{ label: string; reason: string }>
  }
}

export interface PointANarrative {
  executive_summary: string         // 1 short paragraph
  strengths_text: string            // 1 paragraph
  weaknesses_text: string           // 1 paragraph
  risks_text: string                // 1 paragraph
  opportunities_text: string        // 1 paragraph
  next_steps: string[]              // 3–5 concrete bullets
  model_used: string
  generated_at: string
}

// ─── Zod schema for the AI JSON payload ─────────────────────────────────────

const narrativeBodySchema = z.object({
  executive_summary: z.string().min(1),
  strengths_text: z.string().min(1),
  weaknesses_text: z.string().min(1),
  risks_text: z.string().min(1),
  opportunities_text: z.string().min(1),
  next_steps: z.array(z.string().min(1)).min(3).max(5),
})

// ─── Helpers ────────────────────────────────────────────────────────────────

const BLOCK_LABELS_RU: Record<keyof PointA['blocks'], string> = {
  finance: 'Финансы',
  marketing: 'Маркетинг',
  operations: 'Операции',
  strategy: 'Стратегия',
  sales: 'Продажи',
}

const STATUS_RU: Record<BlockScore['status'], string> = {
  critical: 'критично',
  weak: 'слабо',
  average: 'средне',
  strong: 'сильно',
  excellent: 'отлично',
}

function formatBlocks(blocks: PointA['blocks']): string {
  return (Object.keys(blocks) as Array<keyof PointA['blocks']>)
    .map((key) => {
      const b = blocks[key]
      const issues = b.top_issues?.length ? ` — проблемы: ${b.top_issues.join('; ')}` : ''
      return `${BLOCK_LABELS_RU[key]}: ${b.score}/100 (${STATUS_RU[b.status]})${issues}`
    })
    .join('\n')
}

function formatList<T>(items: T[] | undefined | null, render: (item: T) => string): string {
  if (!items || items.length === 0) return '—'
  return items.map(render).join('\n')
}

function buildUserPrompt(input: NarrativeInput): string {
  const { pointA, companyName, industry, stage, resolvedMetricsSummary } = input

  const risksTxt = formatList(pointA.risks, (r) => `[${r.level}] ${r.area}: ${r.text} (влияние: ${r.impact})`)
  const insightsTxt = formatList(pointA.insights, (i) => `(${i.area}) ${i.text}`)
  const quickWinsTxt = formatList(
    pointA.quick_wins,
    (qw) => `[${qw.area}] ${qw.action} — горизонт: ${qw.timeline}`,
  )

  const metricsTxt = resolvedMetricsSummary
    ? `Покрытие данных: ${Math.round((resolvedMetricsSummary.coverage ?? 0) * 100)}%
Сильные метрики:
${formatList(
  resolvedMetricsSummary.topStrengths,
  (s) => `• ${s.label}: ${s.value ?? '—'}${s.unit ? ' ' + s.unit : ''}`,
)}
Пробелы в данных:
${formatList(resolvedMetricsSummary.topGaps, (g) => `• ${g.label} — ${g.reason}`)}`
    : 'Сводка по разрешённым метрикам отсутствует.'

  return `Данные диагностики Точки А компании "${companyName}".
Отрасль: ${industry ?? 'не указана'}.
Стадия: ${stage ?? 'не указана'}.

ОБЩИЕ ПОКАЗАТЕЛИ:
Общий балл: ${pointA.overall_score}/100
Health Index: ${pointA.health_index}/100
Стадия (по движку): ${pointA.stage}

БЛОКИ:
${formatBlocks(pointA.blocks)}

РИСКИ:
${risksTxt}

ИНСАЙТЫ:
${insightsTxt}

БЫСТРЫЕ ПОБЕДЫ:
${quickWinsTxt}

МЕТРИКИ:
${metricsTxt}

ЗАДАЧА:
Сформируй executive-сводку на русском языке в формате JSON со следующими полями (без markdown, только JSON):
{
  "executive_summary": "1 короткий абзац — общая картина бизнеса, ключевой вывод",
  "strengths_text": "1 абзац о сильных сторонах с опорой на цифры и блоки",
  "weaknesses_text": "1 абзац о слабых сторонах со ссылкой на конкретные блоки и метрики",
  "risks_text": "1 абзац о рисках (используй уровни critical/important/moderate)",
  "opportunities_text": "1 абзац о возможностях и точках роста",
  "next_steps": ["3–5 конкретных шагов с горизонтом и владельцем"]
}

Правила:
- Пиши строго на русском языке. Используй русские названия блоков и метрик.
- Тон: фактологичный, но тёплый, как у опытного консультанта для МСБ Казахстана.
- Опирайся на цифры из данных, не придумывай.
- Никаких markdown-обёрток, верни только валидный JSON.`
}

const SYSTEM_PROMPT = `Ты — senior бизнес-консультант платформы AIStart360 для МСБ Казахстана и СНГ.
Ты составляешь executive-сводку по диагностике "Точка А" компании.
Тон: фактологичный, профессиональный, но тёплый и поддерживающий — как у наставника, а не аудитора.
Пиши строго на русском языке, используй русские названия блоков (Финансы, Маркетинг, Операции, Стратегия, Продажи) и привычную МСБ-терминологию.
Опирайся ТОЛЬКО на предоставленные данные: баллы блоков, риски, инсайты, быстрые победы, сводку по метрикам.
Не выдумывай цифры и не повторяй слово в слово содержание входных полей — обобщай, добавляй смысл, расставляй приоритеты.
Если данных мало — честно отметь это и сформулируй гипотезу.
Финальный ответ — строго валидный JSON по запрошенной схеме, без markdown-кодовых блоков и без комментариев.`

// ─── Main entry point ───────────────────────────────────────────────────────

export async function generateNarrative(
  input: NarrativeInput,
): Promise<PointANarrative | null> {
  // Degrade gracefully when no API key is configured.
  if (!hasOpenRouterKey()) {
    return null
  }

  const raw = await chatWithOpenRouter({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(input),
    model: OPENROUTER_MODELS.sonnet,
    temperature: 0.5,
    maxTokens: 2500,
    jsonMode: true,
  })

  if (!raw) return null

  const parsed = extractJson<unknown>(raw)
  if (!parsed) return null

  const result = narrativeBodySchema.safeParse(parsed)
  if (!result.success) return null

  return {
    ...result.data,
    model_used: OPENROUTER_MODELS.sonnet,
    generated_at: new Date().toISOString(),
  }
}
