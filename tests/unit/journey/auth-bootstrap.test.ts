import { describe, expect, it } from 'vitest'
import {
  canonicalWorkspaceId,
  resolveAuthenticatedJourneyState,
  resolveNamedOwnedJourneyState,
  storeJourneyWorkspaceId,
  type JourneyAuthBootstrapDependencies,
  type JourneyAuthBootstrapRepository,
} from '@/lib/journey/auth-bootstrap'
import { buildJourneyStateFromOnboarding } from '@/lib/journey/onboarding-seed'
import { createEmptyJourneyState } from '@/lib/journey/demo'
import {
  hashJourneyCredential,
  type AuthorizedJourneyWorkspace,
} from '@/lib/journey/persistence'
import type { JourneyIdentity, JourneyState } from '@/lib/journey/schema'

const ACTOR = '5cd75337-ff7a-49df-80ef-7cb63d7fe8c4'
const FOREIGN_ACTOR = '0c9ca501-ce72-4266-a329-c19758f0500a'
const DEVICE_TOKEN = 'device-token-that-never-enters-the-repository-raw'

class MemoryBootstrapRepository implements JourneyAuthBootstrapRepository {
  workspaces = new Map<string, AuthorizedJourneyWorkspace>()
  canonical = new Map<string, string>()
  credentialHashes = new Map<string, Set<string>>()
  registrations: Parameters<JourneyAuthBootstrapRepository['registerDevice']>[0][] = []
  saveCalls = 0

  async authorize(identity: JourneyIdentity, actorUserId: string) {
    const workspace = this.workspaces.get(identity.workspaceId)
    if (!workspace || workspace.userId !== actorUserId || !identity.accessToken) return null
    const hashes = this.credentialHashes.get(identity.workspaceId)
    return hashes?.has(hashJourneyCredential(identity.accessToken)) ? workspace : null
  }

  async findMapped(actorUserId: string) {
    const key = this.canonical.get(actorUserId)
    return key ? this.workspaces.get(key) ?? null : null
  }

  async findLatestOwned(actorUserId: string) {
    return [...this.workspaces.values()].find((workspace) => workspace.userId === actorUserId) ?? null
  }

  async findOwned(workspaceId: string, actorUserId: string) {
    const workspace = this.workspaces.get(workspaceId)
    return workspace?.userId === actorUserId ? workspace : null
  }

  async bindCanonical(actorUserId: string, workspaceId: string) {
    if (!this.canonical.has(actorUserId)) this.canonical.set(actorUserId, workspaceId)
    return this.canonical.get(actorUserId)!
  }

  async ensureWorkspace(input: {
    workspaceId: string
    actorUserId: string
    credentialHash: string
    state: JourneyState
  }) {
    const existing = this.workspaces.get(input.workspaceId)
    if (existing) return existing
    const created: AuthorizedJourneyWorkspace = {
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      state: { ...input.state, serverRevision: 1 },
      revision: 1,
      deviceCredentialId: null,
    }
    this.workspaces.set(input.workspaceId, created)
    this.credentialHashes.set(input.workspaceId, new Set([input.credentialHash]))
    return created
  }

  async registerDevice(input: {
    workspaceId: string
    actorUserId: string
    tokenHash: string
    deviceLabel: string
  }) {
    this.registrations.push(input)
    const hashes = this.credentialHashes.get(input.workspaceId) ?? new Set<string>()
    hashes.add(input.tokenHash)
    this.credentialHashes.set(input.workspaceId, hashes)
  }

  async saveState(input: {
    workspace: AuthorizedJourneyWorkspace
    actorUserId: string
    credentialHash: string
    state: JourneyState
  }) {
    this.saveCalls += 1
    const saved: AuthorizedJourneyWorkspace = {
      ...input.workspace,
      state: { ...input.state, serverRevision: input.workspace.revision + 1 },
      revision: input.workspace.revision + 1,
    }
    this.workspaces.set(saved.workspaceId, saved)
    return saved
  }

  async markSeeded() {}
}

function dependencies(repository: MemoryBootstrapRepository): JourneyAuthBootstrapDependencies {
  return {
    repository,
    randomDeviceToken: () => DEVICE_TOKEN,
  }
}

