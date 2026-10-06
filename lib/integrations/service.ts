/**
 * lib/integrations/service.ts — connect / test / disconnect / snapshot, shared
 * by the client routes (/api/integrations/**, tenant-authorised) and the GIGA
 * routes (/api/giga-admin/integrations/**, RBAC-authorised). Callers have
 * authorised the company; nothing here takes a company id on trust from a
 * request body.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMetricRegistry } from '@/lib/metrics/registry'
import { loadCompanyMetrics, type CompanyMetricValue } from '@/lib/metrics/company-metrics'
import { credentialsStorageReady, CredentialsUnavailableError, openCredentials, sealCredentials, secretValues } from './credentials'
import { IntegrationError, sanitizeMessage, type ErrorKind } from './http'
import { adapterFor } from './providers'
import { INTEGRATION_PROVIDERS, parseCredentials, providerCatalog, type ProviderKey } from './registry'
import { INTEGRATION_SYSTEM_PREFIX, loadIntegrationFacts, summarizeProviders, type ProviderSummary } from './signals'
import {
  connectionSecret,
  disconnectConnection,
  isIntegrationsTableMissing,
  listConnections,
  markTestResult,
  saveConnection,
  type ConnectionView,
} from './store'

export interface ServiceDeps {
  fetch?: typeof fetch
  now?: Date
}

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; field?: string; kind?: ErrorKind }

/** Request budget of a connect / test call (a test is one or two documented reads). */
const TEST_BUDGET = 3

function failure(err: unknown, secrets: readonly string[]): { status: number; error: string; kind: ErrorKind } {
  if (err instanceof IntegrationError) {
    const status = err.kind === 'auth' || err.kind === 'config' ? 400 : err.kind === 'rate_limit' ? 429 : 502
    return { status, error: sanitizeMessage(err.message, secrets), kind: err.kind }
  }
  if (err instanceof CredentialsUnavailableError) return { status: 409, error: err.message, kind: 'auth' }
  return { status: 502, error: 'Сервис интеграции не ответил — попробуйте позже', kind: 'transient' }
}

export async function connectIntegration(
  input: { companyId: string; provider: ProviderKey; fields: unknown; actorId: string | null },
  deps: ServiceDeps = {},
): Promise<ServiceResult<ConnectionView>> {
  const def = INTEGRATION_PROVIDERS[input.provider]
  if (def.mode === 'file') {
    // No credentials for a provider without a verified adapter: the record only
    // says «data from this provider comes as exports».
    const conn = await saveConnection({
      companyId: input.companyId, provider: input.provider, authKind: 'file', secretCiphertext: null, settings: {},
      accountLabel: `${def.label} · загрузка выгрузок`, createdBy: input.actorId,
    })
    return { ok: true, data: conn }
  }
  if (!credentialsStorageReady()) {
    return { ok: false, status: 503, error: 'Хранилище ключей не настроено (SECRETS_ENCRYPTION_KEY) — подключение невозможно', kind: 'config' }
  }
  const parsed = parseCredentials(input.provider, input.fields)
  if (!parsed.ok) return { ok: false, status: 422, error: parsed.error, field: parsed.field, kind: 'config' }
  const adapter = adapterFor(input.provider)
  if (!adapter) return { ok: false, status: 409, error: 'Для этого сервиса нет живого подключения', kind: 'config' }
  const secrets = secretValues(parsed.secret)
  let accountLabel: string | null
  try {
    // Honest check before saving: a key that does not work is never stored.
    const t = await adapter.test(parsed.secret, parsed.settings, {
      fetch: deps.fetch ?? fetch, now: deps.now ?? new Date(), budget: { remaining: TEST_BUDGET }, secrets,
    })
    accountLabel = t.accountLabel
  } catch (err) {
    const f = failure(err, secrets)
    return { ok: false, ...f }
  }
  const conn = await saveConnection({
    companyId: input.companyId,
    provider: input.provider,
    authKind: def.authKind === 'oauth' ? 'oauth' : def.authKind === 'basic' ? 'basic' : 'token',
    secretCiphertext: sealCredentials(parsed.secret),
    settings: parsed.settings,
    accountLabel,
    createdBy: input.actorId,
  })
  return { ok: true, data: conn }
}

