/**
 * «Провайдеры и ключи» — pure view model: labels, route slots, form drafts and
 * their client-side checks, verify / budget status. No React and no fetching,
 * so every rule is unit-tested (tests/unit/giga-crm/ai-providers-ui.test.ts).
 * The server (lib/ai/providers/service.ts) validates everything again; the
 * checks here only catch obvious mistakes before a round trip.
 */
import type { Tone } from '../kit'
import { budgetUsage, fmtTokens, fmtUsd, shareOf, toNum } from '../agents/model'
import type {
  BudgetsDto,
  Capability,
  ChatTier,
  CredentialDto,
  ModelDto,
  ProviderDto,
  ProviderKind,
  ProviderRouteRef,
  RouteDto,
  SpendGroupBy,
} from './types'

export { budgetUsage, fmtTokens, fmtUsd, shareOf, toNum }

export const API = '/api/giga-admin/ai-providers'

// ─── Labels ──────────────────────────────────────────────────────────────────

export const KIND_LABEL: Record<ProviderKind, string> = {
  openai_compatible: 'OpenAI-совместимый',
  openrouter: 'OpenRouter',
}

export const CAPABILITY_LABEL: Record<Capability, string> = {
  chat: 'Чат',
  embeddings: 'Эмбеддинги',
  rerank: 'Rerank',
  ocr: 'OCR',
}

export const CAPABILITY_HINT: Record<Capability, string> = {
  chat: 'ответы, анализ, агенты',
  embeddings: 'векторный поиск по документам',
  rerank: 'переранжирование найденных фрагментов',
  ocr: 'распознавание сканов через vision-модель',
}

export const CAPABILITY_TONE: Record<Capability, Tone> = { chat: 'blue', embeddings: 'violet', rerank: 'amber', ocr: 'green' }

export const TIER_LABEL: Record<ChatTier, string> = { light: 'light', standard: 'standard', premium: 'premium' }

export const GROUP_LABEL: Record<SpendGroupBy, string> = {
  provider: 'Провайдер',
  model: 'Модель',
  feature: 'Функция',
  company: 'Компания',
}

export const CAPABILITIES: readonly Capability[] = ['chat', 'embeddings', 'rerank', 'ocr']

// ─── Routing ─────────────────────────────────────────────────────────────────

export interface RouteSlot { capability: Capability; tier: ChatTier | null; label: string; hint: string; fallback: string }

/** Every routable slot, in display order. */
export const ROUTE_SLOTS: readonly RouteSlot[] = [
  { capability: 'chat', tier: 'light', label: 'Чат · light', hint: 'простые задачи: классификация, короткие ответы', fallback: 'OpenRouter, модель уровня light из env' },
  { capability: 'chat', tier: 'standard', label: 'Чат · standard', hint: 'основная работа агентов и анализа', fallback: 'OpenRouter, модель уровня standard из env' },
  { capability: 'chat', tier: 'premium', label: 'Чат · premium', hint: 'сложные отчёты и выводы', fallback: 'OpenRouter, модель уровня premium из env' },
  { capability: 'embeddings', tier: null, label: 'Эмбеддинги', hint: 'векторный поиск по документам', fallback: 'OpenRouter, модель эмбеддингов из env' },
  { capability: 'rerank', tier: null, label: 'Rerank', hint: 'переранжирование найденных фрагментов', fallback: 'встроенного варианта нет — rerank не выполняется' },
  { capability: 'ocr', tier: null, label: 'OCR', hint: 'распознавание сканов', fallback: 'встроенного варианта нет — работает локальный OCR' },
]

export function slotKey(capability: Capability, tier: ChatTier | null): string {
  return tier ? `${capability}/${tier}` : capability
}

export function routeFor(routes: readonly RouteDto[] | null | undefined, slot: Pick<RouteSlot, 'capability' | 'tier'>): RouteDto | null {
  return routes?.find((r) => r.capability === slot.capability && (r.tier ?? null) === slot.tier) ?? null
}

export interface ModelOption { value: string; label: string; disabled: boolean; reason: string | null }

