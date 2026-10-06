/**
 * lib/ai/providers/router.ts — which provider, model and key serve a call.
 *
 * resolveTarget(capability, { tier, model, fallbackModel }):
 *   1. explicit `model` (a call site or agent override pins a model id):
 *      an enabled ai_models row with that model_id for the capability (a routed
 *      one first) whose provider is enabled and has a usable key → that provider;
 *      otherwise the built-in OpenRouter fallback with that model id.
 *   2. no explicit model: ai_routes (capability, tier) → model → provider → key.
 *   3. nothing configured / route unusable (disabled, no key, undecryptable):
 *      the built-in behaviour — OpenRouter with `fallbackModel` (the env/default
 *      tier model) and the OpenRouter key (an owner-entered key of the
 *      `openrouter` provider, else OPENROUTER_API_KEY). Embeddings fall back the
 *      same way; rerank and OCR have no built-in fallback (NOT_CONFIGURED).
 *
 * Keys: a model's own credential (credential_id) if enabled; else the
 * provider's first enabled credential; else the env key of that provider
 * (OPENROUTER_API_KEY for `openrouter`, ALEM_API_KEY for `alem`).
 *
 * The configuration snapshot (all small tables) and decrypted keys are cached
 * in memory for ≤ 60 s per server instance; every mutation through service.ts
 * calls invalidateProviderCache() on the instance that wrote. When the database
 * is unreachable or migration 094 is not applied, the snapshot is empty and
 * everything falls back to the built-in behaviour.
 */
import { decryptSecret } from '@/lib/crypto/secrets'
import type {
  Capability,
  ChatTier,
  CredentialRow,
  ModelRow,
  ProviderRow,
  ProviderSnapshot,
  ProviderTarget,
} from './types'

export const ROUTER_CACHE_TTL_MS = 60_000

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

/** Env fallbacks of provider keys (when no usable credential is stored). */
const ENV_KEYS: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  alem: 'ALEM_API_KEY',
}

const EMPTY: ProviderSnapshot = { providers: [], credentials: [], models: [], routes: [], budgets: null }

interface Cache {
  at: number
  snapshot: ProviderSnapshot
  /** credential id → plaintext key (null = could not be decrypted). */
  keys: Map<string, string | null>
}

let cache: Cache | null = null
let loading: Promise<Cache> | null = null
let generation = 0

/** Drop the cached configuration and keys (called after every mutation). */
export function invalidateProviderCache(): void {
  generation += 1
  cache = null
  loading = null
}

async function load(): Promise<Cache> {
  const gen = generation
  let snapshot: ProviderSnapshot
  try {
    const store = await import('./store')
    snapshot = await store.loadSnapshot()
  } catch (err) {
    // No database, or 094 not applied yet: built-in behaviour.
    const msg = err instanceof Error ? err.message : String(err)
    if (!/DATABASE_URL|ai_providers|ai_routes|ai_models|ai_credentials|ai_budgets/.test(msg)) {
      const line = msg.split('\n').map((l) => l.trim()).find(Boolean) ?? 'unknown error'
      console.warn('[ai-router] provider configuration unavailable:', line.slice(0, 200))
    }
    snapshot = EMPTY
  }
  const fresh: Cache = { at: Date.now(), snapshot, keys: new Map() }
  if (gen === generation) cache = fresh
  return fresh
}

async function current(): Promise<Cache> {
  if (cache && Date.now() - cache.at < ROUTER_CACHE_TTL_MS) return cache
  if (!loading) {
    loading = load().finally(() => {
      loading = null
    })
  }
  return loading
}

/** The cached configuration snapshot (loads it when stale). */
export async function getProviderSnapshot(): Promise<ProviderSnapshot> {
  return (await current()).snapshot
}

function decrypt(c: Cache, cred: CredentialRow): string | null {
  if (c.keys.has(cred.id)) return c.keys.get(cred.id) ?? null
  let plain: string | null = null
  try {
    plain = decryptSecret(cred.secret_ciphertext)
  } catch {
    // Wrong/missing SECRETS_ENCRYPTION_KEY or tampered row. Never log the value.
    console.warn(`[ai-router] credential ${cred.id} cannot be decrypted — skipped`)
  }
  c.keys.set(cred.id, plain)
  return plain
}

