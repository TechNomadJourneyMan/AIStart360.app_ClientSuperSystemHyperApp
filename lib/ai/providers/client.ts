/**
 * lib/ai/providers/client.ts — HTTP client for OpenRouter and any
 * OpenAI-compatible provider (migration 094).
 *
 * One request builder per capability; the provider kind decides the extras:
 *   openrouter         + provider privacy (AI_PRIVACY_MODE, lib/ai/privacy.ts),
 *                        usage accounting (`usage: {include: true}`),
 *                        require_parameters for strict JSON schemas,
 *                        HTTP-Referer / X-Title attribution headers
 *   openai_compatible  plain OpenAI request; OpenRouter-only fields are never
 *                        sent (privacy is governed by the provider's own terms,
 *                        ai_providers.privacy_note); `response_format` only
 *                        when the provider supports it; non-secret extra headers
 *
 * Verification status of the wire formats (docs/platform/05-agents.md §8.1):
 *   chat        — VERIFIED for Alem Plus from the owner's spec:
 *                 POST https://llm.alem.ai/v1/chat/completions, Bearer key,
 *                 {"model":"alemllm","messages":[…]}; standard OpenAI response.
 *   embeddings  — standard OpenAI /embeddings shape; UNVERIFIED for Alem.
 *   rerank      — ASSUMED Cohere/Jina-style {model, query, documents, top_n}
 *                 → {results: [{index, relevance_score}]}; see rerankAdapter.
 *   ocr         — ASSUMED chat with an image_url content part (ocr_mode
 *                 'chat_vision'); see ocrMessages.
 *
 * Never logs or returns the API key; error snippets are sanitised.
 */
import type { LlmErrorCode } from '@/lib/ai/gateway'
import { privacyProvider } from '@/lib/ai/privacy'
import { getSiteUrl } from '@/lib/site-url'
import type { ChatTier, CostSource, ProviderTarget } from './types'
import { joinUrl } from './url-guard'

/**
 * USD per 1M tokens used to ESTIMATE a call when neither the provider nor the
 * model row gives a price (deliberately conservative). AI_PRICE_TABLE in the
 * gateway can override per model id.
 */
export const TIER_ESTIMATE_PRICES_PER_MTOK: Record<ChatTier, { in: number; out: number }> = {
  light: { in: 1, out: 5 },
  standard: { in: 3, out: 15 },
  premium: { in: 15, out: 75 },
}

/**
 * Price class of the model ids the platform uses by default (lib/ai/openrouter.ts
 * OPENROUTER_MODELS), at the conservative tier prices above. Lets a budget
 * estimate price an override by the model actually called instead of by the
 * agent's tier (an Opus override on a light agent is not a Haiku call).
 */
const KNOWN_MODEL_PRICE_TIER: Record<string, ChatTier> = {
  'anthropic/claude-haiku-4.5': 'light',
  'anthropic/claude-sonnet-4.5': 'standard',
  'anthropic/claude-sonnet-5': 'standard',
  'anthropic/claude-opus-4.8': 'premium',
  'anthropic/claude-opus-4.1': 'premium',
  'openai/gpt-4o': 'standard',
  'openai/gpt-4o-mini': 'light',
}

/**
 * Known per-1M-token prices of a model id: AI_PRICE_TABLE='{"model":{"in":3,"out":15}}'
 * first, then the built-in price class; null when the model is unknown.
 */
export function knownModelPrices(model: string | null | undefined): { in: number; out: number } | null {
  if (!model) return null
  try {
    const table = process.env.AI_PRICE_TABLE ? JSON.parse(process.env.AI_PRICE_TABLE) : null
    const row = table?.[model]
    if (row && Number.isFinite(row.in) && Number.isFinite(row.out)) return { in: row.in, out: row.out }
  } catch {
    // malformed override → built-in prices
  }
  const tier = KNOWN_MODEL_PRICE_TIER[model]
  return tier ? TIER_ESTIMATE_PRICES_PER_MTOK[tier] : null
}

/** Chat tier of a known default model id (haiku → light, …); null when unknown. */
export function knownModelTier(model: string | null | undefined): ChatTier | null {
  return model ? KNOWN_MODEL_PRICE_TIER[model] ?? null : null
}