/** Models selectable for a slot: same capability, from every provider; off ones are listed but disabled. */
export function modelOptionsFor(providers: readonly ProviderDto[], capability: Capability): ModelOption[] {
  const out: ModelOption[] = []
  for (const p of providers) {
    for (const m of p.models) {
      if (m.capability !== capability) continue
      const reason = !m.enabled ? 'модель выключена' : !p.enabled ? 'провайдер выключен' : null
      out.push({ value: m.id, label: `${p.name} · ${m.label ? `${m.label} (${m.model_id})` : m.model_id}`, disabled: !m.enabled, reason })
    }
  }
  return out
}

/** Why a configured route will not be used right now (the router falls back), or null. */
export function routeProblem(route: RouteDto | null, providers: readonly ProviderDto[]): string | null {
  if (!route) return null
  if (!route.providerEnabled) return 'провайдер выключен — используется встроенный вариант'
  if (!route.modelEnabled) return 'модель выключена — используется встроенный вариант'
  const p = providers.find((x) => x.key === route.providerKey)
  if (p) {
    const m = p.models.find((x) => x.id === route.modelRowId)
    const keys = p.credentials.filter((c) => c.enabled)
    const bound = m?.credential_id ? p.credentials.find((c) => c.id === m.credential_id) : null
    if (m?.credential_id && (!bound || !bound.enabled) && keys.length === 0) return 'у модели нет включённого ключа — будет взят ключ из env, если он задан'
    if (!m?.credential_id && keys.length === 0) return 'у провайдера нет включённого ключа — будет взят ключ из env, если он задан'
  }
  return null
}

export function routeLabel(r: Pick<ProviderRouteRef, 'capability' | 'tier'>): string {
  return r.tier ? `${CAPABILITY_LABEL[r.capability]} · ${r.tier}` : CAPABILITY_LABEL[r.capability]
}

// ─── Keys ────────────────────────────────────────────────────────────────────

export interface VerifyMeta { label: string; tone: Tone; hint: string | null }

export function verifyMeta(c: Pick<CredentialDto, 'last_verify_ok' | 'last_verified_at' | 'last_verify_error'>): VerifyMeta {
  if (c.last_verify_ok === null || !c.last_verified_at) return { label: 'не проверен', tone: 'neutral', hint: null }
  if (c.last_verify_ok) return { label: 'проверен', tone: 'green', hint: null }
  return { label: 'ошибка проверки', tone: 'red', hint: c.last_verify_error }
}

export const CHECKED_WITH_LABEL: Record<'chat' | 'embeddings' | 'models', string> = {
  chat: 'запрос к чат-модели (1 токен)',
  embeddings: 'эмбеддинг одной строки',
  models: 'список моделей (GET /models)',
}

/** Client-side check of a key before it is sent (the server repeats it). */
export function secretError(secret: string): string | null {
  const s = secret.trim()
  if (!s) return 'Введите ключ'
  if (s.length < 8) return 'Ключ слишком короткий'
  if (s.length > 4096) return 'Ключ слишком длинный'
  if (/\s/.test(s)) return 'Ключ не должен содержать пробелы и переводы строк'
  return null
}

export function labelError(label: string): string | null {
  const l = label.trim()
  if (!l) return 'Укажите название ключа'
  if (l.length > 80) return 'Не длиннее 80 символов'
  return null
}

// ─── Money ───────────────────────────────────────────────────────────────────

/** '' → null; «1,5» → 1.5; invalid → error text. */
export function parseMoney(raw: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const s = raw.trim().replace(',', '.')
  if (!s) return { ok: true, value: null }
  const n = Number(s)
  if (!Number.isFinite(n)) return { ok: false, error: 'Введите число' }
  if (n < 0) return { ok: false, error: 'Не может быть отрицательным' }
  if (n > 100_000) return { ok: false, error: 'Слишком большое значение' }
  return { ok: true, value: n }
}

export function moneyText(v: number | null | undefined): string {
  return v == null ? '' : String(v)
}

export function fmtPrice(v: number | null | undefined): string {
  if (v == null) return '—'
  return `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 })}`
}

// ─── Provider form ───────────────────────────────────────────────────────────

