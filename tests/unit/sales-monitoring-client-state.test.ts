import { describe, expect, it, vi } from 'vitest'
import {
  clearDurableOperation,
  continueDurableOperation,
  createDurableOperation,
  criticalOperationStorageKey,
  formDraftStorageKey,
  readDurableOperation,
  readStoredJson,
  withOperationResource,
  writeDurableOperation,
  writeStoredJson,
  type KeyValueStorage,
} from '@/components/sales-monitoring/client'

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

describe('sales monitoring durable client state', () => {
  it('creates stable create/finalize keys and preserves the exact create payload', () => {
    const uuids = ['create-uuid', 'finalize-uuid']
    const operation = createDurableOperation(
      'org-1',
      'sale',
      { organizationId: 'org-1', items: [{ quantity: '2' }] },
      () => uuids.shift()!,
      '2026-07-28T10:00:00.000Z',
    )

    expect(operation).toEqual({
      version: 1,
      kind: 'sale',
      organizationId: 'org-1',
      createKey: 'sale-create:create-uuid',
      finalizeKey: 'sale-post:finalize-uuid',
      createPayload: {
        organizationId: 'org-1',
        items: [{ quantity: '2' }],
      },
      createdAt: '2026-07-28T10:00:00.000Z',
    })
  })

  it('round-trips operation resource state and keeps organizations isolated', () => {
    const storage = new MemoryStorage()
    const operation = createDurableOperation(
      'org-1',
      'expense',
      { amount: '1000.00' },
      () => 'fixed',
    )
    const created = withOperationResource(operation, 'expense-1')

    expect(writeDurableOperation(storage, created)).toBe(true)
    expect(readDurableOperation(storage, 'org-1', 'expense')).toEqual(created)
    expect(readDurableOperation(storage, 'org-2', 'expense')).toBeNull()
    expect(readDurableOperation(storage, 'org-1', 'plan')).toBeNull()
  })

  it('reuses the create key when the create response was lost', async () => {
    const storage = new MemoryStorage()
    const operation = createDurableOperation(
      'org-1',
      'sale',
      { items: [{ productVariantId: 'variant-1' }] },
      (() => {
        const values = ['create-key', 'finalize-key']
        return () => values.shift()!
      })(),
    )
    writeDurableOperation(storage, operation)

    const serverCreates = new Map<string, string>()
    let actualCreates = 0
    const createWithLostFirstResponse = vi.fn(async (_payload, key: string) => {
      let resourceId = serverCreates.get(key)
      if (!resourceId) {
        resourceId = 'sale-1'
        serverCreates.set(key, resourceId)
        actualCreates += 1
        throw new Error('response lost')
      }
      return { id: resourceId }
    })
    const finalize = vi.fn(async (resourceId: string, key: string) => ({
      resourceId,
      key,
      status: 'posted',
    }))

    await expect(
      continueDurableOperation(
        storage,
        operation,
        createWithLostFirstResponse,
        finalize,
      ),
    ).rejects.toThrow('response lost')

    const retry = readDurableOperation<typeof operation.createPayload>(
      storage,
      'org-1',
      'sale',
    )!
    const result = await continueDurableOperation(
      storage,
      retry,
      createWithLostFirstResponse,
      finalize,
    )

    expect(actualCreates).toBe(1)
    expect(createWithLostFirstResponse).toHaveBeenCalledTimes(2)
    expect(createWithLostFirstResponse.mock.calls[0][1]).toBe(operation.createKey)
    expect(createWithLostFirstResponse.mock.calls[1][1]).toBe(operation.createKey)
    expect(result).toEqual({
      resourceId: 'sale-1',
      key: operation.finalizeKey,
      status: 'posted',
    })
  })

  it('skips create and reuses the finalize key when the finalize response was lost', async () => {
    const storage = new MemoryStorage()
    const operation = createDurableOperation(
      'org-1',
      'plan',
      { periodStart: '2026-07-01' },
      (() => {
        const values = ['create-key', 'finalize-key']
        return () => values.shift()!
      })(),
    )
    writeDurableOperation(storage, operation)

    const create = vi.fn(async () => ({ id: 'plan-1' }))
    const finalizedByKey = new Set<string>()
    let actualFinalizations = 0
    const finalizeWithLostFirstResponse = vi.fn(async (_resourceId: string, key: string) => {
      if (!finalizedByKey.has(key)) {
        finalizedByKey.add(key)
        actualFinalizations += 1
        throw new Error('response lost')
      }
      return { status: 'published' }
    })

    await expect(
      continueDurableOperation(
        storage,
        operation,
        create,
        finalizeWithLostFirstResponse,
      ),
    ).rejects.toThrow('response lost')

    const retry = readDurableOperation<typeof operation.createPayload>(
      storage,
      'org-1',
      'plan',
    )!
    expect(retry.resourceId).toBe('plan-1')

    await expect(
      continueDurableOperation(
        storage,
        retry,
        create,
        finalizeWithLostFirstResponse,
      ),
    ).resolves.toEqual({ status: 'published' })

    expect(create).toHaveBeenCalledTimes(1)
    expect(actualFinalizations).toBe(1)
    expect(finalizeWithLostFirstResponse.mock.calls[0][1]).toBe(operation.finalizeKey)
    expect(finalizeWithLostFirstResponse.mock.calls[1][1]).toBe(operation.finalizeKey)
  })

  it('retains state until the caller confirms success and explicitly clears it', () => {
    const storage = new MemoryStorage()
    const operation = createDurableOperation(
      'org-1',
      'expense',
      { amount: '10.00' },
      () => 'fixed',
    )
    writeDurableOperation(storage, operation)

    expect(storage.getItem(criticalOperationStorageKey('org-1', 'expense'))).not.toBeNull()
    expect(clearDurableOperation(storage, 'org-1', 'expense')).toBe(true)
    expect(readDurableOperation(storage, 'org-1', 'expense')).toBeNull()
  })

  it('persists form drafts independently from operation state', () => {
    const storage = new MemoryStorage()
    const key = formDraftStorageKey('org-1', 'plan')
    const draft = {
      version: 1,
      periodStart: '2026-08-01',
      revenue: '2500000',
    }

    expect(writeStoredJson(storage, key, draft)).toBe(true)
    expect(readStoredJson(storage, key)).toEqual(draft)
    expect(readDurableOperation(storage, 'org-1', 'plan')).toBeNull()
  })
})
