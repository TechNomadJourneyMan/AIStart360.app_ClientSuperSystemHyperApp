import { createServer } from 'node:http'
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
} from 'baileys'
import {
  createCatchUpLimiter,
  createUnreadHistoryAccumulator,
  HISTORY_SYNC_TYPE,
  isCatchUpTimestampAllowed,
} from './catch-up-policy.mjs'
import {
  compactCommandCache,
  FixedWindowRateLimiter,
  isPermanentWebhookStatus,
  SerializedOperationQueue,
  settleWithin,
  WebhookOutbox,
} from './bridge-reliability.mjs'
import {
  parsePortalJobDrainUrl,
  PortalJobDrainKicker,
} from './portal-job-drain-kicker.mjs'
import {
  parsePortalOutboundUrls,
  PortalOutboundPuller,
} from './portal-outbound-puller.mjs'

// Baileys auth files are account-equivalent credentials. Force newly created
// files to owner-only permissions even if the container host has a permissive umask.
process.umask(0o077)

const SERVICE_NAME = 'whatsapp-web-bridge'
const SERVICE_VERSION = '1.0.0'
const HMAC_VERSION = 'v1'
const CONTROL_AUDIENCE = 'whatsapp-web-bridge'
const PORTAL_AUDIENCE = 'aistart360-portal'
const HMAC_SKEW_SECONDS = 60
const EMPTY_BODY_HASH = createHash('sha256').update('').digest('hex')

function envString(name, { required = false, fallback = '' } = {}) {
  const value = (process.env[name] ?? fallback).trim()
  if (required && !value) throw new Error(`${name} is required`)
  return value
}

function boundedInteger(name, raw, fallback, { min, max }) {
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

function envInteger(name, fallback, bounds) {
  return boundedInteger(name, process.env[name], fallback, bounds)
}

function firstEnv(names, fallback = '') {
  for (const name of names) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return fallback
}

function envFlag(name, fallback = false) {
  const value = process.env[name]
  if (value === undefined) return fallback
  return /^(?:1|true|yes|on)$/i.test(value.trim())
}

const PORT = boundedInteger(
  'BRIDGE_PORT',
  firstEnv(['BRIDGE_PORT', 'PORT'], '8787'),
  8787,
  { min: 1, max: 65_535 },
)
const HOST = firstEnv(['BRIDGE_HOST', 'HOST'], '0.0.0.0')
const SESSION_ID = firstEnv(['BRIDGE_SESSION_ID', 'WHATSAPP_SESSION_ID'])
const CONTROL_SECRET = envString('BRIDGE_API_SECRET', { required: true })
const PORTAL_SECRET = envString('PORTAL_WEBHOOK_SECRET', { required: true })
const CONTROL_KEY_ID = envString('BRIDGE_API_KEY_ID', { fallback: 'primary' })
const PORTAL_KEY_ID = envString('PORTAL_WEBHOOK_KEY_ID', {
  fallback: 'primary',
})
const AUTOSTART = envFlag('BRIDGE_AUTOSTART', false)
const SYNC_FULL_HISTORY = envFlag('SYNC_FULL_HISTORY', false)
const HISTORY_FULL_SYNC_MAINTENANCE = envFlag(
  'HISTORY_FULL_SYNC_MAINTENANCE',
  false,
)
const FORCE_HISTORY_RESYNC = envFlag('FORCE_HISTORY_RESYNC', false)
const AUTH_DIR = path.resolve(
  firstEnv(['BRIDGE_AUTH_DIR', 'WHATSAPP_AUTH_DIR'], '/data/auth'),
)
const STATE_DIR = path.resolve(
  envString('BRIDGE_STATE_DIR', { fallback: path.dirname(AUTH_DIR) }),
)
const COMMAND_CACHE_FILE = path.join(STATE_DIR, 'command-cache.json')
const WEBHOOK_OUTBOX_DIR = path.join(STATE_DIR, 'webhook-outbox')
const WEBHOOK_DEAD_LETTER_DIR = path.join(STATE_DIR, 'webhook-dead-letter')
const HISTORY_RESYNC_MARKER_FILE = path.join(
  STATE_DIR,
  'history-resync.applied',
)
const MAX_BODY_BYTES = envInteger('MAX_BODY_BYTES', 32 * 1024, {
  min: 1024,
  max: 1024 * 1024,
})
const MAX_TEXT_CHARS = envInteger('MAX_TEXT_CHARS', 4096, {
  min: 1,
  max: 16_384,
})
const MAX_INBOUND_TEXT_CHARS = envInteger('MAX_INBOUND_TEXT_CHARS', 8000, {
  min: 1,
  max: 8000,
})
const LIVE_MESSAGE_MAX_AGE_SECONDS = envInteger(
  'LIVE_MESSAGE_MAX_AGE_SECONDS',
  300,
  { min: 30, max: 3600 },
)
const CATCH_UP_MESSAGE_MAX_AGE_SECONDS = envInteger(
  'CATCH_UP_MESSAGE_MAX_AGE_SECONDS',
  14 * 24 * 60 * 60,
  { min: 60 * 60, max: 90 * 24 * 60 * 60 },
)
const CATCH_UP_MAX_MESSAGES_TOTAL = envInteger(
  'CATCH_UP_MAX_MESSAGES_TOTAL',
  200,
  { min: 1, max: 5000 },
)
const CATCH_UP_MAX_MESSAGES_PER_CHAT = envInteger(
  'CATCH_UP_MAX_MESSAGES_PER_CHAT',
  20,
  { min: 1, max: 250 },
)
const HISTORY_BUFFER_MAX_CHUNKS = envInteger('HISTORY_BUFFER_MAX_CHUNKS', 64, {
  min: 1,
  max: 1024,
})
const HISTORY_BUFFER_MAX_CHATS = envInteger('HISTORY_BUFFER_MAX_CHATS', 5000, {
  min: 1,
  max: 50_000,
})
const HISTORY_BUFFER_MAX_MESSAGES = envInteger(
  'HISTORY_BUFFER_MAX_MESSAGES',
  20_000,
  { min: 1, max: 200_000 },
)
const QR_TTL_SECONDS = envInteger('QR_TTL_SECONDS', 60, {
  min: 20,
  max: 300,
})
const WEBHOOK_TIMEOUT_MS = envInteger('WEBHOOK_TIMEOUT_MS', 10_000, {
  min: 1000,
  max: 60_000,
})
const WEBHOOK_MAX_ATTEMPTS = envInteger('WEBHOOK_MAX_ATTEMPTS', 5, {
  min: 1,
  max: 10,
})
const WEBHOOK_OUTBOX_MAX_ENTRIES = envInteger(
  'WEBHOOK_OUTBOX_MAX_ENTRIES',
  10_000,
  {
    min: 100,
    max: 100_000,
  },
)
const COMMAND_CACHE_TTL_SECONDS = envInteger(
  'COMMAND_CACHE_TTL_SECONDS',
  7 * 24 * 60 * 60,
  { min: 300, max: 30 * 24 * 60 * 60 },
)
const COMMAND_CACHE_MAX_ENTRIES = envInteger(
  'COMMAND_CACHE_MAX_ENTRIES',
  5000,
  {
    min: 100,
    max: 100_000,
  },
)
const OUTBOUND_RATE_PER_MINUTE = envInteger('OUTBOUND_RATE_PER_MINUTE', 30, {
  min: 1,
  max: 300,
})
const OUTBOUND_MIN_INTERVAL_MS = envInteger('OUTBOUND_MIN_INTERVAL_MS', 1000, {
  min: 100,
  max: 60_000,
})
const MAX_SEND_QUEUE = envInteger('MAX_SEND_QUEUE', 100, {
  min: 1,
  max: 1000,
})
const HTTP_RATE_PER_MINUTE = envInteger('HTTP_RATE_PER_MINUTE', 120, {
  min: 10,
  max: 10_000,
})
const CONNECT_RATE_PER_15_MINUTES = envInteger(
  'CONNECT_RATE_PER_15_MINUTES',
  3,
  { min: 1, max: 30 },
)
const SHUTDOWN_GRACE_MS = envInteger('SHUTDOWN_GRACE_MS', 15_000, {
  min: 1000,
  max: 60_000,
})
const PORTAL_JOB_DRAIN_INTERVAL_MS = envInteger(
  'PORTAL_JOB_DRAIN_INTERVAL_MS',
  10_000,
  { min: 1000, max: 300_000 },
)
const PORTAL_JOB_DRAIN_TIMEOUT_MS = envInteger(
  'PORTAL_JOB_DRAIN_TIMEOUT_MS',
  5_000,
  { min: 500, max: 30_000 },
)
const PORTAL_OUTBOUND_READY_INTERVAL_MS = envInteger(
  'PORTAL_OUTBOUND_READY_INTERVAL_MS',
  1_000,
  { min: 500, max: 30_000 },
)
const PORTAL_OUTBOUND_IDLE_INTERVAL_MS = envInteger(
  'PORTAL_OUTBOUND_IDLE_INTERVAL_MS',
  10_000,
  { min: 1_000, max: 300_000 },
)
const PORTAL_OUTBOUND_OFFLINE_INTERVAL_MS = envInteger(
  'PORTAL_OUTBOUND_OFFLINE_INTERVAL_MS',
  10_000,
  { min: 1_000, max: 300_000 },
)
const PORTAL_OUTBOUND_TIMEOUT_MS = envInteger(
  'PORTAL_OUTBOUND_TIMEOUT_MS',
  5_000,
  { min: 500, max: 30_000 },
)

if (!/^[A-Za-z0-9._-]{1,64}$/.test(SESSION_ID)) {
  throw new Error('WHATSAPP_SESSION_ID contains unsupported characters')
}
if (!/^[A-Za-z0-9._:-]{1,128}$/.test(CONTROL_KEY_ID)) {
  throw new Error('BRIDGE_API_KEY_ID contains unsupported characters')
}
if (!/^[A-Za-z0-9._:-]{1,128}$/.test(PORTAL_KEY_ID)) {
  throw new Error('PORTAL_WEBHOOK_KEY_ID contains unsupported characters')
}
if (Buffer.byteLength(CONTROL_SECRET) < 32) {
  throw new Error('BRIDGE_API_SECRET must contain at least 32 bytes')
}
if (Buffer.byteLength(PORTAL_SECRET) < 32) {
  throw new Error('PORTAL_WEBHOOK_SECRET must contain at least 32 bytes')
}
if (CONTROL_SECRET === PORTAL_SECRET) {
  throw new Error(
    'BRIDGE_API_SECRET and PORTAL_WEBHOOK_SECRET must be different',
  )
}
function parsePortalUrl() {
  const raw = envString('PORTAL_WEBHOOK_URL', { required: true })
  const url = new URL(raw)
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'PORTAL_WEBHOOK_URL must not contain credentials, query, or fragment',
    )
  }
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  const allowLocalHttp =
    localHost &&
    (process.env.NODE_ENV !== 'production' ||
      process.env.ALLOW_INSECURE_LOCALHOST === 'true')
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && allowLocalHttp)
  ) {
    throw new Error('PORTAL_WEBHOOK_URL must use HTTPS')
  }
  return url
}