export interface ProviderDraft {
  key: string
  name: string
  kind: ProviderKind
  baseUrl: string
  chatPath: string
  embeddingsPath: string
  rerankPath: string
  ocrMode: '' | 'chat_vision'
  supportsResponseFormat: boolean
  enabled: boolean
  headersText: string
  dailyBudget: string
  privacyNote: string
}

export type ProviderField = keyof ProviderDraft
export type FieldErrors<F extends string> = Partial<Record<F, string>>

export function headersToText(h: Record<string, string> | null | undefined): string {
  return Object.entries(h ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n')
}

export function providerDraftFrom(p?: ProviderDto | null): ProviderDraft {
  if (!p) {
    return {
      key: '', name: '', kind: 'openai_compatible', baseUrl: 'https://', chatPath: '/chat/completions',
      embeddingsPath: '/embeddings', rerankPath: '', ocrMode: '', supportsResponseFormat: true, enabled: true,
      headersText: '', dailyBudget: '', privacyNote: '',
    }
  }
  return {
    key: p.key, name: p.name, kind: p.kind, baseUrl: p.base_url, chatPath: p.chat_path, embeddingsPath: p.embeddings_path,
    rerankPath: p.rerank_path ?? '', ocrMode: p.ocr_mode ?? '', supportsResponseFormat: p.supports_response_format,
    enabled: p.enabled, headersText: headersToText(p.extra_headers), dailyBudget: moneyText(p.daily_budget_usd),
    privacyNote: p.privacy_note ?? '',
  }
}

const FORBIDDEN_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|host|content-length|content-type|x-api-key|api-key)$/i
const SAFE_PATH = /^\/[A-Za-z0-9._~\-/]*$/

export function parseHeaders(text: string): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const out: Record<string, string> = {}
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const at = line.indexOf(':')
    if (at <= 0) return { ok: false, error: `Строка ${i + 1}: ожидается «Имя: значение»` }
    const name = line.slice(0, at).trim()
    const value = line.slice(at + 1).trim()
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name)) return { ok: false, error: `Строка ${i + 1}: имя заголовка — латиница, цифры, дефис` }
    if (FORBIDDEN_HEADER.test(name)) return { ok: false, error: `Заголовок ${name} задавать нельзя: ключи хранятся только в разделе «Ключи»` }
    if (value.length > 500) return { ok: false, error: `Строка ${i + 1}: значение длиннее 500 символов` }
    out[name] = value
  }
  if (Object.keys(out).length > 20) return { ok: false, error: 'Не больше 20 заголовков' }
  return { ok: true, value: out }
}

/** Request body for POST (create) or PATCH (edit), or per-field errors. */
export function buildProviderPayload(d: ProviderDraft, mode: 'create' | 'edit'): { payload: Record<string, unknown> | null; errors: FieldErrors<ProviderField> } {
  const errors: FieldErrors<ProviderField> = {}
  const key = d.key.trim().toLowerCase()
  if (mode === 'create' && !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(key)) errors.key = 'Латиница в нижнем регистре, цифры, _ и -, 2–40 символов'
  if (!d.name.trim()) errors.name = 'Укажите название'
  else if (d.name.trim().length > 80) errors.name = 'Не длиннее 80 символов'
  if (d.kind === 'openrouter' && key !== 'openrouter') errors.kind = 'Тип OpenRouter зарезервирован за провайдером с ключом openrouter'
  const url = d.baseUrl.trim()
  if (!/^https?:\/\/[^/\s]+/i.test(url)) errors.baseUrl = 'Укажите адрес вида https://api.example.com/v1'
  if (!SAFE_PATH.test(d.chatPath.trim())) errors.chatPath = 'Путь начинается с / и содержит только буквы, цифры, ._-~/'
  if (!SAFE_PATH.test(d.embeddingsPath.trim())) errors.embeddingsPath = 'Путь начинается с / и содержит только буквы, цифры, ._-~/'
  if (d.rerankPath.trim() && !SAFE_PATH.test(d.rerankPath.trim())) errors.rerankPath = 'Путь начинается с / или оставьте пустым'
  const headers = parseHeaders(d.headersText)
  if (!headers.ok) errors.headersText = headers.error
  const budget = parseMoney(d.dailyBudget)
  if (!budget.ok) errors.dailyBudget = budget.error
  if (d.privacyNote.trim().length > 500) errors.privacyNote = 'Не длиннее 500 символов'
  if (Object.keys(errors).length) return { payload: null, errors }

  const body: Record<string, unknown> = {
    name: d.name.trim(),
    kind: d.kind,
    baseUrl: url,
    chatPath: d.chatPath.trim(),
    embeddingsPath: d.embeddingsPath.trim(),
    rerankPath: d.rerankPath.trim() || null,
    ocrMode: d.ocrMode || null,
    extraHeaders: headers.ok ? headers.value : {},
    supportsResponseFormat: d.supportsResponseFormat,
    enabled: d.enabled,
    dailyBudgetUsd: budget.ok ? budget.value : null,
    privacyNote: d.privacyNote.trim() || null,
  }
  return { payload: mode === 'create' ? { key, ...body } : body, errors }
}

