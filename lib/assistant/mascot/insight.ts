/**
 * lib/assistant/mascot/insight.ts — AI-generated screen insights (OpenRouter).
 *
 * Produces ONE short, grounded observation for the user's CURRENT screen from
 * the curated AssistantContext — the only LLM-powered piece of the proactive
 * mascot (scripted hints stay deterministic). Honesty contract matches
 * answer.ts: snapshot-only facts, no invented numbers, `null` on any failure
 * so the caller degrades silently instead of fabricating.
 */

import { generateObjectViaOpenRouter, hasOpenRouterKey } from '@/lib/ai/structured'
import { z } from 'zod'
import type { Locale } from '@/lib/i18n/locale'
import type { AssistantContext } from '../types'
import { mascotPersona } from './system-prompt'
import { filterModelOutput } from './output-filter'
import type { MascotCharacterId } from './characters'

const insightSchema = z.object({
  insight: z
    .string()
    .min(1)
    .describe('Один короткий инсайт (≤160 символов) по данным снимка, на языке пользователя'),
  can_generate: z
    .boolean()
    .describe('false если данных в снимке недостаточно для честного инсайта'),
})

export interface ScreenInsight {
  text: string
}

// Exported so the chat (gree-chat) can inject the same screen focus (GRI-01).
export const SCREEN_FOCUS: Record<string, string> = {
  '/dashboard': 'общая картина бизнеса и самый важный следующий шаг',
  '/client/dashboard': 'общая картина бизнеса и самый важный следующий шаг',
  '/gri': 'GRI-индекс, его главные ограничения и что даст самый быстрый прирост',
  '/pulse': 'динамика GRI и на какой блок обратить внимание',
  '/client/point-a': 'слабейшие блоки Точки А и с чего начать',
  '/point-a': 'слабейшие блоки Точки А и с чего начать',
  '/client/point-b': 'реалистичность цели и требуемый темп роста',
  '/point-b': 'реалистичность цели и требуемый темп роста',
  '/metrics': 'ключевые метрики и пробелы в данных',
  '/client/onboarding': 'какие незаполненные разделы анкеты сильнее всего влияют на точность',
}

/** Compact, whitelisted serialization of the snapshot (numbers only, no PII). */
function serializeForInsight(ctx: AssistantContext): string {
  const g = ctx.gri
  const a = ctx.pointA
  const b = ctx.pointB
  const lines = [
    `Компания: отрасль=${ctx.company.industry ?? '—'}, стадия=${ctx.company.stage ?? '—'}`,
    `Точка А: есть=${a.has_diagnostic ? 'да' : 'нет'}, health=${a.health_index ?? '—'}/100, слабые блоки=${a.weakest_blocks.map((x) => `${x.label}:${x.score ?? '—'}`).join(', ') || '—'}`,
    `GRI: индекс=${g.gri_index ?? '—'}/10, ограничения=${g.top_5_limits.slice(0, 3).map((t) => t.title).join('; ') || '—'}`,
    `Точка B: цель=${b.has_goal ? 'есть' : 'нет'}, реализм=${b.realism.level}, множитель=${b.gap.multiplier ?? '—'}x, требуемый CAGR=${b.gap.required_cagr ?? '—'}%`,
    `Данных не хватает: ${b.data_sufficiency.missing.slice(0, 5).join('; ') || '—'}`,
    `Выручка/год (₸): ${ctx.metrics.revenue ?? '—'}`,
  ]
  return lines.join('\n')
}

/**
 * Generate one grounded insight for `screen`. Returns null when there is no
 * key, the model refuses (can_generate=false) or the call fails — callers show
 * nothing rather than something invented.
 */
export async function buildScreenInsight(
  ctx: AssistantContext,
  screen: string,
  locale: Locale = 'ru',
  character?: MascotCharacterId,
): Promise<ScreenInsight | null> {
  if (!hasOpenRouterKey()) return null

  const focus = SCREEN_FOCUS[screen] ?? 'самое важное наблюдение по данным диагностики'

  const system = `${mascotPersona(locale, character)}

ЗАДАЧА: сгенерируй ОДИН короткий инсайт (максимум 160 символов) для экрана платформы.
Фокус экрана: ${focus}.
- Только факты из снимка ниже; числа бери ТОЛЬКО из снимка, ничего не выдумывай.
- Если данных мало — честно поставь can_generate=false.
- Тон Гри: тёплый, конкретный, без давления; закончи мыслью, что проверить или сделать.
Верни ОДИН валидный минифицированный JSON-объект и ничего больше.`

  const user = `СНИМОК ДАННЫХ (единственный источник):
${serializeForInsight(ctx)}

ФОРМАТ ВЫВОДА:
{"insight": "строка", "can_generate": true}`

  try {
    const result = await generateObjectViaOpenRouter({
      label: 'mascot:insight',
      complexity: 'low', // one short line — the fast tier is enough.
      maxTokens: 300,
      temperature: 0.5,
      schema: insightSchema,
      system,
      user,
    })
    if (!result || !result.can_generate || !result.insight.trim()) return null

    const filtered = filterModelOutput(result.insight.trim())
    const text = filtered.text.slice(0, 200)
    return text ? { text } : null
  } catch (error) {
    console.error('[mascot:insight] failed:', error)
    return null
  }
}
