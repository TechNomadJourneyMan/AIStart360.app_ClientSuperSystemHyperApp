/**
 * lib/ai/providers/service.ts — the SHARED management API for LLM providers,
 * API keys, models, routes, budgets and spend (migration 094). Admin routes
 * (requireGiga(req, 'settings.manage') to mutate, 'agents.view' to read spend)
 * and the Telegram admin bot call these functions; neither talks to the tables
 * directly.
 *
 * Guarantees:
 *   - inputs are validated with Zod; base URLs pass the SSRF guard (url-guard.ts);
 *   - API keys are encrypted with SECRETS_ENCRYPTION_KEY before they touch the
 *     database; without a configured key, storing one is refused — plaintext is
 *     never stored. Reads return only a mask ("••••abcd");
 *   - every mutation takes an `actor` and is written to admin_audit_log BEFORE
 *     it happens (required: an unavailable journal blocks the change); secret
 *     values never reach the journal, logs or errors;
 *   - every mutation invalidates the router cache on this instance (other
 *     instances pick the change up within 60 s).
 *
 * Errors are thrown as ProviderServiceError (code + Russian message + HTTP status).
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { recordAdminAction } from '@/lib/admin/audit'
import { isStaffRole } from '@/lib/admin/rbac'
import { decryptSecret, encryptSecret, isEncryptionConfigured } from '@/lib/crypto/secrets'
import {
  chatCompletion,
  createEmbeddings,
  listRemoteModels,
  sanitizeProviderText,
  type ClientFailure,
} from './client'
import { invalidateProviderCache } from './router'
import * as store from './store'
import {
  CAPABILITIES,
  CHAT_TIERS,
  OCR_MODES,
  PROVIDER_KINDS,
  type BudgetsRow,
  type Capability,
  type ChatTier,
  type CredentialRow,
  type MaskedCredential,
  type ModelRow,
  type ProviderActor,
  type ProviderRow,
  type ProviderTarget,
  type RouteRow,
} from './types'
import { guardProviderBaseUrl, isSafeApiPath, type Resolver } from './url-guard'

export type { ProviderActor } from './types'
export type { SpendGroupBy, SpendRow } from './store'

// ── errors ─────────────────────────────────────────────────────────────────

export type ProviderServiceErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'URL_REJECTED'
  | 'ENCRYPTION_NOT_CONFIGURED'

const STATUS: Record<ProviderServiceErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  URL_REJECTED: 400,
  ENCRYPTION_NOT_CONFIGURED: 503,
}

export class ProviderServiceError extends Error {
  readonly status: number
  constructor(readonly code: ProviderServiceErrorCode, message: string) {
    super(message)
    this.name = 'ProviderServiceError'
    this.status = STATUS[code]
  }
}

function zodMessage(err: z.ZodError): string {
  const i = err.issues[0]
  return i ? `${i.path.join('.') || 'значение'}: ${i.message}` : 'неверные данные'
}

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value)
  if (!r.success) throw new ProviderServiceError('VALIDATION', zodMessage(r.error))
  return r.data
}

function isUniqueViolation(err: unknown): boolean {
  const m = err instanceof Error ? err.message : ''
  return /unique|duplicate key|23505/i.test(m)
}

// ── schemas (exported for routes/bots that want to pre-validate) ─────────────

const uuid = z.string().uuid('ожидается UUID')
const apiPath = z.string().trim().refine(isSafeApiPath, 'путь должен начинаться с / и содержать только буквы, цифры, ._-~/')
const money = z.number().finite().min(0, 'не может быть отрицательным').max(100_000, 'слишком большое значение')
const headerName = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, 'имя заголовка: латиница, цифры, дефис')
  .refine((h) => !/^(authorization|proxy-authorization|cookie|set-cookie|host|content-length|content-type|x-api-key|api-key)$/i.test(h),
    'этот заголовок задавать нельзя (ключи хранятся только в разделе «Ключи»)')
const headerValue = z.string().max(500).refine((v) => !/[\r\n]/.test(v), 'перевод строки в значении заголовка')

export const providerInputSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/, 'ключ: латиница в нижнем регистре, цифры, _ и -, 2–40 символов'),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(PROVIDER_KINDS).default('openai_compatible'),
  baseUrl: z.string().trim().min(1).max(300),
  chatPath: apiPath.default('/chat/completions'),
  embeddingsPath: apiPath.default('/embeddings'),
  rerankPath: apiPath.nullable().default(null),
  ocrMode: z.enum(OCR_MODES).nullable().default(null),
  extraHeaders: z.record(headerName, headerValue).refine((h) => Object.keys(h).length <= 20, 'не больше 20 заголовков').default({}),
  supportsResponseFormat: z.boolean().default(true),
  enabled: z.boolean().default(true),
  dailyBudgetUsd: money.nullable().default(null),
  privacyNote: z.string().trim().max(500).nullable().default(null),
}).strict()
export type ProviderInput = z.input<typeof providerInputSchema>

export const providerPatchSchema = providerInputSchema.omit({ key: true }).partial().strict()
export type ProviderPatch = z.input<typeof providerPatchSchema>

const secretSchema = z.string().trim().min(8, 'ключ слишком короткий').max(4096, 'ключ слишком длинный')
  .refine((s) => !/\s/.test(s), 'ключ не должен содержать пробелы и переводы строк')
const labelSchema = z.string().trim().min(1, 'укажите название').max(80)

export const modelInputSchema = z.object({
  providerId: uuid,
  modelId: z.string().trim().min(1).max(200).regex(/^[\w.:/@+-]+$/, 'id модели: латиница, цифры и . : / @ + - _'),
  capability: z.enum(CAPABILITIES),
  credentialId: uuid.nullable().default(null),
  label: z.string().trim().max(120).nullable().default(null),
  priceInPerMtok: money.nullable().default(null),
  priceOutPerMtok: money.nullable().default(null),
  enabled: z.boolean().default(true),
}).strict()
export type ModelInput = z.input<typeof modelInputSchema>

export const budgetsInputSchema = z.object({
  platformDailyUsd: money.nullable().optional(),
  companyDailyUsd: money.nullable().optional(),
  /** provider key → daily USD budget (null = none). */
  providers: z.record(z.string(), money.nullable()).optional(),
}).strict()
export type BudgetsInput = z.input<typeof budgetsInputSchema>

