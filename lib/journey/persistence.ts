import { createHash, timingSafeEqual } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase-service'
import {
  journeyIdentitySchema,
  journeyStateSchema,
  type JourneyFile,
  type JourneyIdentity,
  type JourneyMessage,
  type JourneyState,
} from './schema'

export class JourneyAccessError extends Error {
  constructor(message = 'Неверный токен рабочего пространства.') {
    super(message)
    this.name = 'JourneyAccessError'
  }
}

export class JourneyConflictError extends Error {
  readonly currentRevision: number

  constructor(currentRevision: number, message = 'Рабочая область изменилась на другом устройстве.') {
    super(message)
    this.name = 'JourneyConflictError'
    this.currentRevision = currentRevision
  }
}

export class JourneyPersistenceUnavailableError extends Error {
  constructor(message = 'Синхронизация Journey сейчас недоступна.') {
    super(message)
    this.name = 'JourneyPersistenceUnavailableError'
  }
}

export interface JourneyPersistenceResult {
  mode: 'database' | 'local'
  label: string
  reason?: string
}

export interface LoadedJourney {
  state: JourneyState | null
  persistence: JourneyPersistenceResult
}

export function isJourneyDatabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export function hashJourneyCredential(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function requireJourneyCredential(identity: JourneyIdentity): string {
  const credential = identity.accessToken
  if (!credential) throw new JourneyAccessError('Для рабочей области не передан credential.')
  return credential
}

function hashesEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  return timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

export interface AuthorizedJourneyWorkspace {
  workspaceId: string
  userId: string | null
  state: unknown
  revision: number
  deviceCredentialId: string | null
}

/** Validate either the original legacy credential or a revocable per-device
 * credential. This is server-only and never returns a raw token. */
export async function authorizeJourneyAccess(
  identityInput: JourneyIdentity,
  actorUserId: string | null = null,
): Promise<AuthorizedJourneyWorkspace | null> {
  const identity = journeyIdentitySchema.parse(identityInput)
  if (!isJourneyDatabaseConfigured()) throw new JourneyPersistenceUnavailableError()
  const client = createServiceClient()
  const { data, error } = await client
    .from('ai_journey_workspaces')
    .select('workspace_key,access_token_hash,user_id,state,revision')
    .eq('workspace_key', identity.workspaceId)
    .maybeSingle()
  if (error) throw new JourneyPersistenceUnavailableError('Схема Journey недоступна.')
  if (!data) return null
  if (actorUserId && data.user_id && data.user_id !== actorUserId) throw new JourneyAccessError()

  const credentialHash = hashJourneyCredential(requireJourneyCredential(identity))
  if (hashesEqual(String(data.access_token_hash), credentialHash)) {
    return {
      workspaceId: String(data.workspace_key),
      userId: data.user_id ? String(data.user_id) : null,
      state: data.state,
      revision: Number(data.revision ?? 0),
      deviceCredentialId: null,
    }
  }

  const { data: device, error: deviceError } = await client
    .from('ai_journey_device_credentials')
    .select('id')
    .eq('workspace_key', identity.workspaceId)
    .eq('token_hash', credentialHash)
    .is('revoked_at', null)
    .maybeSingle()
  if (deviceError) throw new JourneyPersistenceUnavailableError('Миграция синхронизации Journey не применена.')
  if (!device) throw new JourneyAccessError()

  void client
    .from('ai_journey_device_credentials')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', device.id)
    .then(({ error: touchError }) => {
      if (touchError) console.warn('[journey:persistence] device touch failed', touchError)
    })

  return {
    workspaceId: String(data.workspace_key),
    userId: data.user_id ? String(data.user_id) : null,
    state: data.state,
    revision: Number(data.revision ?? 0),
    deviceCredentialId: String(device.id),
  }
}

export async function loadJourneyState(
  identityInput: JourneyIdentity,
  actorUserId: string | null = null,
): Promise<LoadedJourney> {
  const identity = journeyIdentitySchema.parse(identityInput)
  if (!isJourneyDatabaseConfigured()) {
    return {
      state: null,
      persistence: localPersistence('Supabase не настроен; состояние сохраняется локально в браузере.'),
    }
  }

  try {
    const authorized = await authorizeJourneyAccess(identity, actorUserId)
    if (!authorized) return { state: null, persistence: databasePersistence() }
    const parsed = journeyStateSchema.safeParse({
      ...(authorized.state as Record<string, unknown>),
      serverRevision: authorized.revision,
    })
    if (!parsed.success) {
      return {
        state: null,
        persistence: localPersistence('Сохранённое состояние имеет несовместимую версию и не было загружено.'),
      }
    }
    return {
      state: journeyStateSchema.parse({
        ...parsed.data,
        persistence: databasePersistence(),
      }),
      persistence: databasePersistence(),
    }
  } catch (error) {
    if (error instanceof JourneyAccessError) throw error
    console.warn('[journey:persistence] load failed; using client-local state', error)
    return {
      state: null,
      persistence: localPersistence('Схема БД недоступна или миграции Journey 063/064 ещё не применены.'),
    }
  }
}

export async function saveJourneyState(
  identityInput: JourneyIdentity,
  stateInput: JourneyState,
  actorUserId: string | null = null,
): Promise<{ state: JourneyState; persistence: JourneyPersistenceResult }> {
  const identity = journeyIdentitySchema.parse(identityInput)
  const state = journeyStateSchema.parse(stateInput)
  if (state.workspaceId !== identity.workspaceId) throw new JourneyAccessError('Workspace ID не совпадает.')

  if (!isJourneyDatabaseConfigured()) {
    const persistence = localPersistence('Supabase не настроен; состояние сохраняется локально в браузере.')
    return { state: withPersistence(state, persistence), persistence }
  }

  try {
    const client = createServiceClient()
    const credentialHash = hashJourneyCredential(requireJourneyCredential(identity))
    const expectedRevision = Number(state.serverRevision ?? 0)
    const persistedState = withPersistence(state, databasePersistence())
    const { data, error } = await client.rpc('save_ai_journey_workspace_state', {
      p_workspace_key: identity.workspaceId,
      p_credential_hash: credentialHash,
      p_actor_user_id: actorUserId,
      p_expected_revision: expectedRevision,
      p_phase: persistedState.phase,
      p_profile: {
        companyName: persistedState.companyName,
        businessDescription: persistedState.businessDescription,
      },
      p_facts: persistedState.facts,
      p_goals: persistedState.goals,
      p_roadmap: persistedState.roadmap,
      p_widget_state: persistedState.widgets,
      p_state: persistedState,
      p_now: new Date().toISOString(),
    })
    if (error) throw new JourneyPersistenceUnavailableError('Миграция синхронизации Journey не применена.')
    const result = Array.isArray(data) ? data[0] : data
    if (!result) throw new JourneyPersistenceUnavailableError()
    if (result.status === 'forbidden') throw new JourneyAccessError()
    if (result.status === 'stale') throw new JourneyConflictError(Number(result.server_revision ?? 0))
    if (result.status !== 'saved') throw new JourneyPersistenceUnavailableError()
    const savedState = journeyStateSchema.parse({
      ...(result.workspace_state as Record<string, unknown>),
      serverRevision: Number(result.server_revision),
      persistence: databasePersistence(),
    })
    return { state: savedState, persistence: databasePersistence() }
  } catch (error) {
    if (
      error instanceof JourneyAccessError ||
      error instanceof JourneyConflictError ||
      error instanceof JourneyPersistenceUnavailableError
    ) throw error
    console.warn('[journey:persistence] save failed; using client-local state', error)
    const persistence = localPersistence('База недоступна или миграции Journey 063/064 не применены; сохранено локально.')
    return { state: withPersistence(state, persistence), persistence }
  }
}

export async function appendJourneyMessages(
  identity: JourneyIdentity,
  messages: JourneyMessage[],
  providerMode: JourneyState['provider']['mode'],
): Promise<void> {
  if (!isJourneyDatabaseConfigured() || messages.length === 0) return
  try {
    const client = createServiceClient()
    const authorized = await authorizeJourneyAccess(identity)
    if (!authorized) throw new JourneyAccessError()
    const { error } = await client.from('ai_journey_messages').upsert(
      messages.map((message) => ({
        id: message.id,
        workspace_key: identity.workspaceId,
        role: message.role,
        content: message.text,
        provider_mode: providerMode,
        created_at: message.createdAt,
      })),
      { onConflict: 'id' },
    )
    if (error) throw error
  } catch (error) {
    if (error instanceof JourneyAccessError) throw error
    console.warn('[journey:persistence] message mirror failed', error)
  }
}

export async function upsertJourneyFile(
  identity: JourneyIdentity,
  file: JourneyFile,
  details: { storagePath?: string; parser?: string; facts?: unknown[]; error?: string },
): Promise<void> {
  if (!isJourneyDatabaseConfigured()) return
  try {
    const client = createServiceClient()
    const { error } = await client.from('ai_journey_files').upsert(
      {
        id: file.id,
        workspace_key: identity.workspaceId,
        name: file.name,
        mime: file.mime,
        size_bytes: file.sizeBytes,
        status: file.status,
        storage_path: details.storagePath,
        parser: details.parser,
        extracted_facts: details.facts ?? [],
        error: details.error,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    if (error) throw error
  } catch (error) {
    console.warn('[journey:persistence] file mirror failed', error)
  }
}

export async function storeJourneyFile(
  identity: JourneyIdentity,
  fileId: string,
  fileName: string,
  mime: string,
  buffer: Buffer,
): Promise<string | undefined> {
  if (!isJourneyDatabaseConfigured()) return undefined
  try {
    const client = createServiceClient()
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160)
    const path = `journey/${identity.workspaceId}/${fileId}-${safeName}`
    const { error } = await client.storage.from('client-documents').upload(path, buffer, {
      contentType: mime,
      upsert: false,
    })
    if (error) throw error
    return path
  } catch (error) {
    console.warn('[journey:persistence] object upload failed; keeping extracted metadata only', error)
    return undefined
  }
}

function withPersistence(state: JourneyState, persistence: JourneyPersistenceResult): JourneyState {
  return journeyStateSchema.parse({ ...state, persistence })
}

function databasePersistence(): JourneyPersistenceResult {
  return { mode: 'database', label: 'Сохранено в AIStart360' }
}

function localPersistence(reason: string): JourneyPersistenceResult {
  return { mode: 'local', label: 'Локальное сохранение', reason }
}