export async function testIntegration(
  input: { companyId: string; provider: ProviderKey },
  deps: ServiceDeps = {},
): Promise<ServiceResult<{ accountLabel: string | null }>> {
  const adapter = adapterFor(input.provider)
  if (!adapter) return { ok: false, status: 409, error: 'Для этого сервиса нет живого подключения — данные загружаются выгрузками', kind: 'config' }
  const row = await connectionSecret(input.companyId, input.provider)
  if (!row) return { ok: false, status: 404, error: 'Интеграция не подключена' }
  if (row.status === 'disconnected' || !row.secretCiphertext) return { ok: false, status: 409, error: 'Интеграция отключена — подключите заново', kind: 'auth' }
  let secrets: string[] = []
  try {
    const secret = openCredentials(row.secretCiphertext)
    secrets = secretValues(secret)
    const t = await adapter.test(secret, row.settings, {
      fetch: deps.fetch ?? fetch, now: deps.now ?? new Date(), budget: { remaining: TEST_BUDGET }, secrets,
    })
    await markTestResult(input.companyId, input.provider, { ok: true, accountLabel: t.accountLabel })
    return { ok: true, data: { accountLabel: t.accountLabel } }
  } catch (err) {
    const f = failure(err, secrets)
    await markTestResult(input.companyId, input.provider, { ok: false, kind: f.kind, message: f.error })
    return { ok: false, ...f }
  }
}

export async function disconnectIntegration(input: { companyId: string; provider: ProviderKey }): Promise<ServiceResult<{ disconnected: true }>> {
  const done = await disconnectConnection(input.companyId, input.provider)
  return done ? { ok: true, data: { disconnected: true } } : { ok: false, status: 404, error: 'Интеграция не подключена' }
}

/** Connections of a company; [] + migrationPending before migration 105 is applied. */
async function connectionsOrPending(companyId: string): Promise<{ connections: ConnectionView[]; migrationPending: boolean }> {
  try {
    return { connections: await listConnections(companyId), migrationPending: false }
  } catch (err) {
    if (isIntegrationsTableMissing(err)) return { connections: [], migrationPending: true }
    throw err
  }
}

export async function companyIntegrations(companyId: string) {
  return {
    catalog: providerCatalog(),
    ...(await connectionsOrPending(companyId)),
    encryptionReady: credentialsStorageReady(),
  }
}

/** Metrics whose sources include a connected integration («integration:…»). */
export function integrationMetricIds(): string[] {
  return getMetricRegistry()
    .filter((m) => m.sources.some((s) => s.type === 'external' && s.system?.startsWith(INTEGRATION_SYSTEM_PREFIX)))
    .map((m) => m.id)
}

export interface IntegrationsSnapshot {
  connections: ConnectionView[]
  providers: ProviderSummary[]
  /** Current values (public.metrics, the single source) of the integration-fed metrics. */
  metrics: Record<string, CompanyMetricValue>
  generatedAt: string
}

/**
 * Dashboard snapshot: connections, the per-provider 30-day summary (same
 * window rules as the metric signals) and the materialised metrics.
 * `client` is the caller's session client — RLS applies to facts and metrics.
 */
export async function integrationsSnapshot(client: SupabaseClient, companyId: string, now = new Date()): Promise<IntegrationsSnapshot> {
  const [{ connections }, facts, metrics] = await Promise.all([
    connectionsOrPending(companyId),
    loadIntegrationFacts(client, companyId),
    loadCompanyMetrics(client, companyId, integrationMetricIds()),
  ])
  return {
    connections,
    providers: summarizeProviders(facts, now),
    metrics: Object.fromEntries(metrics),
    generatedAt: now.toISOString(),
  }
}