function envKey(providerKey: string): string | null {
  const name = ENV_KEYS[providerKey]
  const v = name ? process.env[name] : undefined
  return v && v.trim() ? v.trim() : null
}

/** The key a model row (or, with model = null, the provider) uses. */
function keyFor(c: Cache, provider: ProviderRow, model: ModelRow | null): { apiKey: string; credentialId: string | null } | null {
  const creds = c.snapshot.credentials.filter((x) => x.provider_id === provider.id)
  if (model?.credential_id) {
    const own = creds.find((x) => x.id === model.credential_id)
    if (!own || !own.enabled) return null
    const k = decrypt(c, own)
    return k ? { apiKey: k, credentialId: own.id } : null
  }
  for (const cred of creds) {
    if (!cred.enabled) continue
    const k = decrypt(c, cred)
    if (k) return { apiKey: k, credentialId: cred.id }
  }
  const env = envKey(provider.key)
  return env ? { apiKey: env, credentialId: null } : null
}

function targetOf(provider: ProviderRow, model: ModelRow, key: { apiKey: string; credentialId: string | null }): ProviderTarget {
  return {
    origin: 'db',
    providerKey: provider.key,
    providerName: provider.name,
    kind: provider.kind,
    baseUrl: provider.base_url,
    chatPath: provider.chat_path,
    embeddingsPath: provider.embeddings_path,
    rerankPath: provider.rerank_path,
    ocrMode: provider.ocr_mode,
    extraHeaders: provider.extra_headers ?? {},
    supportsResponseFormat: provider.supports_response_format,
    model: model.model_id,
    modelRowId: model.id,
    credentialId: key.credentialId,
    apiKey: key.apiKey,
    priceInPerMtok: model.price_in_per_mtok,
    priceOutPerMtok: model.price_out_per_mtok,
    dailyBudgetUsd: provider.daily_budget_usd,
  }
}

function usable(c: Cache, model: ModelRow | undefined): ProviderTarget | null {
  if (!model || !model.enabled) return null
  const provider = c.snapshot.providers.find((p) => p.id === model.provider_id)
  if (!provider || !provider.enabled) return null
  const key = keyFor(c, provider, model)
  return key ? targetOf(provider, model, key) : null
}

export interface ResolveOptions {
  /** Chat tier (chat only). */
  tier?: ChatTier | null
  /** Explicit model id pinned by the caller. */
  model?: string | null
  /** Model of the built-in OpenRouter fallback (env/default tier model). */
  fallbackModel?: string
}

export type ResolveResult =
  | { ok: true; target: ProviderTarget }
  | { ok: false; code: 'NO_API_KEY' | 'NOT_CONFIGURED'; message: string }

const warned = new Set<string>()
function warnOnce(key: string, message: string) {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(message)
}

function fallback(c: Cache, capability: Capability, model: string | undefined): ResolveResult {
  if (capability === 'rerank' || capability === 'ocr' || !model) {
    return { ok: false, code: 'NOT_CONFIGURED', message: `для «${capability}» не настроен маршрут модели` }
  }
  const row = c.snapshot.providers.find((p) => p.key === 'openrouter')
  if (row && !row.enabled) {
    return { ok: false, code: 'NO_API_KEY', message: 'провайдер OpenRouter отключён' }
  }
  const key = row ? keyFor(c, row, null) : (() => {
    const env = envKey('openrouter')
    return env ? { apiKey: env, credentialId: null } : null
  })()
  if (!key) return { ok: false, code: 'NO_API_KEY', message: 'OPENROUTER_API_KEY не задан' }
  return {
    ok: true,
    target: {
      origin: 'env',
      providerKey: 'openrouter',
      providerName: row?.name ?? 'OpenRouter',
      kind: 'openrouter',
      baseUrl: row?.kind === 'openrouter' ? row.base_url : OPENROUTER_BASE_URL,
      chatPath: row?.kind === 'openrouter' ? row.chat_path : '/chat/completions',
      embeddingsPath: row?.kind === 'openrouter' ? row.embeddings_path : '/embeddings',
      rerankPath: null,
      ocrMode: null,
      extraHeaders: {},
      supportsResponseFormat: true,
      model,
      modelRowId: null,
      credentialId: key.credentialId,
      apiKey: key.apiKey,
      priceInPerMtok: null,
      priceOutPerMtok: null,
      dailyBudgetUsd: row?.daily_budget_usd ?? null,
    },
  }
}

