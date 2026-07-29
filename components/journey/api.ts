import type {
  JourneyFactView,
  JourneyFileView,
  JourneyGoalView,
  JourneyIdentity,
  JourneyMessageView,
  JourneyRoadmapView,
  JourneySuggestionView,
  JourneyWidgetView,
  JourneyWorkspaceView,
  PersistenceMode,
  ProviderMode,
} from './model'
import { isJourneyWorkspaceView, isWidgetKind, makeId } from './model'
import { journeyWidgetSchema } from '@/lib/journey/schema'

type UnknownRecord = Record<string, unknown>

export class JourneyRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'JourneyRequestError'
  }
}

export interface JourneyApiResult {
  state: JourneyWorkspaceView
  serverAvailable: boolean
}

export interface JourneyConnectCodeResult {
  code: string
  expiresAt: string
  workspaceId: string
}

export interface JourneyDeviceRedeemResult {
  workspaceId: string
  state: JourneyWorkspaceView
}

export const JOURNEY_REQUEST_TIMEOUT_MS = 20_000

export async function getJourney(
  identity: JourneyIdentity,
  fallback: JourneyWorkspaceView,
): Promise<JourneyApiResult> {
  const response = await journeyFetch('/api/v1/journey', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: journeyHeaders(identity),
  })
  const payload = await readJson(response)
  return { state: normalizeJourneyEnvelope(payload, fallback), serverAvailable: true }
}

export async function patchJourney(
  identity: JourneyIdentity,
  state: JourneyWorkspaceView,
): Promise<JourneyApiResult> {
  const response = await journeyFetch('/api/v1/journey', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: {
      ...journeyHeaders(identity),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      workspaceId: identity.workspaceId,
      ...(identity.accessToken ? { accessToken: identity.accessToken } : {}),
      state,
    }),
  })
  const payload = await readJson(response)
  return { state: normalizeJourneyEnvelope(payload, state), serverAvailable: true }
}

export async function postJourneyMessage(
  identity: JourneyIdentity,
  state: JourneyWorkspaceView,
  message: string,
): Promise<JourneyApiResult> {
  const response = await journeyFetch('/api/v1/journey/chat', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      ...journeyHeaders(identity),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      workspaceId: identity.workspaceId,
      ...(identity.accessToken ? { accessToken: identity.accessToken } : {}),
      state,
      message,
    }),
  }, 45_000)
  const payload = await readJson(response)
  return { state: normalizeJourneyEnvelope(payload, state), serverAvailable: true }
}

export async function postJourneyDocument(
  identity: JourneyIdentity,
  state: JourneyWorkspaceView,
  file: File,
): Promise<JourneyApiResult> {
  const body = new FormData()
  body.set('workspaceId', identity.workspaceId)
  if (identity.accessToken) body.set('accessToken', identity.accessToken)
  body.set('state', JSON.stringify(state))
  body.set('file', file)

  const response = await journeyFetch('/api/v1/journey/documents', {
    method: 'POST',
    credentials: 'same-origin',
    headers: journeyHeaders(identity),
    body,
  }, 60_000)
  const payload = await readJson(response)
  return { state: normalizeJourneyEnvelope(payload, state), serverAvailable: true }
}

export async function createJourneyConnectCode(
  identity: JourneyIdentity,
): Promise<JourneyConnectCodeResult> {
  const response = await journeyFetch('/api/v1/journey/connect/code', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      ...journeyHeaders(identity),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      workspaceId: identity.workspaceId,
      ...(identity.accessToken ? { accessToken: identity.accessToken } : {}),
    }),
  })
  const payload = await readJson(response)
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root
  const code = stringValue(data?.code)
  const expiresAt = stringValue(data?.expiresAt)
  const workspaceId = stringValue(data?.workspaceId)
  if (!code || !expiresAt || !workspaceId || !Number.isFinite(Date.parse(expiresAt))) {
    throw new JourneyRequestError('Сервер вернул некорректный код подключения.')
  }
  if (workspaceId !== identity.workspaceId) {
    throw new JourneyRequestError('Сервер создал код для другого рабочего пространства.', 409)
  }
  return { code, expiresAt, workspaceId }
}