// ── audit ──────────────────────────────────────────────────────────────────

const SECRET_KEYS = /secret|api_?key|token|password|ciphertext|authorization/i

/** Deep copy without anything secret-looking (defence in depth for audit values). */
export function redactForAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForAudit)
  if (!value || typeof value !== 'object' || value instanceof Date) return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) =>
      SECRET_KEYS.test(k) && k !== 'secret_hint' ? [k, '[REDACTED]'] : [k, redactForAudit(v)]),
  )
}

/** ProviderActor → the admin_audit_log actor (Telegram ids are prefixed). */
function auditActor(actor: ProviderActor) {
  const role = isStaffRole(actor.role) ? actor.role : undefined
  if (actor.kind === 'telegram') {
    return { id: `telegram:${actor.id}`, kind: 'telegram' as const, email: actor.label, role }
  }
  return {
    id: actor.id,
    kind: actor.id.startsWith('giga:') ? ('break_glass' as const) : ('session' as const),
    email: actor.label,
    role,
  }
}

function actorTag(actor: ProviderActor): string {
  return actor.kind === 'telegram' ? `telegram:${actor.id}` : actor.id
}

async function audit(
  actor: ProviderActor,
  action: string,
  entityType: string,
  entityId: string | null,
  values: { oldValue?: unknown; newValue?: unknown; metadata?: Record<string, unknown> },
): Promise<void> {
  const parsedActor = z.object({ kind: z.enum(['staff', 'telegram']), id: z.string().min(1).max(200) }).safeParse(actor)
  if (!parsedActor.success) throw new ProviderServiceError('VALIDATION', 'не указан исполнитель действия (actor)')
  await recordAdminAction(auditActor(actor), {
    action,
    entityType,
    entityId,
    oldValue: redactForAudit(values.oldValue),
    newValue: redactForAudit(values.newValue),
    metadata: { via: actor.kind, actor_label: actor.label ?? null, ...(redactForAudit(values.metadata ?? {}) as Record<string, unknown>) },
  }, actor.req ?? null, { required: true })
}