export async function resolveTarget(capability: Capability, opts: ResolveOptions = {}): Promise<ResolveResult> {
  const c = await current()
  const routed = new Set(c.snapshot.routes.map((r) => r.model_id))

  if (opts.model) {
    const candidates = c.snapshot.models
      .filter((m) => m.model_id === opts.model && m.capability === capability)
      .sort((a, b) => Number(routed.has(b.id)) - Number(routed.has(a.id)))
    for (const m of candidates) {
      const t = usable(c, m)
      if (t) return { ok: true, target: t }
    }
    return fallback(c, capability, opts.model)
  }

  const tier = capability === 'chat' ? (opts.tier ?? 'standard') : null
  const route = c.snapshot.routes.find((r) => r.capability === capability && (r.tier ?? null) === tier)
  if (route) {
    const t = usable(c, c.snapshot.models.find((m) => m.id === route.model_id))
    if (t) return { ok: true, target: t }
    warnOnce(`${capability}:${tier ?? ''}:${route.model_id}`,
      `[ai-router] route ${capability}${tier ? `/${tier}` : ''} is unusable (model/provider disabled or no key) — using the built-in fallback`)
  }
  return fallback(c, capability, opts.fallbackModel)
}

/**
 * Synchronous best-effort: does the cached configuration route at least one
 * chat tier to a usable model? Used by the sync hasLlmKey()/hasOpenRouterKey()
 * so an Alem-only deployment (no OPENROUTER_API_KEY) still counts as "AI
 * available". Cold cache → starts loading and answers false this time.
 */
export function hasConfiguredChatRoute(): boolean {
  if (!cache || Date.now() - cache.at >= ROUTER_CACHE_TTL_MS) {
    void current().catch(() => undefined)
    if (!cache) return false
  }
  const c = cache
  return c.snapshot.routes.some((r) => r.capability === 'chat' && usable(c, c.snapshot.models.find((m) => m.id === r.model_id)) !== null)
}

// ── budgets ────────────────────────────────────────────────────────────────

export interface EffectiveBudgets {
  platformDailyUsd: number
  companyDailyUsd: number
  source: { platform: 'db' | 'env'; company: 'db' | 'env' }
}

/**
 * Daily budgets: the runtime-editable ai_budgets row when set, else env
 * AGENT_PLATFORM_DAILY_BUDGET_USD (default 50) / AGENT_COMPANY_DAILY_BUDGET_USD
 * (default 5).
 */
export async function effectiveBudgets(): Promise<EffectiveBudgets> {
  const b = (await current()).snapshot.budgets
  const envPlatform = Number(process.env.AGENT_PLATFORM_DAILY_BUDGET_USD ?? 50)
  const envCompany = Number(process.env.AGENT_COMPANY_DAILY_BUDGET_USD ?? 5)
  const p = b?.platform_daily_usd
  const co = b?.company_daily_usd
  return {
    platformDailyUsd: typeof p === 'number' && Number.isFinite(p) ? p : envPlatform,
    companyDailyUsd: typeof co === 'number' && Number.isFinite(co) ? co : envCompany,
    source: {
      platform: typeof p === 'number' && Number.isFinite(p) ? 'db' : 'env',
      company: typeof co === 'number' && Number.isFinite(co) ? 'db' : 'env',
    },
  }
}

/**
 * Per-provider daily budget guard. Returns a refusal message when the provider
 * of `target` has a daily budget and today's spend reached it; null otherwise
 * (no budget, or spend unknown because the database is unavailable).
 */
export async function providerBudgetRefusal(target: ProviderTarget): Promise<string | null> {
  if (target.dailyBudgetUsd === null || target.dailyBudgetUsd === undefined) return null
  try {
    const store = await import('./store')
    const spent = await store.providerSpendToday(target.providerKey)
    if (spent >= target.dailyBudgetUsd) {
      return `дневной бюджет провайдера ${target.providerName} ($${target.dailyBudgetUsd}) исчерпан`
    }
  } catch (err) {
    console.warn('[ai-router] provider budget check unavailable:', err instanceof Error ? err.message.split('\n')[0] : err)
  }
  return null
}
