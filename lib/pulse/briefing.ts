/**
 * lib/pulse/briefing.ts — the Pulse morning briefing, done like every other AI
 * feature (F-072, idea M16):
 *   - through the shared OpenRouter client (Anthropic Haiku, usage accounting),
 *     not a direct fetch to Gemini;
 *   - rate-limited per user (10 generations / hour);
 *   - cached per user per day (`ai_briefing_cache`, migration 091) — the
 *     briefing is a daily text, re-generating it on every page load was waste;
 *   - passed through the answer validator; a rejected text is shown as the
 *     safe template and is NOT cached.
 */

import { chatWithOpenRouter, OPENROUTER_MODELS } from '@/lib/ai/openrouter'
import { validateAiText, type AiTextValidationMeta } from '@/lib/ai/validation/apply'

export const PULSE_BRIEFING_RATE_LIMIT = { max: 10, windowMs: 60 * 60_000 } as const

export interface BriefingResult {
  text: string | null
  cached: boolean
  limited: boolean
  validation: AiTextValidationMeta | null
}

export interface BriefingDeps {
  readCache: (userId: string, day: string) => Promise<string | null>
  writeCache: (userId: string, day: string, text: string) => Promise<void>
  isLimited: (userId: string) => Promise<boolean>
  /** True when the user's daily AI budget is spent. */
  overBudget: (userId: string) => Promise<boolean>
  generate: (prompt: string, userId: string) => Promise<string | null>
}

/** Calendar day in Almaty (the platform's working time zone), YYYY-MM-DD. */
export function briefingDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const defaultDeps: BriefingDeps = {
  async readCache(userId, day) {
    const { createServiceClient } = await import('@/lib/supabase-service')
    const { data, error } = await createServiceClient()
      .from('ai_briefing_cache').select('text').eq('user_id', userId).eq('day', day).maybeSingle()
    if (error) return null
    return typeof data?.text === 'string' && data.text.trim() ? data.text : null
  },
  async writeCache(userId, day, text) {
    const { createServiceClient } = await import('@/lib/supabase-service')
    await createServiceClient()
      .from('ai_briefing_cache')
      .upsert({ user_id: userId, day, text, created_at: new Date().toISOString() }, { onConflict: 'user_id,day' })
  },
  async isLimited(userId) {
    const { isRateLimitedKey } = await import('@/lib/rate-limit')
    return isRateLimitedKey(userId, 'pulse-briefing-ai', PULSE_BRIEFING_RATE_LIMIT)
  },
  async overBudget(userId) {
    const { assertAiBudget, isAiBudgetError } = await import('@/lib/ai/budget')
    try {
      await assertAiBudget(userId, 'pulse_briefing')
      return false
    } catch (err) {
      return isAiBudgetError(err)
    }
  },
  async generate(prompt, userId) {
    const raw = await chatWithOpenRouter({
      feature: 'pulse_briefing',
      userId,
      model: OPENROUTER_MODELS.haiku,
      user: prompt,
      maxTokens: 300,
      temperature: 0.5,
      timeoutMs: 10_000,
    })
    return raw?.trim() || null
  },
}

/**
 * Today's briefing for `userId`: cached text if present, otherwise a fresh,
 * validated generation (subject to the hourly rate limit). Never throws.
 */
export async function getDailyBriefing(
  userId: string,
  prompt: string,
  deps: BriefingDeps = defaultDeps,
  now: Date = new Date(),
): Promise<BriefingResult> {
  const day = briefingDay(now)
  try {
    const cached = await deps.readCache(userId, day).catch(() => null)
    if (cached) return { text: cached, cached: true, limited: false, validation: null }

    if (await deps.isLimited(userId)) return { text: null, cached: false, limited: true, validation: null }
    if (await deps.overBudget(userId)) return { text: null, cached: false, limited: true, validation: null }

    const raw = await deps.generate(prompt, userId)
    if (!raw) return { text: null, cached: false, limited: false, validation: null }

    const checked = await validateAiText(raw)
    if (checked.approved) {
      await deps.writeCache(userId, day, checked.text).catch(() => undefined)
    }
    return { text: checked.text, cached: false, limited: false, validation: checked.meta }
  } catch (err) {
    console.error('[pulse/briefing] failed (non-fatal):', err instanceof Error ? err.message : err)
    return { text: null, cached: false, limited: false, validation: null }
  }
}
