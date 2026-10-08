/**
 * lib/ai/providers/router.ts — which provider, model and key serve a call.
 *
 * resolveCandidates(capability, { tier, model, fallbackModel }) → an ordered
 * list of call targets (see the function for the order: registered explicit
 * model → route → explicit model via OpenRouter → any usable model of the
 * capability, tier_hint first → built-in OpenRouter with `fallbackModel`),
 * healthy targets first (health.ts). Callers try them in order on failover-
 * worthy errors (failover.ts). resolveTarget = the first candidate.
 * With nothing configured it is the pre-094 behaviour: OpenRouter with
 * `fallbackModel` and the OpenRouter key (an owner-entered key of the
 * `openrouter` provider, else OPENROUTER_API_KEY). Rerank, OCR and transcribe
 * have no built-in fallback (NOT_CONFIGURED). Embeddings never switch models.
 *
 * Keys: a model's own credential (credential_id) if enabled; else a key whose
 * discovery listed the model; else the provider's first enabled credential;
 * else the env key of that provider (OPENROUTER_API_KEY for `openrouter`,
 * ALEM_API_KEY for `alem`).
 *
 * The configuration snapshot (all small tables) and decrypted keys are cached
 * in memory for ≤ 60 s per server instance; every mutation through service.ts
 * calls invalidateProviderCache() on the instance that wrote. When the database
 * is unreachable or migration 094 is not applied, the snapshot is empty and
 * everything falls back to the built-in behaviour.
 */
import { decryptSecret } from '@/lib/crypto/secrets'
import { knownModelTier } from './client'
import { healthKey, isHealthy } from './health'
import {
  capabilityOf,
  type AiCapability,
  type ChatTier,
  type CredentialRow,
  type ModelRow,
  type ProviderRow,
  type ProviderSnapshot,
  type ProviderTarget,
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

/**
 * The key a model row (or, with model = null, the provider) uses:
 *   1. the model's own credential (credential_id) — only that one;
 *   2. credential_id NULL: an enabled key whose last discovery (GET /models)
 *      listed this model id — Alem issues one key per model, so the provider's
 *      first key is often the wrong one;
 *   3. else the provider's enabled keys in order, keys not known to miss the
 *      model first (discovery never ran for them);
 *   4. else the env key of the provider.
 */
function keyFor(c: Cache, provider: ProviderRow, model: ModelRow | null): { apiKey: string; credentialId: string | null } | null {
  const creds = c.snapshot.credentials.filter((x) => x.provider_id === provider.id)
  if (model?.credential_id) {
    const own = creds.find((x) => x.id === model.credential_id)
    if (!own || !own.enabled) return null
    const k = decrypt(c, own)
    return k ? { apiKey: k, credentialId: own.id } : null
  }
  const enabled = creds.filter((x) => x.enabled)
  const lists = (x: CredentialRow) => Array.isArray(x.discovered_models)
  const ordered = model
    ? [
        ...enabled.filter((x) => lists(x) && x.discovered_models!.includes(model.model_id)),
        ...enabled.filter((x) => !lists(x)),
        ...enabled.filter((x) => lists(x) && !x.discovered_models!.includes(model.model_id)),
      ]
    : enabled
  for (const cred of ordered) {
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
    supportsVision: model.supports_vision ?? null,
    supportsTools: model.supports_tools ?? null,
    tierHint: model.tier_hint ?? null,
  }
}

/** Can the provider serve this capability at all (rerank needs a path, OCR a mode)? */
function providerServes(provider: ProviderRow, capability: AiCapability): boolean {
  if (capability === 'rerank') return Boolean(provider.rerank_path)
  if (capability === 'ocr') return provider.ocr_mode === 'chat_vision'
  return true
}

function usable(c: Cache, model: ModelRow | undefined): ProviderTarget | null {
  if (!model || !model.enabled) return null
  const provider = c.snapshot.providers.find((p) => p.id === model.provider_id)
  if (!provider || !provider.enabled) return null
  if (!providerServes(provider, capabilityOf(model))) return null
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
  /** Tool calling: skip models known not to support tools (supports_tools = false). */
  requireTools?: boolean
  /** Image input: skip models known to be text-only, vision models first. */
  requireVision?: boolean
  /** Upper bound of the candidate list (default 6). */
  maxCandidates?: number
}

export type ResolveResult =
  | { ok: true; target: ProviderTarget }
  | { ok: false; code: 'NO_API_KEY' | 'NOT_CONFIGURED'; message: string }

export type CandidatesResult =
  | { ok: true; candidates: ProviderTarget[] }
  | { ok: false; code: 'NO_API_KEY' | 'NOT_CONFIGURED'; message: string }

const warned = new Set<string>()
function warnOnce(key: string, message: string) {
  if (warned.has(key)) return
  warned.add(key)
  console.warn(message)
}

/** The built-in OpenRouter target for `model`, or why there is none. */
function builtin(c: Cache, capability: AiCapability, model: string | null | undefined): ResolveResult {
  if ((capability !== 'chat' && capability !== 'embeddings') || !model) {
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
      supportsVision: null,
      supportsTools: null,
      tierHint: null,
    },
  }
}