/** Rough token count: ~3.5 chars per token for mixed RU/EN text, rounded up. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

/** Upper-bound cost of a call: the input as sent, the output at maxTokens. */
export function worstCaseCostUsd(prices: { in: number; out: number }, inputText: string, maxTokens: number): number {
  return (estimateTokens(inputText) * prices.in + maxTokens * prices.out) / 1_000_000
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  /** Audio input (OpenRouter audio-capable chat models): base64 data + format (wav, mp3, ogg, …). */
  | { type: 'input_audio'; input_audio: { data: string; format: string } }

/** True when any message carries an image part (vision request). */
export function hasImageParts(messages: ReadonlyArray<{ content?: unknown }>): boolean {
  return messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p && typeof p === 'object' && (p as { type?: unknown }).type === 'image_url'))
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

export interface ChatParams {
  messages: ChatMessage[]
  maxTokens: number
  /** undefined or null: not sent. */
  temperature?: number | null
  /** JSON object mode. */
  json?: boolean
  /** Exact JSON schema (wins over `json`). */
  jsonSchema?: { name: string; strict?: boolean; schema: Record<string, unknown> }
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface ClientFailure {
  ok: false
  code: LlmErrorCode
  /** HTTP status when the provider answered. */
  status: number | null
  /** Short, safe message (no key, no body). */
  message: string
  /** Worth retrying: 429, 5xx, timeouts, network errors. */
  retryable: boolean
  /**
   * Sanitised start of the provider's error body (≤ 300 chars, key redacted).
   * May echo prompt content — callers handling client data must not log it.
   */
  detail: string | null
}

export interface ChatSuccess {
  ok: true
  text: string
  /** Model that answered (provider's `model` field, else the requested one). */
  model: string
  tokensIn: number | null
  tokensOut: number | null
  /** usage.cost when the provider reports it (OpenRouter does). */
  providerCostUsd: number | null
}

export interface EmbeddingsSuccess {
  ok: true
  vectors: Array<number[] | null>
  model: string
  tokensIn: number | null
  providerCostUsd: number | null
}

export interface RerankSuccess {
  ok: true
  results: Array<{ index: number; score: number }>
  model: string
  tokensIn: number | null
  providerCostUsd: number | null
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Remove anything that looks like a credential from provider text. */
export function sanitizeProviderText(text: string, apiKey?: string | null, max = 300): string {
  let s = text
  if (apiKey && apiKey.length >= 4) s = s.split(apiKey).join('[REDACTED]')
  s = s
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk|pk|rk|key|api)[-_][A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function headersFor(target: ProviderTarget): Record<string, string> {
  const base: Record<string, string> = {}
  if (target.kind === 'openai_compatible') {
    for (const [k, v] of Object.entries(target.extraHeaders ?? {})) {
      // Never let configuration override the auth/content headers.
      if (/^(authorization|content-type|cookie|host|content-length)$/i.test(k)) continue
      base[k] = v
    }
  }
  base['Content-Type'] = 'application/json'
  base.Authorization = `Bearer ${target.apiKey}`
  if (target.kind === 'openrouter') {
    base['HTTP-Referer'] = getSiteUrl()
    base['X-Title'] = 'AIStart360'
  }
  return base
}

function failure(code: LlmErrorCode, message: string, status: number | null, retryable: boolean, detail: string | null = null): ClientFailure {
  return { ok: false, code, status, message, retryable, detail }
}

/** Map a non-2xx response to an error (reads at most a short body snippet). */
async function httpFailure(res: Response, apiKey: string): Promise<ClientFailure> {
  const raw = await res.text().catch(() => '')
  const detail = raw ? sanitizeProviderText(raw, apiKey) : null
  if (res.status === 429) return failure('RATE_LIMITED', 'HTTP 429', 429, true, detail)
  if (res.status >= 500) return failure('PROVIDER_ERROR', `HTTP ${res.status}`, res.status, true, detail)
  return failure('PROVIDER_ERROR', `HTTP ${res.status}`, res.status, false, detail)
}

function thrownFailure(err: unknown): ClientFailure {
  const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
  return isTimeout
    ? failure('TIMEOUT', 'таймаут', null, true)
    : failure('PROVIDER_ERROR', 'сетевая ошибка', null, true)
}

async function postJson(
  target: ProviderTarget,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  fetchImpl?: typeof fetch,
): Promise<{ ok: true; json: Record<string, unknown> } | ClientFailure> {
  const doFetch = fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(joinUrl(target.baseUrl, path), {
      method: 'POST',
      headers: headersFor(target),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    return thrownFailure(err)
  }
  if (!res.ok) return httpFailure(res, target.apiKey)
  try {
    const json = await res.json()
    if (!json || typeof json !== 'object') return failure('PROVIDER_ERROR', 'некорректный ответ провайдера', res.status, true)
    return { ok: true, json: json as Record<string, unknown> }
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return thrownFailure(err)
    return failure('PROVIDER_ERROR', 'некорректный ответ провайдера', res.status, true)
  }
}

function usageOf(json: Record<string, unknown>): { tokensIn: number | null; tokensOut: number | null; cost: number | null } {
  const u = (json.usage ?? null) as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown; cost?: unknown } | null
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    tokensIn: n(u?.prompt_tokens) ?? n(u?.total_tokens),
    tokensOut: n(u?.completion_tokens),
    cost: n(u?.cost),
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
      .join('')
  }
  return ''
}

// ── chat ───────────────────────────────────────────────────────────────────

/** The request body for a chat call (exported for tests and verification). */
export function buildChatBody(target: ProviderTarget, p: ChatParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: target.model,
    messages: p.messages,
    max_tokens: p.maxTokens,
  }
  if (p.temperature !== null && p.temperature !== undefined) body.temperature = p.temperature
  const responseFormatAllowed = target.kind === 'openrouter' || target.supportsResponseFormat
  if (p.jsonSchema && responseFormatAllowed) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: p.jsonSchema.name, strict: p.jsonSchema.strict ?? true, schema: p.jsonSchema.schema },
    }
    // OpenRouter: do not silently route a strict-schema request through a
    // provider that ignores response_format.
    if (target.kind === 'openrouter') body.provider = { require_parameters: true }
  } else if ((p.json || p.jsonSchema) && responseFormatAllowed) {
    body.response_format = { type: 'json_object' }
  }
  if (target.kind === 'openrouter') {
    const privacy = privacyProvider()
    if (privacy) body.provider = { ...((body.provider as Record<string, unknown> | undefined) ?? {}), ...privacy }
    // Ask OpenRouter to report the real cost of the call.
    body.usage = { include: true }
  }
  return body
}