const PORTAL_WEBHOOK_URL = parsePortalUrl()
const WHATSAPP_WEB_DELIVERY_MODE = envString('WHATSAPP_WEB_DELIVERY_MODE', {
  fallback: 'direct',
}).toLowerCase()
if (!['direct', 'pull'].includes(WHATSAPP_WEB_DELIVERY_MODE)) {
  throw new Error('WHATSAPP_WEB_DELIVERY_MODE must be direct or pull')
}
const PORTAL_JOB_DRAIN_URL = parsePortalJobDrainUrl(
  process.env.PORTAL_JOB_DRAIN_URL,
  {
    portalWebhookUrl: PORTAL_WEBHOOK_URL,
    nodeEnv: process.env.NODE_ENV,
    allowInsecureLocalhost: process.env.ALLOW_INSECURE_LOCALHOST === 'true',
  },
)
const PORTAL_OUTBOUND_URLS =
  WHATSAPP_WEB_DELIVERY_MODE === 'pull'
    ? parsePortalOutboundUrls(PORTAL_WEBHOOK_URL)
    : null

class HttpError extends Error {
  constructor(status, code, message = code, headers = {}) {
    super(message)
    this.status = status
    this.code = code
    this.headers = headers
  }
}

function safeLog(level, event, details = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    event,
    ...details,
  }
  const line = JSON.stringify(payload)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

const silentLogger = {
  level: 'silent',
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  child() {
    return this
  },
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalHmac({
  method,
  audience,
  requestPath,
  bodyHash,
  timestamp,
  nonce,
  keyId,
}) {
  return [
    HMAC_VERSION,
    method.toUpperCase(),
    audience,
    requestPath,
    bodyHash,
    timestamp,
    nonce,
    keyId,
  ].join('\n')
}

function hmacSignature(secret, canonical) {
  return `sha256=${createHmac('sha256', secret).update(canonical).digest('hex')}`
}

function constantTimeStringEqual(left, right) {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  )
}

const usedNonces = new Map()

function pruneNonces(nowSeconds) {
  for (const [nonce, expiresAt] of usedNonces) {
    if (expiresAt <= nowSeconds) usedNonces.delete(nonce)
  }
  if (usedNonces.size <= 10_000) return
  const oldest = [...usedNonces.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, usedNonces.size - 10_000)
  for (const [nonce] of oldest) usedNonces.delete(nonce)
}

function requireControlSignature(req, requestPath, rawBody) {
  const version = req.headers['x-wa-bridge-version']
  const audience = req.headers['x-wa-bridge-audience']
  const timestamp = req.headers['x-wa-bridge-timestamp']
  const nonce = req.headers['x-wa-bridge-nonce']
  const keyId = req.headers['x-wa-bridge-key-id']
  const providedSignature = req.headers['x-wa-bridge-signature']

  if (
    typeof version !== 'string' ||
    typeof audience !== 'string' ||
    typeof timestamp !== 'string' ||
    typeof nonce !== 'string' ||
    typeof keyId !== 'string' ||
    typeof providedSignature !== 'string'
  ) {
    throw new HttpError(401, 'invalid_signature')
  }
  if (
    version !== HMAC_VERSION ||
    audience !== CONTROL_AUDIENCE ||
    keyId !== CONTROL_KEY_ID ||
    !/^\d{10}$/.test(timestamp) ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(nonce) ||
    !/^sha256=[a-f0-9]{64}$/.test(providedSignature)
  ) {
    throw new HttpError(401, 'invalid_signature')
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const signedAt = Number(timestamp)
  if (Math.abs(nowSeconds - signedAt) > HMAC_SKEW_SECONDS) {
    throw new HttpError(401, 'signature_expired')
  }

  const bodyHash = rawBody.length === 0 ? EMPTY_BODY_HASH : sha256(rawBody)
  const expectedSignature = hmacSignature(
    CONTROL_SECRET,
    canonicalHmac({
      method: req.method ?? 'GET',
      audience,
      requestPath,
      bodyHash,
      timestamp,
      nonce,
      keyId,
    }),
  )
  if (!constantTimeStringEqual(providedSignature, expectedSignature)) {
    throw new HttpError(401, 'invalid_signature')
  }

  pruneNonces(nowSeconds)
  if (usedNonces.has(nonce)) throw new HttpError(409, 'replayed_request')
  usedNonces.set(nonce, nowSeconds + HMAC_SKEW_SECONDS * 2 + 1)
}

function portalHeaders(rawBody) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomBytes(18).toString('base64url')
  const canonical = canonicalHmac({
    method: 'POST',
    audience: PORTAL_AUDIENCE,
    requestPath: PORTAL_WEBHOOK_URL.pathname,
    bodyHash: sha256(rawBody),
    timestamp,
    nonce,
    keyId: PORTAL_KEY_ID,
  })
  return {
    'content-type': 'application/json; charset=utf-8',
    'x-wa-bridge-version': HMAC_VERSION,
    'x-wa-bridge-audience': PORTAL_AUDIENCE,
    'x-wa-bridge-timestamp': timestamp,
    'x-wa-bridge-nonce': nonce,
    'x-wa-bridge-key-id': PORTAL_KEY_ID,
    'x-wa-bridge-signature': hmacSignature(PORTAL_SECRET, canonical),
  }
}

async function readRawBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'body_too_large')
    }
    chunks.push(chunk)
  }
  return chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks, size)
}

