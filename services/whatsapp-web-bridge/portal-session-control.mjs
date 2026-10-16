import { signedRequest } from './portal-outbound-puller.mjs'

/**
 * Pull control (PORTAL_CONTROL_MODE=pull): session control for a bridge that
 * has no public URL (behind NAT, bound to 127.0.0.1).
 *
 *   - status push:  POST {origin}/api/webhooks/whatsapp-web/session on every
 *                   state change / QR rotation (debounced) plus a heartbeat
 *                   (pairing: every pairingHeartbeatMs, otherwise heartbeatMs).
 *   - commands:     POST …/commands/claim polls for connect/logout requested in
 *                   GIGA; the bridge executes it locally and POSTs …/commands/ack.
 *                   Fast polling right after a command and while a QR is shown,
 *                   exponential back-off to idlePollMs otherwise.
 *
 * All requests use the portal HMAC protocol (audience aistart360-portal). The
 * QR string is account-equivalent: it travels only inside the signed push body
 * and is never logged.
 */

const SESSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const KEY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,79}$/
const PUSH_STATES = new Set([
  'disconnected',
  'connecting',
  'qr',
  'connected',
  'error',
])
const ACTIONS = new Set(['connect', 'logout'])
const MAX_EXECUTED_CACHE = 32

function portalUrl(webhookUrl, pathname) {
  const url = new URL(pathname, webhookUrl.origin)
  if (
    url.origin !== webhookUrl.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Portal control URL is invalid')
  }
  return url
}

export function parsePortalControlUrls(portalWebhookUrl) {
  const webhookUrl =
    portalWebhookUrl instanceof URL
      ? portalWebhookUrl
      : new URL(portalWebhookUrl)
  const webhookSuffix = '/api/webhooks/whatsapp-web'
  if (webhookUrl.pathname !== webhookSuffix) {
    throw new Error('Portal webhook URL must use the canonical WhatsApp Web route')
  }
  return {
    status: portalUrl(webhookUrl, `${webhookSuffix}/session`),
    claim: portalUrl(webhookUrl, `${webhookSuffix}/commands/claim`),
    ack: portalUrl(webhookUrl, `${webhookSuffix}/commands/ack`),
  }
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return keys.length === wanted.length && keys.every((key, i) => key === wanted[i])
}

export function parseClaimedCommand(value) {
  if (!value || typeof value !== 'object' || value.ok !== true) {
    throw new Error('portal_control_claim_invalid')
  }
  if (value.command === null) return null
  const row = value.command
  if (
    !exactKeys(row, ['command_id', 'action', 'lease_token', 'expires_at']) ||
    !UUID_PATTERN.test(row.command_id) ||
    !UUID_PATTERN.test(row.lease_token) ||
    !ACTIONS.has(row.action) ||
    !Number.isFinite(new Date(row.expires_at).getTime())
  ) {
    throw new Error('portal_control_claim_invalid')
  }
  return row
}

class PortalControlError extends Error {
  constructor(code, status = null) {
    super(code)
    this.code = code
    this.status = status
  }
}