export async function chatCompletion(target: ProviderTarget, p: ChatParams): Promise<ChatSuccess | ClientFailure> {
  const r = await postJson(target, target.chatPath, buildChatBody(target, p), p.timeoutMs ?? 45_000, p.fetchImpl)
  if (!r.ok) return r
  const choices = r.json.choices as Array<{ message?: { content?: unknown } }> | undefined
  const usage = usageOf(r.json)
  return {
    ok: true,
    text: textOf(choices?.[0]?.message?.content),
    model: typeof r.json.model === 'string' && r.json.model ? r.json.model : target.model,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    providerCostUsd: usage.cost,
  }
}

// ── chat with tools (OpenAI tools / tool_calls) ────────────────────────────

/** An OpenAI function tool: JSON-schema parameters. */
export interface ToolDefinition {
  type: 'function'
  function: { name: string; description?: string; parameters: Record<string, unknown> }
}

export interface ToolCall {
  id: string
  type: 'function'
  /** `arguments` is the JSON text the model produced (not validated here). */
  function: { name: string; arguments: string }
}

export type ToolChoice = 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }

/** Messages of a tool loop: the usual roles plus assistant tool calls and tool results. */
export type ToolChatMessage =
  | { role: 'system' | 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ToolChatSuccess {
  ok: true
  message: { content: string; tool_calls: ToolCall[] }
  finishReason: string | null
  model: string
  tokensIn: number | null
  tokensOut: number | null
  providerCostUsd: number | null
}

/**
 * Normalise `choices[0].message.tool_calls`: only function calls with a name;
 * object arguments are serialised, missing ones become '{}', a missing id is
 * generated (some OpenAI-compatible proxies omit it).
 */
export function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return []
  const out: ToolCall[] = []
  raw.forEach((item, i) => {
    const it = item as { id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } } | null
    const name = it?.function?.name
    if (!it || typeof name !== 'string' || !name.trim()) return
    if (it.type !== undefined && it.type !== 'function') return
    const args = it.function?.arguments
    out.push({
      id: typeof it.id === 'string' && it.id ? it.id : `call_${i}`,
      type: 'function',
      function: {
        name: name.trim(),
        arguments: typeof args === 'string' ? (args.trim() || '{}') : args && typeof args === 'object' ? JSON.stringify(args) : '{}',
      },
    })
  })
  return out
}

