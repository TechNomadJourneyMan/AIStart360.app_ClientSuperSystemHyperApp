import { createHash, createHmac, randomBytes } from 'node:crypto'

const HMAC_VERSION = 'v1'
const PORTAL_AUDIENCE = 'aistart360-portal'
const SESSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const KEY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const JID_PATTERN = /^[A-Za-z0-9._:-]+@(s\.whatsapp\.net|lid)$/
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9._:/+=-]{1,256}$/
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/
const SAFE_RETRY_CODES = new Set([
  'session_disconnected',
  'send_rate_limited',
  'send_queue_full',
  'idempotency_cache_full',
  'idempotency_cache_persist_failed',
])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalHmac({ method, requestPath, bodyHash, timestamp, nonce, keyId }) {
  return [
    HMAC_VERSION,
    method.toUpperCase(),
    PORTAL_AUDIENCE,
    requestPath,
    bodyHash,
    timestamp,
    nonce,
    keyId,
  ].join('\n')
}

function signedRequest({ url, payload, secret, keyId }) {
  const rawBody = JSON.stringify(payload)
  const timestamp = String(Math.floor(Date.now() / 1_000))
  const nonce = randomBytes(18).toString('base64url')
  const canonical = canonicalHmac({
    method: 'POST',
    requestPath: url.pathname,
    bodyHash: sha256(rawBody),
    timestamp,
    nonce,
    keyId,
  })
  return {
    rawBody,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json; charset=utf-8',
      'x-wa-bridge-version': HMAC_VERSION,
      'x-wa-bridge-audience': PORTAL_AUDIENCE,
      'x-wa-bridge-timestamp': timestamp,
      'x-wa-bridge-nonce': nonce,
      'x-wa-bridge-key-id': keyId,
      'x-wa-bridge-signature': `sha256=${createHmac('sha256', secret)
        .update(canonical)
        .digest('hex')}`,
    },
  }
}

function portalUrl(webhookUrl, pathname) {
  const url = new URL(pathname, webhookUrl.origin)
  if (
    url.origin !== webhookUrl.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Portal outbound URL is invalid')
  }
  return url
}

export function parsePortalOutboundUrls(portalWebhookUrl) {
  const webhookUrl =
    portalWebhookUrl instanceof URL
      ? portalWebhookUrl
      : new URL(portalWebhookUrl)
  const webhookSuffix = '/api/webhooks/whatsapp-web'
  if (webhookUrl.pathname !== webhookSuffix) {
    throw new Error('Portal webhook URL must use the canonical WhatsApp Web route')
  }
  const outboundBase = `${webhookSuffix}/outbound`
  return {
    claim: portalUrl(
      webhookUrl,
      `${outboundBase}/claim`,
    ),
    authorize: portalUrl(
      webhookUrl,
      `${outboundBase}/authorize`,
    ),
    result: portalUrl(
      webhookUrl,
      `${outboundBase}/result`,
    ),
  }
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return keys.length === wanted.length && keys.every((key, i) => key === wanted[i])
}

function parseClaim(value) {
  if (!value || typeof value !== 'object' || value.ok !== true) {
    throw new Error('portal_claim_invalid_response')
  }
  if (value.delivery === null) return { empty: true }
  const row = value.delivery
  if (
    !exactKeys(row, [
      'delivery_id',
      'lease_token',
      'lease_until',
      'recipient',
      'typing_delay_ms',
    ]) ||
    !UUID_PATTERN.test(row.delivery_id) ||
    !UUID_PATTERN.test(row.lease_token) ||
    !Number.isFinite(new Date(row.lease_until).getTime()) ||
    !JID_PATTERN.test(row.recipient) ||
    !Number.isInteger(row.typing_delay_ms) ||
    row.typing_delay_ms < 0 ||
    row.typing_delay_ms > 15_000
  ) {
    throw new Error('portal_claim_invalid_response')
  }
  return { empty: false, ...row }
}

