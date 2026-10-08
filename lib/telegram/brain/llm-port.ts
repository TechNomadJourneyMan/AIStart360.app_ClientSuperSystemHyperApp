/**
 * lib/telegram/brain/llm-port.ts — THE ONE PLACE where the bot assistant is
 * bound to the AI layer. Everything else in lib/telegram/brain talks to the
 * `BrainLlm` port, so tests use a fake model and the binding below can be
 * rewired in one file.
 *
 * Binding (Part A1 of docs/superpowers/specs/2026-10-08-ai-providers-automation-bot-brain-design.md):
 *   lib/ai/tools-chat.ts  chatWithTools({ feature, label, companyId, userId, tier, messages, tools, toolChoice?, timeoutMs })
 *                           → { ok: true, message: { content, tool_calls: [{ id, name, arguments }] }, model, providerKey }
 *                           | { ok: false, code, message }
 *                         transcribeAudio({ feature, bytes, filename, mime, language? }) → { ok, text } | { ok: false, … }
 *   image input           OpenAI content parts { type: 'image_url', image_url: { url: 'data:…' } } in chatWithTools messages
 *   lib/ai/budget.ts      assertAiBudget(userId, feature) — the staff member's personal daily budget
 *
 * Failures of the AI layer ({ ok: false, error, message }) are mapped to
 * { ok: false, code } — e.g. NOT_CONFIGURED / BUDGET_EXCEEDED — and the brain
 * answers in Russian. AiFeature names: 'bot_assistant', 'bot_transcribe',
 * 'bot_vision' (lib/ai/usage.ts AI_FEATURES).
 */

import { chatWithTools, transcribeAudio, type ChatWithToolsResult, type ToolChatMessage } from '@/lib/ai/tools-chat'
import { assertAiBudget, isAiBudgetError } from '@/lib/ai/budget'
import { runWithAiActor } from '@/lib/ai/usage'

// ─── Port (what the brain needs) ─────────────────────────────────────────────

export type BrainTier = 'light' | 'standard' | 'premium'

export type BrainContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export interface BrainToolCall { id: string; name: string; arguments: string }

/** OpenAI-style chat messages (tool calls / tool results included). */
export type BrainMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | BrainContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string }

/** OpenAI-style tool definition. */
export interface BrainToolSpec {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface BrainChatRequest {
  feature: 'bot_assistant' | 'bot_vision'
  label: string
  userId: string
  companyId?: string | null
  tier: BrainTier
  messages: BrainMessage[]
  tools: BrainToolSpec[]
  toolChoice?: 'auto' | 'none'
  timeoutMs: number
}

export type BrainChatResult =
  | { ok: true; message: { content: string | null; tool_calls: BrainToolCall[] }; model?: string; providerKey?: string }
  | { ok: false; code: string; message: string }

export type BrainTextResult = { ok: true; text: string } | { ok: false; code: string; message: string }

export interface BrainLlm {
  chat(req: BrainChatRequest): Promise<BrainChatResult>
  transcribe(req: { userId: string; bytes: Buffer; filename: string; mime: string; language?: string }): Promise<BrainTextResult>
  /** Describe an image (vision model) — `dataUrl` is a data: URL. */
  describeImage(req: { userId: string; dataUrl: string; prompt: string; timeoutMs: number }): Promise<BrainTextResult>
  /** Personal daily AI budget of the person (staff budget). false = spent. Fail-open. */
  withinBudget(userId: string): Promise<boolean>
  /** Run the turn with the person as the AI actor (ai_usage attribution). */
  withActor<T>(userId: string, fn: () => Promise<T>): Promise<T>
}

export const AI_UNAVAILABLE: BrainChatResult & { ok: false } = { ok: false, code: 'AI_UNAVAILABLE', message: 'AI layer not available' }

// ─── Default binding ─────────────────────────────────────────────────────────


function failure(r: { error?: string; code?: string }, fallback: string): { ok: false; code: string; message: string } {
  return { ok: false, code: r.error ?? r.code ?? fallback, message: 'AI call failed' }
}

function normalizeChat(r: ChatWithToolsResult): BrainChatResult {
  if (!r.ok) return failure(r, 'AI_ERROR')
  return {
    ok: true,
    message: {
      content: r.message.content ? r.message.content : null,
      tool_calls: r.message.tool_calls
        .map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments }))
        .filter((c) => c.id && c.name),
    },
    model: r.model,
    providerKey: r.providerKey,
  }
}

export const defaultBrainLlm: BrainLlm = {
  async chat(req) {
    try {
      return normalizeChat(await chatWithTools({
        feature: req.feature,
        label: req.label,
        companyId: req.companyId ?? null,
        userId: req.userId,
        tier: req.tier,
        messages: req.messages as ToolChatMessage[],
        tools: req.tools,
        ...(req.toolChoice ? { toolChoice: req.toolChoice } : {}),
        timeoutMs: req.timeoutMs,
      }))
    } catch (err) {
      console.error('[telegram/brain] chatWithTools threw:', err instanceof Error ? err.message.split('\n')[0] : err)
      return { ok: false, code: 'AI_ERROR', message: 'AI call failed' }
    }
  },

  async transcribe(req) {
    try {
      // No language hint by default: the speech model detects Russian / Kazakh itself.
      const r = await transcribeAudio({
        feature: 'bot_transcribe', userId: req.userId, bytes: req.bytes, filename: req.filename, mime: req.mime,
        ...(req.language ? { language: req.language } : {}),
      })
      return r.ok ? { ok: true, text: r.text } : failure(r, 'AI_ERROR')
    } catch {
      return { ok: false, code: 'AI_ERROR', message: 'transcription failed' }
    }
  },

  async describeImage(req) {
    const r = await defaultBrainLlm.chat({
      feature: 'bot_vision',
      label: 'Бот: изображение',
      userId: req.userId,
      tier: 'standard',
      messages: [{ role: 'user', content: [{ type: 'text', text: req.prompt }, { type: 'image_url', image_url: { url: req.dataUrl } }] }],
      tools: [],
      timeoutMs: req.timeoutMs,
    })
    if (!r.ok) return r
    return r.message.content ? { ok: true, text: r.message.content } : { ok: false, code: 'EMPTY', message: 'empty answer' }
  },

  async withinBudget(userId) {
    try {
      await assertAiBudget(userId, 'bot_assistant')
      return true
    } catch (err) {
      return !isAiBudgetError(err)
    }
  },

  withActor(userId, fn) {
    return runWithAiActor({ userId }, fn)
  },
}