function boundedInterval(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Portal control ${name} is invalid`)
  }
  return value
}

export class PortalSessionControl {
  #urls
  #sessionId
  #secret
  #keyId
  #bridgeVersion
  #getStatus
  #execute
  #fetch
  #log
  #now
  #heartbeatMs
  #pairingHeartbeatMs
  #fastPollMs
  #idlePollMs
  #offlinePollMs
  #hotWindowMs
  #timeoutMs
  #debounceMs
  #stopped = false
  #started = false
  #pushTimer = null
  #pushInFlight = null
  #pushDirty = false
  #pollTimer = null
  #pollInFlight = null
  #pendingAck = null
  #executed = new Map()
  #hotUntil = 0
  #idleCycles = 0
  #pushFailures = 0
  #pollFailures = 0
  #lastPushAt = null
  #lastPollAt = null

  /**
   * @param {{
   *   urls: { status: URL, claim: URL, ack: URL },
   *   sessionId: string,
   *   secret: string,
   *   keyId?: string,
   *   bridgeVersion?: string | null,
   *   getStatus: () => Record<string, unknown>,
   *   execute: (input: { action: string }) => Promise<unknown>,
   *   heartbeatMs?: number,
   *   pairingHeartbeatMs?: number,
   *   fastPollMs?: number,
   *   idlePollMs?: number,
   *   offlinePollMs?: number,
   *   hotWindowMs?: number,
   *   timeoutMs?: number,
   *   debounceMs?: number,
   *   fetchImpl?: typeof fetch,
   *   log?: (level: string, event: string, details?: Record<string, unknown>) => void,
   *   now?: () => number,
   * }} options
   */
  constructor({
    urls,
    sessionId,
    secret,
    keyId = 'primary',
    bridgeVersion = null,
    getStatus,
    execute,
    heartbeatMs = 30_000,
    pairingHeartbeatMs = 15_000,
    fastPollMs = 2_000,
    idlePollMs = 10_000,
    offlinePollMs = 15_000,
    hotWindowMs = 120_000,
    timeoutMs = 5_000,
    debounceMs = 250,
    fetchImpl = globalThis.fetch,
    log = () => undefined,
    now = () => Date.now(),
  }) {
    if (
      !urls ||
      !(urls.status instanceof URL) ||
      !(urls.claim instanceof URL) ||
      !(urls.ack instanceof URL) ||
      new Set([urls.status.origin, urls.claim.origin, urls.ack.origin]).size !== 1
    ) {
      throw new Error('Portal control URLs are invalid')
    }
    if (!SESSION_PATTERN.test(sessionId)) throw new Error('Portal control session is invalid')
    if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
      throw new Error('Portal control secret must contain at least 32 bytes')
    }
    if (!KEY_ID_PATTERN.test(keyId)) throw new Error('Portal control key id is invalid')
    if (
      typeof getStatus !== 'function' ||
      typeof execute !== 'function' ||
      typeof fetchImpl !== 'function'
    ) {
      throw new Error('Portal control dependencies are invalid')
    }
    // Heartbeats never go below 15 s: every accepted push is a database write.
    this.#heartbeatMs = boundedInterval('heartbeat', heartbeatMs, 15_000, 60_000)
    this.#pairingHeartbeatMs = boundedInterval(
      'pairing heartbeat',
      pairingHeartbeatMs,
      15_000,
      60_000,
    )
    this.#fastPollMs = boundedInterval('fast poll', fastPollMs, 1_000, 30_000)
    this.#idlePollMs = boundedInterval('idle poll', idlePollMs, fastPollMs, 300_000)
    this.#offlinePollMs = boundedInterval('offline poll', offlinePollMs, 1_000, 300_000)
    this.#hotWindowMs = boundedInterval('hot window', hotWindowMs, 0, 600_000)
    this.#timeoutMs = boundedInterval('timeout', timeoutMs, 500, 30_000)
    this.#debounceMs = boundedInterval('debounce', debounceMs, 0, 5_000)
    this.#urls = urls
    this.#sessionId = sessionId
    this.#secret = secret
    this.#keyId = keyId
    this.#bridgeVersion =
      typeof bridgeVersion === 'string' && /^[A-Za-z0-9._+-]{1,32}$/.test(bridgeVersion)
        ? bridgeVersion
        : null
    this.#getStatus = getStatus
    this.#execute = execute
    this.#fetch = fetchImpl
    this.#log = log
    this.#now = now
  }

  start() {
    if (this.#started || this.#stopped) return
    this.#started = true
    this.#schedulePush(0)
    this.#schedulePoll(0)
  }

  stop() {
    this.#stopped = true
    if (this.#pushTimer) clearTimeout(this.#pushTimer)
    if (this.#pollTimer) clearTimeout(this.#pollTimer)
    this.#pushTimer = null
    this.#pollTimer = null
  }

  idle() {
    return Promise.all([
      this.#pushInFlight ?? Promise.resolve(),
      this.#pollInFlight ?? Promise.resolve(),
    ]).then(() => undefined)
  }

  snapshot() {
    return {
      enabled: true,
      running: this.#started && !this.#stopped,
      push_failures: this.#pushFailures,
      poll_failures: this.#pollFailures,
      ack_pending: this.#pendingAck !== null,
      last_push_at: this.#lastPushAt,
      last_poll_at: this.#lastPollAt,
    }
  }

  /** State change or QR rotation: push soon (bursts collapse into one push). */
  notifyStatusChanged() {
    if (!this.#started || this.#stopped) return
    if (this.#pushInFlight) {
      this.#pushDirty = true
      return
    }
    this.#schedulePush(this.#debounceMs)
  }

  async pushNow() {
    if (this.#stopped) return { kind: 'skipped' }
    if (this.#pushTimer) clearTimeout(this.#pushTimer)
    this.#pushTimer = null
    if (this.#pushInFlight) {
      this.#pushDirty = true
      return this.#pushInFlight
    }
    let pairing = false
    const operation = (async () => {
      const payload = this.#statusPayload()
      pairing = payload.state === 'qr' || payload.state === 'connecting'
      await this.#post(this.#urls.status, payload)
      this.#pushFailures = 0
      this.#lastPushAt = new Date(this.#now()).toISOString()
      return { kind: 'pushed' }
    })()
      .catch(() => {
        this.#pushFailures += 1
        if (this.#pushFailures === 1 || this.#pushFailures % 10 === 0) {
          this.#log('warn', 'portal_control_push_failed', {
            consecutive_failures: this.#pushFailures,
          })
        }
        return { kind: 'failed' }
      })
      .finally(() => {
        if (this.#pushInFlight === operation) this.#pushInFlight = null
        if (this.#stopped) return
        if (this.#pushDirty) {
          this.#pushDirty = false
          this.#schedulePush(this.#debounceMs)
          return
        }
        this.#schedulePush(this.#nextPushDelay(pairing))
      })
    this.#pushInFlight = operation
    return operation
  }

  async pollNow() {
    if (this.#stopped) return { kind: 'skipped' }
    if (this.#pollTimer) clearTimeout(this.#pollTimer)
    this.#pollTimer = null
    if (this.#pollInFlight) return this.#pollInFlight
    let outcome = null
    const operation = this.#poll()
      .catch(() => {
        this.#pollFailures += 1
        if (this.#pollFailures === 1 || this.#pollFailures % 10 === 0) {
          this.#log('warn', 'portal_control_poll_failed', {
            consecutive_failures: this.#pollFailures,
          })
        }
        return { kind: 'failed' }
      })
      .then((value) => {
        outcome = value
        return value
      })
      .finally(() => {
        if (this.#pollInFlight === operation) this.#pollInFlight = null
        if (!this.#stopped) this.#schedulePoll(this.#nextPollDelay(outcome))
      })
    this.#pollInFlight = operation
    return operation
  }

  #schedulePush(delay) {
    if (this.#stopped) return
    if (this.#pushTimer) clearTimeout(this.#pushTimer)
    this.#pushTimer = setTimeout(() => {
      this.#pushTimer = null
      void this.pushNow()
    }, delay)
    this.#pushTimer.unref?.()
  }

  #schedulePoll(delay) {
    if (this.#stopped) return
    if (this.#pollTimer) clearTimeout(this.#pollTimer)
    this.#pollTimer = setTimeout(() => {
      this.#pollTimer = null
      void this.pollNow()
    }, delay)
    this.#pollTimer.unref?.()
  }

  #nextPushDelay(pairing) {
    const base = pairing ? this.#pairingHeartbeatMs : this.#heartbeatMs
    if (this.#pushFailures === 0) return base
    return Math.min(120_000, this.#pairingHeartbeatMs * 2 ** Math.min(this.#pushFailures - 1, 3))
  }

  #nextPollDelay(outcome) {
    if (outcome?.kind === 'failed') {
      return Math.min(
        120_000,
        this.#offlinePollMs * 2 ** Math.min(this.#pollFailures - 1, 3),
      )
    }
    if (outcome?.kind === 'executed' || outcome?.kind === 'ack_pending') {
      this.#idleCycles = 0
      return this.#fastPollMs
    }
    const showingQr = this.#safeState() === 'qr'
    if (showingQr || this.#now() < this.#hotUntil) {
      this.#idleCycles = 0
      return this.#fastPollMs
    }
    this.#idleCycles += 1
    return Math.min(
      this.#idlePollMs,
      this.#fastPollMs * 2 ** Math.min(this.#idleCycles, 8),
    )
  }

  #safeState() {
    try {
      return this.#getStatus()?.state ?? null
    } catch {
      return null
    }
  }

  #statusPayload() {
    const status = this.#getStatus() ?? {}
    const state = PUSH_STATES.has(status.state) ? status.state : 'error'
    const qr =
      state === 'qr' && typeof status.qr === 'string' && status.qr.length > 0 && status.qr.length <= 8_192
        ? status.qr
        : null
    const errorCode =
      typeof status.error_code === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(status.error_code)
        ? status.error_code
        : null
    return {
      version: 1,
      session_id: this.#sessionId,
      state,
      connected: state === 'connected',
      updated_at: typeof status.updated_at === 'string' ? status.updated_at : null,
      qr,
      qr_expires_at: qr && typeof status.qr_expires_at === 'string' ? status.qr_expires_at : null,
      error_code: state === 'error' ? errorCode ?? 'connection_error' : null,
      bridge_version: this.#bridgeVersion,
    }
  }

  async #post(url, payload) {
    const request = signedRequest({
      url,
      payload,
      secret: this.#secret,
      keyId: this.#keyId,
    })
    let response
    try {
      response = await this.#fetch(url, {
        method: 'POST',
        headers: request.headers,
        body: request.rawBody,
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
    } catch {
      throw new PortalControlError('portal_transport_failure')
    }
    let raw = ''
    try {
      raw = await response.text()
    } catch {
      throw new PortalControlError('portal_response_read_failed', response.status)
    }
    if (!response.ok) {
      throw new PortalControlError('portal_http_rejection', response.status)
    }
    if (Buffer.byteLength(raw) > 16 * 1024) {
      throw new PortalControlError('portal_response_too_large', response.status)
    }
    try {
      return JSON.parse(raw)
    } catch {
      throw new PortalControlError('portal_response_invalid', response.status)
    }
  }

  async #flushAck() {
    if (!this.#pendingAck) return true
    try {
      const response = await this.#post(this.#urls.ack, this.#pendingAck)
      if (!response || response.ok !== true) throw new PortalControlError('portal_ack_invalid')
      if (response.accepted !== true) {
        this.#log('warn', 'portal_control_ack_fenced')
      }
      this.#pendingAck = null
      return true
    } catch (error) {
      // A 4xx will not get better on retry (fenced/expired/invalid): drop it.
      if (
        error instanceof PortalControlError &&
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429
      ) {
        this.#pendingAck = null
        this.#log('warn', 'portal_control_ack_rejected', { status: error.status })
        return true
      }
      throw error
    }
  }

  async #poll() {
    this.#lastPollAt = new Date(this.#now()).toISOString()
    if (!(await this.#flushAck())) return { kind: 'ack_pending' }
    const command = parseClaimedCommand(
      await this.#post(this.#urls.claim, {
        version: 1,
        session_id: this.#sessionId,
      }),
    )
    this.#pollFailures = 0
    if (!command) return { kind: 'idle' }

    this.#hotUntil = this.#now() + this.#hotWindowMs
    this.#log('info', 'portal_control_command_claimed', { action: command.action })
    let result = this.#executed.get(command.command_id)
    if (!result) {
      result = await this.#runCommand(command.action)
      this.#executed.set(command.command_id, result)
      while (this.#executed.size > MAX_EXECUTED_CACHE) {
        const oldest = this.#executed.keys().next().value
        this.#executed.delete(oldest)
      }
    }
    this.#log('info', 'portal_control_command_finished', {
      action: command.action,
      outcome: result.outcome,
      ...(result.error_code ? { error_code: result.error_code } : {}),
    })
    this.#pendingAck = {
      version: 1,
      session_id: this.#sessionId,
      command_id: command.command_id,
      lease_token: command.lease_token,
      outcome: result.outcome,
      ...(result.outcome === 'failed' ? { error_code: result.error_code } : {}),
    }
    this.notifyStatusChanged()
    try {
      await this.#flushAck()
    } catch {
      return { kind: 'ack_pending' }
    }
    return { kind: 'executed' }
  }

  async #runCommand(action) {
    try {
      const value = await this.#execute({ action })
      if (value?.outcome === 'failed') {
        return {
          outcome: 'failed',
          error_code: ERROR_CODE_PATTERN.test(value.error_code ?? '')
            ? value.error_code
            : 'bridge_command_failed',
        }
      }
      return { outcome: 'succeeded' }
    } catch (error) {
      const code =
        typeof error?.code === 'string' && ERROR_CODE_PATTERN.test(error.code)
          ? error.code
          : 'bridge_command_failed'
      return { outcome: 'failed', error_code: code }
    }
  }
}