function parseJsonObject(rawBody) {
  if (rawBody.length === 0) throw new HttpError(400, 'body_required')
  let value
  try {
    value = JSON.parse(rawBody.toString('utf8'))
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_body')
  }
  return value
}

function requireExactKeys(value, requiredKeys) {
  const keys = Object.keys(value).sort()
  const expected = [...requiredKeys].sort()
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new HttpError(400, 'invalid_body')
  }
}

function requireAllowedKeys(value, requiredKeys, optionalKeys = []) {
  const present = new Set(Object.keys(value))
  for (const key of requiredKeys) {
    if (!present.has(key)) throw new HttpError(400, 'invalid_body')
  }
  const allowed = new Set([...requiredKeys, ...optionalKeys])
  if ([...present].some((key) => !allowed.has(key))) {
    throw new HttpError(400, 'invalid_body')
  }
}

function requireIdempotencyKey(req, bodyValue) {
  const header = req.headers['idempotency-key']
  if (
    typeof header !== 'string' ||
    typeof bodyValue !== 'string' ||
    header !== bodyValue ||
    !/^[A-Za-z0-9._:-]{8,200}$/.test(bodyValue)
  ) {
    throw new HttpError(400, 'invalid_idempotency_key')
  }
  return bodyValue
}

function requireSessionId(value) {
  if (value !== SESSION_ID) throw new HttpError(404, 'session_not_found')
}

function sendJson(res, status, body, headers = {}) {
  const raw = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': raw.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  res.end(raw)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jitteredBackoff(attempt, base = 500, cap = 30_000) {
  const raw = Math.min(cap, base * 2 ** Math.max(0, attempt - 1))
  return Math.max(100, Math.round(raw * (0.8 + Math.random() * 0.4)))
}

async function ensureStateDirectories() {
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 })
  await mkdir(AUTH_DIR, { recursive: true, mode: 0o700 })
  await mkdir(WEBHOOK_OUTBOX_DIR, { recursive: true, mode: 0o700 })
  await chmod(STATE_DIR, 0o700).catch(() => undefined)
  await chmod(AUTH_DIR, 0o700).catch(() => undefined)
  await chmod(WEBHOOK_OUTBOX_DIR, 0o700).catch(() => undefined)
}

