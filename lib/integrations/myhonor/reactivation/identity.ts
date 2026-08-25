import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto'

const VERSION = 'v1'
const AAD = Buffer.from('aistart360:myhonor-reactivation:v1', 'utf8')

function masterKey(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== 32) {
    throw new Error('MYHONOR_REACTIVATION_MASTER_KEY must be 32 bytes in base64')
  }
  return decoded
}

function derive(value: string, info: string): Buffer {
  return Buffer.from(hkdfSync(
    'sha256',
    masterKey(value),
    Buffer.from('aistart360-myhonor-reactivation', 'utf8'),
    Buffer.from(info, 'utf8'),
    32,
  ))
}

export function normalizeE164(value: string): string {
  const normalized = value.trim().replace(/[\s()-]/g, '')
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) {
    throw new Error('phone must be a valid E.164 number')
  }
  return normalized
}

export function contactPhoneHash(phone: string, master: string): string {
  return createHmac('sha256', derive(master, 'phone-hash'))
    .update(normalizeE164(phone))
    .digest('hex')
}

export function externalCustomerHash(
  externalCustomerId: string,
  companyId: string,
  master: string,
): string {
  const customerId = externalCustomerId.trim()
  const tenantId = companyId.trim()
  if (!customerId || !tenantId) {
    throw new Error('external customer and company identifiers are required')
  }
  return createHmac('sha256', derive(master, 'external-customer-hash'))
    .update(`${tenantId.length}:${tenantId}:${customerId.length}:${customerId}`)
    .digest('hex')
}

export function encryptContactValue(value: string, master: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', derive(master, 'pii-encryption'), iv)
  cipher.setAAD(AAD)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`
}

export function decryptContactValue(value: string, master: string): string {
  const [version, encoded, ...extra] = value.split(':')
  if (version !== VERSION || !encoded || extra.length > 0) {
    throw new Error('unsupported encrypted contact value')
  }
  const payload = Buffer.from(encoded, 'base64')
  if (payload.length < 29) throw new Error('invalid encrypted contact value')
  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const ciphertext = payload.subarray(28)
  const decipher = createDecipheriv(
    'aes-256-gcm',
    derive(master, 'pii-encryption'),
    iv,
  )
  decipher.setAAD(AAD)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

export function maskPhone(phone: string): string {
  const normalized = normalizeE164(phone)
  return `${normalized.slice(0, 3)}••••••${normalized.slice(-4)}`
}