function buildSeed(workspaceId: string): Promise<JourneyState> {
  return Promise.resolve(buildJourneyStateFromOnboarding({
    workspaceId,
    company: { name: 'HONOR GROUP', industry: 'Ритейл / E-commerce' },
    surveyRows: [{
      question_key: 'ec_total_sku',
      answer: { value: 88, provenance: 'public_web' },
    }],
    now: '2026-07-29T00:00:00.000Z',
  }))
}

describe('authenticated Journey bootstrap', () => {
  it('creates one deterministic user workspace and returns only a cookie token', async () => {
    const repository = new MemoryBootstrapRepository()
    const result = await resolveAuthenticatedJourneyState({
      identity: {
        workspaceId: 'guest-stale-browser-workspace',
        accessToken: 'guest-token-with-enough-entropy',
      },
      actorUserId: ACTOR,
      buildInitialState: buildSeed,
    }, dependencies(repository))

    expect(result.state.workspaceId).toBe(canonicalWorkspaceId(ACTOR))
    expect(result.state.companyName).toBe('HONOR GROUP')
    expect(result.deviceToken).toBe(DEVICE_TOKEN)
    expect(repository.canonical.get(ACTOR)).toBe(canonicalWorkspaceId(ACTOR))
    expect(repository.registrations[0].tokenHash).toBe(hashJourneyCredential(DEVICE_TOKEN))
    expect(JSON.stringify(repository.registrations)).not.toContain(DEVICE_TOKEN)
  })

  it('reuses the HttpOnly credential and does not reseed an edited workspace', async () => {
    const repository = new MemoryBootstrapRepository()
    const first = await resolveAuthenticatedJourneyState({
      identity: {
        workspaceId: 'guest-first-browser-workspace',
        accessToken: 'guest-token-with-enough-entropy',
      },
      actorUserId: ACTOR,
      buildInitialState: buildSeed,
    }, dependencies(repository))
    const workspace = repository.workspaces.get(first.state.workspaceId)!
    repository.workspaces.set(workspace.workspaceId, {
      ...workspace,
      state: {
        ...first.state,
        companyName: 'HONOR GROUP · изменено пользователем',
        serverRevision: workspace.revision + 1,
      },
      revision: workspace.revision + 1,
    })

    const second = await resolveAuthenticatedJourneyState({
      identity: {
        workspaceId: first.state.workspaceId,
        accessToken: DEVICE_TOKEN,
      },
      actorUserId: ACTOR,
      buildInitialState: buildSeed,
    }, dependencies(repository))

    expect(second.deviceToken).toBeUndefined()
    expect(second.state.companyName).toContain('изменено пользователем')
    expect(repository.saveCalls).toBe(0)
  })

  it('seeds an existing pristine owned workspace without replacing its identity', async () => {
    const repository = new MemoryBootstrapRepository()
    const workspaceId = 'journey-existing-pristine-workspace'
    repository.workspaces.set(workspaceId, {
      workspaceId,
      userId: ACTOR,
      state: createEmptyJourneyState(workspaceId),
      revision: 3,
      deviceCredentialId: null,
    })
    repository.canonical.set(ACTOR, workspaceId)

    const result = await resolveAuthenticatedJourneyState({
      identity: {
        workspaceId: 'guest-other-browser-workspace',
        accessToken: 'guest-token-with-enough-entropy',
      },
      actorUserId: ACTOR,
      buildInitialState: buildSeed,
    }, dependencies(repository))

    expect(result.state.workspaceId).toBe(workspaceId)
    expect(result.state.companyName).toBe('HONOR GROUP')
    expect(repository.saveCalls).toBe(1)
  })

  it('never adopts a foreign workspace from a stale browser identity', async () => {
    const repository = new MemoryBootstrapRepository()
    repository.workspaces.set('journey-foreign-workspace', {
      workspaceId: 'journey-foreign-workspace',
      userId: FOREIGN_ACTOR,
      state: createEmptyJourneyState('journey-foreign-workspace'),
      revision: 1,
      deviceCredentialId: null,
    })
    repository.credentialHashes.set(
      'journey-foreign-workspace',
      new Set([hashJourneyCredential('foreign-token-with-enough-entropy')]),
    )

    const result = await resolveAuthenticatedJourneyState({
      identity: {
        workspaceId: 'journey-foreign-workspace',
        accessToken: 'foreign-token-with-enough-entropy',
      },
      actorUserId: ACTOR,
      buildInitialState: buildSeed,
    }, dependencies(repository))

    expect(result.state.workspaceId).toBe(canonicalWorkspaceId(ACTOR))
    expect(repository.canonical.get(FOREIGN_ACTOR)).toBeUndefined()
  })

  it('never promotes the reserved Store workspace into canonical Journey', async () => {
    const repository = new MemoryBootstrapRepository()
    const storeId = storeJourneyWorkspaceId(ACTOR)
    repository.workspaces.set(storeId, {
      workspaceId: storeId,
      userId: ACTOR,
      state: createEmptyJourneyState(storeId),
      revision: 1,
      deviceCredentialId: null,
    })
    repository.canonical.set(ACTOR, storeId)

    await expect(resolveAuthenticatedJourneyState({
      identity: {
        workspaceId: storeId,
        accessToken: 'store-device-token-with-enough-entropy',
      },
      actorUserId: ACTOR,
      buildInitialState: buildSeed,
    }, dependencies(repository))).rejects.toThrow('Зарезервированное рабочее пространство')
  })

  it('ignores a reserved Store workspace when selecting the latest owned Journey', async () => {
    const repository = new MemoryBootstrapRepository()
    const storeId = storeJourneyWorkspaceId(ACTOR)
    repository.workspaces.set(storeId, {
      workspaceId: storeId,
      userId: ACTOR,
      state: createEmptyJourneyState(storeId),
      revision: 1,
      deviceCredentialId: null,
    })

    const result = await resolveAuthenticatedJourneyState({
      identity: {
        workspaceId: storeId,
        accessToken: 'store-device-token-with-enough-entropy',
      },
      actorUserId: ACTOR,
      buildInitialState: buildSeed,
    }, dependencies(repository))

    expect(result.state.workspaceId).toBe(canonicalWorkspaceId(ACTOR))
    expect(repository.canonical.get(ACTOR)).toBe(canonicalWorkspaceId(ACTOR))
    expect(repository.workspaces.has(storeId)).toBe(true)
  })
})

