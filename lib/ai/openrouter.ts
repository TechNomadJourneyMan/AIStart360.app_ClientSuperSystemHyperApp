/**
 * Unified OpenRouter client.
 *
 * OpenRouter speaks the OpenAI chat-completions protocol, so we just fetch
 * their /chat/completions endpoint. No SDK needed.
 *
 * Env:
 *   OPENROUTER_API_KEY — required for live calls.
 *
 * Default model is Claude Sonnet 4.5 (anthropic/claude-sonnet-4.5).
 * Override via `model` param.
 */

export const OPENROUTER_MODELS = {
  sonnet: 'anthropic/claude-sonnet-4.5',
  haiku:  'anthropic/claude-haiku-4.5',
  opus:   'anthropic/claude-opus-4.1',
  gpt4:   'openai/gpt-4o',
  gpt4mini: 'openai/gpt-4o-mini',
} as const

interface ChatOptions {
  system?: string
  user: string
  model?: string
  maxTokens?: number
  temperature?: number
  jsonMode?: boolean
}

export function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY)
}

/**
 * Sends a chat completion via OpenRouter. Returns the assistant message text,
 * or null if the request fails. Never throws.
 */
export async function chatWithOpenRouter(opts: ChatOptions): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  const messages: Array<{ role: string; content: string }> = []
  if (opts.system) messages.push({ role: 'system', content: opts.system })
  messages.push({ role: 'user', content: opts.user })

  const body: Record<string, unknown> = {
    model: opts.model ?? OPENROUTER_MODELS.sonnet,
    messages,
    max_tokens: opts.maxTokens ?? 2000,
    temperature: opts.temperature ?? 0.7,
  }
  if (opts.jsonMode) body.response_format = { type: 'json_object' }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.AUTH_URL ?? 'https://aistart360.vercel.app',
        'X-Title': 'AIStart360',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.error('[openrouter]', res.status, await res.text().catch(() => ''))
      return null
    }
    const json = await res.json()
    return json.choices?.[0]?.message?.content ?? null
  } catch (err) {
    console.error('[openrouter] fetch failed:', err)
    return null
  }
}

/**
 * Extracts a JSON payload from a model response. Handles fenced code blocks,
 * inline JSON, and plain text. Returns `null` if no valid JSON is found.
 */
export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  const raw = fenced ? fenced[1].trim() : text
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  const candidate = first !== -1 && last > first ? raw.slice(first, last + 1) : raw
  try {
    return JSON.parse(candidate) as T
  } catch {
    return null
  }
}
