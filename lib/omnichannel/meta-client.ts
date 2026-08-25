export const DEFAULT_META_GRAPH_API_VERSION = 'v25.0'
export const DEFAULT_META_GRAPH_TIMEOUT_MS = 10_000
export const INSTAGRAM_GRAPH_ORIGIN = 'https://graph.instagram.com'
export const WHATSAPP_GRAPH_ORIGIN = 'https://graph.facebook.com'

export type MetaFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface MetaEnvironment {
  META_GRAPH_API_VERSION?: string
  META_GRAPH_TIMEOUT_MS?: string
  INSTAGRAM_ACCESS_TOKEN?: string
  INSTAGRAM_ACCOUNT_ID?: string
  WHATSAPP_TOKEN?: string
  WHATSAPP_PHONE_NUMBER_ID?: string
  [key: string]: string | undefined
}

export interface MetaChannelConfigurationHealth {
  configured: boolean
  tokenConfigured: boolean
  accountIdConfigured: boolean
  missing: string[]
}

/** Deliberately exposes presence only. Access tokens are never returned. */
export interface MetaConfigurationHealth {
  graphApiVersion: string
  timeoutMs: number
  instagram: MetaChannelConfigurationHealth
  whatsapp: MetaChannelConfigurationHealth
}

export interface MetaSendSuccess {
  ok: true
  externalMessageId: string
  rawStatus?: number
}

export interface MetaSendFailure {
  ok: false
  /** Explicitly false/absent for a provider rejection that is safe to retry by policy. */
  deliveryUnknown?: false
  status: number | null
  code: string | null
  message: string
  retryable: boolean
}

/**
 * Meta may have accepted the POST, but the caller cannot prove its provider
 * message id because either the 2xx acknowledgement was incomplete or the
 * connection failed after write. This outcome must never be retried
 * automatically.
 */
export interface MetaSendDeliveryUnknown {
  ok: false
  deliveryUnknown: true
  status: number | null
  code: 'provider_ack_missing_message_id' | 'provider_request_outcome_unknown'
  message: string
  retryable: false
}

export type MetaSendResult =
  | MetaSendSuccess
  | MetaSendFailure
  | MetaSendDeliveryUnknown

export interface SendInstagramTextInput {
  recipientId: string
  text: string
  actor: 'automated' | 'manual'
  /** Fail-closed routing check for the conversation's receiving account. */
  accountExternalId?: string
  /** HUMAN_AGENT is applied only when actor is explicitly manual. */
  useHumanAgent?: boolean
}

export interface SendWhatsAppTextInput {
  recipientId: string
  text: string
  /** Fail-closed routing check for the conversation's receiving phone id. */
  accountExternalId?: string
  replyToExternalId?: string | null
}

export interface SendWhatsAppTemplateInput {
  /** E.164 digits without the leading plus, as required by Meta. */
  recipientId: string
  /** Approved Meta template name. The integration selects it server-side. */
  templateName: string
  languageCode: string
  bodyParameters: string[]
  /** Fail-closed routing check for the configured Cloud API sender. */
  accountExternalId?: string
}

export interface MetaInteractiveOption {
  id: string
  title: string
  description?: string
}

export interface SendInstagramQuickRepliesInput extends SendInstagramTextInput {
  options: MetaInteractiveOption[]
}

export interface SendWhatsAppListInput extends SendWhatsAppTextInput {
  options: MetaInteractiveOption[]
  buttonText?: string
  sectionTitle?: string
}

export interface MetaHttpSuccess<T> {
  ok: true
  status: number
  data: T
}

export interface MetaHttpFailure extends MetaSendFailure {
  ok: false
}

export type MetaHttpResult<T> = MetaHttpSuccess<T> | MetaHttpFailure

export interface MetaClientOptions {
  env?: MetaEnvironment
  fetch?: MetaFetch
  fetchImpl?: MetaFetch
  graphApiVersion?: string
  timeoutMs?: number
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeGraphVersion(value: string | undefined): string {
  const candidate = nonEmpty(value)
  if (!candidate || !/^v?\d+\.\d+$/.test(candidate)) {
    return DEFAULT_META_GRAPH_API_VERSION
  }
  return candidate.startsWith('v') ? candidate : `v${candidate}`
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.trunc(parsed), 120_000)
}