// ── views ──────────────────────────────────────────────────────────────────

export function maskCredential(c: CredentialRow): MaskedCredential {
  const { secret_ciphertext: _ciphertext, ...rest } = c
  return { ...rest, masked: c.secret_hint ? `••••${c.secret_hint}` : '••••' }
}

export interface ProviderView extends ProviderRow {
  credentials: MaskedCredential[]
  models: ModelRow[]
  /** Routes served by this provider's models. */
  routes: Array<Pick<RouteRow, 'capability' | 'tier'> & { model_id: string; model: string }>
}

/** All providers with masked keys, models and the routes they serve. */
export async function listProviders(): Promise<ProviderView[]> {
  const [providers, credentials, models, routes] = await Promise.all([
    store.listProviders(), store.listCredentials(), store.listModels(), store.listRoutes(),
  ])
  return providers.map((p) => {
    const own = models.filter((m) => m.provider_id === p.id)
    return {
      ...p,
      credentials: credentials.filter((c) => c.provider_id === p.id).map(maskCredential),
      models: own,
      routes: routes
        .filter((r) => own.some((m) => m.id === r.model_id))
        .map((r) => ({ capability: r.capability, tier: r.tier, model_id: r.model_id, model: own.find((m) => m.id === r.model_id)!.model_id })),
    }
  })
}

export async function getProvider(idOrKey: string): Promise<ProviderView | null> {
  const all = await listProviders()
  return all.find((p) => p.id === idOrKey || p.key === idOrKey) ?? null
}

async function requireProvider(id: string): Promise<ProviderRow> {
  parse(uuid, id)
  const p = await store.getProvider(id)
  if (!p) throw new ProviderServiceError('NOT_FOUND', 'провайдер не найден')
  return p
}

async function requireCredential(id: string): Promise<CredentialRow> {
  parse(uuid, id)
  const c = await store.getCredential(id)
  if (!c) throw new ProviderServiceError('NOT_FOUND', 'ключ не найден')
  return c
}

async function checkUrl(raw: string, resolve?: Resolver): Promise<string> {
  const g = await guardProviderBaseUrl(raw, resolve)
  if (!g.ok) throw new ProviderServiceError('URL_REJECTED', g.error)
  return g.url
}

// ── providers ──────────────────────────────────────────────────────────────

export async function createProvider(actor: ProviderActor, input: ProviderInput, opts: { resolve?: Resolver } = {}): Promise<ProviderRow> {
  const v = parse(providerInputSchema, input)
  const baseUrl = await checkUrl(v.baseUrl, opts.resolve)
  if (v.kind === 'openrouter' && v.key !== 'openrouter') {
    throw new ProviderServiceError('VALIDATION', 'тип openrouter зарезервирован за провайдером с ключом openrouter')
  }
  const write: store.ProviderWrite = {
    key: v.key, name: v.name, kind: v.kind, base_url: baseUrl, chat_path: v.chatPath,
    embeddings_path: v.embeddingsPath, rerank_path: v.rerankPath, ocr_mode: v.ocrMode,
    extra_headers: v.extraHeaders, supports_response_format: v.supportsResponseFormat,
    enabled: v.enabled, daily_budget_usd: v.dailyBudgetUsd, privacy_note: v.privacyNote,
  }
  if (await store.getProviderByKey(v.key)) throw new ProviderServiceError('CONFLICT', `провайдер с ключом ${v.key} уже есть`)
  await audit(actor, 'ai.provider.create', 'ai_provider', v.key, { newValue: write })
  try {
    const row = await store.insertProvider(write, actorTag(actor))
    return row
  } catch (err) {
    if (isUniqueViolation(err)) throw new ProviderServiceError('CONFLICT', `провайдер с ключом ${v.key} уже есть`)
    throw err
  } finally {
    invalidateProviderCache()
  }
}