export async function redeemJourneyConnectCode(
  code: string,
  deviceLabel: string,
  fallback: JourneyWorkspaceView,
): Promise<JourneyDeviceRedeemResult> {
  const response = await journeyFetch('/api/v1/journey/connect/redeem', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceLabel }),
  })
  const payload = await readJson(response)
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root
  const workspaceId = stringValue(data?.workspaceId)
  if (!workspaceId) {
    throw new JourneyRequestError('Сервер не подтвердил рабочее пространство.')
  }
  const state = normalizeJourneyEnvelope(payload, { ...fallback, workspaceId })
  if (state.workspaceId !== workspaceId) {
    throw new JourneyRequestError('Ответ синхронизации относится к другому пространству.')
  }
  return { workspaceId, state }
}

export async function journeyFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = JOURNEY_REQUEST_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new JourneyRequestError(
        'Journey API не ответил вовремя. Повторите попытку.',
        503,
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function journeyHeaders(identity: JourneyIdentity): Record<string, string> {
  return {
    'x-journey-workspace-id': identity.workspaceId,
    ...(identity.accessToken ? { 'x-journey-access-token': identity.accessToken } : {}),
  }
}

async function readJson(response: Response): Promise<unknown> {
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    // The status below remains the useful signal when a proxy returns HTML.
  }

  if (!response.ok) {
    const record = asRecord(payload)
    const errorRecord = asRecord(record?.error)
    const message =
      stringValue(errorRecord?.message) ??
      stringValue(record?.message) ??
      (response.status === 404
        ? 'Journey API пока недоступен.'
        : `Journey API вернул ошибку ${response.status}.`)
    throw new JourneyRequestError(message, response.status)
  }

  return payload
}

/**
 * The server contract is schema-validated. This adapter only makes response
 * envelopes backwards-compatible while the isolated experiment evolves; it
 * never executes or renders model-provided code.
 */
export function normalizeJourneyEnvelope(
  payload: unknown,
  fallback: JourneyWorkspaceView,
): JourneyWorkspaceView {
  const root = asRecord(payload)
  const data = asRecord(root?.data)
  const stateValue = root?.state ?? data?.state ?? data?.workspace ?? root?.workspace ?? payload

  if (isJourneyWorkspaceView(stateValue)) {
    return sanitizeWorkspace(stateValue, fallback)
  }

  const state = asRecord(stateValue)
  if (!state) return withEnvelopeMeta(fallback, root, data)

  const messages = arrayValue(state.messages)
    .map(normalizeMessage)
    .filter((item): item is JourneyMessageView => item !== null)
  const factsSource =
    arrayValue(state.facts).length > 0
      ? arrayValue(state.facts)
      : [...arrayValue(state.confirmedFacts), ...arrayValue(state.pendingFacts)]
  const facts = factsSource
    .map(normalizeFact)
    .filter((item): item is JourneyFactView => item !== null)
  const goals = arrayValue(state.goals)
    .map(normalizeGoal)
    .filter((item): item is JourneyGoalView => item !== null)
  const roadmapSource = arrayValue(state.roadmap).length
    ? arrayValue(state.roadmap)
    : arrayValue(state.roadmapItems)
  const roadmap = roadmapSource
    .map(normalizeRoadmapItem)
    .filter((item): item is JourneyRoadmapView => item !== null)
  const widgets = arrayValue(state.widgets)
    .map(normalizeWidget)
    .filter((item): item is JourneyWidgetView => item !== null)
  const filesSource = arrayValue(state.files).length ? arrayValue(state.files) : arrayValue(state.documents)
  const files = filesSource
    .map(normalizeFile)
    .filter((item): item is JourneyFileView => item !== null)
  const suggestions = arrayValue(state.suggestions)
    .map(normalizeSuggestion)
    .filter((item): item is JourneySuggestionView => item !== null)

  const partial: JourneyWorkspaceView = {
    ...fallback,
    workspaceId: stringValue(state.workspaceId) ?? stringValue(state.id) ?? fallback.workspaceId,
    phase: phaseValue(state.phase) ?? fallback.phase,
    companyName:
      stringValue(state.companyName) ??
      stringValue(asRecord(state.profile)?.companyName) ??
      fallback.companyName,
    businessDescription:
      stringValue(state.businessDescription) ??
      stringValue(asRecord(state.profile)?.description) ??
      fallback.businessDescription,
    messages: messages.length > 0 ? messages : fallback.messages,
    facts: facts.length > 0 || Array.isArray(state.facts) ? facts : fallback.facts,
    goals: goals.length > 0 || Array.isArray(state.goals) ? goals : fallback.goals,
    roadmap: roadmap.length > 0 || Array.isArray(state.roadmap) ? roadmap : fallback.roadmap,
    widgets: widgets.length > 0 || Array.isArray(state.widgets) ? widgets : fallback.widgets,
    files: files.length > 0 || Array.isArray(state.files) ? files : fallback.files,
    suggestions:
      suggestions.length > 0 || Array.isArray(state.suggestions) ? suggestions : fallback.suggestions,
    updatedAt: stringValue(state.updatedAt) ?? new Date().toISOString(),
  }

  return withEnvelopeMeta(partial, root, data)
}