const TIER_ORDER: Record<ChatTier, number> = { light: 0, standard: 1, premium: 2 }

/**
 * Ordered call targets for one call (A1 automatic routing):
 *   1. an explicit `model` registered in ai_models with a usable key (an owner
 *      decision: agent model_override, a registered OpenRouter id, …);
 *   2. the route of (capability, tier) from ai_routes, when usable;
 *   3. an explicit `model` that is not registered — through the built-in
 *      OpenRouter, when it has a key;
 *   4. any other usable model of the capability on any enabled provider with a
 *      key — for chat the ones whose tier_hint matches first, then unhinted,
 *      then the other tiers; routed and manually entered models before
 *      discovered ones;
 *   5. the built-in OpenRouter with `fallbackModel` (chat / embeddings), when
 *      it has a key.
 * Healthy targets come before ones that failed in the last 5 minutes
 * (health.ts). An explicit model that is unavailable (no OpenRouter key) thus
 * transparently becomes the chat model of the matching tier.
 *
 * Embeddings never switch models (vectors of different models are not
 * comparable): exactly one candidate — the explicit / routed / built-in model,
 * else the single usable embeddings model; no health reordering.
 */
export async function resolveCandidates(capability: AiCapability, opts: ResolveOptions = {}): Promise<CandidatesResult> {
  const c = await current()
  const tier: ChatTier | null = capability === 'chat'
    ? (opts.tier ?? knownModelTier(opts.model) ?? 'standard')
    : null
  const max = Math.max(1, opts.maxCandidates ?? 6)
  const routedIds = new Set(c.snapshot.routes.map((r) => r.model_id))
  const ofCapability = c.snapshot.models.filter((m) => capabilityOf(m) === capability)
  const out: ProviderTarget[] = []
  const seen = new Set<string>()
  const push = (t: ProviderTarget | null) => {
    if (!t) return
    if (opts.requireTools && t.supportsTools === false) return
    if (opts.requireVision && t.supportsVision === false) return
    const k = healthKey(t)
    if (seen.has(k)) return
    seen.add(k)
    out.push(t)
  }

  // 1. explicit model registered by the owner
  if (opts.model) {
    ofCapability
      .filter((m) => m.model_id === opts.model)
      .sort((a, b) => Number(routedIds.has(b.id)) - Number(routedIds.has(a.id)))
      .forEach((m) => push(usable(c, m)))
  }
  // 2. the owner's route
  const route = c.snapshot.routes.find((r) => capabilityOf(r) === capability && (r.tier ?? null) === tier)
  if (route) {
    const t = usable(c, c.snapshot.models.find((m) => m.id === route.model_id))
    if (t) push(t)
    else {
      warnOnce(`${capability}:${tier ?? ''}:${route.model_id}`,
        `[ai-router] route ${capability}${tier ? `/${tier}` : ''} is unusable (model/provider disabled or no key) — trying other models`)
    }
  }
  // 3. explicit, unregistered model through the built-in OpenRouter
  const explicitBuiltin = opts.model ? builtin(c, capability, opts.model) : null
  if (explicitBuiltin?.ok) push(explicitBuiltin.target)

  if (capability === 'embeddings') {
    const fb = builtin(c, capability, opts.fallbackModel)
    if (fb.ok) push(fb.target)
    if (out.length === 0) {
      const all = ofCapability.map((m) => usable(c, m)).filter((t): t is ProviderTarget => t !== null)
      if (all.length === 1) push(all[0])
    }
    if (out.length) return { ok: true, candidates: out.slice(0, 1) }
    return fb.ok ? { ok: false, code: 'NOT_CONFIGURED', message: 'для «embeddings» не настроен маршрут модели' } : fb
  }

  // 4. any other usable model of the capability
  const tierRank = (m: ModelRow): number => {
    if (!tier) return 0
    const hint = m.tier_hint ?? null
    if (hint === tier) return 0
    if (hint === null) return 1
    return 1 + Math.abs(TIER_ORDER[hint] - TIER_ORDER[tier])
  }
  const rank = (m: ModelRow): number[] => [
    tierRank(m),
    opts.requireVision ? (m.supports_vision === true ? 0 : 1) : 0,
    opts.requireTools ? (m.supports_tools === true ? 0 : 1) : 0,
    routedIds.has(m.id) ? 0 : 1,
    (m.source ?? 'manual') === 'manual' ? 0 : 1,
  ]
  ofCapability
    .map((m) => ({ m, r: rank(m) }))
    .sort((a, b) => {
      for (let i = 0; i < a.r.length; i++) if (a.r[i] !== b.r[i]) return a.r[i] - b.r[i]
      return 0
    })
    .forEach(({ m }) => push(usable(c, m)))

  // 5. the built-in OpenRouter with the default model of the tier
  const fb = builtin(c, capability, opts.fallbackModel)
  if (fb.ok) push(fb.target)

  if (out.length === 0) {
    if (explicitBuiltin && !explicitBuiltin.ok && explicitBuiltin.code === 'NO_API_KEY' && !opts.fallbackModel) return explicitBuiltin
    return fb.ok ? { ok: false, code: 'NOT_CONFIGURED', message: `для «${capability}» нет доступной модели` } : fb
  }
  // vision: known vision models first (stable otherwise)
  const ordered = opts.requireVision
    ? [...out.filter((t) => t.supportsVision === true), ...out.filter((t) => t.supportsVision !== true)]
    : out
  const now = Date.now()
  const healthy = ordered.filter((t) => isHealthy(t, now))
  const sick = ordered.filter((t) => !isHealthy(t, now))
  return { ok: true, candidates: [...healthy, ...sick].slice(0, max) }
}