export async function chatCompletionWithTools(
  target: ProviderTarget,
  p: {
    messages: ToolChatMessage[]
    tools: ToolDefinition[]
    toolChoice?: ToolChoice
    maxTokens: number
    temperature?: number | null
    timeoutMs?: number
    fetchImpl?: typeof fetch
  },
): Promise<ToolChatSuccess | ClientFailure> {
  const body = buildChatBody(target, {
    messages: p.messages as unknown as ChatMessage[],
    maxTokens: p.maxTokens,
    temperature: p.temperature,
  })
  if (p.tools.length) {
    body.tools = p.tools
    body.tool_choice = p.toolChoice ?? 'auto'
    // OpenRouter: only route to upstream providers that support tools.
    if (target.kind === 'openrouter') body.provider = { ...((body.provider as Record<string, unknown> | undefined) ?? {}), require_parameters: true }
  }
  const r = await postJson(target, target.chatPath, body, p.timeoutMs ?? 45_000, p.fetchImpl)
  if (!r.ok) return r
  const choices = r.json.choices as Array<{ message?: { content?: unknown; tool_calls?: unknown }; finish_reason?: unknown }> | undefined
  const msg = choices?.[0]?.message
  const usage = usageOf(r.json)
  return {
    ok: true,
    message: { content: textOf(msg?.content), tool_calls: parseToolCalls(msg?.tool_calls) },
    finishReason: typeof choices?.[0]?.finish_reason === 'string' ? (choices[0].finish_reason as string) : null,
    model: typeof r.json.model === 'string' && r.json.model ? r.json.model : target.model,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    providerCostUsd: usage.cost,
  }
}

// ── speech-to-text (OpenAI-compatible /audio/transcriptions) ───────────────

export const TRANSCRIPTIONS_PATH = '/audio/transcriptions'

export interface TranscribeSuccess {
  ok: true
  text: string
  model: string
  /** Audio length when the provider reports it. */
  durationSec: number | null
  providerCostUsd: number | null
}

/**
 * POST <base>/audio/transcriptions as multipart/form-data: `file` (the audio
 * bytes with its file name and MIME type), `model`, optional `language`
 * (ISO-639-1) and `response_format=json`. ASSUMED for Alem's Speech-to-Text
 * keys from the OpenAI-compatible (LiteLLM) proxy shape; answers `{text}`
 * (JSON) or plain text.
 */
export async function transcribeAudioRequest(
  target: ProviderTarget,
  p: { bytes: Uint8Array; filename: string; mime: string; language?: string; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<TranscribeSuccess | ClientFailure> {
  const doFetch = p.fetchImpl ?? fetch
  const form = new FormData()
  const copy = new Uint8Array(p.bytes.byteLength)
  copy.set(p.bytes)
  form.append('file', new Blob([copy.buffer], { type: p.mime || 'application/octet-stream' }), p.filename || 'audio')
  form.append('model', target.model)
  form.append('response_format', 'json')
  if (p.language) form.append('language', p.language)
  const headers = headersFor(target)
  delete headers['Content-Type'] // fetch sets the multipart boundary
  let res: Response
  try {
    res = await doFetch(joinUrl(target.baseUrl, TRANSCRIPTIONS_PATH), {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(p.timeoutMs ?? 60_000),
    })
  } catch (err) {
    return thrownFailure(err)
  }
  if (!res.ok) return httpFailure(res, target.apiKey)
  let raw: string
  try {
    raw = await res.text()
  } catch (err) {
    return thrownFailure(err)
  }
  let text = raw.trim()
  let durationSec: number | null = null
  let cost: number | null = null
  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(text) as { text?: unknown; duration?: unknown; usage?: { seconds?: unknown; cost?: unknown } }
      if (typeof json.text !== 'string') return failure('INVALID_OUTPUT', 'неизвестный формат ответа распознавания', res.status, false)
      text = json.text.trim()
      const d = typeof json.duration === 'number' ? json.duration : typeof json.usage?.seconds === 'number' ? json.usage.seconds : null
      durationSec = d !== null && Number.isFinite(d) ? d : null
      cost = typeof json.usage?.cost === 'number' && Number.isFinite(json.usage.cost) ? json.usage.cost : null
    } catch {
      return failure('INVALID_OUTPUT', 'некорректный ответ распознавания', res.status, false)
    }
  }
  return { ok: true, text, model: target.model, durationSec, providerCostUsd: cost }
}

