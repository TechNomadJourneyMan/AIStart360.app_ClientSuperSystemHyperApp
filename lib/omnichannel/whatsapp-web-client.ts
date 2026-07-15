import type { MetaSendFailure, MetaSendResult } from './meta-client'
import {
  createSignedBridgeHeaders,
  WHATSAPP_WEB_BRIDGE_AUDIENCE,
} from './whatsapp-web-signature'

export const WHATSAPP_WEB_ACCOUNT_PREFIX = 'waweb:' as const
export const DEFAULT_WHATSAPP_WEB_BRIDGE_TIMEOUT_MS = 10_000

export interface WhatsAppWebBridgeEnvironment {
  WHATSAPP_WEB_BRIDGE_ENABLED?: string
  WHATSAPP_WEB_BRIDGE_URL?: string
  WHATSAPP_WEB_BRIDGE_SESSION_ID?: string
  WHATSAPP_WEB_BRIDGE_API_SECRET?: string
  WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET?: string
  WHATSAPP_WEB_BRIDGE_API_KEY_ID?: string
  WHATSAPP_WEB_BRIDGE_TIMEOUT_MS?: string
  NODE_ENV?: string
  [key: string]: string | undefined
}

export interface WhatsAppWebBridgeConfig {
  baseUrl: string
  sessionId: string
  accountExternalId: string
  apiSecret: string
  keyId: string
  timeoutMs: number
}

export interface WhatsAppWebBridgeConfigurationHealth {
  enabled: boolean
  configured: boolean
  missing: string[]
  sessionIdConfigured: boolean
  accountExternalId: string | null
}

export interface SendWhatsAppWebTextInput {
  /** Canonical one-to-one WhatsApp JID, e.g. `77001234567@s.whatsapp.net`. */
  recipientId: string
  text: string
  accountExternalId: string
  replyToExternalId?: string | null
  /** Stable across retries. The bridge must persist and deduplicate this key. */
  idempotencyKey: string
}

export type WhatsAppWebPresence = 'composing' | 'paused'

export interface SendWhatsAppWebPresenceInput {
  /** Canonical one-to-one WhatsApp JID, e.g. `77001234567@s.whatsapp.net`. */
  recipientId: string
  accountExternalId: string
  presence: WhatsAppWebPresence
}

export type WhatsAppWebPresenceResult =
  | { ok: true; rawStatus: number }
  | MetaSendFailure

export type WhatsAppWebBridgeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface WhatsAppWebClientOptions {
  env?: WhatsAppWebBridgeEnvironment
  fetch?: WhatsAppWebBridgeFetch
  fetchImpl?: WhatsAppWebBridgeFetch
  timeoutMs?: number
}

export const WHATSAPP_WEB_SESSION_STATES = [
  'disconnected',
  'connecting',
  'qr',
  'connected',
  'error',
] as const
export type WhatsAppWebSessionState = (typeof WHATSAPP_WEB_SESSION_STATES)[number]

export interface WhatsAppWebSessionStatus {
  state: WhatsAppWebSessionState
  connected: boolean
  /** Transient raw pairing payload. Callers must never persist or log it. */
  qr: string | null
  updatedAt: string | null
  errorCode: string | null
}

export type WhatsAppWebControlResult =
  | { ok: true; rawStatus: number; status: WhatsAppWebSessionStatus }
  | MetaSendFailure

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function enabledFlag(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? '')
}

function validSharedSecret(value: unknown): string | null {
  const secret = nonEmpty(value)
  return secret && Buffer.byteLength(secret, 'utf8') >= 32 ? secret : null
}

function boundedTimeout(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WHATSAPP_WEB_BRIDGE_TIMEOUT_MS
  return Math.min(Math.trunc(parsed), 120_000)
}

