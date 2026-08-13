import { createHash, createHmac, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase-service'
import { isReservedJourneyWorkspaceId } from './auth-bootstrap'
import {
  authorizeJourneyAccess,
  hashJourneyCredential,
  isJourneyDatabaseConfigured,
  JourneyAccessError,
  JourneyPersistenceUnavailableError,
  type AuthorizedJourneyWorkspace,
} from './persistence'
import { journeyIdentitySchema, journeyStateSchema, type JourneyIdentity, type JourneyState } from './schema'

export const JOURNEY_CONNECT_CODE_TTL_MS = 10 * 60_000
export const JOURNEY_CONNECT_CODE_MAX_ATTEMPTS = 5
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const journeyConnectCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
  .pipe(z.string().length(8).regex(/^[A-HJ-NP-Z2-9]{8}$/))

export const journeyDeviceLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .default('Связанное устройство')

export type JourneyConnectClaimStatus =
  | 'claimed'
  | 'invalid'
  | 'consumed'
  | 'expired'
  | 'locked'
  | 'forbidden'

export interface JourneyConnectSource {
  workspaceId: string
  userId: string | null
  state: unknown
  revision: number
  deviceCredentialId: string | null
}

export interface JourneyConnectClaim {
  status: JourneyConnectClaimStatus
  workspaceId?: string
  state?: unknown
  revision?: number
}

export interface JourneyDeviceSyncRepository {
  authorizeSource(identity: JourneyIdentity, actorUserId: string | null): Promise<JourneyConnectSource | null>
  findCanonicalWorkspace(actorUserId: string): Promise<JourneyConnectSource | null>
  insertConnectCode(input: {
    codeHash: string
    workspaceId: string
    actorUserId: string | null
    deviceCredentialId: string | null
    expiresAt: string
    maxAttempts: number
  }): Promise<boolean>
  claimConnectCode(input: {
    codeHash: string
    deviceTokenHash: string
    deviceLabel: string
    actorUserId: string | null
    now: string
  }): Promise<JourneyConnectClaim>
}

export interface JourneyDeviceSyncDependencies {
  repository: JourneyDeviceSyncRepository
  now: () => Date
  randomCode: () => string
  randomDeviceToken: () => string
  hashConnectCode: (code: string) => string
}

export class JourneyConnectCodeError extends Error {
  readonly code:
    | 'JOURNEY_CONNECT_CODE_REQUIRED'
    | 'JOURNEY_CONNECT_CODE_INVALID'
    | 'JOURNEY_CONNECT_CODE_EXPIRED'
    | 'JOURNEY_CONNECT_CODE_CONSUMED'
    | 'JOURNEY_CONNECT_CODE_LOCKED'

  constructor(code: JourneyConnectCodeError['code'], message: string) {
    super(message)
    this.name = 'JourneyConnectCodeError'
    this.code = code
  }
}

export interface CreateJourneyConnectCodeInput {
  identity?: JourneyIdentity
  actorUserId: string | null
}

export interface RedeemJourneyConnectCodeInput {
  code: string
  deviceLabel?: string
  actorUserId: string | null
}

export async function createJourneyConnectCode(
  input: CreateJourneyConnectCodeInput,
  deps: JourneyDeviceSyncDependencies = defaultDependencies(),
): Promise<{ code: string; expiresAt: string; workspaceId: string }> {
  const identity = input.identity ? journeyIdentitySchema.parse(input.identity) : undefined
  let source: JourneyConnectSource | null = null

  if (identity && isReservedJourneyWorkspaceId(identity.workspaceId)) {
    throw reservedWorkspaceAccessError()
  }

  // An explicitly supplied active workspace must win, otherwise a client that
  // ignores workspaceId in this response could silently link the wrong board.
  // A signed-in canonical fallback is allowed only when there is no identity.
  if (identity) {
    source = await deps.repository.authorizeSource(identity, input.actorUserId)
    if (!source) throw new JourneyAccessError()
    if (input.actorUserId) {
      if (source.userId !== input.actorUserId) throw new JourneyAccessError()
    } else if (source.userId) {
      throw new JourneyAccessError()
    }
  } else if (input.actorUserId) {
    source = await deps.repository.findCanonicalWorkspace(input.actorUserId)
  }
  if (!source) {
    if (!identity && !input.actorUserId) {
      throw new JourneyConnectCodeError(
        'JOURNEY_CONNECT_CODE_REQUIRED',
        'Откройте существующую Journey-доску, чтобы связать новое устройство.',
      )
    }
    throw new JourneyAccessError()
  }
  if (isReservedJourneyWorkspaceId(source.workspaceId)) {
    throw reservedWorkspaceAccessError()
  }
  if (source.userId && source.userId !== input.actorUserId) throw new JourneyAccessError()

  const expiresAt = new Date(deps.now().getTime() + JOURNEY_CONNECT_CODE_TTL_MS).toISOString()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const normalizedCode = journeyConnectCodeSchema.parse(deps.randomCode())
    const inserted = await deps.repository.insertConnectCode({
      codeHash: deps.hashConnectCode(normalizedCode),
      workspaceId: source.workspaceId,
      actorUserId: input.actorUserId,
      deviceCredentialId: source.deviceCredentialId,
      expiresAt,
      maxAttempts: JOURNEY_CONNECT_CODE_MAX_ATTEMPTS,
    })
    if (inserted) {
      return {
        code: `${normalizedCode.slice(0, 4)}-${normalizedCode.slice(4)}`,
        expiresAt,
        workspaceId: source.workspaceId,
      }
    }
  }
  throw new JourneyPersistenceUnavailableError('Не удалось выпустить уникальный код. Повторите позже.')
}