const SERVER_FIELD: Record<string, ProviderField> = {
  key: 'key', name: 'name', kind: 'kind', baseUrl: 'baseUrl', chatPath: 'chatPath', embeddingsPath: 'embeddingsPath',
  rerankPath: 'rerankPath', ocrMode: 'ocrMode', extraHeaders: 'headersText', supportsResponseFormat: 'supportsResponseFormat',
  dailyBudgetUsd: 'dailyBudget', privacyNote: 'privacyNote',
}

/** Which form field a service error belongs to («baseUrl: …», URL guard texts), or null for a general error. */
export function providerFieldOfError(message: string): ProviderField | null {
  const m = /^([A-Za-z]+)[.:]/.exec(message)
  if (m && SERVER_FIELD[m[1]]) return SERVER_FIELD[m[1]]
  if (/^(Неверный адрес|Адрес не должен|Нужен https|Укажите доменное|Нестандартный порт|Домен провайдера)/.test(message)) return 'baseUrl'
  if (/тип openrouter/i.test(message)) return 'kind'
  return null
}

// ─── Model form ──────────────────────────────────────────────────────────────

export interface ModelDraft {
  modelId: string
  capability: Capability
  label: string
  credentialId: string
  priceIn: string
  priceOut: string
  enabled: boolean
}

export type ModelField = keyof ModelDraft

export function modelDraftFrom(m?: ModelDto | null): ModelDraft {
  if (!m) return { modelId: '', capability: 'chat', label: '', credentialId: '', priceIn: '', priceOut: '', enabled: true }
  return {
    modelId: m.model_id, capability: m.capability, label: m.label ?? '', credentialId: m.credential_id ?? '',
    priceIn: moneyText(m.price_in_per_mtok), priceOut: moneyText(m.price_out_per_mtok), enabled: m.enabled,
  }
}

/** Capabilities the provider can serve (rerank needs a rerank path, OCR needs the chat_vision mode). */
export function capabilityAvailability(p: Pick<ProviderDto, 'rerank_path' | 'ocr_mode'>): Record<Capability, string | null> {
  return {
    chat: null,
    embeddings: null,
    rerank: p.rerank_path ? null : 'у провайдера не задан путь rerank',
    ocr: p.ocr_mode === 'chat_vision' ? null : 'у провайдера не включён режим OCR (chat_vision)',
  }
}