function sanitizeWorkspace(
  value: JourneyWorkspaceView,
  fallback: JourneyWorkspaceView,
): JourneyWorkspaceView {
  return {
    ...fallback,
    ...value,
    widgets: value.widgets.filter((widget) => isWidgetKind(widget.kind)).slice(0, 24),
    messages: value.messages.slice(-80),
    facts: value.facts.slice(0, 80),
    goals: value.goals.slice(0, 20),
    roadmap: value.roadmap.slice(0, 30),
    suggestions: value.suggestions.slice(0, 8),
    files: value.files.slice(0, 30),
  }
}

function withEnvelopeMeta(
  state: JourneyWorkspaceView,
  root: UnknownRecord | null,
  data: UnknownRecord | null,
): JourneyWorkspaceView {
  const provider = asRecord(root?.provider) ?? asRecord(data?.provider)
  const persistence = asRecord(root?.persistence) ?? asRecord(data?.persistence)
  const providerMode = providerModeValue(provider?.mode)
  const persistenceMode = persistenceModeValue(persistence?.mode)

  return {
    ...state,
    provider: provider
      ? {
          mode: providerMode ?? state.provider.mode,
          label: stringValue(provider.label) ?? labelForProvider(providerMode ?? state.provider.mode),
        }
      : state.provider,
    persistence: persistence
      ? {
          mode: persistenceMode ?? state.persistence.mode,
          label:
            stringValue(persistence.label) ??
            labelForPersistence(persistenceMode ?? state.persistence.mode),
          reason: stringValue(persistence.reason),
        }
      : state.persistence,
  }
}

function normalizeMessage(value: unknown): JourneyMessageView | null {
  const item = asRecord(value)
  if (!item) return null
  const text = stringValue(item.text) ?? stringValue(item.content)
  const role = item.role === 'user' || item.role === 'system' ? item.role : 'assistant'
  if (!text) return null
  return {
    id: stringValue(item.id) ?? makeId('message'),
    role,
    text,
    createdAt: stringValue(item.createdAt) ?? new Date().toISOString(),
  }
}

function normalizeFact(value: unknown): JourneyFactView | null {
  const item = asRecord(value)
  if (!item) return null
  const label = stringValue(item.label) ?? stringValue(item.key) ?? stringValue(item.name)
  const rawValue = item.value ?? item.v
  const factValue = scalarString(rawValue)
  if (!label || !factValue) return null
  const source = asRecord(item.source)
  const rawStatus = stringValue(item.status)
  return {
    id: stringValue(item.id) ?? makeId('fact'),
    label,
    value: factValue,
    category: factCategory(item.category) ?? factCategory(item.section) ?? 'business',
    sourceLabel:
      stringValue(item.sourceLabel) ?? stringValue(source?.label) ?? stringValue(source?.name) ?? 'AI',
    confidence: numberValue(item.confidence),
    status:
      rawStatus === 'confirmed' || item.confirmed === true
        ? 'confirmed'
        : rawStatus === 'rejected'
          ? 'rejected'
          : 'pending',
  }
}

function normalizeGoal(value: unknown): JourneyGoalView | null {
  const item = asRecord(value)
  if (!item) return null
  const title = stringValue(item.title) ?? stringValue(item.description)
  if (!title) return null
  return {
    id: stringValue(item.id) ?? makeId('goal'),
    title,
    metric: stringValue(item.metric),
    target: scalarString(item.target),
    deadline: stringValue(item.deadline) ?? stringValue(item.horizon),
    status: item.status === 'confirmed' || item.confirmed === true ? 'confirmed' : 'draft',
  }
}

function normalizeRoadmapItem(value: unknown): JourneyRoadmapView | null {
  const item = asRecord(value)
  if (!item) return null
  const title = stringValue(item.title) ?? stringValue(item.label)
  if (!title) return null
  const status = item.status === 'done' ? 'done' : item.status === 'next' || item.active === true ? 'next' : 'planned'
  return {
    id: stringValue(item.id) ?? makeId('roadmap'),
    title,
    description: stringValue(item.description) ?? '',
    horizon: stringValue(item.horizon) ?? stringValue(item.period) ?? 'Следующий этап',
    progress: clamp(numberValue(item.progress) ?? (status === 'done' ? 100 : 0), 0, 100),
    status,
    dependsOn: arrayValue(item.dependsOn).filter((entry): entry is string => typeof entry === 'string'),
  }
}