async function maybeForceHistoryResync(state, saveCreds) {
  if (!FORCE_HISTORY_RESYNC) return
  try {
    await access(HISTORY_RESYNC_MARKER_FILE)
    safeLog('warn', 'history_resync_already_applied')
    return
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const previousCount = Array.isArray(state?.creds?.processedHistoryMessages)
    ? state.creds.processedHistoryMessages.length
    : 0
  state.creds.processedHistoryMessages = []
  await saveCreds()
  await writeFile(HISTORY_RESYNC_MARKER_FILE, `${new Date().toISOString()}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })
  safeLog('warn', 'history_resync_applied', {
    cleared_history_notifications: previousCount,
  })
}

function individualJid(value) {
  return (
    typeof value === 'string' &&
    /^[1-9]\d{5,19}@(s\.whatsapp\.net|c\.us|lid)$/.test(value)
  )
}

function inboundIndividualJid(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}@(s\.whatsapp\.net|lid)$/.test(value)
  )
}

function normalizeRecipient(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_recipient')
  const trimmed = value.trim()
  if (/^[1-9][0-9]{5,19}$/.test(trimmed)) return `${trimmed}@s.whatsapp.net`
  if (individualJid(trimmed)) return trimmed
  throw new HttpError(400, 'invalid_recipient')
}

function messageTimestampMs(value) {
  let seconds
  try {
    if (typeof value === 'bigint') seconds = Number(value)
    else if (typeof value === 'number') seconds = value
    else if (value && typeof value.toNumber === 'function')
      seconds = value.toNumber()
    else seconds = Number(value)
  } catch {
    return null
  }
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const milliseconds = Math.trunc(seconds * 1000)
  return Number.isSafeInteger(milliseconds) ? milliseconds : null
}

function boundedString(value, maxLength) {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\u0000/g, '').trim()
  if (!normalized) return null
  return normalized.slice(0, maxLength)
}

function providerMessageId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:/+=-]{1,256}$/.test(value)
}

function unwrapMessageContent(content) {
  let current = content
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== 'object') return null
    if (current.protocolMessage) return null
    const wrapped =
      current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message
    if (!wrapped) return current
    current = wrapped
  }
  return null
}

function extractMessageContent(rawContent) {
  const content = unwrapMessageContent(rawContent)
  if (!content) return { messageType: 'unknown', text: null }
  if (typeof content.conversation === 'string') {
    return {
      messageType: 'text',
      text: boundedString(content.conversation, MAX_INBOUND_TEXT_CHARS),
    }
  }
  if (content.extendedTextMessage) {
    return {
      messageType: 'text',
      text: boundedString(
        content.extendedTextMessage.text,
        MAX_INBOUND_TEXT_CHARS,
      ),
    }
  }
  if (content.imageMessage) {
    return {
      messageType: 'image',
      text: boundedString(content.imageMessage.caption, MAX_INBOUND_TEXT_CHARS),
    }
  }
  if (content.videoMessage) {
    return {
      messageType: 'video',
      text: boundedString(content.videoMessage.caption, MAX_INBOUND_TEXT_CHARS),
    }
  }
  if (content.audioMessage) return { messageType: 'audio', text: null }
  if (content.documentMessage) {
    return {
      messageType: 'document',
      text: boundedString(
        content.documentMessage.caption,
        MAX_INBOUND_TEXT_CHARS,
      ),
    }
  }
  if (content.stickerMessage) return { messageType: 'sticker', text: null }
  if (content.locationMessage || content.liveLocationMessage) {
    return { messageType: 'location', text: null }
  }
  if (content.contactMessage || content.contactsArrayMessage) {
    return { messageType: 'contacts', text: null }
  }
  if (content.buttonsResponseMessage) {
    return {
      messageType: 'button',
      text: boundedString(
        content.buttonsResponseMessage.selectedDisplayText,
        MAX_INBOUND_TEXT_CHARS,
      ),
    }
  }
  if (content.templateButtonReplyMessage) {
    return {
      messageType: 'button',
      text: boundedString(
        content.templateButtonReplyMessage.selectedDisplayText,
        MAX_INBOUND_TEXT_CHARS,
      ),
    }
  }
  if (content.listResponseMessage) {
    return {
      messageType: 'interactive',
      text: boundedString(
        content.listResponseMessage.title ??
          content.listResponseMessage.singleSelectReply?.selectedRowId,
        MAX_INBOUND_TEXT_CHARS,
      ),
    }
  }
  if (content.interactiveResponseMessage) {
    return { messageType: 'interactive', text: null }
  }
  if (content.reactionMessage) {
    return {
      messageType: 'reaction',
      text: boundedString(content.reactionMessage.text, MAX_INBOUND_TEXT_CHARS),
    }
  }
  return { messageType: 'unknown', text: null }
}

async function deliverPortalEvent(envelope) {
  const rawBody = JSON.stringify(envelope)
  let lastStatus
  for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(PORTAL_WEBHOOK_URL, {
        method: 'POST',
        headers: portalHeaders(rawBody),
        body: rawBody,
        redirect: 'error',
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      })
      if (response.ok) {
        await response.body?.cancel().catch(() => undefined)
        return { kind: 'delivered' }
      }
      lastStatus = response.status
      await response.body?.cancel().catch(() => undefined)
      if (isPermanentWebhookStatus(response.status)) {
        return { kind: 'permanent_failure', status: response.status }
      }
    } catch {
      // Timeouts and network failures are retryable. Error strings are not
      // logged because upstream libraries may include URLs or request data.
    }
    if (attempt < WEBHOOK_MAX_ATTEMPTS) {
      await sleep(jitteredBackoff(attempt))
    }
  }
  return {
    kind: 'retryable_failure',
    ...(Number.isInteger(lastStatus) ? { status: lastStatus } : {}),
  }
}

function validOutboxEnvelope(envelope, eventId) {
  return Boolean(
    envelope &&
    envelope.event_id === eventId &&
    envelope.session_id === SESSION_ID &&
    envelope.version === 1 &&
    envelope.event_type === 'message',
  )
}

const webhookOutbox = new WebhookOutbox({
  outboxDir: WEBHOOK_OUTBOX_DIR,
  deadLetterDir: WEBHOOK_DEAD_LETTER_DIR,
  maxEntries: WEBHOOK_OUTBOX_MAX_ENTRIES,
  validateEnvelope: validOutboxEnvelope,
  deliver: deliverPortalEvent,
  log: safeLog,
})

async function postPortalEvent(envelope) {
  // Inbound processing waits only for durable persistence. Delivery runs on a
  // separate serialized drain so a slow portal cannot block later Baileys
  // event parsing until the durable outbox itself reaches capacity.
  await webhookOutbox.persist(envelope)
  webhookOutbox.triggerDrain()
}

function buildInboundPortalEnvelope(candidate, { live, nowMs }) {
  const key = candidate?.key
  if (!key || key.fromMe !== false || !inboundIndividualJid(key.remoteJid))
    return null
  if (!providerMessageId(key.id)) return null

  const timestampMs = messageTimestampMs(candidate.messageTimestamp)
  if (timestampMs === null) return null
  const timestampAllowed = live
    ? timestampMs >= nowMs - LIVE_MESSAGE_MAX_AGE_SECONDS * 1000 &&
      timestampMs <= nowMs + HMAC_SKEW_SECONDS * 1000
    : isCatchUpTimestampAllowed({
        timestampMs,
        nowMs,
        maxAgeSeconds: CATCH_UP_MESSAGE_MAX_AGE_SECONDS,
        futureSkewSeconds: HMAC_SKEW_SECONDS,
      })
  if (!timestampAllowed || !unwrapMessageContent(candidate.message)) return null

  const remoteJidAlt = inboundIndividualJid(key.remoteJidAlt)
    ? key.remoteJidAlt
    : undefined
  const pushName = boundedString(candidate.pushName, 120)
  const extracted = extractMessageContent(candidate.message)
  const eventId = sha256(
    `waweb-event:v1:${SESSION_ID}:${key.remoteJid}:${key.id}`,
  )
  return {
    version: 1,
    event_id: eventId,
    event_type: 'message',
    session_id: SESSION_ID,
    message: {
      id: key.id,
      remote_jid: key.remoteJid,
      timestamp_ms: timestampMs,
      text: extracted.text,
      message_type: extracted.messageType,
      live,
      from_me: false,
      ...(remoteJidAlt ? { remote_jid_alt: remoteJidAlt } : {}),
      ...(pushName ? { push_name: pushName } : {}),
    },
  }
}

async function handleLiveMessagesUpsert(event) {
  if (!event || event.type !== 'notify' || !Array.isArray(event.messages))
    return
  const nowMs = Date.now()
  for (const candidate of event.messages) {
    const envelope = buildInboundPortalEnvelope(candidate, {
      live: true,
      nowMs,
    })
    if (envelope) await postPortalEvent(envelope)
  }
}

async function forwardCatchUpCandidate(
  candidate,
  limiter,
  chatId,
  nowMs,
  aliases = [],
) {
  const envelope = buildInboundPortalEnvelope(candidate, {
    live: false,
    nowMs,
  })
  if (!envelope) return 'invalid'
  const quotaDecision = limiter.tryAcceptMessage({
    chatId,
    messageId: envelope.message.id,
    aliases: [
      ...aliases,
      envelope.message.remote_jid,
      envelope.message.remote_jid_alt,
    ].filter(Boolean),
  })
  if (quotaDecision !== 'accepted') return quotaDecision
  await postPortalEvent(envelope)
  return 'forwarded'
}

async function handleCatchUpMessagesUpsert(event, limiter) {
  if (!event || event.type !== 'append' || !Array.isArray(event.messages))
    return
  const nowMs = Date.now()
  let forwarded = 0
  let skippedDuplicate = 0
  let skippedByLimit = 0
  let skippedInvalid = 0

  for (const candidate of event.messages) {
    const result = await forwardCatchUpCandidate(
      candidate,
      limiter,
      candidate?.key?.remoteJid,
      nowMs,
    )
    if (result === 'forwarded') forwarded += 1
    else if (result === 'duplicate') skippedDuplicate += 1
    else if (result === 'limited') skippedByLimit += 1
    else skippedInvalid += 1
  }

  if (forwarded > 0 || skippedDuplicate > 0 || skippedByLimit > 0) {
    safeLog('info', 'catch_up_batch_processed', {
      received: event.messages.length,
      forwarded,
      skipped_duplicate: skippedDuplicate,
      skipped_by_limit: skippedByLimit,
      skipped_invalid: skippedInvalid,
      partial: skippedDuplicate > 0 || skippedByLimit > 0 || skippedInvalid > 0,
      budget: limiter.snapshot(),
    })
  }
}

function sanitizedHistoryMetrics(summary, partialOverride) {
  const received = summary?.received ?? {}
  const unread = summary?.unread
  const filtered = summary?.filtered ?? {}
  return {
    mode:
      summary?.mode === 'full_maintenance'
        ? 'full_maintenance'
        : 'unread_snapshot',
    partial: partialOverride ?? summary?.partial === true,
    received: {
      chunks: Number.isInteger(received.chunks) ? received.chunks : 0,
      chats: Number.isInteger(received.chats) ? received.chats : 0,
      messages: Number.isInteger(received.messages) ? received.messages : 0,
    },
    unread:
      unread && typeof unread === 'object'
        ? {
            declared: Number.isInteger(unread.declared) ? unread.declared : 0,
            candidates: Number.isInteger(unread.candidates)
              ? unread.candidates
              : 0,
            selected: Number.isInteger(unread.selected) ? unread.selected : 0,
            missing: Number.isInteger(unread.missing) ? unread.missing : 0,
          }
        : null,
    filtered: {
      messages: Number.isInteger(filtered.messages) ? filtered.messages : 0,
      unread: Number.isInteger(filtered.unread) ? filtered.unread : 0,
      duplicates: Number.isInteger(filtered.duplicates)
        ? filtered.duplicates
        : 0,
    },
  }
}

async function handleUnreadHistorySet(event, accumulator, limiter) {
  const result = accumulator.add(event)
  if (result.status === 'ignored') {
    if (result.reason === 'full_maintenance_disabled') {
      safeLog('info', 'history_sync_ignored', {
        reason: result.reason,
        sync_type: 'full',
        ...sanitizedHistoryMetrics(result.summary),
      })
    }
    return
  }
  if (result.status === 'closed') {
    if (result.reason !== 'recent_payload_complete') {
      safeLog('warn', 'history_sync_discarded', {
        reason: result.reason,
        ...sanitizedHistoryMetrics(result.summary, true),
      })
    }
    return
  }
  if (result.status !== 'ready' && result.status !== 'full_ready') return
  const selected = result.selected
  const nowMs = Date.now()
  let forwarded = 0
  let skippedInvalid = 0
  let skippedDuplicate = 0
  let skippedByLimit = 0

  for (const { chatId, aliases, message } of selected) {
    const result = await forwardCatchUpCandidate(
      message,
      limiter,
      chatId,
      nowMs,
      aliases,
    )
    if (result === 'forwarded') forwarded += 1
    else if (result === 'duplicate') skippedDuplicate += 1
    else if (result === 'limited') skippedByLimit += 1
    else skippedInvalid += 1
  }

  const partial =
    result.summary?.partial === true ||
    skippedInvalid > 0 ||
    skippedDuplicate > 0 ||
    skippedByLimit > 0
  safeLog(
    'info',
    result.status === 'full_ready'
      ? 'history_full_maintenance_processed'
      : 'unread_history_processed',
    {
      ...sanitizedHistoryMetrics(result.summary, partial),
      selected: selected.length,
      forwarded,
      skipped_invalid: skippedInvalid,
      skipped_duplicate: skippedDuplicate,
      skipped_by_limit: skippedByLimit,
      budget: limiter.snapshot(),
    },
  )
}

function handleMessagingHistoryStatus(event, accumulator) {
  const result = accumulator.handleStatus(event)
  if (result.status === 'status_observed') {
    safeLog('info', 'history_sync_status_observed', {
      state: 'complete',
      explicit: event?.explicit === true,
      ...sanitizedHistoryMetrics(result.summary, true),
    })
  } else if (
    result.status === 'closed' &&
    result.reason === 'history_status_paused'
  ) {
    safeLog('warn', 'history_sync_discarded', {
      reason: result.reason,
      state: 'paused',
      explicit: event?.explicit === true,
      ...sanitizedHistoryMetrics(result.summary, true),
    })
  }
}

let sessionState = 'idle'
let stateUpdatedAt = new Date().toISOString()
let currentQr = null
let currentQrUpdatedAt = null
let currentQrExpiresAt = 0
let currentSocket = null
let socketGeneration = 0
let connectPromise = null
let reconnectTimer = null
let outboxDrainTimer = null
let shuttingDown = false
const portalJobDrainKicker = PORTAL_JOB_DRAIN_URL
  ? new PortalJobDrainKicker({
      url: PORTAL_JOB_DRAIN_URL,
      sessionId: SESSION_ID,
      secret: PORTAL_SECRET,
      keyId: PORTAL_KEY_ID,
      intervalMs: PORTAL_JOB_DRAIN_INTERVAL_MS,
      timeoutMs: PORTAL_JOB_DRAIN_TIMEOUT_MS,
      shouldRun: () => sessionState === 'connected' && !shuttingDown,
      log: safeLog,
    })
  : null
const portalOutboundPuller = PORTAL_OUTBOUND_URLS
  ? new PortalOutboundPuller({
      urls: PORTAL_OUTBOUND_URLS,
      sessionId: SESSION_ID,
      secret: PORTAL_SECRET,
      keyId: PORTAL_KEY_ID,
      readyIntervalMs: PORTAL_OUTBOUND_READY_INTERVAL_MS,
      idleIntervalMs: PORTAL_OUTBOUND_IDLE_INTERVAL_MS,
      offlineIntervalMs: PORTAL_OUTBOUND_OFFLINE_INTERVAL_MS,
      timeoutMs: PORTAL_OUTBOUND_TIMEOUT_MS,
      isReady: () => sessionState === 'connected' && !shuttingDown,
      execute: executePulledMessage,
      sendPresence: sendPulledPresence,
      log: safeLog,
    })
  : null
let reconnectAttempt = 0
let manualStop = false
let inboundTail = Promise.resolve()
let pendingInboundBatches = 0
const authPersistQueue = new SerializedOperationQueue()

function enqueueInboundBatch(operation, failureEvent) {
  pendingInboundBatches += 1
  inboundTail = inboundTail
    .then(operation)
    .catch(() => safeLog('error', failureEvent))
    .finally(() => {
      pendingInboundBatches -= 1
    })
}

function persistAuthState(saveCreds) {
  return authPersistQueue.enqueue(saveCreds)
}

function setSessionState(nextState) {
  sessionState = nextState
  stateUpdatedAt = new Date().toISOString()
}

function clearQr() {
  currentQr = null
  currentQrUpdatedAt = null
  currentQrExpiresAt = 0
}

function publicSessionStatus({ includeQr = true } = {}) {
  const qrUsable =
    includeQr &&
    currentQr !== null &&
    currentQrExpiresAt > Date.now() &&
    sessionState === 'qr'
  const publicState = (() => {
    if (sessionState === 'connected') return 'connected'
    if (sessionState === 'qr' && qrUsable) return 'qr'
    if (['connecting', 'reconnecting', 'qr'].includes(sessionState))
      return 'connecting'
    if (sessionState === 'error') return 'error'
    return 'disconnected'
  })()
  return {
    session_id: SESSION_ID,
    account_external_id: `waweb:${SESSION_ID}`,
    state: publicState,
    connected: publicState === 'connected',
    updated_at: stateUpdatedAt,
    qr: publicState === 'qr' ? currentQr : null,
    qr_updated_at: publicState === 'qr' ? currentQrUpdatedAt : null,
    qr_expires_at:
      publicState === 'qr' ? new Date(currentQrExpiresAt).toISOString() : null,
    error_code: publicState === 'error' ? 'connection_error' : null,
  }
}

function disconnectStatusCode(error) {
  const candidates = [
    error?.output?.statusCode,
    error?.data?.statusCode,
    error?.statusCode,
  ]
  return candidates.find((value) => Number.isInteger(value)) ?? null
}

function cancelReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
}

function scheduleReconnect({ immediate = false } = {}) {
  if (manualStop || reconnectTimer) return
  reconnectAttempt += 1
  const delay = immediate
    ? 100
    : jitteredBackoff(reconnectAttempt, 1000, 60_000)
  setSessionState('reconnecting')
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void connectSession('reconnect').catch(() => {
      scheduleReconnect()
    })
  }, delay)
  reconnectTimer.unref()
}

async function clearAuthState() {
  await authPersistQueue.idle()
  await rm(AUTH_DIR, { recursive: true, force: true })
  await mkdir(AUTH_DIR, { recursive: true, mode: 0o700 })
  await chmod(AUTH_DIR, 0o700).catch(() => undefined)
  authPersistQueue.markUnavailable()
}

async function connectSession(reason = 'manual') {
  const alreadyActive = ['connected', 'connecting', 'qr'].includes(sessionState)
  if (!alreadyActive && !connectPromise) {
    const pending = (async () => {
      manualStop = false
      cancelReconnect()
      await ensureStateDirectories()
      setSessionState('connecting')
      clearQr()

      const generation = ++socketGeneration
      const hadPersistedAuth = await authStateExists()
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
      if (hadPersistedAuth) authPersistQueue.markInitialized()
      else authPersistQueue.markUnavailable()
      const serializedSaveCreds = () => persistAuthState(saveCreds)
      await maybeForceHistoryResync(state, serializedSaveCreds)
      const socket = makeWASocket({
        auth: state,
        // Baileys only advertises full companion history for a Desktop
        // profile. Keep the legacy web profile for already-linked sessions:
        // changing the advertised device after pairing can make WhatsApp
        // reject the reconnect with 428.
        browser: SYNC_FULL_HISTORY
          ? Browsers.macOS('Desktop')
          : Browsers.ubuntu('Chrome'),
        logger: silentLogger,
        markOnlineOnConnect: false,
        syncFullHistory: SYNC_FULL_HISTORY,
        // Baileys rc13 deliberately excludes FULL in its default callback.
        // Preserve every normal sync type and opt into FULL only for an
        // explicit, bounded maintenance import.
        shouldSyncHistoryMessage: ({ syncType }) =>
          syncType !== HISTORY_SYNC_TYPE.FULL || HISTORY_FULL_SYNC_MAINTENANCE,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined,
      })
      currentSocket = socket
      const catchUpLimiter = createCatchUpLimiter({
        maxTotal: CATCH_UP_MAX_MESSAGES_TOTAL,
        maxPerChat: CATCH_UP_MAX_MESSAGES_PER_CHAT,
      })
      const unreadHistoryAccumulator = createUnreadHistoryAccumulator({
        maxChunks: HISTORY_BUFFER_MAX_CHUNKS,
        maxChats: HISTORY_BUFFER_MAX_CHATS,
        maxMessages: HISTORY_BUFFER_MAX_MESSAGES,
        allowFullSync: HISTORY_FULL_SYNC_MAINTENANCE,
      })

      socket.ev.on('creds.update', () => {
        if (generation !== socketGeneration) return
        void serializedSaveCreds().catch(() => {
          safeLog('error', 'auth_state_persist_failed')
        })
      })

      socket.ev.on('messages.upsert', (event) => {
        if (generation !== socketGeneration || manualStop) return
        enqueueInboundBatch(async () => {
          if (event?.type === 'notify') {
            await handleLiveMessagesUpsert(event)
          } else if (event?.type === 'append') {
            await handleCatchUpMessagesUpsert(event, catchUpLimiter)
          }
        }, 'inbound_batch_failed')
      })

      socket.ev.on('messaging-history.set', (event) => {
        if (generation !== socketGeneration || manualStop) return
        enqueueInboundBatch(
          () =>
            handleUnreadHistorySet(
              event,
              unreadHistoryAccumulator,
              catchUpLimiter,
            ),
          'unread_history_batch_failed',
        )
      })

      socket.ev.on('messaging-history.status', (event) => {
        if (generation !== socketGeneration || manualStop) return
        enqueueInboundBatch(
          () => handleMessagingHistoryStatus(event, unreadHistoryAccumulator),
          'history_status_handling_failed',
        )
      })

      socket.ev.on('connection.update', (update) => {
        if (generation !== socketGeneration) return
        if (typeof update.qr === 'string' && update.qr) {
          currentQr = update.qr
          currentQrUpdatedAt = new Date().toISOString()
          currentQrExpiresAt = Date.now() + QR_TTL_SECONDS * 1000
          setSessionState('qr')
        }
        if (update.connection === 'open') {
          clearQr()
          reconnectAttempt = 0
          setSessionState('connected')
          safeLog('info', 'whatsapp_connected', { reason })
        }
        if (update.connection !== 'close') return

        unreadHistoryAccumulator.discard()
        clearQr()
        currentSocket = null
        const code = disconnectStatusCode(update.lastDisconnect?.error)
        safeLog('warn', 'whatsapp_disconnected', { code })
        if (manualStop) {
          setSessionState('idle')
          return
        }
        if (code === DisconnectReason.loggedOut) {
          setSessionState('logged_out')
          void clearAuthState().catch(() =>
            safeLog('error', 'auth_state_clear_failed'),
          )
          return
        }
        scheduleReconnect({
          immediate: code === DisconnectReason.restartRequired,
        })
      })
    })()
    connectPromise = pending
    try {
      await pending
    } catch (error) {
      currentSocket = null
      setSessionState('error')
      safeLog('error', 'whatsapp_connect_failed')
      throw error
    } finally {
      if (connectPromise === pending) connectPromise = null
    }
  } else if (connectPromise) {
    await connectPromise
  }
  return publicSessionStatus()
}

async function deleteSession() {
  manualStop = true
  cancelReconnect()
  const socket = currentSocket
  currentSocket = null
  socketGeneration += 1
  clearQr()
  setSessionState('disconnecting')
  if (socket) {
    try {
      await socket.logout()
    } catch {
      try {
        socket.end(undefined)
      } catch {
        // Best effort: the generation fence already prevents old callbacks.
      }
    }
  }
  await clearAuthState()
  reconnectAttempt = 0
  setSessionState('idle')
  safeLog('info', 'whatsapp_session_deleted')
}

const commandCache = new Map()
let commandCacheWriteTail = Promise.resolve()
let commandCacheCapacityEvictions = 0
let commandCacheExpiredEntries = 0
let commandCacheLastEvictionAt = null
let commandCacheLastSaturatedAt = null
let commandCacheSaturationLogged = false

function recordCommandCacheCompaction(result) {
  commandCacheExpiredEntries += result.expiredSent
  if (result.evictedSent > 0) {
    commandCacheCapacityEvictions += result.evictedSent
    commandCacheLastEvictionAt = new Date().toISOString()
    if (
      commandCacheCapacityEvictions === result.evictedSent ||
      commandCacheCapacityEvictions % 100 === 0
    ) {
      safeLog('warn', 'idempotency_cache_capacity_eviction', {
        entries: result.size,
        max_entries: COMMAND_CACHE_MAX_ENTRIES,
        evictions_total: commandCacheCapacityEvictions,
      })
    }
  }
  return result
}

function pruneCommandCache({ reserve = 0, record = true } = {}) {
  const result = compactCommandCache(commandCache, {
    maxEntries: COMMAND_CACHE_MAX_ENTRIES,
    ttlMs: COMMAND_CACHE_TTL_SECONDS * 1000,
    reserve,
  })
  if (record) recordCommandCacheCompaction(result)
  if (reserve > 0 && result.available) commandCacheSaturationLogged = false
  return result
}

function markCommandCacheSaturated(result) {
  commandCacheLastSaturatedAt = new Date().toISOString()
  if (!commandCacheSaturationLogged) {
    commandCacheSaturationLogged = true
    safeLog('error', 'idempotency_cache_saturated', {
      entries: result.size,
      max_entries: COMMAND_CACHE_MAX_ENTRIES,
      protected_entries: result.protectedEntries,
    })
  }
}

function commandCacheStatus() {
  const sentEntries = [...commandCache.values()].filter(
    (entry) => entry?.status === 'sent',
  ).length
  const protectedEntries = commandCache.size - sentEntries
  const entriesToFree = Math.max(
    0,
    commandCache.size - (COMMAND_CACHE_MAX_ENTRIES - 1),
  )
  const saturated = sentEntries < entriesToFree
  return {
    ready: !saturated,
    entries: commandCache.size,
    max_entries: COMMAND_CACHE_MAX_ENTRIES,
    protected_entries: protectedEntries,
    saturated,
    capacity_evictions_total: commandCacheCapacityEvictions,
    expired_entries_total: commandCacheExpiredEntries,
    last_eviction_at: commandCacheLastEvictionAt,
    last_saturated_at: commandCacheLastSaturatedAt,
  }
}

async function loadCommandCache() {
  try {
    const raw = await readFile(COMMAND_CACHE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries))
      return
    for (const pair of parsed.entries) {
      if (!Array.isArray(pair) || pair.length !== 2) continue
      const [commandId, entry] = pair
      if (
        typeof commandId !== 'string' ||
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.request_hash !== 'string' ||
        !['sending', 'sent', 'unknown'].includes(entry.status)
      ) {
        continue
      }
      commandCache.set(commandId, {
        ...entry,
        status: entry.status === 'sending' ? 'unknown' : entry.status,
      })
    }
    pruneCommandCache()
  } catch (error) {
    if (error?.code !== 'ENOENT') safeLog('warn', 'command_cache_load_failed')
  }
}

function persistCommandCache() {
  commandCacheWriteTail = commandCacheWriteTail
    .catch(() => undefined)
    .then(async () => {
      pruneCommandCache()
      const tempPath = `${COMMAND_CACHE_FILE}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
      const raw = JSON.stringify({
        version: 1,
        entries: [...commandCache.entries()],
      })
      await writeFile(tempPath, raw, { encoding: 'utf8', mode: 0o600 })
      await rename(tempPath, COMMAND_CACHE_FILE)
      await chmod(COMMAND_CACHE_FILE, 0o600).catch(() => undefined)
    })
  return commandCacheWriteTail
}