function channelHealth(
  env: MetaEnvironment,
  tokenName: 'INSTAGRAM_ACCESS_TOKEN' | 'WHATSAPP_TOKEN',
  accountIdName: 'INSTAGRAM_ACCOUNT_ID' | 'WHATSAPP_PHONE_NUMBER_ID',
): MetaChannelConfigurationHealth {
  const tokenConfigured = Boolean(nonEmpty(env[tokenName]))
  const accountIdConfigured = Boolean(nonEmpty(env[accountIdName]))
  const missing: string[] = []
  if (!tokenConfigured) missing.push(tokenName)
  if (!accountIdConfigured) missing.push(accountIdName)
  return {
    configured: tokenConfigured && accountIdConfigured,
    tokenConfigured,
    accountIdConfigured,
    missing,
  }
}

export function getMetaConfigurationHealth(
  options: Pick<MetaClientOptions, 'env' | 'graphApiVersion' | 'timeoutMs'> = {},
): MetaConfigurationHealth {
  const env = options.env ?? process.env
  return {
    graphApiVersion: normalizeGraphVersion(
      options.graphApiVersion ?? env.META_GRAPH_API_VERSION,
    ),
    timeoutMs: positiveInteger(
      options.timeoutMs ?? env.META_GRAPH_TIMEOUT_MS,
      DEFAULT_META_GRAPH_TIMEOUT_MS,
    ),
    instagram: channelHealth(env, 'INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_ACCOUNT_ID'),
    whatsapp: channelHealth(env, 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'),
  }
}

export function getConfiguredMetaAccountId(
  channel: 'instagram' | 'whatsapp',
  env: MetaEnvironment = process.env,
): string | null {
  return nonEmpty(
    channel === 'instagram' ? env.INSTAGRAM_ACCOUNT_ID : env.WHATSAPP_PHONE_NUMBER_ID,
  )
}

export function isConfiguredMetaAccount(
  channel: 'instagram' | 'whatsapp',
  accountExternalId: string,
  env: MetaEnvironment = process.env,
): boolean {
  return getConfiguredMetaAccountId(channel, env) === nonEmpty(accountExternalId)
}

function replaceAll(value: string, search: string, replacement: string): string {
  return search ? value.split(search).join(replacement) : value
}

/** Redacts both configured secrets and common accidental token renderings. */
export function redactMetaSecrets(value: unknown, secrets: Array<string | null | undefined> = []): string {
  let safe = value instanceof Error ? value.message : String(value ?? '')
  for (const secret of secrets) {
    if (!secret) continue
    safe = replaceAll(safe, secret, '[REDACTED]')
    try {
      safe = replaceAll(safe, encodeURIComponent(secret), '[REDACTED]')
    } catch {
      // A malformed value cannot be URI encoded; direct replacement above is enough.
    }
  }
  safe = safe
    .replace(/([?&]access_token=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
  return safe.slice(0, 500) || 'Meta API request failed'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function graphFailure(
  status: number | null,
  payload: unknown,
  secrets: string[],
  fallback: string,
): MetaHttpFailure {
  const graphError = asRecord(asRecord(payload)?.error)
  const rawCode = graphError?.code
  const code =
    typeof rawCode === 'string' || typeof rawCode === 'number'
      ? String(rawCode)
      : null
  const rawMessage =
    typeof graphError?.message === 'string'
      ? graphError.message
      : typeof payload === 'string' && payload.trim()
        ? payload
        : fallback
  const numericCode = typeof rawCode === 'number' ? rawCode : Number(rawCode)
  const retryableCodes = new Set([1, 2, 4, 17, 32, 341, 613])
  const retryable =
    status === 408 ||
    status === 429 ||
    (status !== null && status >= 500) ||
    graphError?.is_transient === true ||
    retryableCodes.has(numericCode)

  return {
    ok: false,
    status,
    code,
    message: redactMetaSecrets(rawMessage, secrets),
    retryable,
  }
}

function localFailure(
  code: string,
  message: string,
  retryable = false,
): MetaSendFailure {
  return { ok: false, status: null, code, message, retryable }
}

function missingWhatsAppMessageId(status: number): MetaSendDeliveryUnknown {
  return {
    ok: false,
    deliveryUnknown: true,
    status,
    code: 'provider_ack_missing_message_id',
    message: 'WhatsApp API returned 2xx without messages[0].id; delivery is unknown',
    retryable: false,
  }
}

function unknownWhatsAppRequestOutcome(
  failure: MetaSendFailure,
): MetaSendDeliveryUnknown {
  return {
    ok: false,
    deliveryUnknown: true,
    status: failure.status,
    code: 'provider_request_outcome_unknown',
    message: `WhatsApp API request outcome is unknown: ${failure.message}`,
    retryable: false,
  }
}

function uniqueNonEmptyOptionIds(options: MetaInteractiveOption[]): boolean {
  const ids = options.map((option) => nonEmpty(option.id))
  return ids.every((id): id is string => Boolean(id)) && new Set(ids).size === ids.length
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function cleanProviderUrl(origin: string, version: string, pathOrUrl: string): string | null {
  try {
    const url = /^https?:\/\//i.test(pathOrUrl)
      ? new URL(pathOrUrl)
      : new URL(
          pathOrUrl.startsWith(`/${version}/`)
            ? pathOrUrl
            : `/${version}/${pathOrUrl.replace(/^\/+/, '')}`,
          origin,
        )
    if (url.origin !== origin) return null
    url.searchParams.delete('access_token')
    return url.toString()
  } catch {
    return null
  }
}

export class MetaClient {
  readonly graphApiVersion: string
  readonly timeoutMs: number

  private readonly env: MetaEnvironment
  private readonly fetchImpl: MetaFetch
  private readonly instagramToken: string | null
  private readonly instagramAccountId: string | null
  private readonly whatsappToken: string | null
  private readonly whatsappPhoneNumberId: string | null

  constructor(options: MetaClientOptions = {}) {
    this.env = options.env ?? process.env
    this.graphApiVersion = normalizeGraphVersion(
      options.graphApiVersion ?? this.env.META_GRAPH_API_VERSION,
    )
    this.timeoutMs = positiveInteger(
      options.timeoutMs ?? this.env.META_GRAPH_TIMEOUT_MS,
      DEFAULT_META_GRAPH_TIMEOUT_MS,
    )
    this.fetchImpl = options.fetchImpl ?? options.fetch ?? globalThis.fetch.bind(globalThis)
    this.instagramToken = nonEmpty(this.env.INSTAGRAM_ACCESS_TOKEN)
    this.instagramAccountId = nonEmpty(this.env.INSTAGRAM_ACCOUNT_ID)
    this.whatsappToken = nonEmpty(this.env.WHATSAPP_TOKEN)
    this.whatsappPhoneNumberId = nonEmpty(this.env.WHATSAPP_PHONE_NUMBER_ID)
  }

  getConfigurationHealth(): MetaConfigurationHealth {
    return getMetaConfigurationHealth({
      env: this.env,
      graphApiVersion: this.graphApiVersion,
      timeoutMs: this.timeoutMs,
    })
  }

  private secrets(): string[] {
    return [this.instagramToken, this.whatsappToken].filter(
      (value): value is string => Boolean(value),
    )
  }

  private async requestJson<T>(input: {
    origin: string
    pathOrUrl: string
    token: string | null
    method?: 'GET' | 'POST'
    body?: unknown
  }): Promise<MetaHttpResult<T>> {
    if (!input.token) {
      return localFailure('configuration_error', 'Meta channel access token is not configured')
    }

    const url = cleanProviderUrl(input.origin, this.graphApiVersion, input.pathOrUrl)
    if (!url) {
      return localFailure('invalid_url', 'Meta API URL is invalid or uses an unexpected host')
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    const secrets = this.secrets()

    try {
      const response = await this.fetchImpl(url, {
        method: input.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${input.token}`,
          Accept: 'application/json',
          ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: controller.signal,
      })
      const payload = await readResponseBody(response)
      const embeddedError = asRecord(payload)?.error

      if (!response.ok || embeddedError) {
        return graphFailure(
          response.status,
          payload,
          secrets,
          `Meta API request failed with HTTP ${response.status}`,
        )
      }

      if (payload === null || typeof payload === 'string') {
        return {
          ok: false,
          status: response.status,
          code: 'invalid_response',
          message: 'Meta API returned an invalid JSON response',
          retryable: false,
        }
      }

      return { ok: true, status: response.status, data: payload as T }
    } catch (error) {
      const isTimeout =
        controller.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      return {
        ok: false,
        status: null,
        code: isTimeout ? 'timeout' : 'network_error',
        message: isTimeout
          ? `Meta API request timed out after ${this.timeoutMs}ms`
          : redactMetaSecrets(error, secrets),
        retryable: true,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Authenticated GET used by the bounded Instagram history importer. */
  async getInstagramJson<T>(pathOrUrl: string): Promise<MetaHttpResult<T>> {
    return this.requestJson<T>({
      origin: INSTAGRAM_GRAPH_ORIGIN,
      pathOrUrl,
      token: this.instagramToken,
    })
  }

  async sendInstagramText(input: SendInstagramTextInput): Promise<MetaSendResult> {
    if (!this.instagramAccountId || !this.instagramToken) {
      return localFailure(
        'configuration_error',
        'Instagram messaging is not configured (INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_ACCOUNT_ID are required)',
      )
    }
    if (!nonEmpty(input.recipientId) || !nonEmpty(input.text)) {
      return localFailure('invalid_input', 'Instagram recipientId and text are required')
    }
    if (input.accountExternalId && input.accountExternalId !== this.instagramAccountId) {
      return localFailure(
        'account_configuration_mismatch',
        'Instagram conversation account does not match the configured sender account',
      )
    }

    const body: Record<string, unknown> = {
      recipient: { id: input.recipientId },
      message: { text: input.text },
    }
    if (input.actor === 'manual' && input.useHumanAgent === true) {
      body.tag = 'HUMAN_AGENT'
    }

    const result = await this.requestJson<Record<string, unknown>>({
      origin: INSTAGRAM_GRAPH_ORIGIN,
      pathOrUrl: `${encodeURIComponent(this.instagramAccountId)}/messages`,
      token: this.instagramToken,
      method: 'POST',
      body,
    })
    if (!result.ok) return result

    const externalMessageId = nonEmpty(result.data.message_id) ?? nonEmpty(result.data.id)
    if (!externalMessageId) {
      return {
        ok: false,
        status: result.status,
        code: 'invalid_response',
        message: 'Instagram API response did not include message_id',
        retryable: false,
      }
    }
    return { ok: true, externalMessageId, rawStatus: result.status }
  }

  async sendInstagramQuickReplies(
    input: SendInstagramQuickRepliesInput,
  ): Promise<MetaSendResult> {
    if (!this.instagramAccountId || !this.instagramToken) {
      return localFailure(
        'configuration_error',
        'Instagram messaging is not configured (INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_ACCOUNT_ID are required)',
      )
    }
    if (!nonEmpty(input.recipientId) || !nonEmpty(input.text)) {
      return localFailure('invalid_input', 'Instagram recipientId and text are required')
    }
    if (input.accountExternalId && input.accountExternalId !== this.instagramAccountId) {
      return localFailure(
        'account_configuration_mismatch',
        'Instagram conversation account does not match the configured sender account',
      )
    }
    if (
      input.options.length < 1
      || input.options.length > 13
      || input.text.length > 1_000
      || !uniqueNonEmptyOptionIds(input.options)
      || input.options.some((option) =>
        !nonEmpty(option.title)
        || option.title !== option.title.trim()
        || option.id !== option.id.trim()
        || option.title.length > 20
        || option.id.length > 1_000,
      )
    ) {
      return localFailure('invalid_input', 'Instagram quick replies violate provider limits')
    }

    const body: Record<string, unknown> = {
      recipient: { id: input.recipientId },
      message: {
        text: input.text,
        quick_replies: input.options.map((option) => ({
          content_type: 'text',
          title: option.title,
          payload: option.id,
        })),
      },
    }
    if (input.actor === 'manual' && input.useHumanAgent === true) {
      body.tag = 'HUMAN_AGENT'
    }

    const result = await this.requestJson<Record<string, unknown>>({
      origin: INSTAGRAM_GRAPH_ORIGIN,
      pathOrUrl: `${encodeURIComponent(this.instagramAccountId)}/messages`,
      token: this.instagramToken,
      method: 'POST',
      body,
    })
    if (!result.ok) return result

    const externalMessageId = nonEmpty(result.data.message_id) ?? nonEmpty(result.data.id)
    if (!externalMessageId) {
      return {
        ok: false,
        status: result.status,
        code: 'invalid_response',
        message: 'Instagram API response did not include message_id',
        retryable: false,
      }
    }
    return { ok: true, externalMessageId, rawStatus: result.status }
  }

  async sendWhatsAppText(input: SendWhatsAppTextInput): Promise<MetaSendResult> {
    if (!this.whatsappPhoneNumberId || !this.whatsappToken) {
      return localFailure(
        'configuration_error',
        'WhatsApp messaging is not configured (WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required)',
      )
    }
    if (!nonEmpty(input.recipientId) || !nonEmpty(input.text)) {
      return localFailure('invalid_input', 'WhatsApp recipientId and text are required')
    }
    if (input.accountExternalId && input.accountExternalId !== this.whatsappPhoneNumberId) {
      return localFailure(
        'account_configuration_mismatch',
        'WhatsApp conversation phone id does not match the configured sender phone id',
      )
    }

    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.recipientId,
      type: 'text',
      text: { body: input.text, preview_url: false },
    }
    if (nonEmpty(input.replyToExternalId)) {
      body.context = { message_id: input.replyToExternalId }
    }

    const result = await this.requestJson<Record<string, unknown>>({
      origin: WHATSAPP_GRAPH_ORIGIN,
      pathOrUrl: `${encodeURIComponent(this.whatsappPhoneNumberId)}/messages`,
      token: this.whatsappToken,
      method: 'POST',
      body,
    })
    if (!result.ok) return result

    const messages = Array.isArray(result.data.messages) ? result.data.messages : []
    const firstMessage = asRecord(messages[0])
    const externalMessageId = nonEmpty(firstMessage?.id)
    if (!externalMessageId) {
      return {
        ok: false,
        status: result.status,
        code: 'invalid_response',
        message: 'WhatsApp API response did not include messages[0].id',
        retryable: false,
      }
    }
    return { ok: true, externalMessageId, rawStatus: result.status }
  }

  async sendWhatsAppTemplate(
    input: SendWhatsAppTemplateInput,
  ): Promise<MetaSendResult> {
    if (!this.whatsappPhoneNumberId || !this.whatsappToken) {
      return localFailure(
        'configuration_error',
        'WhatsApp messaging is not configured (WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required)',
      )
    }
    if (input.accountExternalId && input.accountExternalId !== this.whatsappPhoneNumberId) {
      return localFailure(
        'account_configuration_mismatch',
        'WhatsApp template sender does not match the configured phone id',
      )
    }
    if (
      !/^[1-9][0-9]{7,14}$/.test(input.recipientId)
      || !/^[a-z0-9_]{1,512}$/.test(input.templateName)
      || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(input.languageCode)
      || input.bodyParameters.length > 20
      || input.bodyParameters.some((parameter) =>
        parameter !== parameter.trim()
        || parameter.length < 1
        || parameter.length > 1_024,
      )
    ) {
      return localFailure(
        'invalid_input',
        'WhatsApp template send input violates provider limits',
      )
    }

    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.recipientId,
      type: 'template',
      template: {
        name: input.templateName,
        language: {
          policy: 'deterministic',
          code: input.languageCode,
        },
        ...(input.bodyParameters.length > 0
          ? {
              components: [{
                type: 'body',
                parameters: input.bodyParameters.map((parameter) => ({
                  type: 'text',
                  text: parameter,
                })),
              }],
            }
          : {}),
      },
    }

    const result = await this.requestJson<Record<string, unknown>>({
      origin: WHATSAPP_GRAPH_ORIGIN,
      pathOrUrl: `${encodeURIComponent(this.whatsappPhoneNumberId)}/messages`,
      token: this.whatsappToken,
      method: 'POST',
      body,
    })
    if (!result.ok) {
      if (
        result.status === null
        || result.status === 408
        || result.status >= 500
      ) return unknownWhatsAppRequestOutcome(result)
      return result.status !== null && result.status >= 200 && result.status < 300
        ? missingWhatsAppMessageId(result.status)
        : result
    }

    const messages = Array.isArray(result.data.messages) ? result.data.messages : []
    const firstMessage = asRecord(messages[0])
    const externalMessageId = nonEmpty(firstMessage?.id)
    if (!externalMessageId) {
      return missingWhatsAppMessageId(result.status)
    }
    return { ok: true, externalMessageId, rawStatus: result.status }
  }

  async sendWhatsAppList(input: SendWhatsAppListInput): Promise<MetaSendResult> {
    if (!this.whatsappPhoneNumberId || !this.whatsappToken) {
      return localFailure(
        'configuration_error',
        'WhatsApp messaging is not configured (WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required)',
      )
    }
    const text = nonEmpty(input.text)
    const recipientId = nonEmpty(input.recipientId)
    const buttonText = nonEmpty(input.buttonText) ?? 'Выбрать'
    const sectionTitle = nonEmpty(input.sectionTitle) ?? 'Экипировка'
    if (!recipientId || !text) {
      return localFailure('invalid_input', 'WhatsApp recipientId and text are required')
    }
    if (input.accountExternalId && input.accountExternalId !== this.whatsappPhoneNumberId) {
      return localFailure(
        'account_configuration_mismatch',
        'WhatsApp conversation phone id does not match the configured sender phone id',
      )
    }
    if (
      text.length > 1_024
      || buttonText.length > 20
      || sectionTitle.length > 24
      || input.options.length < 1
      || input.options.length > 10
      || !uniqueNonEmptyOptionIds(input.options)
      || input.options.some((option) =>
        !nonEmpty(option.title)
        || option.title !== option.title.trim()
        || option.id !== option.id.trim()
        || option.title.length > 24
        || option.id.length > 200
        || (option.description?.length ?? 0) > 72,
      )
    ) {
      return localFailure('invalid_input', 'WhatsApp list message violates provider limits')
    }

    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientId,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text },
        action: {
          button: buttonText,
          sections: [{
            title: sectionTitle,
            rows: input.options.map((option) => ({
              id: option.id,
              title: option.title,
              ...(option.description ? { description: option.description } : {}),
            })),
          }],
        },
      },
    }
    if (nonEmpty(input.replyToExternalId)) {
      body.context = { message_id: input.replyToExternalId }
    }

    const result = await this.requestJson<Record<string, unknown>>({
      origin: WHATSAPP_GRAPH_ORIGIN,
      pathOrUrl: `${encodeURIComponent(this.whatsappPhoneNumberId)}/messages`,
      token: this.whatsappToken,
      method: 'POST',
      body,
    })
    if (!result.ok) return result

    const messages = Array.isArray(result.data.messages) ? result.data.messages : []
    const firstMessage = asRecord(messages[0])
    const externalMessageId = nonEmpty(firstMessage?.id)
    if (!externalMessageId) {
      return {
        ok: false,
        status: result.status,
        code: 'invalid_response',
        message: 'WhatsApp API response did not include messages[0].id',
        retryable: false,
      }
    }
    return { ok: true, externalMessageId, rawStatus: result.status }
  }
}

export function createMetaClient(options: MetaClientOptions = {}): MetaClient {
  return new MetaClient(options)
}

export async function sendInstagramText(
  input: SendInstagramTextInput,
  options: MetaClientOptions = {},
): Promise<MetaSendResult> {
  return createMetaClient(options).sendInstagramText(input)
}

export async function sendWhatsAppText(
  input: SendWhatsAppTextInput,
  options: MetaClientOptions = {},
): Promise<MetaSendResult> {
  return createMetaClient(options).sendWhatsAppText(input)
}

export async function sendWhatsAppTemplate(
  input: SendWhatsAppTemplateInput,
  options: MetaClientOptions = {},
): Promise<MetaSendResult> {
  return createMetaClient(options).sendWhatsAppTemplate(input)
}

export async function sendInstagramQuickReplies(
  input: SendInstagramQuickRepliesInput,
  options: MetaClientOptions = {},
): Promise<MetaSendResult> {
  return createMetaClient(options).sendInstagramQuickReplies(input)
}

export async function sendWhatsAppList(
  input: SendWhatsAppListInput,
  options: MetaClientOptions = {},
): Promise<MetaSendResult> {
  return createMetaClient(options).sendWhatsAppList(input)
}

// Explicit aliases keep call sites readable without duplicating provider logic.
export const sendInstagramTextMessage = sendInstagramText
export const sendWhatsAppTextMessage = sendWhatsAppText
export const sendWhatsAppTemplateMessage = sendWhatsAppTemplate
