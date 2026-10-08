/**
 * lib/ai/providers/discovery.ts — which models each API key serves (part A1,
 * migration 107).
 *
 * For a key: GET {base_url}/models with that key (OpenAI / LiteLLM shape) →
 * the id list is stored on the key (ai_credentials.discovered_models) and
 * every id is merged into ai_models:
 *   - a new id → a 'discovered' row bound to this key, capability by the name
 *     heuristic (classifyModelId), enabled;
 *   - an id the owner already entered (a 'manual' row, any capability) is never
 *     changed — except binding a key to a row without one, when every enabled
 *     key of the provider has been discovered and exactly one lists that id;
 *   - an already discovered row → discovered_at refreshed; rebound to this key
 *     when its own key is gone or disabled.
 * Ids that disappear are kept (the owner deletes them). When /models fails the
 * key stays usable; the error is stored on the key and the models can be
 * entered by hand.
 *
 * Triggers: after a key is added / replaced / verified (service.ts), the GIGA
 * button «Обнаружить модели» (POST /api/giga-admin/ai-providers/discover), the
 * daily cron /api/cron/ai-discovery. No audit here — callers audit.
 */
import { decryptSecret } from '@/lib/crypto/secrets'
import { listRemoteModels, sanitizeProviderText } from './client'
import { invalidateProviderCache } from './router'
import * as store from './store'
import { MODEL_ID_RE, type AiCapability, type CredentialRow, type ModelRow, type ProviderRow, type ProviderTarget } from './types'
import { guardProviderBaseUrl, type Resolver } from './url-guard'

export interface ModelClass {
  capability: AiCapability
  /** True when the name says vision; null = unknown. */
  vision: boolean | null
}

/**
 * Capability of a model id by its name: embed → embeddings; rerank → rerank;
 * whisper|stt|speech|asr|transcri → transcribe; ocr → ocr; vision|vl → chat
 * with vision; anything else → chat. Ids that are clearly not text models
 * (text-to-speech, image generation, moderation) → null (not added).
 */
export function classifyModelId(id: string): ModelClass | null {
  const s = id.toLowerCase()
  if (/(^|[^a-z])tts([^a-z]|$)|text-to-speech|dall-?e|image-gen|stable-diffusion|sdxl|imagen|flux|moderation/.test(s)) return null
  if (s.includes('embed')) return { capability: 'embeddings', vision: null }
  if (s.includes('rerank')) return { capability: 'rerank', vision: null }
  if (/whisper|stt|speech|asr|transcri/.test(s)) return { capability: 'transcribe', vision: null }
  if (s.includes('ocr')) return { capability: 'ocr', vision: null }
  if (/vision|(^|[^a-z])vl([^a-z]|$)/.test(s)) return { capability: 'chat', vision: true }
  return { capability: 'chat', vision: null }
}

export interface DiscoveryOutcome {
  credentialId: string
  credentialLabel: string
  providerKey: string
  ok: boolean
  /** Sanitised error (never the key). */
  error: string | null
  /** Model ids the key listed. */
  ids: string[]
  added: number
  bound: number
  refreshed: number
}

function targetFor(provider: ProviderRow, cred: CredentialRow, apiKey: string): ProviderTarget {
  return {
    origin: 'db', providerKey: provider.key, providerName: provider.name, kind: provider.kind,
    baseUrl: provider.base_url, chatPath: provider.chat_path, embeddingsPath: provider.embeddings_path,
    rerankPath: provider.rerank_path, ocrMode: provider.ocr_mode, extraHeaders: provider.extra_headers ?? {},
    supportsResponseFormat: provider.supports_response_format, model: '', modelRowId: null,
    credentialId: cred.id, apiKey, priceInPerMtok: null, priceOutPerMtok: null, dailyBudgetUsd: null,
  }
}

/** Merge the ids one key listed into ai_models (rules in the file header). */
async function mergeModels(provider: ProviderRow, cred: CredentialRow, ids: string[]): Promise<{ added: number; refreshed: number }> {
  const [models, creds] = await Promise.all([store.listModels(provider.id), store.listCredentials(provider.id)])
  const enabledKeys = new Set(creds.filter((c) => c.enabled).map((c) => c.id))
  let added = 0
  let refreshed = 0
  for (const id of ids) {
    const same: ModelRow[] = models.filter((m) => m.model_id === id)
    if (same.some((m) => (m.source ?? 'manual') === 'manual')) continue // the owner's row: see bindUnambiguous
    const cls = MODEL_ID_RE.test(id) ? classifyModelId(id) : null
    if (!cls) continue
    const discovered = same.find((m) => m.capability === cls.capability)
    if (discovered) {
      const orphan = !discovered.credential_id || !enabledKeys.has(discovered.credential_id)
      await store.touchDiscoveredModel(discovered.id, orphan ? cred.id : null)
      refreshed += 1
      continue
    }
    const row = await store.insertDiscoveredModel({
      providerId: provider.id, credentialId: cred.id, modelId: id, capability: cls.capability, supportsVision: cls.vision,
    })
    if (row) added += 1
  }
  return { added, refreshed }
}