let sendQueueTail = Promise.resolve()
let pendingSends = 0
let outboundTimestamps = []

function outboundRateLimit() {
  const now = Date.now()
  outboundTimestamps = outboundTimestamps.filter(
    (timestamp) => timestamp > now - 60_000,
  )
  const latest = outboundTimestamps.at(-1) ?? 0
  if (outboundTimestamps.length >= OUTBOUND_RATE_PER_MINUTE) {
    return Math.max(1, Math.ceil((outboundTimestamps[0] + 60_000 - now) / 1000))
  }
  if (now - latest < OUTBOUND_MIN_INTERVAL_MS) {
    return Math.max(
      1,
      Math.ceil((latest + OUTBOUND_MIN_INTERVAL_MS - now) / 1000),
    )
  }
  return 0
}

function rawReplyMessageId(value) {
  if (value === undefined) return null
  if (typeof value !== 'string')
    throw new HttpError(400, 'invalid_reply_message_id')
  const prefix = `waweb:${SESSION_ID}:`
  const raw = value.startsWith(prefix) ? value.slice(prefix.length) : value
  if (!providerMessageId(raw)) {
    throw new HttpError(400, 'invalid_reply_message_id')
  }
  return raw
}

function validateMessageCommand(req, body, { legacy = false } = {}) {
  if (legacy) {
    requireExactKeys(body, ['session_id', 'command_id', 'to', 'text'])
    requireSessionId(body.session_id)
  } else {
    requireAllowedKeys(
      body,
      ['to', 'type', 'text', 'idempotency_key'],
      ['reply_to_message_id'],
    )
    if (body.type !== 'text')
      throw new HttpError(400, 'unsupported_message_type')
  }
  const commandId = legacy
    ? body.command_id
    : requireIdempotencyKey(req, body.idempotency_key)
  if (
    typeof commandId !== 'string' ||
    !/^[A-Za-z0-9._:-]{8,200}$/.test(commandId)
  ) {
    throw new HttpError(400, 'invalid_command_id')
  }
  const recipient = normalizeRecipient(body.to)
  if (typeof body.text !== 'string') throw new HttpError(400, 'invalid_text')
  const text = body.text.trim()
  if (!text || text.length > MAX_TEXT_CHARS)
    throw new HttpError(400, 'invalid_text')
  const replyToMessageId = legacy
    ? null
    : rawReplyMessageId(body.reply_to_message_id)
  return {
    commandId,
    recipient,
    text,
    replyToMessageId,
    requestHash: sha256(
      `${SESSION_ID}\n${recipient}\n${text}\n${replyToMessageId ?? ''}`,
    ),
  }
}