export async function updateProvider(actor: ProviderActor, id: string, patch: ProviderPatch, opts: { resolve?: Resolver } = {}): Promise<ProviderRow> {
  const old = await requireProvider(id)
  const v = parse(providerPatchSchema, patch)
  const baseUrl = v.baseUrl !== undefined ? await checkUrl(v.baseUrl, opts.resolve) : old.base_url
  const kind = v.kind ?? old.kind
  if (kind === 'openrouter' && old.key !== 'openrouter') {
    throw new ProviderServiceError('VALIDATION', 'тип openrouter зарезервирован за провайдером с ключом openrouter')
  }
  const next: Omit<store.ProviderWrite, 'key'> = {
    name: v.name ?? old.name,
    kind,
    base_url: baseUrl,
    chat_path: v.chatPath ?? old.chat_path,
    embeddings_path: v.embeddingsPath ?? old.embeddings_path,
    rerank_path: v.rerankPath !== undefined ? v.rerankPath : old.rerank_path,
    ocr_mode: v.ocrMode !== undefined ? v.ocrMode : old.ocr_mode,
    extra_headers: v.extraHeaders ?? old.extra_headers,
    supports_response_format: v.supportsResponseFormat ?? old.supports_response_format,
    enabled: v.enabled ?? old.enabled,
    daily_budget_usd: v.dailyBudgetUsd !== undefined ? v.dailyBudgetUsd : old.daily_budget_usd,
    privacy_note: v.privacyNote !== undefined ? v.privacyNote : old.privacy_note,
  }
  await audit(actor, 'ai.provider.update', 'ai_provider', id, { oldValue: old, newValue: next, metadata: { key: old.key } })
  try {
    const row = await store.updateProviderRow(id, next)
    if (!row) throw new ProviderServiceError('NOT_FOUND', 'провайдер не найден')
    return row
  } finally {
    invalidateProviderCache()
  }
}

/** Deletes the provider with its keys, models and routes (cascade). */
export async function deleteProvider(actor: ProviderActor, id: string): Promise<{ deleted: true }> {
  const old = await requireProvider(id)
  await audit(actor, 'ai.provider.delete', 'ai_provider', id, { oldValue: old, metadata: { key: old.key } })
  try {
    await store.deleteProviderRow(id)
    return { deleted: true }
  } finally {
    invalidateProviderCache()
  }
}

// ── credentials ────────────────────────────────────────────────────────────

function hintOf(secret: string): string {
  return secret.slice(-4)
}

function requireEncryption(): void {
  if (!isEncryptionConfigured()) {
    throw new ProviderServiceError(
      'ENCRYPTION_NOT_CONFIGURED',
      'Хранение ключей недоступно: на сервере не задан SECRETS_ENCRYPTION_KEY (32 байта, hex или base64). Ключ не сохранён.',
    )
  }
}

export async function addCredential(actor: ProviderActor, providerId: string, label: string, secret: string): Promise<MaskedCredential> {
  const provider = await requireProvider(providerId)
  const l = parse(labelSchema, label)
  const s = parse(secretSchema, secret)
  requireEncryption()
  const ciphertext = encryptSecret(s)
  const id = randomUUID()
  const hint = hintOf(s)
  await audit(actor, 'ai.credential.create', 'ai_credential', id, {
    newValue: { provider: provider.key, label: l, secret_hint: hint },
  })
  try {
    const row = await store.insertCredential({ id, providerId, label: l, ciphertext, hint, enabled: true, createdBy: actorTag(actor) })
    return maskCredential(row)
  } finally {
    invalidateProviderCache()
  }
}