function normalizedBridgeUrl(value: string | null, nodeEnv: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const localHttp = url.protocol === 'http:'
      && nodeEnv !== 'production'
      && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    if (url.protocol !== 'https:' && !localHttp) return null
    if (url.username || url.password || url.search || url.hash) return null
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function validSessionId(value: string | null): string | null {
  return value && /^[A-Za-z0-9._:-]{1,80}$/.test(value) ? value : null
}

function validKeyId(value: string | null): string {
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : 'primary'
}

function accountExternalId(sessionId: string): string {
  return `${WHATSAPP_WEB_ACCOUNT_PREFIX}${sessionId}`
}

export function getWhatsAppWebBridgeConfig(
  env: WhatsAppWebBridgeEnvironment = process.env,
  timeoutOverride?: number,
): WhatsAppWebBridgeConfig | null {
  if (!enabledFlag(env.WHATSAPP_WEB_BRIDGE_ENABLED)) return null
  const baseUrl = normalizedBridgeUrl(
    nonEmpty(env.WHATSAPP_WEB_BRIDGE_URL),
    env.NODE_ENV,
  )
  const sessionId = validSessionId(nonEmpty(env.WHATSAPP_WEB_BRIDGE_SESSION_ID))
  const apiSecret = validSharedSecret(env.WHATSAPP_WEB_BRIDGE_API_SECRET)
  const webhookSecret = validSharedSecret(env.WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET)
  if (
    !baseUrl
    || !sessionId
    || !apiSecret
    || !webhookSecret
    || apiSecret === webhookSecret
  ) return null

  return {
    baseUrl,
    sessionId,
    accountExternalId: accountExternalId(sessionId),
    apiSecret,
    keyId: validKeyId(nonEmpty(env.WHATSAPP_WEB_BRIDGE_API_KEY_ID)),
    timeoutMs: boundedTimeout(timeoutOverride ?? env.WHATSAPP_WEB_BRIDGE_TIMEOUT_MS),
  }
}

/** Presence-only health output; secrets and the bridge URL are never exposed. */
export function getWhatsAppWebBridgeConfigurationHealth(
  env: WhatsAppWebBridgeEnvironment = process.env,
): WhatsAppWebBridgeConfigurationHealth {
  const missing: string[] = []
  const enabled = enabledFlag(env.WHATSAPP_WEB_BRIDGE_ENABLED)
  if (!enabled) missing.push('WHATSAPP_WEB_BRIDGE_ENABLED')
  if (!normalizedBridgeUrl(nonEmpty(env.WHATSAPP_WEB_BRIDGE_URL), env.NODE_ENV)) {
    missing.push('WHATSAPP_WEB_BRIDGE_URL')
  }
  const sessionId = validSessionId(nonEmpty(env.WHATSAPP_WEB_BRIDGE_SESSION_ID))
  if (!sessionId) missing.push('WHATSAPP_WEB_BRIDGE_SESSION_ID')
  const apiSecret = validSharedSecret(env.WHATSAPP_WEB_BRIDGE_API_SECRET)
  const webhookSecret = validSharedSecret(env.WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET)
  if (!apiSecret) {
    missing.push('WHATSAPP_WEB_BRIDGE_API_SECRET')
  }
  if (!webhookSecret) {
    missing.push('WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET')
  }
  if (apiSecret && webhookSecret && apiSecret === webhookSecret) {
    missing.push('WHATSAPP_WEB_BRIDGE_SECRETS_MUST_DIFFER')
  }
  return {
    enabled,
    configured: enabled && missing.length === 0,
    missing,
    sessionIdConfigured: Boolean(sessionId),
    accountExternalId: sessionId ? accountExternalId(sessionId) : null,
  }
}

export function isConfiguredWhatsAppWebAccount(
  candidate: string,
  env: WhatsAppWebBridgeEnvironment = process.env,
): boolean {
  const health = getWhatsAppWebBridgeConfigurationHealth(env)
  return health.configured && health.accountExternalId === nonEmpty(candidate)
}

function validRecipientJid(value: string): boolean {
  return /^[1-9]\d{5,19}@(s\.whatsapp\.net|c\.us|lid)$/.test(value)
}

function validIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9._:-]{8,200}$/.test(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

async function readJson(response: Response): Promise<unknown> {
  const raw = await response.text().catch(() => '')
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function providerCode(payload: unknown): string | null {
  const root = asRecord(payload)
  const error = asRecord(root?.error)
  const candidate = error?.code ?? root?.code
  const value = typeof candidate === 'string' || typeof candidate === 'number'
    ? String(candidate)
    : null
  return value && /^[A-Za-z0-9._:-]{1,80}$/.test(value) ? value : null
}

function safeCode(value: unknown): string | null {
  const candidate = typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null
  return candidate && /^[A-Za-z0-9._:-]{1,80}$/.test(candidate) ? candidate : null
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function sessionStatus(payload: unknown): WhatsAppWebSessionStatus | null {
  const root = asRecord(payload)
  const state = typeof root?.state === 'string'
    && WHATSAPP_WEB_SESSION_STATES.includes(root.state as WhatsAppWebSessionState)
      ? root.state as WhatsAppWebSessionState
      : null
  if (!root || !state) return null
  const qr = nonEmpty(root.qr)
  return {
    state,
    connected: root.connected === true || state === 'connected',
    qr: state === 'qr' && qr && qr.length <= 16_384 ? qr : null,
    updatedAt: isoTimestamp(root.updated_at ?? root.updatedAt),
    errorCode: safeCode(root.error_code ?? root.errorCode),
  }
}

function responseMessageId(payload: unknown): string | null {
  const root = asRecord(payload)
  const message = asRecord(root?.message)
  return nonEmpty(root?.message_id)
    ?? nonEmpty(root?.messageId)
    ?? nonEmpty(message?.id)
}

function namespacedMessageId(sessionId: string, rawId: string): string {
  const prefix = `${WHATSAPP_WEB_ACCOUNT_PREFIX}${sessionId}:`
  return rawId.startsWith(prefix) ? rawId : `${prefix}${rawId}`
}

function localFailure(code: string, message: string): MetaSendFailure {
  return { ok: false, status: null, code, message, retryable: false }
}

export class WhatsAppWebClient {
  private readonly config: WhatsAppWebBridgeConfig | null
  private readonly health: WhatsAppWebBridgeConfigurationHealth
  private readonly fetchImpl: WhatsAppWebBridgeFetch

  constructor(options: WhatsAppWebClientOptions = {}) {
    const env = options.env ?? process.env
    this.config = getWhatsAppWebBridgeConfig(env, options.timeoutMs)
    this.health = getWhatsAppWebBridgeConfigurationHealth(env)
    this.fetchImpl = options.fetchImpl ?? options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  getConfigurationHealth(): WhatsAppWebBridgeConfigurationHealth {
    return this.health
  }

  private sessionEndpoint(action: 'status' | 'connect' | 'logout' | 'presence'): {
    endpoint: URL
    path: string
  } | null {
    if (!this.config) return null
    const base = new URL(this.config.baseUrl)
    const basePath = base.pathname.replace(/\/+$/, '')
    const path = `${basePath}/v1/sessions/${encodeURIComponent(this.config.sessionId)}/${action}`
      .replace(/\/{2,}/g, '/')
    return { endpoint: new URL(path, `${base.origin}/`), path }
  }

  private async sessionControl(
    action: 'status' | 'connect' | 'logout',
    idempotencyKey?: string,
  ): Promise<WhatsAppWebControlResult> {
    const config = this.config
    const target = this.sessionEndpoint(action)
    if (!config || !target) {
      return localFailure('configuration_error', 'WhatsApp Web bridge is not configured')
    }
    const method = action === 'status' ? 'GET' : 'POST'
    if (method === 'POST' && (!idempotencyKey || !validIdempotencyKey(idempotencyKey))) {
      return localFailure('invalid_input', 'A stable idempotency key is required')
    }
    const rawBody = method === 'POST'
      ? JSON.stringify({ idempotency_key: idempotencyKey })
      : ''
    const signedHeaders = createSignedBridgeHeaders({
      method,
      path: target.path,
      body: rawBody,
      secret: config.apiSecret,
      audience: WHATSAPP_WEB_BRIDGE_AUDIENCE,
      keyId: config.keyId,
    })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const response = await this.fetchImpl(target.endpoint, {
        method,
        headers: {
          Accept: 'application/json',
          ...(method === 'POST'
            ? {
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey!,
              }
            : {}),
          ...signedHeaders,
        },
        body: method === 'POST' ? rawBody : undefined,
        signal: controller.signal,
      })
      const responseBody = await readJson(response)
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          code: providerCode(responseBody) ?? `http_${response.status}`,
          message: 'WhatsApp Web bridge rejected the control request',
          retryable: response.status === 408
            || response.status === 429
            || response.status >= 500,
        }
      }
      const status = sessionStatus(responseBody)
      if (!status) {
        return {
          ok: false,
          status: response.status,
          code: 'invalid_response',
          message: 'WhatsApp Web bridge returned an invalid session status',
          retryable: false,
        }
      }
      return { ok: true, rawStatus: response.status, status }
    } catch (error) {
      const timeout = controller.signal.aborted
        || (error instanceof Error && error.name === 'AbortError')
      return {
        ok: false,
        status: null,
        code: timeout ? 'timeout' : 'network_error',
        message: timeout
          ? `WhatsApp Web bridge timed out after ${config.timeoutMs}ms`
          : 'WhatsApp Web bridge request failed',
        retryable: true,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async getStatus(): Promise<WhatsAppWebControlResult> {
    return this.sessionControl('status')
  }

  async connect(idempotencyKey: string): Promise<WhatsAppWebControlResult> {
    return this.sessionControl('connect', idempotencyKey)
  }

  async logout(idempotencyKey: string): Promise<WhatsAppWebControlResult> {
    return this.sessionControl('logout', idempotencyKey)
  }

  async sendPresence(
    input: SendWhatsAppWebPresenceInput,
  ): Promise<WhatsAppWebPresenceResult> {
    const config = this.config
    const target = this.sessionEndpoint('presence')
    if (!config || !target) {
      return localFailure(
        'configuration_error',
        'WhatsApp Web bridge is not configured',
      )
    }
    if (input.accountExternalId !== config.accountExternalId) {
      return localFailure(
        'account_configuration_mismatch',
        'WhatsApp Web conversation session does not match the configured bridge session',
      )
    }
    if (
      !validRecipientJid(input.recipientId)
      || (input.presence !== 'composing' && input.presence !== 'paused')
    ) {
      return localFailure('invalid_input', 'WhatsApp Web presence input is invalid')
    }

    const rawBody = JSON.stringify({
      to: input.recipientId,
      presence: input.presence,
    })
    const signedHeaders = createSignedBridgeHeaders({
      method: 'POST',
      path: target.path,
      body: rawBody,
      secret: config.apiSecret,
      audience: WHATSAPP_WEB_BRIDGE_AUDIENCE,
      keyId: config.keyId,
    })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)

    try {
      const response = await this.fetchImpl(target.endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...signedHeaders,
        },
        body: rawBody,
        signal: controller.signal,
      })
      const responseBody = await readJson(response)
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          code: providerCode(responseBody) ?? `http_${response.status}`,
          message: 'WhatsApp Web bridge rejected the presence request',
          retryable: response.status === 408
            || response.status === 429
            || response.status >= 500,
        }
      }
      const root = asRecord(responseBody)
      if (root?.ok !== true || root.presence !== input.presence) {
        return {
          ok: false,
          status: response.status,
          code: 'invalid_response',
          message: 'WhatsApp Web bridge returned an invalid presence response',
          retryable: false,
        }
      }
      return { ok: true, rawStatus: response.status }
    } catch (error) {
      const timeout = controller.signal.aborted
        || (error instanceof Error && error.name === 'AbortError')
      return {
        ok: false,
        status: null,
        code: timeout ? 'timeout' : 'network_error',
        message: timeout
          ? `WhatsApp Web bridge timed out after ${config.timeoutMs}ms`
          : 'WhatsApp Web bridge request failed',
        retryable: true,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async sendText(input: SendWhatsAppWebTextInput): Promise<MetaSendResult> {
    const config = this.config
    if (!config) {
      return localFailure(
        'configuration_error',
        'WhatsApp Web bridge is not configured',
      )
    }
    if (input.accountExternalId !== config.accountExternalId) {
      return localFailure(
        'account_configuration_mismatch',
        'WhatsApp Web conversation session does not match the configured bridge session',
      )
    }
    if (
      !validRecipientJid(input.recipientId)
      || !nonEmpty(input.text)
      || input.text.length > 4_096
      || !validIdempotencyKey(input.idempotencyKey)
    ) {
      return localFailure('invalid_input', 'WhatsApp Web send input is invalid')
    }

    const base = new URL(config.baseUrl)
    const basePath = base.pathname.replace(/\/+$/, '')
    const path = `${basePath}/v1/sessions/${encodeURIComponent(config.sessionId)}/messages`
      .replace(/\/{2,}/g, '/')
    const endpoint = new URL(path, `${base.origin}/`)
    const payload = {
      to: input.recipientId,
      type: 'text',
      text: input.text,
      idempotency_key: input.idempotencyKey,
      ...(nonEmpty(input.replyToExternalId)
        ? { reply_to_message_id: input.replyToExternalId }
        : {}),
    }
    const rawBody = JSON.stringify(payload)
    const signedHeaders = createSignedBridgeHeaders({
      method: 'POST',
      path: endpoint.pathname,
      body: rawBody,
      secret: config.apiSecret,
      audience: WHATSAPP_WEB_BRIDGE_AUDIENCE,
      keyId: config.keyId,
    })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)

    try {
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': input.idempotencyKey,
          ...signedHeaders,
        },
        body: rawBody,
        signal: controller.signal,
      })
      const responseBody = await readJson(response)
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          code: providerCode(responseBody) ?? `http_${response.status}`,
          message: 'WhatsApp Web bridge rejected the send request',
          retryable: response.status === 408
            || response.status === 429
            || response.status >= 500,
        }
      }
      const rawMessageId = responseMessageId(responseBody)
      if (!rawMessageId) {
        return {
          ok: false,
          status: response.status,
          code: 'invalid_response',
          message: 'WhatsApp Web bridge response did not include a message id',
          retryable: false,
        }
      }
      return {
        ok: true,
        externalMessageId: namespacedMessageId(config.sessionId, rawMessageId),
        rawStatus: response.status,
      }
    } catch (error) {
      const timeout = controller.signal.aborted
        || (error instanceof Error && error.name === 'AbortError')
      return {
        ok: false,
        status: null,
        code: timeout ? 'timeout' : 'network_error',
        message: timeout
          ? `WhatsApp Web bridge timed out after ${config.timeoutMs}ms`
          : 'WhatsApp Web bridge request failed',
        retryable: true,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

export function createWhatsAppWebClient(
  options: WhatsAppWebClientOptions = {},
): WhatsAppWebClient {
  return new WhatsAppWebClient(options)
}
