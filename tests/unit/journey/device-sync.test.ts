import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createEmptyJourneyState } from '@/lib/journey/demo'
import {
  createJourneyConnectCode,
  hashJourneyConnectCode,
  JOURNEY_CONNECT_CODE_MAX_ATTEMPTS,
  JOURNEY_CONNECT_CODE_TTL_MS,
  JourneyConnectCodeError,
  redeemJourneyConnectCode,
  type JourneyConnectClaim,
  type JourneyDeviceSyncDependencies,
  type JourneyDeviceSyncRepository,
} from '@/lib/journey/device-sync'
import { journeyErrorResponse } from '@/lib/journey/http'
import {
  hashJourneyCredential,
  JourneyAccessError,
  JourneyConflictError,
} from '@/lib/journey/persistence'
import type { JourneyIdentity } from '@/lib/journey/schema'

const NOW = new Date('2026-07-14T10:00:00.000Z')
const IDENTITY: JourneyIdentity = {
  workspaceId: 'journey-test-workspace',
  accessToken: 'legacy-secret-token-with-enough-entropy',
}

class MemoryRepository implements JourneyDeviceSyncRepository {
  inserted: Parameters<JourneyDeviceSyncRepository['insertConnectCode']>[0][] = []
  claims: Parameters<JourneyDeviceSyncRepository['claimConnectCode']>[0][] = []
  claimResult: JourneyConnectClaim = {
    status: 'claimed',
    workspaceId: IDENTITY.workspaceId,
    state: createEmptyJourneyState(IDENTITY.workspaceId),
    revision: 4,
  }
  canonicalUserId: string | null = null
  canonicalWorkspaceId = 'journey-canonical-workspace'
  sourceUserId: string | null = null

  async authorizeSource(identity: JourneyIdentity) {
    if (identity.accessToken !== IDENTITY.accessToken) return null
    return {
      workspaceId: identity.workspaceId,
      userId: this.sourceUserId,
      state: createEmptyJourneyState(identity.workspaceId),
      revision: 2,
      deviceCredentialId: 'f71a26f1-a683-4f77-9bdd-b86a7696f759',
    }
  }

  async findCanonicalWorkspace(actorUserId: string) {
    if (this.canonicalUserId !== actorUserId) return null
    return {
      workspaceId: this.canonicalWorkspaceId,
      userId: actorUserId,
      state: createEmptyJourneyState(this.canonicalWorkspaceId),
      revision: 8,
      deviceCredentialId: null,
    }
  }

  async insertConnectCode(input: Parameters<JourneyDeviceSyncRepository['insertConnectCode']>[0]) {
    this.inserted.push(input)
    return true
  }

  async claimConnectCode(input: Parameters<JourneyDeviceSyncRepository['claimConnectCode']>[0]) {
    this.claims.push(input)
    return this.claimResult
  }
}

function deps(repository: MemoryRepository): JourneyDeviceSyncDependencies {
  return {
    repository,
    now: () => NOW,
    randomCode: () => 'ABCD2345',
    randomDeviceToken: () => 'new-device-token-that-is-never-sent-to-the-repository-raw',
    hashConnectCode: (code) => hashJourneyConnectCode(code, {
      NODE_ENV: 'test',
      JOURNEY_CONNECT_CODE_SECRET: 'test-connect-code-secret-with-at-least-32-bytes',
    }),
  }
}