function pulledMessageCommand(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new HttpError(400, 'invalid_pull_payload')
  }
  const commandId = payload.idempotencyKey
  if (
    typeof commandId !== 'string' ||
    !/^[A-Za-z0-9._:-]{8,200}$/.test(commandId)
  ) {
    throw new HttpError(400, 'invalid_command_id')
  }
  const recipient = normalizeRecipient(payload.recipient)
  if (typeof payload.text !== 'string') {
    throw new HttpError(400, 'invalid_text')
  }
  const text = payload.text.trim()
  if (!text || text.length > MAX_TEXT_CHARS) {
    throw new HttpError(400, 'invalid_text')
  }
  const replyToMessageId = rawReplyMessageId(
    payload.replyToExternalId ?? undefined,
  )
  return {
    commandId,
    recipient,
    text,
    replyToMessageId,
    requestHash: sha256(
      `${SESSION_ID}\n${recipient}\n${text}\n${replyToMessageId ?? ''}`,
    ),
  }
}

async function executePulledMessage(payload) {
  return enqueueMessageCommand(pulledMessageCommand(payload))
}

async function sendPulledPresence(recipient, presence) {
  if (presence !== 'composing' && presence !== 'paused') return
  const socket = currentSocket
  if (!socket || sessionState !== 'connected') {
    throw new HttpError(409, 'session_disconnected')
  }
  await socket.sendPresenceUpdate(presence, normalizeRecipient(recipient))
}