export async function updateCredential(actor: ProviderActor, id: string, patch: { label?: string; enabled?: boolean }): Promise<MaskedCredential> {
  const old = await requireCredential(id)
  const v = parse(z.object({ label: labelSchema.optional(), enabled: z.boolean().optional() }).strict(), patch)
  const next = { label: v.label ?? old.label, enabled: v.enabled ?? old.enabled }
  await audit(actor, 'ai.credential.update', 'ai_credential', id, {
    oldValue: { label: old.label, enabled: old.enabled }, newValue: next,
  })
  try {
    const row = await store.updateCredentialMeta(id, next)
    if (!row) throw new ProviderServiceError('NOT_FOUND', 'ключ не найден')
    return maskCredential(row)
  } finally {
    invalidateProviderCache()
  }
}

export async function rotateCredential(actor: ProviderActor, id: string, newSecret: string): Promise<MaskedCredential> {
  const old = await requireCredential(id)
  const s = parse(secretSchema, newSecret)
  requireEncryption()
  const ciphertext = encryptSecret(s)
  const hint = hintOf(s)
  await audit(actor, 'ai.credential.rotate', 'ai_credential', id, {
    oldValue: { secret_hint: old.secret_hint }, newValue: { secret_hint: hint },
  })
  try {
    const row = await store.rotateCredentialSecret(id, ciphertext, hint)
    if (!row) throw new ProviderServiceError('NOT_FOUND', 'ключ не найден')
    return maskCredential(row)
  } finally {
    invalidateProviderCache()
  }
}

export async function deleteCredential(actor: ProviderActor, id: string): Promise<{ deleted: true }> {
  const old = await requireCredential(id)
  await audit(actor, 'ai.credential.delete', 'ai_credential', id, {
    oldValue: { label: old.label, secret_hint: old.secret_hint, provider_id: old.provider_id },
  })
  try {
    await store.deleteCredentialRow(id)
    return { deleted: true }
  } finally {
    invalidateProviderCache()
  }
}

export interface VerifyResult {
  ok: boolean
  /** Sanitised error (never the key), null when ok. */
  error: string | null
  /** What was called: a 1-token chat, a 1-input embedding, or GET /models. */
  checkedWith: 'chat' | 'embeddings' | 'models'
  model: string | null
  credential: MaskedCredential
}

function verifyError(f: ClientFailure, key: string): string {
  const base = f.status !== null ? `HTTP ${f.status}` : f.message
  const hint = f.status === 401 || f.status === 403 ? ' (ключ не принят провайдером)' : f.status === 404 ? ' (неверный адрес/путь или модель)' : ''
  const detail = f.detail ? `: ${sanitizeProviderText(f.detail, key, 200)}` : ''
  return `${base}${hint}${detail}`.slice(0, 500)
}

/**
 * Checks a key with a minimal real call and stores the outcome: a chat with
 * max_tokens 1 when the key serves a chat model (its own model, else the
 * provider's first chat model), an embedding of one short input for an
 * embeddings model, else GET <base>/models. The key is decrypted in memory only.
 */