describe('Journey cross-device sync', () => {
  it('stores only a code hash with a ten-minute TTL and attempt cap', async () => {
    const repository = new MemoryRepository()
    const result = await createJourneyConnectCode(
      { identity: IDENTITY, actorUserId: null },
      deps(repository),
    )

    expect(result.code).toBe('ABCD-2345')
    expect(Date.parse(result.expiresAt) - NOW.getTime()).toBe(JOURNEY_CONNECT_CODE_TTL_MS)
    expect(repository.inserted[0]).toMatchObject({
      codeHash: hashJourneyConnectCode('ABCD2345', {
        NODE_ENV: 'test',
        JOURNEY_CONNECT_CODE_SECRET: 'test-connect-code-secret-with-at-least-32-bytes',
      }),
      maxAttempts: JOURNEY_CONNECT_CODE_MAX_ATTEMPTS,
      workspaceId: IDENTITY.workspaceId,
    })
    expect(JSON.stringify(repository.inserted[0])).not.toContain('ABCD2345')
    expect(JSON.stringify(repository.inserted[0])).not.toContain(IDENTITY.accessToken)
  })

  it('keeps an explicitly supplied owned workspace instead of silently switching to canonical', async () => {
    const repository = new MemoryRepository()
    const actorUserId = '5cd75337-ff7a-49df-80ef-7cb63d7fe8c4'
    repository.canonicalUserId = actorUserId
    repository.sourceUserId = actorUserId
    const result = await createJourneyConnectCode(
      { identity: IDENTITY, actorUserId },
      deps(repository),
    )
    expect(result.workspaceId).toBe(IDENTITY.workspaceId)
    expect(repository.inserted[0].actorUserId).toBe(actorUserId)
  })

  it('uses canonical only when a signed-in client has no active identity', async () => {
    const repository = new MemoryRepository()
    const actorUserId = '5cd75337-ff7a-49df-80ef-7cb63d7fe8c4'
    repository.canonicalUserId = actorUserId
    const result = await createJourneyConnectCode(
      { actorUserId },
      deps(repository),
    )
    expect(result.workspaceId).toBe('journey-canonical-workspace')
  })

  it('rejects a signed-in empty create when latest-owned discovery returns the reserved Store workspace', async () => {
    const repository = new MemoryRepository()
    const actorUserId = '5cd75337-ff7a-49df-80ef-7cb63d7fe8c4'
    repository.canonicalUserId = actorUserId
    repository.canonicalWorkspaceId = `journey-store-user-${actorUserId}`

    await expect(createJourneyConnectCode(
      { actorUserId },
      deps(repository),
    )).rejects.toBeInstanceOf(JourneyAccessError)
    expect(repository.inserted).toHaveLength(0)
  })

  it('rejects an explicitly supplied reserved Store workspace', async () => {
    const repository = new MemoryRepository()
    const actorUserId = '5cd75337-ff7a-49df-80ef-7cb63d7fe8c4'
    repository.sourceUserId = actorUserId

    await expect(createJourneyConnectCode(
      {
        identity: {
          workspaceId: `journey-store-user-${actorUserId}`,
          accessToken: IDENTITY.accessToken,
        },
        actorUserId,
      },
      deps(repository),
    )).rejects.toBeInstanceOf(JourneyAccessError)
    expect(repository.inserted).toHaveLength(0)
  })

  it('rejects an active identity that is not owned by the signed-in account', async () => {
    const repository = new MemoryRepository()
    repository.canonicalUserId = '5cd75337-ff7a-49df-80ef-7cb63d7fe8c4'
    repository.sourceUserId = '0c9ca501-ce72-4266-a329-c19758f0500a'
    await expect(createJourneyConnectCode(
      { identity: IDENTITY, actorUserId: repository.canonicalUserId },
      deps(repository),
    )).rejects.toBeInstanceOf(Error)
    expect(repository.inserted).toHaveLength(0)
  })

  it('mints a distinct device credential and gives the repository only its hash', async () => {
    const repository = new MemoryRepository()
    const result = await redeemJourneyConnectCode(
      { code: 'ABCD-2345', deviceLabel: 'Телефон', actorUserId: null },
      deps(repository),
    )

    const rawDeviceToken = 'new-device-token-that-is-never-sent-to-the-repository-raw'
    expect(result.deviceToken).toBe(rawDeviceToken)
    expect(result.state.serverRevision).toBe(4)
    expect(repository.claims[0]).toMatchObject({
      codeHash: hashJourneyConnectCode('ABCD2345', {
        NODE_ENV: 'test',
        JOURNEY_CONNECT_CODE_SECRET: 'test-connect-code-secret-with-at-least-32-bytes',
      }),
      deviceTokenHash: hashJourneyCredential(rawDeviceToken),
      deviceLabel: 'Телефон',
    })
    expect(JSON.stringify(repository.claims[0])).not.toContain(rawDeviceToken)
    expect(JSON.stringify(repository.claims[0])).not.toContain(IDENTITY.accessToken)
  })

  it('rejects a claimed reserved Store workspace before returning its state or device token', async () => {
    const repository = new MemoryRepository()
    const actorUserId = '5cd75337-ff7a-49df-80ef-7cb63d7fe8c4'
    const storeWorkspaceId = `journey-store-user-${actorUserId}`
    repository.claimResult = {
      status: 'claimed',
      workspaceId: storeWorkspaceId,
      state: createEmptyJourneyState(storeWorkspaceId),
      revision: 9,
    }

    await expect(redeemJourneyConnectCode(
      { code: 'ABCD-2345', deviceLabel: 'Телефон', actorUserId },
      deps(repository),
    )).rejects.toBeInstanceOf(JourneyAccessError)
    expect(repository.claims).toHaveLength(1)
  })

  it('does not disclose a same-user ownership failure', async () => {
    const repository = new MemoryRepository()
    repository.claimResult = { status: 'forbidden' }
    await expect(
      redeemJourneyConnectCode(
        { code: 'ABCD-2345', deviceLabel: 'Телефон', actorUserId: null },
        deps(repository),
      ),
    ).rejects.toMatchObject({
      code: 'JOURNEY_CONNECT_CODE_INVALID',
    } satisfies Partial<JourneyConnectCodeError>)
  })

  it('uses a keyed code digest and fails closed without a production secret', () => {
    const first = hashJourneyConnectCode('ABCD-2345', {
      NODE_ENV: 'production',
      JOURNEY_CONNECT_CODE_SECRET: 'first-production-secret-that-is-at-least-32-bytes',
    })
    const second = hashJourneyConnectCode('ABCD-2345', {
      NODE_ENV: 'production',
      JOURNEY_CONNECT_CODE_SECRET: 'second-production-secret-that-is-at-least-32-bytes',
    })
    expect(first).not.toBe(second)
    expect(first).not.toBe(hashJourneyCredential('ABCD2345'))
    expect(() => hashJourneyConnectCode('ABCD-2345', {
      NODE_ENV: 'production',
    })).toThrow('JOURNEY_CONNECT_CODE_SECRET')
  })

  it('derives the development HMAC key only from a server-side service secret', () => {
    expect(hashJourneyConnectCode('ABCD-2345', {
      NODE_ENV: 'development',
      SUPABASE_SERVICE_ROLE_KEY: 'local-service-role-secret',
    })).toMatch(/^[0-9a-f]{64}$/)
    expect(() => hashJourneyConnectCode('ABCD-2345', {
      NODE_ENV: 'development',
    })).toThrow('серверный секрет')
  })

  it('implements one-time claim and compare-and-swap under row locks in SQL', () => {
    const migration = readFileSync(
      new URL('../../../supabase/migrations/075_ai_journey_device_sync.sql', import.meta.url),
      'utf8',
    )
    expect(migration).toContain('for update')
    expect(migration).toContain("v_code.consumed_at is not null")
    expect(migration).toContain('v_workspace.revision <> p_expected_revision')
    expect(migration).toContain("return query select 'stale'::text")
    expect(migration).toContain('token_hash')
    expect(migration).not.toMatch(/raw[_ ]token/i)
  })

  it('maps a stale concurrent save to a retryable 409 response', async () => {
    const response = journeyErrorResponse(new JourneyConflictError(12))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'JOURNEY_STATE_CONFLICT',
        message: 'Рабочая область изменилась на другом устройстве.',
        currentRevision: 12,
      },
    })
  })

  it('keeps anonymous production access behind the explicit public demo flag', () => {
    const http = readFileSync(
      new URL('../../../lib/journey/http.ts', import.meta.url),
      'utf8',
    )
    const middleware = readFileSync(
      new URL('../../../middleware.ts', import.meta.url),
      'utf8',
    )

    expect(http).toContain('isJourneyPublicDemoEnabled()')
    expect(middleware).toContain('isJourneyPublicDemoEnabled()')
  })

  it('keeps production redeem behind login, same-account SQL, and a strict API-scoped cookie', () => {
    const redeemRoute = readFileSync(
      new URL('../../../app/api/v1/journey/connect/redeem/route.ts', import.meta.url),
      'utf8',
    )
    const http = readFileSync(
      new URL('../../../lib/journey/http.ts', import.meta.url),
      'utf8',
    )
    const migration = readFileSync(
      new URL('../../../supabase/migrations/075_ai_journey_device_sync.sql', import.meta.url),
      'utf8',
    )
    expect(redeemRoute.indexOf('resolveJourneyActor()')).toBeLessThan(
      redeemRoute.indexOf('redeemJourneyConnectCode({'),
    )
    expect(redeemRoute).toContain("sameSite: 'strict'")
    expect(redeemRoute).toContain("path: '/api/v1/journey'")
    expect(http).toContain("process.env.NODE_ENV !== 'production'")
    expect(http).toContain('throw new JourneyAuthenticationError()')
    expect(migration).toContain('v_workspace.user_id <> p_actor_user_id')
  })
})
