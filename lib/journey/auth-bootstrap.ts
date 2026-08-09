import { randomBytes } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase-service'
import {
  authorizeJourneyAccess,
  hashJourneyCredential,
  JourneyAccessError,
  JourneyConflictError,
  JourneyPersistenceUnavailableError,
  type AuthorizedJourneyWorkspace,
  type JourneyPersistenceResult,
} from './persistence'
import {
  journeyIdentitySchema,
  journeyStateSchema,
  type JourneyIdentity,
  type JourneyState,
} from './schema'

export interface JourneyAuthBootstrapRepository {
  authorize(
    identity: JourneyIdentity,
    actorUserId: string,
  ): Promise<AuthorizedJourneyWorkspace | null>
  findMapped(actorUserId: string): Promise<AuthorizedJourneyWorkspace | null>
  findLatestOwned(actorUserId: string): Promise<AuthorizedJourneyWorkspace | null>
  bindCanonical(actorUserId: string, workspaceId: string): Promise<string>
  ensureWorkspace(input: {
    workspaceId: string
    actorUserId: string
    credentialHash: string
    state: JourneyState
  }): Promise<AuthorizedJourneyWorkspace>
  registerDevice(input: {
    workspaceId: string
    actorUserId: string
    tokenHash: string
    deviceLabel: string
  }): Promise<void>
  saveState(input: {
    workspace: AuthorizedJourneyWorkspace
    actorUserId: string
    credentialHash: string
    state: JourneyState
  }): Promise<AuthorizedJourneyWorkspace>
  markSeeded(actorUserId: string, fingerprint: string): Promise<void>
}

export interface JourneyAuthBootstrapDependencies {
  repository: JourneyAuthBootstrapRepository
  randomDeviceToken: () => string
}

export interface AuthenticatedJourneyResult {
  state: JourneyState
  persistence: JourneyPersistenceResult
  deviceToken?: string
  switchedWorkspace: boolean
}

interface ResolveAuthenticatedJourneyInput {
  identity: JourneyIdentity
  actorUserId: string
  buildInitialState: (workspaceId: string) => Promise<JourneyState>
}

const DATABASE_PERSISTENCE: JourneyPersistenceResult = {
  mode: 'database',
  label: 'Сохранено в AIStart360',
}

export async function resolveAuthenticatedJourneyState(
  input: ResolveAuthenticatedJourneyInput,
  dependencies: JourneyAuthBootstrapDependencies = defaultDependencies(),
): Promise<AuthenticatedJourneyResult> {
  const identity = journeyIdentitySchema.parse(input.identity)
  const { repository } = dependencies

  const requested = await repository.authorize(identity, input.actorUserId)
  let canonical = await repository.findMapped(input.actorUserId)

  if (!canonical) {
    if (requested?.userId === input.actorUserId) {
      await repository.bindCanonical(input.actorUserId, requested.workspaceId)
    } else {
      const latest = await repository.findLatestOwned(input.actorUserId)
      if (latest) {
        await repository.bindCanonical(input.actorUserId, latest.workspaceId)
      } else {
        const workspaceId = canonicalWorkspaceId(input.actorUserId)
        const initialState = await input.buildInitialState(workspaceId)
        const rootCredentialHash = hashJourneyCredential(dependencies.randomDeviceToken())
        const created = await repository.ensureWorkspace({
          workspaceId,
          actorUserId: input.actorUserId,
          credentialHash: rootCredentialHash,
          state: initialState,
        })
        await repository.bindCanonical(input.actorUserId, created.workspaceId)
      }
    }
    canonical = await repository.findMapped(input.actorUserId)
  }

  if (!canonical || canonical.userId !== input.actorUserId) {
    throw new JourneyPersistenceUnavailableError(
      'Каноническое рабочее пространство Journey недоступно.',
    )
  }

  let credentialHash: string
  let deviceToken: string | undefined
  const canReuseRequestedCredential =
    requested?.workspaceId === canonical.workspaceId &&
    requested.userId === input.actorUserId &&
    Boolean(identity.accessToken)

  if (canReuseRequestedCredential) {
    credentialHash = hashJourneyCredential(identity.accessToken!)
  } else {
    deviceToken = dependencies.randomDeviceToken()
    credentialHash = hashJourneyCredential(deviceToken)
    await repository.registerDevice({
      workspaceId: canonical.workspaceId,
      actorUserId: input.actorUserId,
      tokenHash: credentialHash,
      deviceLabel: 'Браузер после входа',
    })
  }

  let selected = canonical
  const currentState = parseAuthorizedState(selected)
  if (isPristineJourneyState(currentState)) {
    const seed = await input.buildInitialState(selected.workspaceId)
    if (hasOnboardingSeed(seed)) {
      selected = await repository.saveState({
        workspace: selected,
        actorUserId: input.actorUserId,
        credentialHash,
        state: journeyStateSchema.parse({
          ...seed,
          workspaceId: selected.workspaceId,
          serverRevision: selected.revision,
          persistence: DATABASE_PERSISTENCE,
        }),
      })
      await repository.markSeeded(input.actorUserId, journeySeedFingerprint(seed))
    }
  }

  return {
    state: parseAuthorizedState(selected),
    persistence: DATABASE_PERSISTENCE,
    ...(deviceToken ? { deviceToken } : {}),
    switchedWorkspace: selected.workspaceId !== identity.workspaceId,
  }
}