/** The first candidate (backward compatible single-target API). */
export async function resolveTarget(capability: AiCapability, opts: ResolveOptions = {}): Promise<ResolveResult> {
  const r = await resolveCandidates(capability, opts)
  return r.ok ? { ok: true, target: r.candidates[0] } : r
}

/**
 * Synchronous best-effort: does the cached configuration have at least one
 * usable chat target (a route, or any manual/discovered chat model on an
 * enabled provider with a key)? Used by the sync hasLlmKey()/hasOpenRouterKey()
 * so an Alem-only deployment (no OPENROUTER_API_KEY) still counts as "AI
 * available". Cold cache → starts loading and answers false this time.
 */
export function hasConfiguredChatRoute(): boolean {
  if (!cache || Date.now() - cache.at >= ROUTER_CACHE_TTL_MS) {
    void current().catch(() => undefined)
    if (!cache) return false
  }
  const c = cache
  return c.snapshot.models.some((m) => capabilityOf(m) === 'chat' && usable(c, m) !== null)
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
 * of `target` has a daily budget and today's spend reached it, or when that
 * spend cannot be read and the check fails closed (production, see
 * budgetFailsClosed in lib/ai/usage-ledger.ts); null otherwise.
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
    const reason = err instanceof Error ? err.message.split('\n')[0] : err
    const { budgetFailsClosed } = await import('../usage-ledger')
    if (budgetFailsClosed()) {
      console.error('[ai-router] provider budget check unavailable — call refused (fail closed):', reason)
      return `расход провайдера ${target.providerName} не удалось проверить — вызов отклонён`
    }
    console.warn('[ai-router] provider budget check unavailable:', reason)
  }
  return null
}