function parseAuthorization(value) {
  if (!value || typeof value !== 'object' || value.ok !== true) {
    throw new Error('portal_authorize_invalid_response')
  }
  if (value.authorized === false && typeof value.reason === 'string') {
    return { authorized: false }
  }
  const row = value.delivery
  if (
    value.authorized !== true ||
    !row ||
    typeof row !== 'object' ||
    !JID_PATTERN.test(row.recipient) ||
    typeof row.text !== 'string' ||
    !row.text.trim() ||
    row.text.length > 4_096 ||
    !IDEMPOTENCY_PATTERN.test(row.idempotency_key) ||
    !(
      row.reply_to_external_id === null ||
      (typeof row.reply_to_external_id === 'string' &&
        row.reply_to_external_id.length <= 400)
    )
  ) {
    throw new Error('portal_authorize_invalid_response')
  }
  return { authorized: true, ...row }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

class PortalRequestError extends Error {
  constructor(code, status = null) {
    super(code)
    this.code = code
    this.status = status
  }
}

/**
 * Pulls one fenced outbound delivery at a time. Provider execution is delegated
 * to server.mjs so the same serialized queue and persistent idempotency cache
 * protect both direct and pull modes.
 */
export class PortalOutboundPuller {
  #urls
  #sessionId
  #secret
  #keyId
  #readyIntervalMs
  #idleIntervalMs
  #offlineIntervalMs
  #timeoutMs
  #fetch
  #isReady
  #execute
  #presence
  #log
  #timer = null
  #inFlight = null
  #stopped = false
  #pendingReport = null
  #consecutiveFailures = 0
  #idleCycles = 0
  #lastPortalSuccessAt = null
  #lastPortalErrorAt = null

  constructor({
    urls,
    sessionId,
    secret,
    keyId = 'primary',
    readyIntervalMs = 1_000,
    idleIntervalMs = 10_000,
    offlineIntervalMs = 10_000,
    timeoutMs = 5_000,
    fetchImpl = globalThis.fetch,
    isReady,
    execute,
    sendPresence = async () => undefined,
    log = () => undefined,
  }) {
    if (
      !urls ||
      !(urls.claim instanceof URL) ||
      !(urls.authorize instanceof URL) ||
      !(urls.result instanceof URL) ||
      new Set([urls.claim.origin, urls.authorize.origin, urls.result.origin]).size !== 1
    ) {
      throw new Error('Portal outbound URLs are invalid')
    }
    if (!SESSION_PATTERN.test(sessionId)) throw new Error('Outbound session is invalid')
    if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
      throw new Error('Outbound portal secret must contain at least 32 bytes')
    }
    if (!KEY_ID_PATTERN.test(keyId)) throw new Error('Outbound key id is invalid')
    if (!Number.isInteger(readyIntervalMs) || readyIntervalMs < 500 || readyIntervalMs > 30_000) {
      throw new Error('Outbound ready interval is invalid')
    }
    if (
      !Number.isInteger(idleIntervalMs) ||
      idleIntervalMs < readyIntervalMs ||
      idleIntervalMs > 300_000
    ) {
      throw new Error('Outbound idle interval is invalid')
    }
    if (!Number.isInteger(offlineIntervalMs) || offlineIntervalMs < 1_000 || offlineIntervalMs > 300_000) {
      throw new Error('Outbound offline interval is invalid')
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000) {
      throw new Error('Outbound timeout is invalid')
    }
    if (typeof fetchImpl !== 'function' || typeof isReady !== 'function' || typeof execute !== 'function') {
      throw new Error('Outbound puller dependencies are invalid')
    }
    this.#urls = urls
    this.#sessionId = sessionId
    this.#secret = secret
    this.#keyId = keyId
    this.#readyIntervalMs = readyIntervalMs
    this.#idleIntervalMs = idleIntervalMs
    this.#offlineIntervalMs = offlineIntervalMs
    this.#timeoutMs = timeoutMs
    this.#fetch = fetchImpl
    this.#isReady = isReady
    this.#execute = execute
    this.#presence = sendPresence
    this.#log = log
  }

  start() {
    if (this.#timer || this.#inFlight || this.#stopped) return
    this.#schedule(0)
  }

  stop() {
    this.#stopped = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }

  idle() {
    return this.#inFlight ?? Promise.resolve()
  }

  snapshot() {
    const ready =
      this.#pendingReport === null && this.#consecutiveFailures < 3
    return {
      enabled: true,
      ready,
      running: !this.#stopped && (this.#timer !== null || this.#inFlight !== null),
      in_flight: this.#inFlight !== null,
      report_pending: this.#pendingReport !== null,
      consecutive_failures: this.#consecutiveFailures,
      idle_cycles: this.#idleCycles,
      last_portal_success_at: this.#lastPortalSuccessAt,
      last_portal_error_at: this.#lastPortalErrorAt,
    }
  }

  async trigger() {
    if (this.#stopped) return { kind: 'skipped', reason: 'stopped' }
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    if (this.#inFlight) return this.#inFlight
    let outcome = null
    const operation = this.#run()
      .catch(() => this.#failure('pull_cycle_failed'))
      .then((value) => {
        outcome = value
        return value
      })
      .finally(() => {
        if (this.#inFlight === operation) this.#inFlight = null
        if (!this.#stopped) {
          this.#schedule(this.#nextDelay(outcome))
        }
      })
    this.#inFlight = operation
    return operation
  }

  #schedule(delay) {
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.trigger()
    }, delay)
    this.#timer.unref?.()
  }

  #nextDelay(outcome) {
    if (!this.#isReady()) return this.#offlineIntervalMs
    if (outcome?.kind === 'idle') {
      this.#idleCycles += 1
      return Math.min(
        this.#idleIntervalMs,
        this.#readyIntervalMs * 2 ** Math.min(this.#idleCycles, 8),
      )
    }
    if (outcome?.kind === 'retry_later') {
      this.#idleCycles = 0
      return Math.min(
        this.#idleIntervalMs,
        this.#readyIntervalMs * 2 ** Math.min(this.#consecutiveFailures, 8),
      )
    }
    this.#idleCycles = 0
    return this.#readyIntervalMs
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
      throw new PortalRequestError('portal_transport_failure')
    }
    let raw = ''
    try {
      raw = await response.text()
    } catch {
      throw new PortalRequestError('portal_response_read_failed', response.status)
    }
    if (!response.ok) {
      throw new PortalRequestError('portal_http_rejection', response.status)
    }
    if (Buffer.byteLength(raw) > 32 * 1024) {
      throw new PortalRequestError('portal_response_too_large', response.status)
    }
    try {
      const parsed = JSON.parse(raw)
      this.#lastPortalSuccessAt = new Date().toISOString()
      return parsed
    } catch {
      throw new PortalRequestError('portal_response_invalid', response.status)
    }
  }

  async #flushPendingReport() {
    if (!this.#pendingReport) return true
    try {
      const response = await this.#post(this.#urls.result, this.#pendingReport)
      if (!response || response.accepted !== true) {
        throw new PortalRequestError('portal_result_rejected')
      }
      this.#pendingReport = null
      this.#markRecovered()
      return true
    } catch (error) {
      // A 409 means the fence has already become terminal (normally unknown).
      // Never try to overwrite that terminal database decision.
      if (error instanceof PortalRequestError && error.status === 409) {
        this.#pendingReport = null
        this.#log('warn', 'portal_outbound_result_fenced')
        return true
      }
      this.#failure('result_report_failed')
      return false
    }
  }

  async #run() {
    if (!(await this.#flushPendingReport())) {
      return { kind: 'retry_later', reason: 'result_pending' }
    }
    if (!this.#isReady()) return { kind: 'skipped', reason: 'not_ready' }

    const claim = parseClaim(
      await this.#post(this.#urls.claim, {
        version: 1,
        session_id: this.#sessionId,
      }),
    )
    this.#markRecovered()
    if (claim.empty) return { kind: 'idle' }

    await this.#presence(claim.recipient, 'composing').catch(() => undefined)
    if (claim.typing_delay_ms > 0) await sleep(claim.typing_delay_ms)
    await this.#presence(claim.recipient, 'paused').catch(() => undefined)

    const authorized = parseAuthorization(
      await this.#post(this.#urls.authorize, {
        version: 1,
        session_id: this.#sessionId,
        delivery_id: claim.delivery_id,
        lease_token: claim.lease_token,
      }),
    )
    if (!authorized.authorized) return { kind: 'cancelled' }

    let report
    try {
      const result = await this.#execute({
        recipient: authorized.recipient,
        text: authorized.text,
        replyToExternalId: authorized.reply_to_external_id,
        idempotencyKey: authorized.idempotency_key,
      })
      if (!result || !PROVIDER_ID_PATTERN.test(result.message_id)) {
        throw Object.assign(new Error('provider result invalid'), {
          code: 'provider_result_invalid',
        })
      }
      report = {
        version: 1,
        session_id: this.#sessionId,
        delivery_id: claim.delivery_id,
        lease_token: claim.lease_token,
        outcome: 'sent',
        provider_message_id: result.message_id,
      }
    } catch (error) {
      const code =
        typeof error?.code === 'string' &&
        /^[a-z0-9][a-z0-9._:-]{0,119}$/.test(error.code)
          ? error.code
          : 'bridge_execution_unknown'
      report = {
        version: 1,
        session_id: this.#sessionId,
        delivery_id: claim.delivery_id,
        lease_token: claim.lease_token,
        outcome: SAFE_RETRY_CODES.has(code)
          ? 'retryable_failure'
          : 'delivery_unknown',
        error_code: code,
      }
    }

    this.#pendingReport = report
    const reported = await this.#flushPendingReport()
    return reported
      ? { kind: report.outcome === 'sent' ? 'sent' : report.outcome }
      : { kind: 'retry_later', reason: 'result_pending' }
  }

  #failure(kind) {
    this.#consecutiveFailures += 1
    this.#lastPortalErrorAt = new Date().toISOString()
    if (this.#consecutiveFailures === 1 || this.#consecutiveFailures % 10 === 0) {
      this.#log('warn', 'portal_outbound_pull_failed', {
        kind,
        consecutive_failures: this.#consecutiveFailures,
      })
    }
    return { kind: 'retry_later', reason: kind }
  }

  #markRecovered() {
    if (this.#consecutiveFailures > 0) {
      this.#log('info', 'portal_outbound_recovered', {
        previous_failures: this.#consecutiveFailures,
      })
    }
    this.#consecutiveFailures = 0
  }
}