export function canonicalWorkspaceId(actorUserId: string): string {
  return `journey-user-${actorUserId}`
}

export function isPristineJourneyState(state: JourneyState): boolean {
  return (
    state.phase === 'empty' &&
    !state.companyName &&
    !state.businessDescription &&
    state.facts.length === 0 &&
    state.goals.length === 0 &&
    state.roadmap.length === 0 &&
    state.widgets.length === 0 &&
    state.files.length === 0 &&
    state.messages.length <= 1
  )
}

function defaultDependencies(): JourneyAuthBootstrapDependencies {
  return {
    repository: new SupabaseJourneyAuthBootstrapRepository(),
    randomDeviceToken: () => randomBytes(32).toString('base64url'),
  }
}

class SupabaseJourneyAuthBootstrapRepository implements JourneyAuthBootstrapRepository {
  async authorize(
    identity: JourneyIdentity,
    actorUserId: string,
  ): Promise<AuthorizedJourneyWorkspace | null> {
    try {
      return await authorizeJourneyAccess(identity, actorUserId)
    } catch (error) {
      if (error instanceof JourneyAccessError) return null
      throw error
    }
  }

  async findMapped(actorUserId: string): Promise<AuthorizedJourneyWorkspace | null> {
    const client = createServiceClient()
    const { data: mapping, error } = await client
      .from('ai_journey_user_workspaces')
      .select('workspace_key')
      .eq('user_id', actorUserId)
      .maybeSingle()
    if (error) {
      throw new JourneyPersistenceUnavailableError(
        // 078_ai_journey_authenticated_bootstrap.sql — the one that creates
        // ai_journey_user_workspaces (was 074 before the AIStart360 merge,
        // where 074 was already taken by 074_ai_first_workspace).
        'Миграция Journey 078 ещё не применена.',
      )
    }
    if (!mapping?.workspace_key) return null
    return this.findOwnedByKey(String(mapping.workspace_key), actorUserId)
  }

  async findLatestOwned(actorUserId: string): Promise<AuthorizedJourneyWorkspace | null> {
    const client = createServiceClient()
    const { data, error } = await client
      .from('ai_journey_workspaces')
      .select('workspace_key,user_id,state,revision')
      .eq('user_id', actorUserId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      throw new JourneyPersistenceUnavailableError(
        'Не удалось найти рабочее пространство Journey.',
      )
    }
    return data ? authorizedFromRow(data) : null
  }

  async bindCanonical(actorUserId: string, workspaceId: string): Promise<string> {
    const client = createServiceClient()
    const owned = await this.findOwnedByKey(workspaceId, actorUserId)
    if (!owned) throw new JourneyAccessError()

    const { error } = await client
      .from('ai_journey_user_workspaces')
      .insert({ user_id: actorUserId, workspace_key: workspaceId })
    if (error && error.code !== '23505') {
      throw new JourneyPersistenceUnavailableError(
        'Не удалось закрепить рабочее пространство Journey.',
      )
    }
    const { data: mapping, error: lookupError } = await client
      .from('ai_journey_user_workspaces')
      .select('workspace_key')
      .eq('user_id', actorUserId)
      .maybeSingle()
    if (lookupError || !mapping?.workspace_key) {
      throw new JourneyPersistenceUnavailableError(
        'Не удалось подтвердить рабочее пространство Journey.',
      )
    }
    return String(mapping.workspace_key)
  }

  async ensureWorkspace(input: {
    workspaceId: string
    actorUserId: string
    credentialHash: string
    state: JourneyState
  }): Promise<AuthorizedJourneyWorkspace> {
    try {
      return await this.writeState({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        credentialHash: input.credentialHash,
        expectedRevision: 0,
        state: input.state,
      })
    } catch (error) {
      if (!(error instanceof JourneyConflictError)) throw error
      const existing = await this.findOwnedByKey(input.workspaceId, input.actorUserId)
      if (!existing) throw new JourneyAccessError()
      return existing
    }
  }

