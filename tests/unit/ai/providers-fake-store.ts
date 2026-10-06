/**
 * In-memory stand-in for lib/ai/providers/store.ts (unit tests only).
 *
 *   vi.mock('@/lib/ai/providers/store', async () => (await import('./providers-fake-store')).fakeStoreModule)
 *
 * `fakeDb` holds the rows; tests seed and inspect it directly.
 */
import { randomUUID } from 'node:crypto'
import type {
  BudgetsRow,
  Capability,
  ChatTier,
  CredentialRow,
  ModelRow,
  ProviderRow,
  ProviderSnapshot,
  RouteRow,
} from '@/lib/ai/providers/types'
import type { ModelWrite, ProviderWrite, SpendGroupBy, SpendRow } from '@/lib/ai/providers/store'

export const fakeDb = {
  providers: [] as ProviderRow[],
  credentials: [] as CredentialRow[],
  models: [] as ModelRow[],
  routes: [] as RouteRow[],
  budgets: null as BudgetsRow | null,
  spendToday: {} as Record<string, number>,
  loads: 0,
}

export function resetFakeDb(): void {
  fakeDb.providers = []
  fakeDb.credentials = []
  fakeDb.models = []
  fakeDb.routes = []
  fakeDb.budgets = null
  fakeDb.spendToday = {}
  fakeDb.loads = 0
}

const now = () => new Date()

export function seedProvider(p: Partial<ProviderRow> & { key: string }): ProviderRow {
  const row: ProviderRow = {
    id: randomUUID(),
    name: p.key,
    kind: 'openai_compatible',
    base_url: 'https://llm.example.com/v1',
    chat_path: '/chat/completions',
    embeddings_path: '/embeddings',
    rerank_path: null,
    ocr_mode: null,
    extra_headers: {},
    supports_response_format: true,
    enabled: true,
    daily_budget_usd: null,
    privacy_note: null,
    created_by: 'test',
    created_at: now(),
    updated_at: now(),
    ...p,
  }
  fakeDb.providers.push(row)
  return row
}

export function seedCredential(c: Partial<CredentialRow> & { provider_id: string; secret_ciphertext: string }): CredentialRow {
  const row: CredentialRow = {
    id: randomUUID(),
    label: 'key',
    secret_hint: 'xxxx',
    enabled: true,
    last_verified_at: null,
    last_verify_ok: null,
    last_verify_error: null,
    created_by: 'test',
    created_at: now(),
    rotated_at: null,
    updated_at: now(),
    ...c,
  }
  fakeDb.credentials.push(row)
  return row
}

export function seedModel(m: Partial<ModelRow> & { provider_id: string; model_id: string; capability: Capability }): ModelRow {
  const row: ModelRow = {
    id: randomUUID(),
    credential_id: null,
    label: null,
    price_in_per_mtok: null,
    price_out_per_mtok: null,
    enabled: true,
    created_at: now(),
    updated_at: now(),
    ...m,
  }
  fakeDb.models.push(row)
  return row
}

export function seedRoute(capability: Capability, tier: ChatTier | null, modelRowId: string): RouteRow {
  const row: RouteRow = { id: randomUUID(), capability, tier, model_id: modelRowId, updated_by: 'test', updated_at: now() }
  fakeDb.routes.push(row)
  return row
}

function cascadeProvider(id: string) {
  const models = new Set(fakeDb.models.filter((m) => m.provider_id === id).map((m) => m.id))
  fakeDb.routes = fakeDb.routes.filter((r) => !models.has(r.model_id))
  fakeDb.models = fakeDb.models.filter((m) => m.provider_id !== id)
  fakeDb.credentials = fakeDb.credentials.filter((c) => c.provider_id !== id)
}

