export interface ContextItem {
  id: string
  organization_id: string
  name: string
}

export interface SalesOrganization {
  id: string
  name: string
  currency: string
  role: string
  permissions: string[]
  regionIds: string[] | null
  channelIds: string[] | null
}

export interface SalesMonitoringContext {
  actor: { id: string; email?: string; profileRole: string }
  organizations: SalesOrganization[]
  regions: ContextItem[]
  channels: ContextItem[]
  categories: ContextItem[]
  costCenters: ContextItem[]
}

export type CriticalOperationKind = 'sale' | 'expense' | 'plan'

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface DurableOperation<TPayload = unknown> {
  version: 1
  kind: CriticalOperationKind
  organizationId: string
  createKey: string
  finalizeKey: string
  createPayload: TPayload
  resourceId?: string
  createdAt: string
}

const operationPrefixes: Record<
  CriticalOperationKind,
  { create: string; finalize: string }
> = {
  sale: { create: 'sale-create', finalize: 'sale-post' },
  expense: { create: 'expense-create', finalize: 'expense-post' },
  plan: { create: 'plan-create', finalize: 'plan-publish' },
}

export function browserStorage(): KeyValueStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function criticalOperationStorageKey(
  organizationId: string,
  kind: CriticalOperationKind,
) {
  return `sales-monitoring:v1:${organizationId}:operation:${kind}`
}

export function formDraftStorageKey(
  organizationId: string,
  kind: CriticalOperationKind,
) {
  return `sales-monitoring:v1:${organizationId}:draft:${kind}`
}

export function readStoredJson<T>(
  storage: KeyValueStorage | null,
  key: string,
): T | null {
  if (!storage) return null
  try {
    const value = storage.getItem(key)
    return value === null ? null : JSON.parse(value) as T
  } catch {
    return null
  }
}

export function writeStoredJson(
  storage: KeyValueStorage | null,
  key: string,
  value: unknown,
) {
  if (!storage) return false
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeStoredValue(
  storage: KeyValueStorage | null,
  key: string,
) {
  if (!storage) return false
  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}

export function createDurableOperation<TPayload>(
  organizationId: string,
  kind: CriticalOperationKind,
  createPayload: TPayload,
  createUuid: () => string = () => crypto.randomUUID(),
  createdAt: string = new Date().toISOString(),
): DurableOperation<TPayload> {
  const prefixes = operationPrefixes[kind]
  return {
    version: 1,
    kind,
    organizationId,
    createKey: `${prefixes.create}:${createUuid()}`,
    finalizeKey: `${prefixes.finalize}:${createUuid()}`,
    createPayload,
    createdAt,
  }
}

export function readDurableOperation<TPayload>(
  storage: KeyValueStorage | null,
  organizationId: string,
  kind: CriticalOperationKind,
): DurableOperation<TPayload> | null {
  const value = readStoredJson<unknown>(
    storage,
    criticalOperationStorageKey(organizationId, kind),
  )
  if (!value || typeof value !== 'object') return null

  const operation = value as Partial<DurableOperation<TPayload>>
  if (
    operation.version !== 1
    || operation.kind !== kind
    || operation.organizationId !== organizationId
    || typeof operation.createKey !== 'string'
    || typeof operation.finalizeKey !== 'string'
    || typeof operation.createdAt !== 'string'
    || !Object.prototype.hasOwnProperty.call(operation, 'createPayload')
    || (operation.resourceId !== undefined && typeof operation.resourceId !== 'string')
  ) {
    return null
  }
  return operation as DurableOperation<TPayload>
}

export function writeDurableOperation<TPayload>(
  storage: KeyValueStorage | null,
  operation: DurableOperation<TPayload>,
) {
  return writeStoredJson(
    storage,
    criticalOperationStorageKey(operation.organizationId, operation.kind),
    operation,
  )
}

export function withOperationResource<TPayload>(
  operation: DurableOperation<TPayload>,
  resourceId: string,
): DurableOperation<TPayload> {
  return { ...operation, resourceId }
}

export async function continueDurableOperation<
  TPayload,
  TCreated extends { id: string },
  TFinalized,
>(
  storage: KeyValueStorage | null,
  operation: DurableOperation<TPayload>,
  create: (payload: TPayload, idempotencyKey: string) => Promise<TCreated>,
  finalize: (resourceId: string, idempotencyKey: string) => Promise<TFinalized>,
): Promise<TFinalized> {
  let current = operation
  let resourceId = current.resourceId
  if (!resourceId) {
    const created = await create(current.createPayload, current.createKey)
    resourceId = created.id
    current = withOperationResource(current, resourceId)
    if (!writeDurableOperation(storage, current)) {
      throw new Error(
        'Операция создана, но её идентификатор не удалось сохранить; безопасно повторите отправку',
      )
    }
  }
  return finalize(resourceId, current.finalizeKey)
}

export function clearDurableOperation(
  storage: KeyValueStorage | null,
  organizationId: string,
  kind: CriticalOperationKind,
) {
  return removeStoredValue(
    storage,
    criticalOperationStorageKey(organizationId, kind),
  )
}

export async function apiRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = body?.error?.message ?? body?.message ?? body?.error ?? 'Ошибка запроса'
    throw new Error(typeof message === 'string' ? message : 'Ошибка запроса')
  }
  return body.data as T
}

export function idempotencyKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`
}

export function money(value: string | number, currency = 'KZT') {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('ru-KZ', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0)
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

export function monthStart() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10)
}

export const fieldClass =
  'w-full rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2.5 text-sm text-on-surface outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20 disabled:opacity-50'

export const labelClass =
  'mb-2 block text-xs font-medium uppercase tracking-wider text-on-surface-variant'