describe('named owned Journey bootstrap', () => {
  it('creates Store separately from canonical mapping and reuses its device credential', async () => {
    const repository = new MemoryBootstrapRepository()
    const workspaceId = storeJourneyWorkspaceId(ACTOR)
    const first = await resolveNamedOwnedJourneyState({
      workspaceId,
      identity: { workspaceId },
      actorUserId: ACTOR,
      buildInitialState: buildSeed,
      deviceLabel: 'Store Journey браузер',
    }, dependencies(repository))

    expect(first.state.workspaceId).toBe(workspaceId)
    expect(first.deviceToken).toBe(DEVICE_TOKEN)
    expect(repository.canonical.has(ACTOR)).toBe(false)
    expect(repository.registrations).toHaveLength(1)

    const second = await resolveNamedOwnedJourneyState({
      workspaceId,
      identity: { workspaceId, accessToken: DEVICE_TOKEN },
      actorUserId: ACTOR,
      buildInitialState: buildSeed,
    }, dependencies(repository))

    expect(second.deviceToken).toBeUndefined()
    expect(repository.registrations).toHaveLength(1)
  })

  it('rejects a browser-selected workspace before repository access', async () => {
    const repository = new MemoryBootstrapRepository()
    await expect(resolveNamedOwnedJourneyState({
      workspaceId: storeJourneyWorkspaceId(ACTOR),
      identity: { workspaceId: canonicalWorkspaceId(ACTOR) },
      actorUserId: ACTOR,
      buildInitialState: buildSeed,
    }, dependencies(repository))).rejects.toThrow('Workspace ID не совпадает')
    expect(repository.workspaces.size).toBe(0)
  })
})