/**
 * Bind a key to the provider's models without one, where it is unambiguous:
 * every enabled key of the provider has been discovered and exactly one of
 * them lists the model id. Manual rows are only ever touched here.
 */
async function bindUnambiguous(provider: ProviderRow): Promise<number> {
  const [models, creds] = await Promise.all([store.listModels(provider.id), store.listCredentials(provider.id)])
  const enabled = creds.filter((c) => c.enabled)
  if (!enabled.length || enabled.some((c) => !Array.isArray(c.discovered_models))) return 0
  let bound = 0
  for (const m of models) {
    if (m.credential_id) continue
    const who = enabled.filter((c) => c.discovered_models!.includes(m.model_id))
    if (who.length === 1 && await store.bindModelCredential(m.id, who[0].id)) bound += 1
  }
  return bound
}

/** Discover the models of one key and merge them. Never throws for provider errors. */
export async function discoverCredentialModels(
  credentialId: string,
  opts: { fetchImpl?: typeof fetch; resolve?: Resolver; timeoutMs?: number } = {},
): Promise<DiscoveryOutcome> {
  const cred = await store.getCredential(credentialId)
  if (!cred) throw new Error('credential not found')
  const provider = await store.getProvider(cred.provider_id)
  if (!provider) throw new Error('provider not found')
  const base = { credentialId: cred.id, credentialLabel: cred.label, providerKey: provider.key, ids: [] as string[], added: 0, bound: 0, refreshed: 0 }
  const fail = async (error: string): Promise<DiscoveryOutcome> => {
    await store.recordDiscovery(cred.id, null, error)
    return { ...base, ok: false, error }
  }
  if (!cred.enabled) return { ...base, ok: false, error: 'ключ выключен' }
  if (!provider.enabled) return { ...base, ok: false, error: 'провайдер выключен' }

  let apiKey: string
  try {
    apiKey = decryptSecret(cred.secret_ciphertext)
  } catch {
    return fail('ключ не удаётся расшифровать (сменился SECRETS_ENCRYPTION_KEY?)')
  }
  const url = await guardProviderBaseUrl(provider.base_url, opts.resolve)
  if (!url.ok) return fail(url.error)
  const r = await listRemoteModels(targetFor(provider, cred, apiKey), { timeoutMs: opts.timeoutMs ?? 15_000, fetchImpl: opts.fetchImpl })
  if (!r.ok) {
    const hint = r.status === 401 || r.status === 403 ? ' (ключ не принят)' : r.status === 404 ? ' (у провайдера нет GET /models)' : ''
    const detail = r.detail ? `: ${sanitizeProviderText(r.detail, apiKey, 160)}` : ''
    return fail(`${r.status !== null ? `HTTP ${r.status}` : r.message}${hint}${detail}`.slice(0, 500))
  }
  await store.recordDiscovery(cred.id, r.ids, null)
  try {
    const merged = await mergeModels(provider, { ...cred, discovered_models: r.ids }, r.ids)
    const bound = await bindUnambiguous(provider)
    return { ...base, ok: true, error: null, ids: r.ids, ...merged, bound }
  } finally {
    invalidateProviderCache()
  }
}

/**
 * Discover every enabled key of every enabled provider (the GIGA button
 * without a key, the daily cron). Keys run one after another (a handful).
 */
export async function discoverAllModels(
  opts: { fetchImpl?: typeof fetch; resolve?: Resolver; timeoutMs?: number; providerId?: string } = {},
): Promise<DiscoveryOutcome[]> {
  const [providers, creds] = await Promise.all([store.listProviders(), store.listCredentials(opts.providerId)])
  const enabledProviders = new Set(providers.filter((p) => p.enabled).map((p) => p.id))
  const out: DiscoveryOutcome[] = []
  for (const c of creds) {
    if (!c.enabled || !enabledProviders.has(c.provider_id)) continue
    try {
      out.push(await discoverCredentialModels(c.id, opts))
    } catch (err) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : 'ошибка'
      out.push({ credentialId: c.id, credentialLabel: c.label, providerKey: providers.find((p) => p.id === c.provider_id)?.key ?? '?', ok: false, error: msg.slice(0, 200), ids: [], added: 0, bound: 0, refreshed: 0 })
    }
  }
  return out
}