export async function redeemJourneyConnectCode(
  input: RedeemJourneyConnectCodeInput,
  deps: JourneyDeviceSyncDependencies = defaultDependencies(),
): Promise<{ workspaceId: string; state: JourneyState; deviceToken: string }> {
  const normalizedCode = journeyConnectCodeSchema.parse(input.code)
  const deviceLabel = journeyDeviceLabelSchema.parse(input.deviceLabel)
  const deviceToken = deps.randomDeviceToken()
  const claim = await deps.repository.claimConnectCode({
    codeHash: deps.hashConnectCode(normalizedCode),
    deviceTokenHash: hashJourneyCredential(deviceToken),
    deviceLabel,
    actorUserId: input.actorUserId,
    now: deps.now().toISOString(),
  })

  if (claim.status !== 'claimed' || !claim.workspaceId || !claim.state) {
    throw claimError(claim.status)
  }
  if (isReservedJourneyWorkspaceId(claim.workspaceId)) {
    throw reservedWorkspaceAccessError()
  }
  const state = journeyStateSchema.parse({
    ...(claim.state as Record<string, unknown>),
    workspaceId: claim.workspaceId,
    serverRevision: claim.revision ?? 0,
    persistence: { mode: 'database', label: 'Сохранено в AIStart360' },
  })
  return { workspaceId: claim.workspaceId, state, deviceToken }
}

