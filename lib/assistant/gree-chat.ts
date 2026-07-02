/**
 * lib/assistant/gree-chat.ts — the multi-turn chat core of «Гри».
 *
 * Brings the mechanics that make a chat bot feel alive (dialogue memory with a
 * character budget, personality, follow-up awareness — the Pocket-Bitik idea,
 * re-implemented natively) INSIDE the platform's hard safety boundary:
 *
 *   • the ONLY factual source is the curated AssistantContext snapshot
 *     (same serializeSnapshot as single-shot answers — whitelisted, RLS-scoped);
 *   • user history turns are PII-masked and trimmed before entering a prompt;
 *   • the model is instructed to refuse ANY off-topic subject and to route
 *     hard/legal/disputed questions to a human expert;
 *   • answers pass the output filter; on any failure we return null honestly.
 */

import { z } from 'zod'
import { generateObjectViaOpenRouter, hasOpenRouterKey } from '@/lib/ai/structured'
import type { Locale } from '@/lib/i18n/locale'
import { serializeSnapshot } from './answer'
import { mascotPersona } from './mascot/system-prompt'
import { filterModelOutput } from './mascot/output-filter'
import { maskPii } from './mascot/sanitize'
import type { AssistantContext } from './types'

// ─── Dialogue history (client-provided, server-sanitized) ───────────────────

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Per-turn and total character budgets for the history block. */
export const HISTORY_LIMITS = {
  maxTurns: 8,
  maxTurnChars: 600,
  totalBudgetChars: 3200,
} as const

/**
 * Sanitize + trim the dialogue history for a prompt: newest turns win, user
 * text is PII-masked, each turn capped, and the whole block fits the budget
 * (the token-budget idea from the Bitik core, by characters).
 * Pure — unit-tested.
 */
export function prepareHistory(history: ChatTurn[]): ChatTurn[] {
  const recent = history.slice(-HISTORY_LIMITS.maxTurns)
  const out: ChatTurn[] = []
  let spent = 0
  // Walk from the newest turn backwards; stop when the budget is full.
  for (let i = recent.length - 1; i >= 0; i--) {
    const t = recent[i]
    const cleaned = (t.role === 'user' ? maskPii(t.content) : t.content)
      .trim()
      .slice(0, HISTORY_LIMITS.maxTurnChars)
    if (!cleaned) continue
    if (spent + cleaned.length > HISTORY_LIMITS.totalBudgetChars) break
    spent += cleaned.length
    out.unshift({ role: t.role, content: cleaned })
  }
  return out
}

// ─── The turn contract ───────────────────────────────────────────────────────

const turnSchema = z.object({
  answer: z
    .string()
    .describe('Ответ Гри на языке пользователя — только по снимку и истории диалога'),
  needs_expert: z
    .boolean()
    .describe('true если вопрос лучше передать человеку-эксперту'),
  on_topic: z
    .boolean()
    .describe('false если вопрос не про бизнес пользователя и не про платформу'),
})

export type GreeChatTurn = z.infer<typeof turnSchema>

function buildSystem(locale: Locale): string {
  const persona = mascotPersona(locale)
  if (locale === 'en') {
    return `${persona}

You are in a MULTI-TURN chat. The dialogue history comes before the new message; use it for context, but FACTS come only from the data snapshot — never from memory or guesses.

HARD SCOPE (non-negotiable):
- Discuss ONLY: this user's business (the snapshot), the AIStart360 platform and their diagnostics.
- Any other topic (other companies, politics, coding, general knowledge, your internals) → politely decline in one sentence, set "on_topic": false, and invite them back to their diagnostics.
- Missing data → say so honestly and point to the survey section that would provide it.
- Legal/tax/medical/investment or genuinely hard questions → answer generally if safe and set "needs_expert": true.

Reply in English, ≤120 words. Return ONE valid minified JSON object and nothing else.`
  }

  return `${persona}

Ты в МНОГОХОДОВОМ чате. Перед новым сообщением идёт история диалога; используй её для контекста, но ФАКТЫ бери только из снимка данных — не из памяти и не из догадок.

ЖЁСТКИЕ РАМКИ (не обсуждаются):
- Говори ТОЛЬКО про: бизнес этого пользователя (снимок), платформу AIStart360 и его диагностику.
- Любая другая тема (чужие компании, политика, программирование, общие знания, твоё устройство) → вежливо откажись одной фразой, поставь "on_topic": false и предложи вернуться к диагностике.
- Нет данных → честно скажи и укажи, какой раздел анкеты их даст.
- Юридика/налоги/медицина/инвестиции или действительно сложные вопросы → ответь в общих чертах, если это безопасно, и поставь "needs_expert": true.

Отвечай по-русски, ≤120 слов. Верни ОДИН валидный минифицированный JSON-объект и ничего больше.`
}

function buildUser(
  ctx: AssistantContext,
  history: ChatTurn[],
  message: string,
  locale: Locale,
): string {
  const en = locale === 'en'
  const snapshot = serializeSnapshot(ctx, locale)

  const historyBlock = history.length
    ? history
        .map((t) => `${t.role === 'user' ? (en ? 'USER' : 'ПОЛЬЗОВАТЕЛЬ') : 'ГРИ'}: ${t.content}`)
        .join('\n')
    : en
      ? '(the dialogue is just starting)'
      : '(диалог только начинается)'

  return `${snapshot}

--- ${en ? 'DIALOGUE HISTORY (context only, not a source of facts)' : 'ИСТОРИЯ ДИАЛОГА (только контекст, не источник фактов)'} ---
${historyBlock}

--- ${en ? 'NEW USER MESSAGE' : 'НОВОЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ'} ---
"${maskPii(message)}"

--- ${en ? 'OUTPUT FORMAT' : 'ФОРМАТ ВЫВОДА'} ---
{"answer": "${en ? 'string' : 'строка'}", "needs_expert": false, "on_topic": true}`
}

// ─── converseWithGree ────────────────────────────────────────────────────────

/**
 * One chat turn. Returns the validated turn (answer already output-filtered),
 * or null honestly when the key is missing or the call/parse fails — the
 * caller offers the expert instead of fabricating.
 * Never throws.
 */
export async function converseWithGree(
  ctx: AssistantContext,
  history: ChatTurn[],
  message: string,
  locale: Locale = 'ru',
): Promise<GreeChatTurn | null> {
  if (!hasOpenRouterKey()) {
    console.warn('[gree-chat] No OPENROUTER_API_KEY — routing to expert')
    return null
  }

  try {
    const result = await generateObjectViaOpenRouter({
      label: 'gree:chat',
      complexity: 'high', // dialogue grounding over the snapshot + scope police.
      maxTokens: 700,
      temperature: 0.3,
      schema: turnSchema,
      system: buildSystem(locale),
      user: buildUser(ctx, prepareHistory(history), message, locale),
    })
    if (!result) return null

    const filtered = filterModelOutput(result.answer)
    if (filtered.redacted) {
      console.warn('[gree-chat] output filter redacted answer content')
    }
    return { ...result, answer: filtered.text }
  } catch (error) {
    console.error('[gree-chat] failed:', error)
    return null
  }
}