async function executeMessageCommand(command) {
  const cached = commandCache.get(command.commandId)
  if (cached) {
    if (cached.request_hash !== command.requestHash) {
      throw new HttpError(409, 'idempotency_conflict')
    }
    if (cached.status === 'sent') {
      return {
        ok: true,
        session_id: SESSION_ID,
        command_id: command.commandId,
        message_id: cached.message_id,
        deduplicated: true,
      }
    }
    throw new HttpError(409, 'command_outcome_unknown')
  }
  if (sessionState !== 'connected' || !currentSocket) {
    throw new HttpError(409, 'session_disconnected')
  }

  const retryAfter = outboundRateLimit()
  if (retryAfter > 0) {
    throw new HttpError(429, 'send_rate_limited', 'send_rate_limited', {
      'retry-after': String(retryAfter),
    })
  }

  const capacity = pruneCommandCache({ reserve: 1, record: false })
  if (!capacity.available) {
    markCommandCacheSaturated(capacity)
    throw new HttpError(503, 'idempotency_cache_full')
  }

  commandCache.set(command.commandId, {
    request_hash: command.requestHash,
    status: 'sending',
    recorded_at: Date.now(),
  })
  try {
    await persistCommandCache()
    recordCommandCacheCompaction(capacity)
  } catch {
    // The provider has not been called yet. Restore the previous dedupe
    // records so a local persistence failure cannot make an old retry send
    // twice during the remaining lifetime of this process.
    commandCache.delete(command.commandId)
    for (const [commandId, entry] of capacity.evictedEntries) {
      commandCache.set(commandId, entry)
    }
    await persistCommandCache().catch(() => undefined)
    throw new HttpError(503, 'idempotency_cache_persist_failed')
  }
  outboundTimestamps.push(Date.now())

  try {
    const socket = currentSocket
    if (!socket || sessionState !== 'connected') {
      throw new Error('session disconnected before send')
    }
    const quoted = command.replyToMessageId
      ? {
          key: {
            id: command.replyToMessageId,
            remoteJid: command.recipient,
            fromMe: false,
          },
          message: { conversation: '' },
        }
      : undefined
    const result = await socket.sendMessage(
      command.recipient,
      { text: command.text },
      quoted ? { quoted } : undefined,
    )
    const messageId = result?.key?.id
    if (typeof messageId !== 'string' || !messageId) {
      throw new Error('provider did not return message id')
    }
    commandCache.set(command.commandId, {
      request_hash: command.requestHash,
      status: 'sent',
      recorded_at: Date.now(),
      message_id: messageId,
    })
    await persistCommandCache()
    return {
      ok: true,
      session_id: SESSION_ID,
      command_id: command.commandId,
      message_id: messageId,
      deduplicated: false,
    }
  } catch {
    commandCache.set(command.commandId, {
      request_hash: command.requestHash,
      status: 'unknown',
      recorded_at: Date.now(),
    })
    await persistCommandCache().catch(() => undefined)
    throw new HttpError(502, 'provider_send_ambiguous')
  }
}

function enqueueMessageCommand(command) {
  if (pendingSends >= MAX_SEND_QUEUE)
    throw new HttpError(429, 'send_queue_full')
  pendingSends += 1
  const run = sendQueueTail.then(() => executeMessageCommand(command))
  sendQueueTail = run.catch(() => undefined)
  return run.finally(() => {
    pendingSends -= 1
  })
}

let connectAttempts = []

const publicHttpRateLimiter = new FixedWindowRateLimiter({
  limit: HTTP_RATE_PER_MINUTE,
  windowMs: 60_000,
  maxBuckets: 1000,
})
const authenticatedHttpRateLimiter = new FixedWindowRateLimiter({
  limit: HTTP_RATE_PER_MINUTE,
  windowMs: 60_000,
  maxBuckets: 16,
})

function clientAddress(req) {
  return req.socket.remoteAddress ?? 'unknown'
}

function enforceRateLimit(limiter, key) {
  const outcome = limiter.consume(key)
  if (!outcome.allowed) {
    throw new HttpError(429, 'request_rate_limited', 'request_rate_limited', {
      'retry-after': String(outcome.retryAfterSeconds),
    })
  }
}

function enforcePublicHttpRateLimit(req) {
  enforceRateLimit(publicHttpRateLimiter, clientAddress(req))
}

function enforceAuthenticatedHttpRateLimit() {
  enforceRateLimit(authenticatedHttpRateLimiter, CONTROL_KEY_ID)
}

function enforceConnectRateLimit() {
  const now = Date.now()
  connectAttempts = connectAttempts.filter(
    (timestamp) => timestamp > now - 15 * 60_000,
  )
  if (connectAttempts.length >= CONNECT_RATE_PER_15_MINUTES) {
    const retryAfter = Math.max(
      1,
      Math.ceil((connectAttempts[0] + 15 * 60_000 - now) / 1000),
    )
    throw new HttpError(429, 'connect_rate_limited', 'connect_rate_limited', {
      'retry-after': String(retryAfter),
    })
  }
  connectAttempts.push(now)
}

function sessionRoute(pathname) {
  const match = pathname.match(
    /^(?:\/[A-Za-z0-9._~-]+)*\/v1\/sessions\/([^/]+)\/(status|connect|logout|messages|presence)$/,
  )
  if (!match) return null
  let sessionId
  try {
    sessionId = decodeURIComponent(match[1])
  } catch {
    throw new HttpError(400, 'invalid_session_id')
  }
  requireSessionId(sessionId)
  return { action: match[2] }
}

function readinessStatus() {
  const outbox = webhookOutbox.snapshot()
  const authPersist = authPersistQueue.snapshot()
  const idempotencyCache = commandCacheStatus()
  const outboundPull = portalOutboundPuller?.snapshot() ?? null
  const checks = {
    connected: sessionState === 'connected',
    outbox: outbox.ready,
    auth_persist: authPersist.ready,
    idempotency_cache: idempotencyCache.ready,
    outbound_pull: outboundPull?.ready ?? true,
  }
  const ready = !shuttingDown && Object.values(checks).every(Boolean)
  return {
    ready,
    body: {
      ok: ready,
      ready,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      state: sessionState,
      checks,
      outbox_depth: outbox.outbox_depth,
      outbox_saturated: outbox.saturated,
      last_webhook_success_at: outbox.last_webhook_success_at,
      last_webhook_error: outbox.last_webhook_error,
      idempotency_cache: idempotencyCache,
      outbound_pull: outboundPull,
    },
  }
}