export function buildModelPayload(d: ModelDraft, provider: Pick<ProviderDto, 'id' | 'rerank_path' | 'ocr_mode'>): { payload: Record<string, unknown> | null; errors: FieldErrors<ModelField> } {
  const errors: FieldErrors<ModelField> = {}
  const id = d.modelId.trim()
  if (!id) errors.modelId = 'Укажите id модели у провайдера'
  else if (id.length > 200 || !/^[\w.:/@+-]+$/.test(id)) errors.modelId = 'Латиница, цифры и . : / @ + - _'
  const unavailable = capabilityAvailability(provider)[d.capability]
  if (unavailable) errors.capability = unavailable
  if (d.label.trim().length > 120) errors.label = 'Не длиннее 120 символов'
  const pin = parseMoney(d.priceIn)
  if (!pin.ok) errors.priceIn = pin.error
  const pout = parseMoney(d.priceOut)
  if (!pout.ok) errors.priceOut = pout.error
  if (Object.keys(errors).length) return { payload: null, errors }
  return {
    payload: {
      providerId: provider.id,
      modelId: id,
      capability: d.capability,
      credentialId: d.credentialId || null,
      label: d.label.trim() || null,
      priceInPerMtok: pin.ok ? pin.value : null,
      priceOutPerMtok: pout.ok ? pout.value : null,
      enabled: d.enabled,
    },
    errors,
  }
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

export interface BudgetsDraft { platform: string; company: string; providers: Record<string, string> }

export function budgetsDraftFrom(b: BudgetsDto): BudgetsDraft {
  return {
    platform: moneyText(b.platform.configured),
    company: moneyText(b.company.configured),
    providers: Object.fromEntries(b.providers.map((p) => [p.key, moneyText(p.dailyBudgetUsd)])),
  }
}

export interface BudgetChange { label: string; from: string; to: string }

/** PUT body with only the changed values ('' clears → env / no limit), the human-readable diff and errors. */
export function buildBudgetsPayload(d: BudgetsDraft, cur: BudgetsDto): {
  payload: Record<string, unknown> | null
  changes: BudgetChange[]
  errors: Record<string, string>
} {
  const errors: Record<string, string> = {}
  const changes: BudgetChange[] = []
  const payload: Record<string, unknown> = {}
  const show = (v: number | null, empty: string) => (v == null ? empty : fmtUsd(v))

  const level = (field: 'platform' | 'company', label: string, envNote: string) => {
    const r = parseMoney(d[field])
    if (!r.ok) { errors[field] = r.error; return }
    if (r.value !== cur[field].configured) {
      payload[field === 'platform' ? 'platformDailyUsd' : 'companyDailyUsd'] = r.value
      changes.push({ label, from: show(cur[field].configured, envNote), to: show(r.value, envNote) })
    }
  }
  level('platform', 'Платформа в сутки', 'из env')
  level('company', 'Одна компания в сутки', 'из env')

  const providers: Record<string, number | null> = {}
  for (const p of cur.providers) {
    const raw = d.providers[p.key] ?? ''
    const r = parseMoney(raw)
    if (!r.ok) { errors[`provider:${p.key}`] = r.error; continue }
    if (r.value !== p.dailyBudgetUsd) {
      providers[p.key] = r.value
      changes.push({ label: `${p.name} в сутки`, from: show(p.dailyBudgetUsd, 'без лимита'), to: show(r.value, 'без лимита') })
    }
  }
  if (Object.keys(providers).length) payload.providers = providers
  if (Object.keys(errors).length) return { payload: null, changes, errors }
  return { payload: changes.length ? payload : null, changes, errors }
}

export const SOURCE_LABEL: Record<'db' | 'env', string> = { db: 'БД', env: 'env' }

/** Sum of today's spend recorded per provider (calls with a provider key). */
export function providersSpentToday(b: BudgetsDto | null | undefined): number {
  return (b?.providers ?? []).reduce((s, p) => s + toNum(p.spentTodayUsd), 0)
}

// ─── Spend ───────────────────────────────────────────────────────────────────

/** Human label for a spend row key. */
export function spendKeyLabel(groupBy: SpendGroupBy, key: string | null, providers: readonly Pick<ProviderDto, 'key' | 'name'>[] = []): string {
  if (key === null || key === '') {
    if (groupBy === 'provider') return 'не записан (вызовы до миграции 094)'
    if (groupBy === 'company') return 'без компании (платформенные задачи)'
    return 'не указано'
  }
  if (groupBy === 'provider') return providers.find((p) => p.key === key)?.name ?? key
  if (groupBy === 'feature') {
    if (key.startsWith('agent:')) return `Агент: ${key.slice(6)}`
    if (key.startsWith('feature:')) return `Функция: ${key.slice(8)}`
  }
  return key
}

/** The provider's model a key is bound to, for the key row. */
export function modelsUsingKey(p: Pick<ProviderDto, 'models'>, credentialId: string): ModelDto[] {
  return p.models.filter((m) => m.credential_id === credentialId)
}