export async function verifyCredential(
  actor: ProviderActor,
  id: string,
  opts: { fetchImpl?: typeof fetch; resolve?: Resolver; timeoutMs?: number } = {},
): Promise<VerifyResult> {
  const cred = await requireCredential(id)
  const provider = await requireProvider(cred.provider_id)
  let apiKey: string
  try {
    apiKey = decryptSecret(cred.secret_ciphertext)
  } catch {
    const row = await store.recordVerification(id, false, 'ключ не удаётся расшифровать (сменился SECRETS_ENCRYPTION_KEY?)')
    return { ok: false, error: row?.last_verify_error ?? 'decrypt failed', checkedWith: 'models', model: null, credential: maskCredential(row ?? cred) }
  }
  const url = await guardProviderBaseUrl(provider.base_url, opts.resolve)
  const models = (await store.listModels(provider.id)).filter((m) => m.enabled)
  const own = models.filter((m) => m.credential_id === id)
  const shared = models.filter((m) => m.credential_id === null)
  const pick = own.find((m) => m.capability === 'chat') ?? own.find((m) => m.capability === 'embeddings')
    ?? (own.length ? undefined : shared.find((m) => m.capability === 'chat') ?? shared.find((m) => m.capability === 'embeddings'))

  const target: ProviderTarget = {
    origin: 'db', providerKey: provider.key, providerName: provider.name, kind: provider.kind,
    baseUrl: provider.base_url, chatPath: provider.chat_path, embeddingsPath: provider.embeddings_path,
    rerankPath: provider.rerank_path, ocrMode: provider.ocr_mode, extraHeaders: provider.extra_headers ?? {},
    supportsResponseFormat: provider.supports_response_format, model: pick?.model_id ?? '', modelRowId: pick?.id ?? null,
    credentialId: id, apiKey, priceInPerMtok: null, priceOutPerMtok: null, dailyBudgetUsd: null,
  }
  const timeoutMs = opts.timeoutMs ?? 20_000
  let checkedWith: VerifyResult['checkedWith'] = 'models'
  let error: string | null = null
  if (!url.ok) {
    error = url.error
  } else if (pick?.capability === 'chat') {
    checkedWith = 'chat'
    const r = await chatCompletion(target, {
      messages: [{ role: 'user', content: 'ping' }], maxTokens: 1, timeoutMs, fetchImpl: opts.fetchImpl,
    })
    if (!r.ok) error = verifyError(r, apiKey)
  } else if (pick?.capability === 'embeddings') {
    checkedWith = 'embeddings'
    const r = await createEmbeddings(target, { input: ['ping'], timeoutMs, fetchImpl: opts.fetchImpl })
    if (!r.ok) error = verifyError(r, apiKey)
  } else {
    const r = await listRemoteModels(target, { timeoutMs, fetchImpl: opts.fetchImpl })
    if (!r.ok) error = verifyError(r, apiKey)
  }
  const ok = error === null
  await recordAdminAction(auditActor(actor), {
    action: 'ai.credential.verify', entityType: 'ai_credential', entityId: id,
    newValue: { ok, checked_with: checkedWith, model: pick?.model_id ?? null, error },
    metadata: { via: actor.kind, actor_label: actor.label ?? null, provider: provider.key },
  }, actor.req ?? null)
  const row = await store.recordVerification(id, ok, error)
  invalidateProviderCache()
  return { ok, error, checkedWith, model: pick?.model_id ?? null, credential: maskCredential(row ?? cred) }
}

// ── models ─────────────────────────────────────────────────────────────────

export async function upsertModel(actor: ProviderActor, input: ModelInput): Promise<ModelRow> {
  const v = parse(modelInputSchema, input)
  const provider = await requireProvider(v.providerId)
  if (v.credentialId) {
    const cred = await requireCredential(v.credentialId)
    if (cred.provider_id !== provider.id) throw new ProviderServiceError('VALIDATION', 'ключ принадлежит другому провайдеру')
  }
  if (v.capability === 'rerank' && !provider.rerank_path) {
    throw new ProviderServiceError('VALIDATION', 'у провайдера не задан путь rerank (rerankPath)')
  }
  if (v.capability === 'ocr' && provider.ocr_mode !== 'chat_vision') {
    throw new ProviderServiceError('VALIDATION', 'у провайдера не задан режим OCR (ocrMode: chat_vision)')
  }
  const write: store.ModelWrite = {
    providerId: provider.id, credentialId: v.credentialId, modelId: v.modelId, capability: v.capability,
    label: v.label, priceInPerMtok: v.priceInPerMtok, priceOutPerMtok: v.priceOutPerMtok, enabled: v.enabled,
  }
  await audit(actor, 'ai.model.upsert', 'ai_model', `${provider.key}/${v.modelId}/${v.capability}`, { newValue: write })
  try {
    return await store.upsertModelRow(write)
  } finally {
    invalidateProviderCache()
  }
}