async function routeRequest(req, res) {
  const url = new URL(
    req.url ?? '/',
    `http://${req.headers.host ?? 'localhost'}`,
  )
  if (url.search) throw new HttpError(400, 'query_not_supported')

  if (req.method === 'GET' && url.pathname === '/health') {
    enforcePublicHttpRateLimit(req)
    sendJson(res, 200, {
      ok: true,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      state: sessionState,
      connected: sessionState === 'connected',
      uptime_seconds: Math.floor(process.uptime()),
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/ready') {
    enforcePublicHttpRateLimit(req)
    const readiness = readinessStatus()
    sendJson(res, readiness.ready ? 200 : 503, readiness.body)
    return
  }

  const rawBody = await readRawBody(req)
  requireControlSignature(req, url.pathname, rawBody)
  // Only a successfully authenticated request may consume the trusted
  // control-plane budget. Public traffic often shares a single Cloudflare
  // source address and must not be able to starve signed portal calls.
  enforceAuthenticatedHttpRateLimit()

  const scopedRoute = sessionRoute(url.pathname)

  if (
    req.method === 'GET' &&
    (url.pathname === '/v1/session/status' || scopedRoute?.action === 'status')
  ) {
    if (rawBody.length !== 0) throw new HttpError(400, 'body_not_allowed')
    sendJson(res, 200, { ok: true, ...publicSessionStatus() })
    return
  }

  const contentType = req.headers['content-type']
  if (
    typeof contentType !== 'string' ||
    !/^application\/json(?:\s*;|$)/i.test(contentType)
  ) {
    throw new HttpError(415, 'json_required')
  }
  const body = parseJsonObject(rawBody)

  if (req.method === 'POST' && scopedRoute?.action === 'connect') {
    requireExactKeys(body, ['idempotency_key'])
    requireIdempotencyKey(req, body.idempotency_key)
    if (!['connected', 'connecting', 'qr'].includes(sessionState))
      enforceConnectRateLimit()
    const status = await connectSession('api')
    sendJson(res, 202, { ok: true, ...status })
    return
  }

  if (req.method === 'POST' && scopedRoute?.action === 'logout') {
    requireExactKeys(body, ['idempotency_key'])
    requireIdempotencyKey(req, body.idempotency_key)
    await deleteSession()
    sendJson(res, 200, { ok: true, ...publicSessionStatus() })
    return
  }

  if (req.method === 'POST' && scopedRoute?.action === 'messages') {
    const command = validateMessageCommand(req, body)
    const result = await enqueueMessageCommand(command)
    sendJson(res, 200, result)
    return
  }

  if (req.method === 'POST' && scopedRoute?.action === 'presence') {
    requireExactKeys(body, ['to', 'presence'])
    const recipient = normalizeRecipient(body.to)
    if (body.presence !== 'composing' && body.presence !== 'paused') {
      throw new HttpError(400, 'invalid_presence')
    }
    const socket = currentSocket
    if (!socket || sessionState !== 'connected') {
      throw new HttpError(409, 'session_disconnected')
    }
    try {
      await socket.sendPresenceUpdate(body.presence, recipient)
    } catch {
      throw new HttpError(502, 'provider_presence_failed')
    }
    sendJson(res, 200, { ok: true, presence: body.presence })
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/session/connect') {
    requireExactKeys(body, ['session_id'])
    requireSessionId(body.session_id)
    if (!['connected', 'connecting', 'qr'].includes(sessionState))
      enforceConnectRateLimit()
    const status = await connectSession('api')
    sendJson(res, 202, { ok: true, ...status })
    return
  }

  if (req.method === 'DELETE' && url.pathname === '/v1/session') {
    requireExactKeys(body, ['session_id'])
    requireSessionId(body.session_id)
    await deleteSession()
    sendJson(res, 200, { ok: true, ...publicSessionStatus() })
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    const command = validateMessageCommand(req, body, { legacy: true })
    const result = await enqueueMessageCommand(command)
    sendJson(res, 200, result)
    return
  }

  throw new HttpError(404, 'not_found')
}

const server = createServer((req, res) => {
  void routeRequest(req, res).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500
    const code = error instanceof HttpError ? error.code : 'internal_error'
    const headers = error instanceof HttpError ? error.headers : {}
    if (status >= 500) safeLog('error', 'http_request_failed', { status, code })
    if (!res.headersSent) {
      sendJson(res, status, { ok: false, code, error: { code } }, headers)
    } else res.destroy()
  })
})

server.requestTimeout = 15_000
server.headersTimeout = 10_000
server.keepAliveTimeout = 5_000
server.maxHeadersCount = 50

async function authStateExists() {
  try {
    await access(path.join(AUTH_DIR, 'creds.json'))
    return true
  } catch {
    return false
  }
}

async function start() {
  await ensureStateDirectories()
  await loadCommandCache()
  await webhookOutbox.initialize()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })
  safeLog('info', 'bridge_started', { port: PORT })
  webhookOutbox.triggerDrain()
  outboxDrainTimer = setInterval(() => {
    webhookOutbox.triggerDrain()
  }, 60_000)
  outboxDrainTimer.unref()
  portalJobDrainKicker?.start()
  if (portalJobDrainKicker) {
    safeLog('info', 'portal_job_drain_kicker_started', {
      interval_ms: PORTAL_JOB_DRAIN_INTERVAL_MS,
    })
  }
  portalOutboundPuller?.start()
  if (portalOutboundPuller) {
    safeLog('info', 'portal_outbound_puller_started', {
      ready_interval_ms: PORTAL_OUTBOUND_READY_INTERVAL_MS,
      offline_interval_ms: PORTAL_OUTBOUND_OFFLINE_INTERVAL_MS,
    })
  }
  if (AUTOSTART && (await authStateExists())) {
    void connectSession('startup').catch(() => scheduleReconnect())
  }
}

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  manualStop = true
  cancelReconnect()
  if (outboxDrainTimer) clearInterval(outboxDrainTimer)
  outboxDrainTimer = null
  portalJobDrainKicker?.stop()
  portalOutboundPuller?.stop()
  clearQr()
  safeLog('info', 'bridge_stopping', { signal })

  let serverClosed = !server.listening
  const serverClosePromise = serverClosed
    ? Promise.resolve()
    : new Promise((resolve) => {
        server.close(() => {
          serverClosed = true
          resolve()
        })
      })
  const deadline = Date.now() + SHUTDOWN_GRACE_MS
  const remaining = () => Math.max(1, deadline - Date.now())

  // Stop accepting provider events first, but retain the socket while queued
  // sends finish. A send may emit a final creds.update, so auth persistence is
  // awaited in the second phase after the send queue settles.
  const transportSettled = await settleWithin(
    [inboundTail, sendQueueTail],
    remaining(),
  )
  socketGeneration += 1
  webhookOutbox.triggerDrain()
  const stateSettled =
    transportSettled &&
    (await settleWithin(
      [
        webhookOutbox.idle(),
        authPersistQueue.idle(),
        portalJobDrainKicker?.idle() ?? Promise.resolve(),
        portalOutboundPuller?.idle() ?? Promise.resolve(),
        persistCommandCache(),
      ],
      remaining(),
    ))

  setSessionState('stopping')
  const socket = currentSocket
  currentSocket = null
  try {
    socket?.end(undefined)
  } catch {
    // Best effort. Persisted auth state is retained for the next process.
  }

  if (!transportSettled || !stateSettled) {
    safeLog('warn', 'bridge_shutdown_grace_expired', {
      pending_inbound_batches: pendingInboundBatches,
      pending_sends: pendingSends,
      pending_auth_persists: authPersistQueue.snapshot().pending,
      outbox_depth: webhookOutbox.snapshot().outbox_depth,
    })
  }

  if (!serverClosed) {
    const closedWithinGrace = await settleWithin(
      [serverClosePromise],
      remaining(),
    )
    if (!closedWithinGrace) {
      server.closeIdleConnections?.()
      server.closeAllConnections?.()
    }
  }
  safeLog('info', 'bridge_stopped', {
    graceful: transportSettled && stateSettled && serverClosed,
  })
  process.exit(0)
}

process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))

start().catch(() => {
  safeLog('error', 'bridge_start_failed')
  process.exit(1)
})