function normalizeWidget(value: unknown): JourneyWidgetView | null {
  const parsed = journeyWidgetSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function normalizeFile(value: unknown): JourneyFileView | null {
  const item = asRecord(value)
  if (!item) return null
  const name = stringValue(item.name) ?? stringValue(item.fileName)
  if (!name) return null
  const rawStatus = stringValue(item.status)
  const status: JourneyFileView['status'] =
    rawStatus === 'queued' ||
    rawStatus === 'uploading' ||
    rawStatus === 'analyzing' ||
    rawStatus === 'ready' ||
    rawStatus === 'local-only' ||
    rawStatus === 'error'
      ? rawStatus
      : rawStatus === 'processed' || rawStatus === 'parsed'
        ? 'ready'
        : 'analyzing'
  return {
    id: stringValue(item.id) ?? makeId('file'),
    name,
    sizeBytes: numberValue(item.sizeBytes) ?? numberValue(item.size) ?? 0,
    mime: stringValue(item.mime) ?? stringValue(item.mimeType) ?? '',
    status,
    statusLabel:
      stringValue(item.statusLabel) ??
      (status === 'ready' ? 'Анализ завершён' : status === 'error' ? 'Ошибка анализа' : 'Анализируется'),
    documentId: stringValue(item.documentId),
  }
}

function normalizeSuggestion(value: unknown): JourneySuggestionView | null {
  const item = asRecord(value)
  if (!item) return null
  const label = stringValue(item.label) ?? stringValue(item.text)
  if (!label) return null
  const target = item.target
  return {
    id: stringValue(item.id) ?? makeId('suggestion'),
    label,
    value: stringValue(item.value) ?? label,
    target:
      target === 'point-a' || target === 'roadmap' || target === 'point-b' || target === 'widget'
        ? target
        : 'chat',
    status: item.status === 'rejected' || item.status === 'hidden' ? item.status : 'active',
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 4000) : undefined
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === 'string') return stringValue(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function phaseValue(value: unknown): JourneyWorkspaceView['phase'] | undefined {
  return value === 'empty' ||
    value === 'loading' ||
    value === 'analyzing' ||
    value === 'partial' ||
    value === 'ready' ||
    value === 'error'
    ? value
    : undefined
}

function providerModeValue(value: unknown): ProviderMode | undefined {
  return value === 'live' || value === 'demo' || value === 'unavailable' ? value : undefined
}

function persistenceModeValue(value: unknown): PersistenceMode | undefined {
  if (value === 'db') return 'database'
  return value === 'database' || value === 'local' || value === 'unavailable' ? value : undefined
}

function factCategory(value: unknown): JourneyFactView['category'] | undefined {
  return value === 'business' ||
    value === 'product' ||
    value === 'clients' ||
    value === 'sales' ||
    value === 'marketing' ||
    value === 'finance' ||
    value === 'operations' ||
    value === 'team' ||
    value === 'goal' ||
    value === 'other'
    ? value
    : undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function labelForProvider(mode: ProviderMode): string {
  return mode === 'live' ? 'AI подключён' : mode === 'demo' ? 'Демо-логика' : 'AI недоступен'
}

function labelForPersistence(mode: PersistenceMode): string {
  return mode === 'database'
    ? 'Сохранено в базе'
    : mode === 'local'
      ? 'Сохранение на устройстве'
      : 'Без сохранения'
}

function titleForWidget(kind: JourneyWidgetView['kind']): string {
  const titles: Record<JourneyWidgetView['kind'], string> = {
    business_passport: 'Паспорт бизнеса',
    business_health: 'Здоровье бизнеса',
    point_b_goals: 'Точка B',
    roadmap_actions: 'Ближайшие действия',
    crm_readiness: 'CRM readiness',
    sales_funnel: 'Воронка продаж',
    marketing_growth: 'Маркетинг',
    finance_cashflow: 'Финансы',
    operations_team: 'Процессы и команда',
    risks_opportunities: 'Риски и возможности',
    news_digest: 'Новости',
    tasks_reminders: 'Задачи',
    learning_resources: 'Материалы',
    knowledge_base: 'База знаний',
    external_sources: 'Источники данных',
    domain_metrics: 'Отраслевые метрики',
    domain_process: 'Отраслевой процесс',
  }
  return titles[kind]
}
