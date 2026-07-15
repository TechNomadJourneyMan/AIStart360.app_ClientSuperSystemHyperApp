import { createHash, createHmac, randomBytes } from 'node:crypto'

const HMAC_VERSION = 'v1'
const PORTAL_AUDIENCE = 'aistart360-portal'
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const KEY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalHmac({
  method,
  requestPath,
  bodyHash,
  timestamp,
  nonce,
  keyId,
}) {
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

function portalSignature(secret, canonical) {
  return `sha256=${createHmac('sha256', secret).update(canonical).digest('hex')}`
}

function cleanUrlError() {
  return new Error(
    'PORTAL_JOB_DRAIN_URL must be a same-origin HTTPS URL or absolute pathname without credentials, query, or fragment',
  )
}

/**
 * The drain endpoint is opt-in. A relative pathname is resolved against the
 * portal webhook origin; an absolute URL must use that exact same origin. This
 * prevents the shared portal HMAC secret from becoming a signing oracle for an
 * unrelated host.
 */
export function parsePortalJobDrainUrl(
  raw,
  { portalWebhookUrl, nodeEnv = 'development', allowInsecureLocalhost = false },
) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return null

  const webhookUrl =
    portalWebhookUrl instanceof URL
      ? portalWebhookUrl
      : new URL(portalWebhookUrl)
  let drainUrl
  try {
    drainUrl = value.startsWith('/')
      ? new URL(value, webhookUrl.origin)
      : new URL(value)
  } catch {
    throw cleanUrlError()
  }

  if (
    drainUrl.username ||
    drainUrl.password ||
    drainUrl.search ||
    drainUrl.hash ||
    !drainUrl.pathname.startsWith('/') ||
    drainUrl.origin !== webhookUrl.origin ||
    drainUrl.href === webhookUrl.href
  ) {
    throw cleanUrlError()
  }

  const isLoopback = LOOPBACK_HOSTS.has(drainUrl.hostname.toLowerCase())
  const localHttpAllowed =
    isLoopback && (nodeEnv !== 'production' || allowInsecureLocalhost === true)
  if (
    drainUrl.protocol !== 'https:' &&
    !(drainUrl.protocol === 'http:' && localHttpAllowed)
  ) {
    throw cleanUrlError()
  }

  return drainUrl
}

/**
 * Builds the exact signed request expected by the portal drain route. The body
 * contains control metadata only; it never contains a message, JID, phone, or
 * any other customer data.
 */
export function buildPortalJobDrainRequest({
  url,
  sessionId,
  secret,
  keyId = 'primary',
  timestampSeconds = Math.floor(Date.now() / 1000),
  nonce = randomBytes(18).toString('base64url'),
}) {
  if (!(url instanceof URL)) throw new Error('Portal job drain URL is invalid')
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('Portal job drain session id is invalid')
  }
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new Error('Portal job drain secret must contain at least 32 bytes')
  }
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error('Portal job drain key id is invalid')
  }
  const timestamp = String(Math.trunc(timestampSeconds))
  if (!/^\d{10}$/.test(timestamp)) {
    throw new Error('Portal job drain timestamp is invalid')
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(nonce)) {
    throw new Error('Portal job drain nonce is invalid')
  }

  const rawBody = JSON.stringify({ version: 1, session_id: sessionId })
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
      'content-type': 'application/json; charset=utf-8',
      'x-wa-bridge-version': HMAC_VERSION,
      'x-wa-bridge-audience': PORTAL_AUDIENCE,
      'x-wa-bridge-timestamp': timestamp,
      'x-wa-bridge-nonce': nonce,
      'x-wa-bridge-key-id': keyId,
      'x-wa-bridge-signature': portalSignature(secret, canonical),
    },
  }
}

/**
 * Best-effort periodic trigger for a durable portal queue. Failures are
 * intentionally isolated from WhatsApp readiness and retried on a later tick.
 */
export class PortalJobDrainKicker {
  #url
  #sessionId
  #secret
  #keyId
  #intervalMs
  #timeoutMs
  #fetch
  #shouldRun
  #log
  #timer = null
  #inFlight = null
  #stopped = false
  #consecutiveFailures = 0

