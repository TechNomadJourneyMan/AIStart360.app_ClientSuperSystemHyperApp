/**
 * lib/ai/tools-chat.ts — tool calling, speech-to-text and image input on top
 * of the multi-provider router (part A1 of
 * docs/superpowers/specs/2026-10-08-ai-providers-automation-bot-brain-design.md).
 * Built for the Telegram bots' "brain" (part B), usable by any server feature.
 *
 *   chatWithTools    one model step of a tool loop (OpenAI tools / tool_calls);
 *                    image parts in the messages make it a vision call
 *   askAboutImage    a single question about one image (vision chat)
 *   transcribeAudio  speech-to-text via capability 'transcribe'
 *                    (POST /audio/transcriptions), else — only when OpenRouter
 *                    has a key — an audio-input chat model through OpenRouter
 *
 * Same controls as chatWithOpenRouter (lib/ai/openrouter.ts): the platform
 * daily budget before the call, the provider daily budget per candidate,
 * OpenRouter privacy fields (lib/ai/privacy.ts, added by the client for the
 * openrouter kind only), the spend ledger (ai_usage_ledger, including the
 * worst case of a timed-out attempt) and per-user ai_usage with a required
 * `feature`. Candidates fail over on 401/403/404/408/429/5xx/timeout/network
 * (lib/ai/providers/failover.ts). Never throws; never logs prompts or keys.
 */
import { modelForTier, type LlmErrorCode } from './gateway'
import {
  chatCompletion,
  chatCompletionWithTools,
  computeCost,
  estimateTokens,
  hasImageParts,
  knownModelPrices,
  TIER_ESTIMATE_PRICES_PER_MTOK,
  transcribeAudioRequest,
  worstCaseCostUsd,
  type ClientFailure,
  type ContentPart,
  type ToolCall,
  type ToolChatMessage,
  type ToolChoice,
  type ToolDefinition,
} from './providers/client'
import { runWithFailover } from './providers/failover'
import { providerBudgetRefusal, resolveCandidates } from './providers/router'
import type { ChatTier, ProviderTarget } from './providers/types'
import { platformBudgetLeft, recordUsage } from './usage-ledger'
import { recordAiUsage, type AiFeature } from './usage'

export type { ToolCall, ToolChatMessage, ToolChoice, ToolDefinition } from './providers/client'

export type AiCallFailure = { ok: false; error: LlmErrorCode | 'NOT_CONFIGURED' | 'INVALID_INPUT'; message: string }

interface Accounting {
  /** Cost-accounting tag (ai_usage.feature). */
  feature: AiFeature
  /** Spend-ledger label (`feature:<label>`); defaults to `feature`. */
  label?: string
  companyId?: string | null
  userId?: string | null
}

/** Plain text of the messages (cost estimates only — never logged). */
function messagesText(messages: readonly ToolChatMessage[]): string {
  return messages.map((m) => {
    if (typeof m.content === 'string') return m.content
    if (Array.isArray(m.content)) return m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
    return ''
  }).join('\n')
}

async function platformRefusal(label: string): Promise<AiCallFailure | null> {
  const left = await platformBudgetLeft()
  if (left !== null && left <= 0) {
    console.warn(`[ai] platform AI budget for today is spent — ${label} skipped`)
    return { ok: false, error: 'BUDGET_EXCEEDED', message: 'дневной бюджет ИИ платформы исчерпан' }
  }
  return null
}

function failureOf(run: { failure: ClientFailure | null; refusal: string | null }): AiCallFailure {
  if (!run.failure) return { ok: false, error: 'BUDGET_EXCEEDED', message: run.refusal ?? 'бюджет провайдера исчерпан' }
  return { ok: false, error: run.failure.code, message: run.failure.message }
}

function logTag(target: ProviderTarget): string {
  return `[ai:${target.providerKey}]`
}

// ── chat with tools / vision ───────────────────────────────────────────────

export interface ChatWithToolsOptions extends Accounting {
  tier: ChatTier
  messages: ToolChatMessage[]
  /** OpenAI function tools (JSON-schema parameters); [] = plain chat. */
  tools: ToolDefinition[]
  toolChoice?: ToolChoice
  maxTokens?: number
  /** null omits temperature. Default 0.2. */
  temperature?: number | null
  timeoutMs?: number
  /** Pin a model id (registered or OpenRouter); unavailable → the tier's models. */
  model?: string | null
}