/** Deletes a model; routes pointing at it are removed with it (cascade). */
export async function deleteModel(actor: ProviderActor, id: string): Promise<{ deleted: true }> {
  parse(uuid, id)
  const old = await store.getModel(id)
  if (!old) throw new ProviderServiceError('NOT_FOUND', 'модель не найдена')
  await audit(actor, 'ai.model.delete', 'ai_model', id, { oldValue: old })
  try {
    await store.deleteModelRow(id)
    return { deleted: true }
  } finally {
    invalidateProviderCache()
  }
}

// ── routes ─────────────────────────────────────────────────────────────────

export interface RouteView {
  capability: Capability
  tier: ChatTier | null
  modelRowId: string
  modelId: string
  providerKey: string
  providerEnabled: boolean
  modelEnabled: boolean
  updatedBy: string | null
  updatedAt: Date
}

export async function listRoutes(): Promise<RouteView[]> {
  const [routes, models, providers] = await Promise.all([store.listRoutes(), store.listModels(), store.listProviders()])
  return routes.map((r) => {
    const m = models.find((x) => x.id === r.model_id)
    const p = providers.find((x) => x.id === m?.provider_id)
    return {
      capability: r.capability, tier: r.tier, modelRowId: r.model_id, modelId: m?.model_id ?? '?',
      providerKey: p?.key ?? '?', providerEnabled: Boolean(p?.enabled), modelEnabled: Boolean(m?.enabled),
      updatedBy: r.updated_by, updatedAt: r.updated_at,
    }
  })
}

/**
 * Route a capability (chat: per tier) to a model row; `modelRowId = null`
 * removes the route (back to the built-in fallback).
 */
export async function setRoute(
  actor: ProviderActor,
  capability: Capability,
  tier: ChatTier | null,
  modelRowId: string | null,
): Promise<RouteRow | null> {
  const cap = parse(z.enum(CAPABILITIES), capability)
  const t = parse(z.enum(CHAT_TIERS).nullable(), tier ?? null)
  if (cap === 'chat' && !t) throw new ProviderServiceError('VALIDATION', 'для chat укажите уровень: light, standard или premium')
  if (cap !== 'chat' && t) throw new ProviderServiceError('VALIDATION', `для ${cap} уровень не указывается`)
  const old = (await store.listRoutes()).find((r) => r.capability === cap && (r.tier ?? null) === t) ?? null
  if (modelRowId === null) {
    await audit(actor, 'ai.route.delete', 'ai_route', `${cap}${t ? `/${t}` : ''}`, { oldValue: old })
    try {
      await store.deleteRoute(cap, t)
      return null
    } finally {
      invalidateProviderCache()
    }
  }
  parse(uuid, modelRowId)
  const model = await store.getModel(modelRowId)
  if (!model) throw new ProviderServiceError('NOT_FOUND', 'модель не найдена')
  if (model.capability !== cap) {
    throw new ProviderServiceError('VALIDATION', `модель ${model.model_id} зарегистрирована для «${model.capability}», а не для «${cap}»`)
  }
  if (!model.enabled) throw new ProviderServiceError('VALIDATION', `модель ${model.model_id} выключена`)
  await audit(actor, 'ai.route.set', 'ai_route', `${cap}${t ? `/${t}` : ''}`, {
    oldValue: old, newValue: { capability: cap, tier: t, model_id: model.id, model: model.model_id },
  })
  try {
    return await store.upsertRoute(cap, t, model.id, actorTag(actor))
  } finally {
    invalidateProviderCache()
  }
}

// ── budgets ────────────────────────────────────────────────────────────────

export interface BudgetsView {
  platform: { dailyUsd: number; source: 'db' | 'env'; configured: number | null }
  company: { dailyUsd: number; source: 'db' | 'env'; configured: number | null }
  providers: Array<{ key: string; name: string; dailyBudgetUsd: number | null; spentTodayUsd: number }>
  updatedBy: string | null
  updatedAt: Date | null
}