  constructor({
    url,
    sessionId,
    secret,
    keyId = 'primary',
    intervalMs = 10_000,
    timeoutMs = 5_000,
    fetchImpl = globalThis.fetch,
    shouldRun = () => true,
    log = () => undefined,
  }) {
    if (!(url instanceof URL))
      throw new Error('Portal job drain URL is invalid')
    if (
      !Number.isInteger(intervalMs) ||
      intervalMs < 1_000 ||
      intervalMs > 300_000
    ) {
      throw new Error(
        'Portal job drain interval must be between 1000 and 300000 ms',
      )
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000) {
      throw new Error(
        'Portal job drain timeout must be between 500 and 30000 ms',
      )
    }
    if (typeof fetchImpl !== 'function')
      throw new Error('Portal job drain fetch is required')
    if (typeof shouldRun !== 'function')
      throw new Error('Portal job drain predicate is required')
    if (typeof log !== 'function')
      throw new Error('Portal job drain logger is required')

    // Validate all signing inputs before a timer can be installed.
    buildPortalJobDrainRequest({
      url,
      sessionId,
      secret,
      keyId,
      timestampSeconds: 1_750_000_000,
      nonce: 'validation-nonce',
    })

    this.#url = url
    this.#sessionId = sessionId
    this.#secret = secret
    this.#keyId = keyId
    this.#intervalMs = intervalMs
    this.#timeoutMs = timeoutMs
    this.#fetch = fetchImpl
    this.#shouldRun = shouldRun
    this.#log = log
  }

  start() {
    if (this.#timer || this.#stopped) return
    this.#timer = setInterval(() => {
      void this.trigger()
    }, this.#intervalMs)
    this.#timer.unref?.()
  }

  stop() {
    this.#stopped = true
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
  }

  async trigger() {
    if (this.#stopped) return { kind: 'skipped', reason: 'stopped' }
    let eligible = false
    try {
      eligible = this.#shouldRun() === true
    } catch {
      eligible = false
    }
    if (!eligible) return { kind: 'skipped', reason: 'not_ready' }
    if (this.#inFlight) return this.#inFlight

    const operation = this.#run().finally(() => {
      if (this.#inFlight === operation) this.#inFlight = null
    })
    this.#inFlight = operation
    return operation
  }

  idle() {
    return this.#inFlight ?? Promise.resolve()
  }

  snapshot() {
    return {
      enabled: true,
      running: this.#timer !== null,
      in_flight: this.#inFlight !== null,
      consecutive_failures: this.#consecutiveFailures,
    }
  }

  async #run() {
    try {
      const request = buildPortalJobDrainRequest({
        url: this.#url,
        sessionId: this.#sessionId,
        secret: this.#secret,
        keyId: this.#keyId,
      })
      const response = await this.#fetch(this.#url, {
        method: 'POST',
        headers: request.headers,
        body: request.rawBody,
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
      await response.body?.cancel().catch(() => undefined)
      if (!response.ok) {
        return this.#failure('http_rejection', response.status)
      }

      if (this.#consecutiveFailures > 0) {
        this.#log('info', 'portal_job_drain_recovered', {
          previous_failures: this.#consecutiveFailures,
        })
      }
      this.#consecutiveFailures = 0
      return { kind: 'accepted', status: response.status }
    } catch {
      // Do not log exception strings: fetch errors may contain a URL and
      // library errors may embed request details.
      return this.#failure('transport_failure')
    }
  }

  #failure(kind, status) {
    this.#consecutiveFailures += 1
    // Avoid a log line every ten seconds during a portal outage. The first and
    // every sixth consecutive failure are enough for an operator alert.
    if (
      this.#consecutiveFailures === 1 ||
      this.#consecutiveFailures % 6 === 0
    ) {
      this.#log('warn', 'portal_job_drain_failed', {
        kind,
        ...(Number.isInteger(status) ? { status } : {}),
        consecutive_failures: this.#consecutiveFailures,
      })
    }
    return {
      kind: 'retry_later',
      reason: kind,
      ...(Number.isInteger(status) ? { status } : {}),
    }
  }
}