export function formatJourneyConnectCode(value: string): string {
  const code = journeyConnectCodeSchema.parse(value)
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

interface ConnectCodeEnvironment {
  NODE_ENV?: string
  JOURNEY_CONNECT_CODE_SECRET?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

/** A user-enterable code has only ~40 bits of entropy. A keyed digest prevents
 * an offline attacker with a database snapshot from enumerating every code.
 * Production requires a dedicated secret. Development may derive a server-only
 * key from the local service-role secret, and therefore still fails closed when
 * no server secret is configured. */
export function hashJourneyConnectCode(
  value: string,
  environment: ConnectCodeEnvironment = process.env,
): string {
  const code = journeyConnectCodeSchema.parse(value)
  const configuredSecret = environment.JOURNEY_CONNECT_CODE_SECRET
  let secret: string
  if (configuredSecret) {
    if (Buffer.byteLength(configuredSecret, 'utf8') < 32) {
      throw new JourneyPersistenceUnavailableError(
        'JOURNEY_CONNECT_CODE_SECRET должен содержать не менее 32 байт.',
      )
    }
    secret = configuredSecret
  } else {
    if (environment.NODE_ENV === 'production') {
      throw new JourneyPersistenceUnavailableError(
        'Для production-синхронизации не задан JOURNEY_CONNECT_CODE_SECRET.',
      )
    }
    const serviceRoleSecret = environment.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleSecret) {
      throw new JourneyPersistenceUnavailableError(
        'Для локальной синхронизации не настроен серверный секрет.',
      )
    }
    secret = createHash('sha256')
      .update('aistart360:journey-connect-code:development:v1\0', 'utf8')
      .update(serviceRoleSecret, 'utf8')
      .digest('hex')
  }
  return createHmac('sha256', secret)
    .update('aistart360:journey-connect-code:v1\0', 'utf8')
    .update(code, 'utf8')
    .digest('hex')
}

function claimError(status: JourneyConnectClaimStatus): JourneyConnectCodeError {
  if (status === 'expired') {
    return new JourneyConnectCodeError('JOURNEY_CONNECT_CODE_EXPIRED', 'Срок действия кода истёк. Создайте новый код.')
  }
  if (status === 'consumed') {
    return new JourneyConnectCodeError('JOURNEY_CONNECT_CODE_CONSUMED', 'Этот код уже использован.')
  }
  if (status === 'locked') {
    return new JourneyConnectCodeError('JOURNEY_CONNECT_CODE_LOCKED', 'Код заблокирован после нескольких попыток.')
  }
  // Do not disclose whether a valid code belongs to another signed-in user.
  return new JourneyConnectCodeError('JOURNEY_CONNECT_CODE_INVALID', 'Код недействителен или введён неверно.')
}

function reservedWorkspaceAccessError(): JourneyAccessError {
  return new JourneyAccessError(
    'Зарезервированное рабочее пространство Store нельзя подключить через общий Journey.',
  )
}

function defaultDependencies(): JourneyDeviceSyncDependencies {
  if (!isJourneyDatabaseConfigured()) throw new JourneyPersistenceUnavailableError()
  return {
    repository: new SupabaseJourneyDeviceSyncRepository(),
    now: () => new Date(),
    randomCode: secureConnectCode,
    randomDeviceToken: () => randomBytes(32).toString('base64url'),
    hashConnectCode: hashJourneyConnectCode,
  }
}

function secureConnectCode(): string {
  const bytes = randomBytes(8)
  let code = ''
  for (let index = 0; index < 8; index += 1) {
    code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length]
  }
  return code
}

class SupabaseJourneyDeviceSyncRepository implements JourneyDeviceSyncRepository {
  async authorizeSource(identity: JourneyIdentity, actorUserId: string | null): Promise<AuthorizedJourneyWorkspace | null> {
    return authorizeJourneyAccess(identity, actorUserId)
  }

  async findCanonicalWorkspace(actorUserId: string): Promise<JourneyConnectSource | null> {
    const client = createServiceClient()
    const { data, error } = await client
      .from('ai_journey_workspaces')
      .select('workspace_key,user_id,state,revision')
      .eq('user_id', actorUserId)
      .not('workspace_key', 'like', 'journey-store-user-%')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new JourneyPersistenceUnavailableError('Не удалось найти рабочую область пользователя.')
    if (!data) return null
    return {
      workspaceId: String(data.workspace_key),
      userId: String(data.user_id),
      state: data.state,
      revision: Number(data.revision ?? 0),
      deviceCredentialId: null,
    }
  }

  async insertConnectCode(input: Parameters<JourneyDeviceSyncRepository['insertConnectCode']>[0]): Promise<boolean> {
    const client = createServiceClient()
    const { error } = await client.from('ai_journey_connect_codes').insert({
      code_hash: input.codeHash,
      workspace_key: input.workspaceId,
      created_by_device_id: input.deviceCredentialId,
      created_by_user_id: input.actorUserId,
      expires_at: input.expiresAt,
      max_attempts: input.maxAttempts,
    })
    if (!error) return true
    if (error.code === '23505') return false
    throw new JourneyPersistenceUnavailableError('Не удалось сохранить код подключения.')
  }

  async claimConnectCode(input: Parameters<JourneyDeviceSyncRepository['claimConnectCode']>[0]): Promise<JourneyConnectClaim> {
    const client = createServiceClient()
    const { data, error } = await client.rpc('claim_ai_journey_connect_code', {
      p_code_hash: input.codeHash,
      p_device_token_hash: input.deviceTokenHash,
      p_device_label: input.deviceLabel,
      p_actor_user_id: input.actorUserId,
      p_now: input.now,
    })
    if (error) throw new JourneyPersistenceUnavailableError('Миграция синхронизации Journey не применена.')
    const row = Array.isArray(data) ? data[0] : data
    if (!row) return { status: 'invalid' }
    return {
      status: row.status as JourneyConnectClaimStatus,
      workspaceId: row.workspace_key ? String(row.workspace_key) : undefined,
      state: row.workspace_state,
      revision: row.server_revision == null ? undefined : Number(row.server_revision),
    }
  }
}
