import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'crypto'

export const WHATSAPP_WEB_SIGNATURE_VERSION = 'v1' as const
export const WHATSAPP_WEB_BRIDGE_AUDIENCE = 'whatsapp-web-bridge' as const
export const WHATSAPP_WEB_PORTAL_AUDIENCE = 'aistart360-portal' as const

export const WHATSAPP_WEB_SIGNATURE_HEADERS = {
  version: 'x-wa-bridge-version',
  audience: 'x-wa-bridge-audience',
  timestamp: 'x-wa-bridge-timestamp',
  nonce: 'x-wa-bridge-nonce',
  keyId: 'x-wa-bridge-key-id',
  signature: 'x-wa-bridge-signature',
} as const

export interface CreateBridgeSignatureInput {
  method: string
  path: string
  body: Buffer | Uint8Array | string
  secret: string
  audience: string
  timestamp?: number
  nonce?: string
  keyId?: string
}
export interface BridgeSignatureHeaders {
  'x-wa-bridge-version': typeof WHATSAPP_WEB_SIGNATURE_VERSION
  'x-wa-bridge-audience': string
  'x-wa-bridge-timestamp': string
  'x-wa-bridge-nonce': string
  'x-wa-bridge-key-id': string
  'x-wa-bridge-signature': string
}

export type BridgeSignatureVerification =
  | { ok: true; timestamp: number; nonce: string; keyId: string }
  | {
      ok: false
      reason:
        | 'missing_header'
        | 'invalid_version'
        | 'invalid_audience'
        | 'invalid_timestamp'
        | 'expired_timestamp'
        | 'invalid_nonce'
        | 'unknown_key'
        | 'invalid_signature'
    }

export interface VerifyBridgeSignatureInput {
  method: string
  path: string
  body: Buffer | Uint8Array | string
  headers: Headers
  expectedAudience: string
  secrets: Record<string, string | undefined>
  nowSeconds?: number
  maxSkewSeconds?: number
}

function rawBody(value: Buffer | Uint8Array | string): Buffer {
  if (typeof value === 'string') return Buffer.from(value, 'utf8')
  return Buffer.from(value)
}

function normalizedMethod(value: string): string {
  const method = value.trim().toUpperCase()
  if (!/^[A-Z]+$/.test(method)) throw new Error('Invalid bridge signature method')
  return method
}

function normalizedPath(value: string): string {
  const path = value.trim()
  if (!path.startsWith('/') || path.includes('?') || path.includes('#') || /[\r\n]/.test(path)) {
    throw new Error('Invalid bridge signature path')
  }
  return path
}

function safeToken(value: string, label: string): string {
  const token = value.trim()
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(token)) {
    throw new Error(`Invalid bridge signature ${label}`)
  }
  return token
}

function canonicalPayload(input: {
  method: string
  path: string
  body: Buffer | Uint8Array | string
  audience: string
  timestamp: number
  nonce: string
  keyId: string
}): string {
  const bodyHash = createHash('sha256').update(rawBody(input.body)).digest('hex')
  return [
    WHATSAPP_WEB_SIGNATURE_VERSION,
    normalizedMethod(input.method),
    safeToken(input.audience, 'audience'),
    normalizedPath(input.path),
    bodyHash,
    String(Math.trunc(input.timestamp)),
    safeToken(input.nonce, 'nonce'),
    safeToken(input.keyId, 'key id'),
  ].join('\n')
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

export function createBridgeSignature(input: CreateBridgeSignatureInput): {
  timestamp: number
  nonce: string
  keyId: string
  signature: string
} {
  if (!input.secret.trim()) throw new Error('Bridge signature secret is missing')
  const timestamp = Math.trunc(input.timestamp ?? Date.now() / 1_000)
  const nonce = input.nonce ?? randomUUID()
  const keyId = input.keyId ?? 'primary'
  const canonical = canonicalPayload({ ...input, timestamp, nonce, keyId })
  const signature = `sha256=${createHmac('sha256', input.secret).update(canonical).digest('hex')}`
  return { timestamp, nonce, keyId, signature }
}

export function createSignedBridgeHeaders(
  input: CreateBridgeSignatureInput,
): BridgeSignatureHeaders {
  const signed = createBridgeSignature(input)
  return {
    [WHATSAPP_WEB_SIGNATURE_HEADERS.version]: WHATSAPP_WEB_SIGNATURE_VERSION,
    [WHATSAPP_WEB_SIGNATURE_HEADERS.audience]: input.audience,
    [WHATSAPP_WEB_SIGNATURE_HEADERS.timestamp]: String(signed.timestamp),
    [WHATSAPP_WEB_SIGNATURE_HEADERS.nonce]: signed.nonce,
    [WHATSAPP_WEB_SIGNATURE_HEADERS.keyId]: signed.keyId,
    [WHATSAPP_WEB_SIGNATURE_HEADERS.signature]: signed.signature,
  }
}

export function verifySignedBridgeRequest(
  input: VerifyBridgeSignatureInput,
): BridgeSignatureVerification {
  const version = input.headers.get(WHATSAPP_WEB_SIGNATURE_HEADERS.version)
  const audience = input.headers.get(WHATSAPP_WEB_SIGNATURE_HEADERS.audience)
  const timestampHeader = input.headers.get(WHATSAPP_WEB_SIGNATURE_HEADERS.timestamp)
  const nonce = input.headers.get(WHATSAPP_WEB_SIGNATURE_HEADERS.nonce)
  const keyId = input.headers.get(WHATSAPP_WEB_SIGNATURE_HEADERS.keyId)
  const signature = input.headers.get(WHATSAPP_WEB_SIGNATURE_HEADERS.signature)
  if (!version || !audience || !timestampHeader || !nonce || !keyId || !signature) {
    return { ok: false, reason: 'missing_header' }
  }
  if (version !== WHATSAPP_WEB_SIGNATURE_VERSION) {
    return { ok: false, reason: 'invalid_version' }
  }
  if (!constantTimeEqual(audience, input.expectedAudience)) {
    return { ok: false, reason: 'invalid_audience' }
  }
  if (!/^\d{10}$/.test(timestampHeader)) {
    return { ok: false, reason: 'invalid_timestamp' }
  }
  const timestamp = Number(timestampHeader)
  const now = Math.trunc(input.nowSeconds ?? Date.now() / 1_000)
  const maxSkewSeconds = Math.max(1, Math.min(300, input.maxSkewSeconds ?? 60))
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > maxSkewSeconds) {
    return { ok: false, reason: 'expired_timestamp' }
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(nonce)) {
    return { ok: false, reason: 'invalid_nonce' }
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(keyId)) {
    return { ok: false, reason: 'unknown_key' }
  }
  const secret = input.secrets[keyId]
  if (!secret?.trim()) return { ok: false, reason: 'unknown_key' }

  let expected: string
  try {
    expected = createBridgeSignature({
      method: input.method,
      path: input.path,
      body: input.body,
      secret,
      audience: input.expectedAudience,
      timestamp,
      nonce,
      keyId,
    }).signature
  } catch {
    return { ok: false, reason: 'invalid_signature' }
  }
  if (!constantTimeEqual(expected, signature)) {
    return { ok: false, reason: 'invalid_signature' }
  }
  return { ok: true, timestamp, nonce, keyId }
}