export type ChatWithToolsResult =
  | {
      ok: true
      message: { content: string; tool_calls: ToolCall[] }
      model: string
      providerKey: string
      finishReason: string | null
      costUsd: number
    }
  | AiCallFailure

/**
 * One model step: sends the messages (and tools) to the first working
 * candidate. With tools, models known not to support tools are skipped and a
 * 400 from a model whose tool support is unknown also moves on; with image
 * parts, text-only models are skipped and vision models go first.
 */
export async function chatWithTools(opts: ChatWithToolsOptions): Promise<ChatWithToolsResult> {
  const label = opts.label ?? opts.feature
  if (!opts.messages.length) return { ok: false, error: 'INVALID_INPUT', message: 'нет сообщений' }
  const vision = hasImageParts(opts.messages)
  const withTools = opts.tools.length > 0
  const resolved = await resolveCandidates('chat', {
    tier: opts.tier,
    model: opts.model ?? null,
    fallbackModel: modelForTier(opts.tier, opts.model ?? null),
    requireTools: withTools,
    requireVision: vision,
  })
  if (!resolved.ok) return { ok: false, error: resolved.code === 'NO_API_KEY' ? 'NO_API_KEY' : 'NOT_CONFIGURED', message: resolved.message }
  const refused = await platformRefusal(label)
  if (refused) return refused

  const maxTokens = opts.maxTokens ?? 1500
  const timeoutMs = opts.timeoutMs ?? 45_000
  const inputText = `${messagesText(opts.messages)}${withTools ? JSON.stringify(opts.tools) : ''}`
  const prices = (target: ProviderTarget, answeredBy?: string) =>
    knownModelPrices(answeredBy) ?? knownModelPrices(target.model) ?? TIER_ESTIMATE_PRICES_PER_MTOK[opts.tier]
  const started = Date.now()

  const run = await runWithFailover(
    resolved.candidates,
    (target) => chatCompletionWithTools(target, {
      messages: opts.messages,
      tools: opts.tools,
      toolChoice: opts.toolChoice,
      maxTokens,
      temperature: opts.temperature === null ? null : (opts.temperature ?? 0.2),
      timeoutMs,
    }),
    {
      budgetCheck: providerBudgetRefusal,
      // A model that cannot take tools / images often answers 400: try the next one.
      alsoFailoverOn: (target, f) => f.status === 400
        && ((withTools && target.supportsTools !== true) || (vision && target.supportsVision !== true)),
      onFailure: async (target, f) => {
        if (f.code === 'TIMEOUT') {
          await recordUsage({
            source: `feature:${label}`, model: target.model, tokensIn: estimateTokens(inputText), tokensOut: 0,
            costUsd: worstCaseCostUsd(prices(target), inputText, maxTokens), costSource: 'estimate',
            companyId: opts.companyId ?? null, providerKey: target.providerKey, ok: false,
          })
        }
        console.error(`${logTag(target)} ${label} failed:`, f.status ?? f.message)
      },
    },
  )
  if (!run.ok) {
    if (run.failure) {
      const target = run.target ?? resolved.candidates[0]
      await recordAiUsage({ feature: opts.feature, model: target.model, ok: false, latencyMs: Date.now() - started, userId: opts.userId })
    }
    return failureOf(run)
  }
  const { result: res, target } = run
  const tokensIn = res.tokensIn ?? estimateTokens(inputText)
  const tokensOut = res.tokensOut ?? 0
  const cost = computeCost({
    providerCostUsd: res.providerCostUsd, tokensIn, tokensOut,
    priceInPerMtok: target.priceInPerMtok, priceOutPerMtok: target.priceOutPerMtok,
    estimatePrices: prices(target, res.model),
  })
  await recordUsage({
    source: `feature:${label}`, model: res.model, tokensIn, tokensOut, costUsd: cost.costUsd, costSource: cost.costSource,
    companyId: opts.companyId ?? null, providerKey: target.providerKey, ok: true,
  })
  const answered = Boolean(res.message.content.trim()) || res.message.tool_calls.length > 0
  await recordAiUsage({
    feature: opts.feature, model: res.model, promptTokens: tokensIn, completionTokens: tokensOut,
    providerCostUsd: cost.costUsd, latencyMs: Date.now() - started, ok: answered, userId: opts.userId,
  })
  if (!answered) return { ok: false, error: 'INVALID_OUTPUT', message: 'пустой ответ модели' }
  return {
    ok: true, message: res.message, model: res.model, providerKey: target.providerKey,
    finishReason: res.finishReason, costUsd: cost.costUsd,
  }
}