  async registerDevice(input: {
    workspaceId: string
    actorUserId: string
    tokenHash: string
    deviceLabel: string
  }): Promise<void> {
    const client = createServiceClient()
    const owned = await this.findOwnedByKey(input.workspaceId, input.actorUserId)
    if (!owned) throw new JourneyAccessError()
    const { error } = await client.from('ai_journey_device_credentials').insert({
      workspace_key: input.workspaceId,
      token_hash: input.tokenHash,
      device_label: input.deviceLabel,
      created_by_user_id: input.actorUserId,
      last_used_at: new Date().toISOString(),
    })
    if (error) {
      throw new JourneyPersistenceUnavailableError(
        'Не удалось создать credential для Journey.',
      )
    }
  }

  async saveState(input: {
    workspace: AuthorizedJourneyWorkspace
    actorUserId: string
    credentialHash: string
    state: JourneyState
  }): Promise<AuthorizedJourneyWorkspace> {
    return this.writeState({
      workspaceId: input.workspace.workspaceId,
      actorUserId: input.actorUserId,
      credentialHash: input.credentialHash,
      expectedRevision: input.workspace.revision,
      state: input.state,
    })
  }

  async markSeeded(actorUserId: string, fingerprint: string): Promise<void> {
    const client = createServiceClient()
    const now = new Date().toISOString()
    const { error } = await client
      .from('ai_journey_user_workspaces')
      .update({
        seed_fingerprint: fingerprint,
        seeded_at: now,
        updated_at: now,
      })
      .eq('user_id', actorUserId)
    if (error) {
      console.warn('[journey:bootstrap] seed marker update failed', error)
    }
  }

  private async findOwnedByKey(
    workspaceId: string,
    actorUserId: string,
  ): Promise<AuthorizedJourneyWorkspace | null> {
    const client = createServiceClient()
    const { data, error } = await client
      .from('ai_journey_workspaces')
      .select('workspace_key,user_id,state,revision')
      .eq('workspace_key', workspaceId)
      .eq('user_id', actorUserId)
      .maybeSingle()
    if (error) {
      throw new JourneyPersistenceUnavailableError(
        'Не удалось загрузить рабочее пространство Journey.',
      )
    }
    return data ? authorizedFromRow(data) : null
  }

  private async writeState(input: {
    workspaceId: string
    actorUserId: string
    credentialHash: string
    expectedRevision: number
    state: JourneyState
  }): Promise<AuthorizedJourneyWorkspace> {
    const client = createServiceClient()
    const persistedState = journeyStateSchema.parse({
      ...input.state,
      workspaceId: input.workspaceId,
      serverRevision: input.expectedRevision,
      persistence: DATABASE_PERSISTENCE,
    })
    const { data, error } = await client.rpc('save_ai_journey_workspace_state', {
      p_workspace_key: input.workspaceId,
      p_credential_hash: input.credentialHash,
      p_actor_user_id: input.actorUserId,
      p_expected_revision: input.expectedRevision,
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
    if (error) {
      throw new JourneyPersistenceUnavailableError(
        'Не удалось сохранить рабочее пространство Journey.',
      )
    }
    const result = Array.isArray(data) ? data[0] : data
    if (!result) throw new JourneyPersistenceUnavailableError()
    if (result.status === 'forbidden') throw new JourneyAccessError()
    if (result.status === 'stale') {
      throw new JourneyConflictError(Number(result.server_revision ?? 0))
    }
    if (result.status !== 'saved') throw new JourneyPersistenceUnavailableError()
    return {
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      state: result.workspace_state,
      revision: Number(result.server_revision),
      deviceCredentialId: null,
    }
  }
}

function parseAuthorizedState(workspace: AuthorizedJourneyWorkspace): JourneyState {
  const parsed = journeyStateSchema.safeParse({
    ...(workspace.state as Record<string, unknown>),
    workspaceId: workspace.workspaceId,
    serverRevision: workspace.revision,
    persistence: DATABASE_PERSISTENCE,
  })
  if (!parsed.success) {
    throw new JourneyPersistenceUnavailableError(
      'Сохранённое состояние Journey имеет несовместимую версию.',
    )
  }
  return parsed.data
}

function authorizedFromRow(row: Record<string, unknown>): AuthorizedJourneyWorkspace {
  return {
    workspaceId: String(row.workspace_key),
    userId: row.user_id ? String(row.user_id) : null,
    state: row.state,
    revision: Number(row.revision ?? 0),
    deviceCredentialId: null,
  }
}

function hasOnboardingSeed(state: JourneyState): boolean {
  return Boolean(
    state.companyName ||
    state.businessDescription ||
    state.facts.length ||
    state.widgets.length,
  )
}

function journeySeedFingerprint(state: JourneyState): string {
  return hashJourneyCredential(JSON.stringify({
    companyName: state.companyName,
    businessDescription: state.businessDescription,
    facts: state.facts.map((fact) => ({
      id: fact.id,
      value: fact.value,
      sourceLabel: fact.sourceLabel,
    })),
  }))
}
