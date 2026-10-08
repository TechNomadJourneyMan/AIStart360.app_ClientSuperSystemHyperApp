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
 * The module is loaded lazily; when it (or the export) is missing — the AI
 * layer is not merged yet, or failed to load — every call answers
 * { ok: false, code: 'AI_UNAVAILABLE' } and the bot says «ИИ временно недоступен».
 * New AiFeature names: 'bot_assistant', 'bot_transcribe', 'bot_vision'
 * (added to lib/ai/usage.ts AI_FEATURES by the AI layer; cast here until then).
 */

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
}

export const AI_UNAVAILABLE: BrainChatResult & { ok: false } = { ok: false, code: 'AI_UNAVAILABLE', message: 'AI layer not available' }

// ─── Default binding ─────────────────────────────────────────────────────────

type AnyFn = (args: Record<string, unknown>) => Promise<unknown>

/**
 * `@/lib/ai/tools-chat`, loaded once on demand. The specifier is built at
 * runtime (webpack bundles the matching file of lib/ai when it exists) so this
 * file compiles before the module is merged.
 */
async function loadToolsChat(): Promise<Record<string, unknown> | null> {
  const name = 'tools-chat'
  try {
    return (await import(/* webpackInclude: /tools-chat\.ts$/ */ /* @vite-ignore */ `@/lib/ai/${name}`)) as Record<string, unknown>
  } catch {
    return null
  }
}

async function fn(name: string): Promise<AnyFn | null> {
  const mod = await loadToolsChat()
  const f = mod?.[name]
  return typeof f === 'function' ? (f as AnyFn) : null
}

function normalizeChat(raw: unknown): BrainChatResult {
  const r = raw as { ok?: unknown; message?: { content?: unknown; tool_calls?: unknown }; model?: unknown; providerKey?: unknown; code?: unknown } | null
  if (!r || r.ok !== true) {
    return { ok: false, code: typeof r?.code === 'string' ? r.code : 'AI_ERROR', message: 'AI call failed' }
  }
  const calls = Array.isArray(r.message?.tool_calls) ? r.message!.tool_calls as Array<Record<string, unknown>> : []
  return {
    ok: true,
    message: {
      content: typeof r.message?.content === 'string' ? r.message.content : null,
      tool_calls: calls
        .map((c) => {
          // Accept both { id, name, arguments } and OpenAI's { id, function: { name, arguments } }.
          const f = (c.function ?? c) as Record<string, unknown>
          return { id: String(c.id ?? ''), name: String(f.name ?? ''), arguments: typeof f.arguments === 'string' ? f.arguments : JSON.stringify(f.arguments ?? {}) }
        })
        .filter((c) => c.id && c.name),
    },
    model: typeof r.model === 'string' ? r.model : undefined,
    providerKey: typeof r.providerKey === 'string' ? r.providerKey : undefined,
  }
}

export const defaultBrainLlm: BrainLlm = {
  async chat(req) {
    const chatWithTools = await fn('chatWithTools')
    if (!chatWithTools) return AI_UNAVAILABLE
    try {
      return normalizeChat(await chatWithTools({
        feature: req.feature,
        label: req.label,
        companyId: req.companyId ?? null,
        userId: req.userId,
        tier: req.tier,
        messages: req.messages,
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
    const transcribeAudio = await fn('transcribeAudio')
    if (!transcribeAudio) return { ok: false, code: 'AI_UNAVAILABLE', message: 'AI layer not available' }
    try {
      const r = (await transcribeAudio({
        feature: 'bot_transcribe', userId: req.userId, bytes: req.bytes, filename: req.filename, mime: req.mime, language: req.language ?? 'ru',
      })) as { ok?: unknown; text?: unknown; code?: unknown }
      return r?.ok === true && typeof r.text === 'string' ? { ok: true, text: r.text } : { ok: false, code: typeof r?.code === 'string' ? r.code : 'AI_ERROR', message: 'transcription failed' }
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
      const { assertAiBudget, isAiBudgetError } = await import('@/lib/ai/budget')
      try {
        // 'bot_assistant' is added to AI_FEATURES by the AI layer (Part A1).
        await assertAiBudget(userId, 'bot_assistant' as Parameters<typeof assertAiBudget>[1])
        return true
      } catch (err) {
        return !isAiBudgetError(err)
      }
    } catch {
      return true
    }
  },
}