// ── one question about an image ────────────────────────────────────────────

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export interface AskAboutImageOptions extends Accounting {
  prompt: string
  system?: string
  /** https URL or raw bytes (sent as a data: URL). */
  image: { url: string } | { bytes: Uint8Array; mime: string }
  tier?: ChatTier
  maxTokens?: number
  timeoutMs?: number
}

export async function askAboutImage(opts: AskAboutImageOptions): Promise<{ ok: true; text: string; model: string; providerKey: string } | AiCallFailure> {
  let url: string
  if ('url' in opts.image) {
    if (!/^https:\/\//i.test(opts.image.url)) return { ok: false, error: 'INVALID_INPUT', message: 'нужна https-ссылка на изображение' }
    url = opts.image.url
  } else {
    if (!/^image\/[a-z0-9.+-]+$/i.test(opts.image.mime)) return { ok: false, error: 'INVALID_INPUT', message: 'это не изображение' }
    if (opts.image.bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, error: 'INVALID_INPUT', message: 'изображение больше 10 МБ' }
    url = `data:${opts.image.mime};base64,${Buffer.from(opts.image.bytes).toString('base64')}`
  }
  const content: ContentPart[] = [{ type: 'text', text: opts.prompt }, { type: 'image_url', image_url: { url } }]
  const messages: ToolChatMessage[] = []
  if (opts.system) messages.push({ role: 'system', content: opts.system })
  messages.push({ role: 'user', content })
  const r = await chatWithTools({
    feature: opts.feature, label: opts.label, companyId: opts.companyId, userId: opts.userId,
    tier: opts.tier ?? 'standard', messages, tools: [], maxTokens: opts.maxTokens ?? 1500, timeoutMs: opts.timeoutMs ?? 60_000,
  })
  return r.ok ? { ok: true, text: r.message.content, model: r.model, providerKey: r.providerKey } : r
}

// ── speech-to-text ─────────────────────────────────────────────────────────

/** OpenAI's /audio/transcriptions limit; Telegram voice notes are far below it. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024

/** OpenRouter audio-input chat model used when no 'transcribe' model works. */
export function transcribeFallbackModel(): string {
  return process.env.AI_TRANSCRIBE_FALLBACK_MODEL?.trim() || 'google/gemini-2.5-flash'
}

/** input_audio format of a MIME type / file name (Telegram voice = OGG/Opus). */
export function audioFormatOf(mime: string, filename = ''): string {
  const m = mime.toLowerCase()
  if (m.includes('ogg') || m.includes('opus')) return 'ogg'
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  if (m.includes('wav')) return 'wav'
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return m.includes('aac') ? 'aac' : 'm4a'
  if (m.includes('webm')) return 'webm'
  if (m.includes('flac')) return 'flac'
  const ext = /\.([a-z0-9]{2,5})$/i.exec(filename)?.[1]?.toLowerCase()
  if (ext === 'oga' || ext === 'opus') return 'ogg'
  return ext || 'ogg'
}

export interface TranscribeOptions extends Accounting {
  bytes: Uint8Array
  filename: string
  mime: string
  /** ISO-639-1 hint (ru, kk, en); omitted = auto. */
  language?: string
  timeoutMs?: number
}

export type TranscribeResult = { ok: true; text: string; model: string; providerKey: string } | AiCallFailure

export async function transcribeAudio(opts: TranscribeOptions): Promise<TranscribeResult> {
  const label = opts.label ?? opts.feature
  if (!opts.bytes.byteLength) return { ok: false, error: 'INVALID_INPUT', message: 'пустой аудиофайл' }
  if (opts.bytes.byteLength > MAX_AUDIO_BYTES) return { ok: false, error: 'INVALID_INPUT', message: 'аудио больше 25 МБ' }
  const language = opts.language && /^[a-z]{2}$/i.test(opts.language) ? opts.language.toLowerCase() : undefined
  const timeoutMs = opts.timeoutMs ?? 60_000

  const stt = await resolveCandidates('transcribe')
  // Fallback: an audio-input chat model, only through OpenRouter (never another provider).
  const viaChat = await resolveCandidates('chat', { model: transcribeFallbackModel(), fallbackModel: transcribeFallbackModel(), tier: 'light' })
  const chatTargets = viaChat.ok ? viaChat.candidates.filter((t) => t.kind === 'openrouter' && t.model === transcribeFallbackModel()) : []
  const sttTargets = stt.ok ? stt.candidates : []
  if (!sttTargets.length && !chatTargets.length) {
    return { ok: false, error: 'NOT_CONFIGURED', message: 'нет модели распознавания речи (transcribe) и ключа OpenRouter' }
  }
  const refused = await platformRefusal(label)
  if (refused) return refused
  const started = Date.now()

  const record = async (target: ProviderTarget, model: string, costUsd: number | null, tokensIn = 0, tokensOut = 0, estimate = 0) => {
    const cost = costUsd ?? estimate
    await recordUsage({
      source: `feature:${label}`, model, tokensIn, tokensOut, costUsd: cost,
      costSource: costUsd !== null ? 'provider' : 'estimate', companyId: opts.companyId ?? null,
      providerKey: target.providerKey, ok: true,
    })
    await recordAiUsage({
      feature: opts.feature, model, promptTokens: tokensIn, completionTokens: tokensOut, providerCostUsd: cost,
      latencyMs: Date.now() - started, ok: true, userId: opts.userId,
    })
  }
  let last: { failure: ClientFailure | null; refusal: string | null; target: ProviderTarget | null } | null = null

  if (sttTargets.length) {
    const run = await runWithFailover(
      sttTargets,
      (target) => transcribeAudioRequest(target, { bytes: opts.bytes, filename: opts.filename, mime: opts.mime, language, timeoutMs }),
      {
        budgetCheck: providerBudgetRefusal,
        onFailure: (target, f) => { console.error(`${logTag(target)} ${label} transcription failed:`, f.status ?? f.message) },
      },
    )
    if (run.ok) {
      await record(run.target, run.result.model, run.result.providerCostUsd)
      return { ok: true, text: run.result.text, model: run.result.model, providerKey: run.target.providerKey }
    }
    last = run
  }

  if (chatTargets.length) {
    const prompt = `Транскрибируй эту аудиозапись дословно${language ? ` (язык: ${language})` : ''}. Верни только текст речи, без комментариев. Если речи нет — верни пустую строку.`
    const content: ContentPart[] = [
      { type: 'text', text: prompt },
      { type: 'input_audio', input_audio: { data: Buffer.from(opts.bytes).toString('base64'), format: audioFormatOf(opts.mime, opts.filename) } },
    ]
    const run = await runWithFailover(
      chatTargets,
      (target) => chatCompletion(target, { messages: [{ role: 'user', content }], maxTokens: 2000, temperature: 0, timeoutMs }),
      {
        budgetCheck: providerBudgetRefusal,
        onFailure: (target, f) => { console.error(`${logTag(target)} ${label} audio chat failed:`, f.status ?? f.message) },
      },
    )
    if (run.ok) {
      const r = run.result
      const tokensIn = r.tokensIn ?? 0
      const tokensOut = r.tokensOut ?? 0
      const cost = computeCost({
        providerCostUsd: r.providerCostUsd, tokensIn, tokensOut, priceInPerMtok: null, priceOutPerMtok: null,
        estimatePrices: knownModelPrices(r.model) ?? TIER_ESTIMATE_PRICES_PER_MTOK.light,
      })
      await record(run.target, r.model, cost.costSource === 'provider' ? cost.costUsd : null, tokensIn, tokensOut, cost.costUsd)
      return { ok: true, text: r.text.trim(), model: r.model, providerKey: run.target.providerKey }
    }
    last = run
  }

  if (last?.failure) {
    const target = last.target ?? sttTargets[0] ?? chatTargets[0]
    await recordAiUsage({ feature: opts.feature, model: target.model, ok: false, latencyMs: Date.now() - started, userId: opts.userId })
  }
  return failureOf(last ?? { failure: null, refusal: null })
}