export async function getBudgets(): Promise<BudgetsView> {
  const [row, providers] = await Promise.all([store.getBudgetsRow(), store.listProviders()])
  const spent = await Promise.all(providers.map((p) => store.providerSpendToday(p.key)))
  const envPlatform = Number(process.env.AGENT_PLATFORM_DAILY_BUDGET_USD ?? 50)
  const envCompany = Number(process.env.AGENT_COMPANY_DAILY_BUDGET_USD ?? 5)
  const platform = row?.platform_daily_usd ?? null
  const company = row?.company_daily_usd ?? null
  return {
    // Fresh DB values (the router copy may be up to 60 s old on other instances).
    platform: { dailyUsd: platform ?? envPlatform, source: platform !== null ? 'db' : 'env', configured: platform },
    company: { dailyUsd: company ?? envCompany, source: company !== null ? 'db' : 'env', configured: company },
    providers: providers.map((p, i) => ({ key: p.key, name: p.name, dailyBudgetUsd: p.daily_budget_usd, spentTodayUsd: spent[i] })),
    updatedBy: row?.updated_by ?? null,
    updatedAt: row?.updated_at ?? null,
  }
}

/**
 * Change budgets. Omitted fields stay; `null` clears a value (platform /
 * company fall back to env, a provider gets no budget of its own).
 */
export async function setBudgets(actor: ProviderActor, input: BudgetsInput): Promise<BudgetsView> {
  const v = parse(budgetsInputSchema, input)
  const old = await store.getBudgetsRow()
  const providers = await store.listProviders()
  const providerChanges: Array<{ row: ProviderRow; value: number | null }> = []
  for (const [key, value] of Object.entries(v.providers ?? {})) {
    const row = providers.find((p) => p.key === key)
    if (!row) throw new ProviderServiceError('NOT_FOUND', `провайдер ${key} не найден`)
    providerChanges.push({ row, value })
  }
  const next = {
    platformDailyUsd: v.platformDailyUsd !== undefined ? v.platformDailyUsd : (old?.platform_daily_usd ?? null),
    companyDailyUsd: v.companyDailyUsd !== undefined ? v.companyDailyUsd : (old?.company_daily_usd ?? null),
  }
  await audit(actor, 'ai.budgets.update', 'ai_budgets', '1', {
    oldValue: {
      platform_daily_usd: old?.platform_daily_usd ?? null,
      company_daily_usd: old?.company_daily_usd ?? null,
      providers: Object.fromEntries(providerChanges.map((c) => [c.row.key, c.row.daily_budget_usd])),
    },
    newValue: {
      platform_daily_usd: next.platformDailyUsd,
      company_daily_usd: next.companyDailyUsd,
      providers: Object.fromEntries(providerChanges.map((c) => [c.row.key, c.value])),
    },
  })
  try {
    if (v.platformDailyUsd !== undefined || v.companyDailyUsd !== undefined) {
      await store.setBudgetsRow({ ...next, by: actorTag(actor) })
    }
    for (const c of providerChanges) {
      const { id, key: _key, created_at: _c, updated_at: _u, created_by: _b, ...rest } = c.row
      await store.updateProviderRow(id, { ...rest, daily_budget_usd: c.value })
    }
  } finally {
    invalidateProviderCache()
  }
  return getBudgets()
}

// ── spend ──────────────────────────────────────────────────────────────────

export const spendQuerySchema = z.object({
  days: z.number().int().min(1).max(366).default(7),
  groupBy: z.enum(['provider', 'model', 'feature', 'company']).default('provider'),
}).strict()

/**
 * Spend over the last `days` days grouped by provider / model / feature
 * (ledger source: 'feature:<label>' or 'agent:<key>') / company, most expensive
 * first. Rows written before 094 have no provider (key null).
 */
export async function spendSummary(q: z.input<typeof spendQuerySchema> = {}): Promise<{
  days: number
  groupBy: store.SpendGroupBy
  totalUsd: number
  rows: store.SpendRow[]
}> {
  const v = parse(spendQuerySchema, q)
  const rows = await store.spendSummaryRows(v.days, v.groupBy)
  return { days: v.days, groupBy: v.groupBy, totalUsd: rows.reduce((s, r) => s + r.costUsd, 0), rows }
}

export type { BudgetsRow }
