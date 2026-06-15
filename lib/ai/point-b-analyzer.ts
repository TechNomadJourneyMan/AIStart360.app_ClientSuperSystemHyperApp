import { z } from 'zod'
import { chatWithOpenRouter, hasOpenRouterKey, extractJson, OPENROUTER_MODELS } from './openrouter'
import type { PointA } from '@/types/onboarding'
import type { PointB } from '@/types/point-b'

/**
 * Point B AI Analyzer — Bridges the gap between Current (A) and Target (B)
 */

const pointBAISchema = z.object({
  strategic_bridge_summary: z.string().describe('Обзор перехода из Точки А в Точку Б (3-5 предложений)'),
  gap_analysis: z.array(z.object({
    title: z.string().describe('Область разрыва (например, "Финансовая прозрачность")'),
    gap: z.string().describe('В чем именно заключается разрыв'),
    action: z.string().describe('Конкретное действие для закрытия'),
    priority_level: z.enum(['Приоритет 1', 'Приоритет 2', 'Приоритет 3']),
    icon: z.string().describe('Material Symbol Name (e.g. "priority_high", "group", "automation")'),
    color: z.enum(['primary', 'error', 'tertiary-container'])
  })).length(3),
  milestones: z.array(z.object({
    q: z.string().describe('Квартал (например, Q2 2026)'),
    title: z.string().describe('Заголовок вехи'),
    desc: z.string().describe('Описание достижений'),
    icon: z.string().describe('Material Symbol Name'),
    status: z.enum(['current', 'planned', 'future'])
  })).length(4)
})

export async function analyzePointB(
  answers: Record<string, unknown>,
  pointA: PointA,
  pointBBase: PointB,
  company: Record<string, unknown> | null
): Promise<Record<string, unknown> | null> {
  if (!hasOpenRouterKey()) {
    console.warn('[point-b-analyzer] No OPENROUTER_API_KEY — skipping AI bridge analysis')
    return null
  }

  try {
    const prompt = `
Анализируй переход компании из Точки А (Текущее состояние) в Точку Б (Целевое состояние).

--- КОМПАНИЯ ---
Название: ${company?.name || answers['s1_company_name']}
Отрасль: ${company?.industry || answers['s1_industry']}
Стадия: ${pointA.stage} (GRI: ${pointA.overall_score}/100)

--- ТОЧКА А (ГДЕ МЫ СЕЙЧАС) ---
Финансы: ${pointA.blocks.finance.score}/100. Проблемы: ${pointA.blocks.finance.top_issues.join(', ')}
Продажи: ${pointA.blocks.sales.score}/100. Проблемы: ${pointA.blocks.sales.top_issues.join(', ')}
Операции: ${pointA.blocks.operations.score}/100. Проблемы: ${pointA.blocks.operations.top_issues.join(', ')}
Риски: ${pointA.risks.map(r => r.text).join('; ')}

--- ТОЧКА Б (КУДА МЫ ИДЕМ - ЦЕЛИ) ---
Цель на 12 месяцев: ${answers['s6_goal_12months']}
Цель на 3 года: ${answers['s6_goal_3years']}
Проекция выручки 2025: ${pointBBase.target_kpis?.find((t: { label: string }) => t.label.includes('Выручка'))?.target ?? '—'}
Целевой GRI: 85+ (Excellent)

--- ЗАДАЧА ---
Сгенерируй Gap-анализ и Дорожную карту (milestones).
Будь предельно конкретен. Если в Точке А нет CRM — в Gap-анализе должен быть пункт про CRM. 
Если цель — рост в 2 раза, в Roadmap должны быть шаги по масштабированию маркетинга.
Язык: Русский.
`

    const raw = await chatWithOpenRouter({
      system: `Ты — ведущий стратег AIStart360. Твоя роль — построить мост между текущим хаосом (Точка А) и масштабируемым бизнесом (Точка Б).
Используй данные скоринга Точки А для выявления реальных препятствий.
Ответь СТРОГО валидным JSON по схеме, без markdown и пояснений:
{"strategic_bridge_summary": string, "gap_analysis": [{"title": string, "gap": string, "action": string, "priority_level": "Приоритет 1"|"Приоритет 2"|"Приоритет 3", "icon": string, "color": "primary"|"error"|"tertiary-container"}] (ровно 3 элемента), "milestones": [{"q": string, "title": string, "desc": string, "icon": string, "status": "current"|"planned"|"future"}] (ровно 4 элемента)}`,
      user: prompt,
      model: OPENROUTER_MODELS.sonnet,
      jsonMode: true,
      maxTokens: 1500,
    })
    if (!raw) return null
    const parsed = pointBAISchema.safeParse(extractJson(raw))
    if (!parsed.success) {
      console.error('[point-b-analyzer] schema validation failed:', parsed.error.message)
      return null
    }
    const object = parsed.data

    return {
      gap_analysis: object.gap_analysis.map(g => ({
        label: g.priority_level,
        title: g.title,
        gap: g.gap,
        action: g.action,
        icon: g.icon,
        color: g.color as any
      })),
      milestones: object.milestones
    }
  } catch (error) {
    console.error('[point-b-analyzer] AI bridge analysis failed:', error)
    return null
  }
}