export const fakeStoreModule = {
  async listProviders() { return [...fakeDb.providers] },
  async getProvider(id: string) { return fakeDb.providers.find((p) => p.id === id) ?? null },
  async getProviderByKey(key: string) { return fakeDb.providers.find((p) => p.key === key) ?? null },
  async insertProvider(p: ProviderWrite, createdBy: string) {
    return seedProvider({ ...p, created_by: createdBy })
  },
  async updateProviderRow(id: string, p: Omit<ProviderWrite, 'key'>) {
    const row = fakeDb.providers.find((x) => x.id === id)
    if (!row) return null
    Object.assign(row, p, { updated_at: now() })
    return row
  },
  async deleteProviderRow(id: string) {
    const before = fakeDb.providers.length
    fakeDb.providers = fakeDb.providers.filter((p) => p.id !== id)
    cascadeProvider(id)
    return fakeDb.providers.length < before
  },
  async listCredentials(providerId?: string) {
    return fakeDb.credentials.filter((c) => !providerId || c.provider_id === providerId)
  },
  async getCredential(id: string) { return fakeDb.credentials.find((c) => c.id === id) ?? null },
  async insertCredential(c: { id: string; providerId: string; label: string; ciphertext: string; hint: string; enabled: boolean; createdBy: string }) {
    return seedCredential({
      id: c.id, provider_id: c.providerId, label: c.label, secret_ciphertext: c.ciphertext, secret_hint: c.hint,
      enabled: c.enabled, created_by: c.createdBy,
    })
  },
  async updateCredentialMeta(id: string, m: { label: string; enabled: boolean }) {
    const row = fakeDb.credentials.find((c) => c.id === id)
    if (!row) return null
    Object.assign(row, m)
    return row
  },
  async rotateCredentialSecret(id: string, ciphertext: string, hint: string) {
    const row = fakeDb.credentials.find((c) => c.id === id)
    if (!row) return null
    Object.assign(row, { secret_ciphertext: ciphertext, secret_hint: hint, rotated_at: now(), last_verify_ok: null, last_verify_error: null })
    return row
  },
  async recordVerification(id: string, ok: boolean, error: string | null) {
    const row = fakeDb.credentials.find((c) => c.id === id)
    if (!row) return null
    Object.assign(row, { last_verified_at: now(), last_verify_ok: ok, last_verify_error: error })
    return row
  },
  async deleteCredentialRow(id: string) {
    const before = fakeDb.credentials.length
    fakeDb.credentials = fakeDb.credentials.filter((c) => c.id !== id)
    for (const m of fakeDb.models) if (m.credential_id === id) m.credential_id = null
    return fakeDb.credentials.length < before
  },
  async listModels(providerId?: string) {
    return fakeDb.models.filter((m) => !providerId || m.provider_id === providerId)
  },
  async getModel(id: string) { return fakeDb.models.find((m) => m.id === id) ?? null },
  async upsertModelRow(m: ModelWrite) {
    const existing = fakeDb.models.find((x) => x.provider_id === m.providerId && x.model_id === m.modelId && x.capability === m.capability)
    const fields = {
      credential_id: m.credentialId, label: m.label, price_in_per_mtok: m.priceInPerMtok,
      price_out_per_mtok: m.priceOutPerMtok, enabled: m.enabled,
    }
    if (existing) return Object.assign(existing, fields)
    return seedModel({ provider_id: m.providerId, model_id: m.modelId, capability: m.capability, ...fields })
  },
  async deleteModelRow(id: string) {
    const before = fakeDb.models.length
    fakeDb.models = fakeDb.models.filter((m) => m.id !== id)
    fakeDb.routes = fakeDb.routes.filter((r) => r.model_id !== id)
    return fakeDb.models.length < before
  },
  async listRoutes() { return [...fakeDb.routes] },
  async upsertRoute(capability: Capability, tier: ChatTier | null, modelRowId: string, by: string) {
    fakeDb.routes = fakeDb.routes.filter((r) => !(r.capability === capability && r.tier === tier))
    const row = seedRoute(capability, tier, modelRowId)
    row.updated_by = by
    return row
  },
  async deleteRoute(capability: Capability, tier: ChatTier | null) {
    const before = fakeDb.routes.length
    fakeDb.routes = fakeDb.routes.filter((r) => !(r.capability === capability && r.tier === tier))
    return fakeDb.routes.length < before
  },
  async getBudgetsRow() { return fakeDb.budgets },
  async setBudgetsRow(b: { platformDailyUsd: number | null; companyDailyUsd: number | null; by: string }) {
    fakeDb.budgets = { platform_daily_usd: b.platformDailyUsd, company_daily_usd: b.companyDailyUsd, updated_by: b.by, updated_at: now() }
    return fakeDb.budgets
  },
  async loadSnapshot(): Promise<ProviderSnapshot> {
    fakeDb.loads += 1
    return {
      providers: structuredClone(fakeDb.providers),
      credentials: structuredClone(fakeDb.credentials),
      models: structuredClone(fakeDb.models),
      routes: structuredClone(fakeDb.routes),
      budgets: fakeDb.budgets ? structuredClone(fakeDb.budgets) : null,
    }
  },
  async providerSpendToday(key: string) { return fakeDb.spendToday[key] ?? 0 },
  async spendSummaryRows(_days: number, _groupBy: SpendGroupBy): Promise<SpendRow[]> { return [] },
}