// ── embeddings ─────────────────────────────────────────────────────────────

export async function createEmbeddings(
  target: ProviderTarget,
  p: { input: string[]; dimensions?: number; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<EmbeddingsSuccess | ClientFailure> {
  const body: Record<string, unknown> = { model: target.model, input: p.input }
  if (p.dimensions !== undefined) body.dimensions = p.dimensions
  const r = await postJson(target, target.embeddingsPath, body, p.timeoutMs ?? 20_000, p.fetchImpl)
  if (!r.ok) return r
  const data = Array.isArray(r.json.data) ? (r.json.data as Array<{ embedding?: unknown; index?: unknown }>) : []
  const usage = usageOf(r.json)
  return {
    ok: true,
    vectors: data.map((d) => (d && Array.isArray(d.embedding) ? (d.embedding as number[]) : null)),
    model: typeof r.json.model === 'string' && r.json.model ? r.json.model : target.model,
    tokensIn: usage.tokensIn,
    providerCostUsd: usage.cost,
  }
}

// ── rerank (ASSUMED wire format) ───────────────────────────────────────────

/**
 * Rerank request/response mapping. ASSUMPTION, not verified against Alem:
 * Cohere/Jina-style `POST <rerank_path> {model, query, documents, top_n}`
 * answering `{results: [{index, relevance_score}]}`. Also accepted on the way
 * back: `{data: [{index, score}]}` and a bare array (TEI style). Change only
 * this adapter once the real format is confirmed.
 */
export const rerankAdapter = {
  request(model: string, query: string, documents: string[], topN?: number): Record<string, unknown> {
    const body: Record<string, unknown> = { model, query, documents }
    if (topN !== undefined) body.top_n = topN
    return body
  },
  response(json: unknown): Array<{ index: number; score: number }> | null {
    const obj = json as { results?: unknown; data?: unknown } | null
    const list = Array.isArray(json) ? json : Array.isArray(obj?.results) ? obj?.results : Array.isArray(obj?.data) ? obj?.data : null
    if (!Array.isArray(list)) return null
    const out: Array<{ index: number; score: number }> = []
    for (const item of list) {
      const it = item as { index?: unknown; relevance_score?: unknown; score?: unknown }
      const score = typeof it.relevance_score === 'number' ? it.relevance_score : typeof it.score === 'number' ? it.score : null
      if (typeof it.index !== 'number' || score === null) return null
      out.push({ index: it.index, score })
    }
    return out.sort((a, b) => b.score - a.score)
  },
}

export async function rerankDocuments(
  target: ProviderTarget,
  p: { query: string; documents: string[]; topN?: number; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<RerankSuccess | ClientFailure> {
  if (!target.rerankPath) return failure('PROVIDER_ERROR', 'у провайдера не задан путь rerank', null, false)
  const doFetch = p.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(joinUrl(target.baseUrl, target.rerankPath), {
      method: 'POST',
      headers: headersFor(target),
      body: JSON.stringify(rerankAdapter.request(target.model, p.query, p.documents, p.topN)),
      signal: AbortSignal.timeout(p.timeoutMs ?? 20_000),
    })
  } catch (err) {
    return thrownFailure(err)
  }
  if (!res.ok) return httpFailure(res, target.apiKey)
  let json: unknown
  try {
    json = await res.json()
  } catch {
    return failure('PROVIDER_ERROR', 'некорректный ответ провайдера', res.status, true)
  }
  const results = rerankAdapter.response(json)
  if (!results) return failure('INVALID_OUTPUT', 'неизвестный формат ответа rerank', res.status, false)
  const usage = usageOf((json && typeof json === 'object' && !Array.isArray(json) ? json : {}) as Record<string, unknown>)
  return { ok: true, results, model: target.model, tokensIn: usage.tokensIn, providerCostUsd: usage.cost }
}

// ── OCR via a vision chat model (ASSUMED) ──────────────────────────────────

/**
 * OCR messages for ocr_mode 'chat_vision'. ASSUMPTION, not verified against
 * Alem's DeepSeek OCR: an OpenAI vision-style user message with a text part
 * and an `image_url` part (https URL or data: URL).
 */
export function ocrMessages(imageUrl: string, prompt?: string): ChatMessage[] {
  return [{
    role: 'user',
    content: [
      { type: 'text', text: prompt ?? 'Распознай весь текст на изображении. Верни только текст, без комментариев.' },
      { type: 'image_url', image_url: { url: imageUrl } },
    ],
  }]
}

export async function ocrImage(
  target: ProviderTarget,
  p: { imageUrl: string; prompt?: string; maxTokens?: number; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<ChatSuccess | ClientFailure> {
  if (target.ocrMode !== 'chat_vision') return failure('PROVIDER_ERROR', 'у провайдера не задан режим OCR', null, false)
  return chatCompletion(target, {
    messages: ocrMessages(p.imageUrl, p.prompt),
    maxTokens: p.maxTokens ?? 4000,
    temperature: 0,
    timeoutMs: p.timeoutMs ?? 60_000,
    fetchImpl: p.fetchImpl,
  })
}

// ── GET /models (verification) ─────────────────────────────────────────────

export async function listRemoteModels(
  target: ProviderTarget,
  p: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ ok: true; count: number; ids: string[] } | ClientFailure> {
  const doFetch = p.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(joinUrl(target.baseUrl, '/models'), {
      method: 'GET',
      headers: headersFor(target),
      signal: AbortSignal.timeout(p.timeoutMs ?? 15_000),
    })
  } catch (err) {
    return thrownFailure(err)
  }
  if (!res.ok) return httpFailure(res, target.apiKey)
  const json = (await res.json().catch(() => null)) as unknown
  const ids = modelIdsOf(json)
  return { ok: true, count: ids.length, ids }
}

const MAX_DISCOVERED_MODELS = 500

/**
 * Model ids of a GET /models answer: OpenAI / LiteLLM `{data: [{id}]}`, also
 * `{models: [...]}` and a bare array of objects or strings. Ids are trimmed,
 * 1–200 printable characters, de-duplicated, at most 500.
 */
export function modelIdsOf(json: unknown): string[] {
  const obj = json as { data?: unknown; models?: unknown } | null
  const list = Array.isArray(json) ? json : Array.isArray(obj?.data) ? obj?.data : Array.isArray(obj?.models) ? obj?.models : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list as unknown[]) {
    const raw = typeof item === 'string' ? item : (item as { id?: unknown; model?: unknown; name?: unknown } | null)?.id
      ?? (item as { model?: unknown } | null)?.model ?? (item as { name?: unknown } | null)?.name
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    // eslint-disable-next-line no-control-regex
    if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_DISCOVERED_MODELS) break
  }
  return out
}

// ── cost ───────────────────────────────────────────────────────────────────

/**
 * Cost of a call: the provider-reported cost when present; else the model's
 * configured prices (a missing in/out price counts as 0); else the estimate
 * prices when given; else 0 (an unknown cost, recorded as an estimate).
 */
export function computeCost(c: {
  providerCostUsd: number | null
  tokensIn: number
  tokensOut: number
  priceInPerMtok: number | null
  priceOutPerMtok: number | null
  estimatePrices?: { in: number; out: number } | null
}): { costUsd: number; costSource: CostSource } {
  if (typeof c.providerCostUsd === 'number' && Number.isFinite(c.providerCostUsd)) {
    return { costUsd: c.providerCostUsd, costSource: 'provider' }
  }
  if (c.priceInPerMtok !== null || c.priceOutPerMtok !== null) {
    return {
      costUsd: (c.tokensIn * (c.priceInPerMtok ?? 0) + c.tokensOut * (c.priceOutPerMtok ?? 0)) / 1_000_000,
      costSource: 'model_price',
    }
  }
  if (c.estimatePrices) {
    return { costUsd: (c.tokensIn * c.estimatePrices.in + c.tokensOut * c.estimatePrices.out) / 1_000_000, costSource: 'estimate' }
  }
  return { costUsd: 0, costSource: 'estimate' }
}
