import {
  isReservedJourneyWorkspaceId,
  storeJourneyWorkspaceId,
} from '@/lib/journey/auth-bootstrap'
import {
  JourneyAuthenticationError,
  storeJourneyDeviceCredentialFromRequest,
  withJourneyDeadline,
} from '@/lib/journey/http'
import {
  JourneyAccessError,
  JourneyPersistenceUnavailableError,
} from '@/lib/journey/persistence'
import {
  journeyStateSchema,
  journeyWidgetSchema,
  type JourneyFact,
  type JourneyIdentity,
  type JourneyRoadmapItem,
  type JourneyState,
  type JourneyWidget,
} from '@/lib/journey/schema'
import { MFA_COOKIE_NAME } from '@/lib/mfa/step-up'
import { createClient } from '@/lib/supabase/server'
import { hasStoreMfaStepUp, resolveStoreAccess } from '@/lib/store/access'
import { loadStoreOverview } from '@/lib/store/loader'
import type { StoreOverview } from '@/lib/store/types'

export const JOURNEY_CONTEXT_HEADER = 'x-journey-context'
export const STORE_JOURNEY_CONTEXT = 'store'

const STORE_FACT_PREFIX = 'fact:store:'
const STORE_MESSAGE_PREFIX = 'message:store:'
const STORE_ROADMAP_PREFIX = 'roadmap:store:'
const STORE_SUGGESTION_PREFIX = 'store:'
const STORE_WIDGET_PREFIX = 'widget:store:'

export interface ResolvedStoreJourneyContext {
  userId: string
  overview: StoreOverview
}

/** Bind Store Journey identity to the authenticated actor. Browser headers and
 * bodies may confirm the expected id, but can never select another workspace. */
export function storeJourneyIdentityFromRequest(
  request: Request,
  actorUserId: string,
  suppliedWorkspaceIds: Array<string | null | undefined> = [],
): JourneyIdentity {
  const workspaceId = storeJourneyWorkspaceId(actorUserId)
  const hints = [
    request.headers.get('x-journey-workspace-id'),
    ...suppliedWorkspaceIds,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
  if (hints.some((value) => value !== workspaceId)) {
    throw new JourneyAccessError('Store Journey workspace определяется только текущим аккаунтом.')
  }
  return {
    workspaceId,
    accessToken: storeJourneyDeviceCredentialFromRequest(request),
  }
}

/** Generic Journey endpoints must never become an alternate route into the
 * dedicated Store workspace, even when the Store context header is omitted. */
export function assertNotStoreJourneyWorkspace(
  workspaceId: string,
  _actorUserId: string | null,
): void {
  if (isReservedJourneyWorkspaceId(workspaceId)) {
    throw new JourneyAccessError('Используйте выделенный Store Journey endpoint.')
  }
}

/** The Store context is opt-in and exact. Unknown values stay on the standard
 * Journey path instead of silently broadening Store's stronger auth boundary. */
export function isStoreJourneyContext(request: Request): boolean {
  return request.headers.get(JOURNEY_CONTEXT_HEADER) === STORE_JOURNEY_CONTEXT
}

/** API routes bypass dashboard middleware, so Store Journey repeats the live
 * Supabase session, MFA and trusted profile checks before reading any facts. */
export async function resolveStoreJourneyContext(
  request: Request,
): Promise<ResolvedStoreJourneyContext> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await withJourneyDeadline(() => supabase.auth.getUser(), 10_000)

  if (error || !user) {
    throw new JourneyAuthenticationError('Для Store Journey требуется активный вход.')
  }
  if (!hasStoreMfaStepUp(user, requestCookie(request, MFA_COOKIE_NAME))) {
    throw new JourneyAccessError('Для Store Journey требуется подтверждение MFA.')
  }

  const access = await withJourneyDeadline(
    () => resolveStoreAccess(supabase, user.id),
    10_000,
  )
  if (access === 'forbidden') {
    throw new JourneyAccessError('Нет доступа к данным Store текущего аккаунта.')
  }
  if (access === 'unavailable') {
    throw new JourneyPersistenceUnavailableError('Проверка доступа к Store временно недоступна.')
  }

  try {
    const overview = await withJourneyDeadline(
      () => loadStoreOverview(supabase, user.id),
    )
    return { userId: user.id, overview }
  } catch (loadError) {
    if (loadError instanceof JourneyPersistenceUnavailableError) throw loadError
    console.error('[journey:store] overview load failed', loadError)
    throw new JourneyPersistenceUnavailableError('Опубликованные данные Store временно недоступны.')
  }
}

/** Overlay the latest server-owned Store projection onto the canonical Journey
 * workspace. User goals, dialog, roadmap and compatible modules survive, while
 * the browser cannot replace confirmed Store facts or widget content. */
export function rehydrateStoreJourneyState(
  overlayInput: JourneyState,
  liveInput: JourneyState,
): JourneyState {
  const overlay = journeyStateSchema.parse(overlayInput)
  const live = journeyStateSchema.parse(liveInput)
  if (overlay.workspaceId !== live.workspaceId) {
    throw new JourneyAccessError('Store Journey workspace ID не совпадает.')
  }

  // Store Point A is exclusively server-owned. Even a differently-labelled
  // browser fact could otherwise smuggle a competing financial assertion into
  // the orchestrator's grounded context.
  const facts = live.facts.filter(isStoreFact).slice(0, 80)

  const liveStoreWidgets = live.widgets.filter(isStoreWidget)
  const reservedKinds = new Set(liveStoreWidgets.map((widget) => widget.kind))
  const userWidgets = overlay.widgets
    .filter((widget) => !isStoreWidget(widget) && !reservedKinds.has(widget.kind))
    .map((widget) => STORE_TRANSFORMATION_WIDGET_KINDS.has(widget.kind)
      ? journeyWidgetSchema.parse({ ...widget, collapsed: true, focused: false })
      : widget)
  const widgets = [
    ...liveStoreWidgets.map((widget) => withStoredLayout(
      widget,
      overlay.widgets.find((candidate) => candidate.id === widget.id && candidate.kind === widget.kind),
    )),
    ...userWidgets,
  ].slice(0, 24)
  const widgetIds = new Set(widgets.map((widget) => widget.id))
  const factIds = new Set(facts.map((fact) => fact.id))

  const messages = uniqueById([
    ...live.messages.filter(isStoreMessage),
    ...overlay.messages.filter((message) => (
      !isStoreMessage(message) && !isWorkspaceWelcomeMessage(message.id, overlay.workspaceId)
    )),
  ]).slice(-80)

  const roadmap = normalizeRoadmapDependencies(uniqueById([
    ...live.roadmap.filter(isStoreRoadmapItem),
    ...overlay.roadmap.filter((item) => !isStoreRoadmapItem(item)),
  ]).slice(0, 30))

  const liveDecisions = (live.widgetDecisions ?? []).filter(
    (decision) => widgetIds.has(decision.widgetId),
  )
  const userDecisions = (overlay.widgetDecisions ?? [])
    .filter((decision) => !isStoreWidgetId(decision.widgetId))
    .filter((decision) => widgets.some(
      (widget) => widget.id === decision.widgetId && widget.kind === decision.kind,
    ))
    .map((decision) => ({
      ...decision,
      evidenceFactIds: decision.evidenceFactIds.filter((factId) => factIds.has(factId)),
    }))
  const widgetDecisions = uniqueById(
    [...liveDecisions, ...userDecisions],
    (decision) => decision.widgetId,
  ).slice(0, 24)

  const suggestions = uniqueById([
    ...live.suggestions.filter((suggestion) => isStoreSuggestionId(suggestion.id)),
    ...overlay.suggestions.filter((suggestion) => !isStoreSuggestionId(suggestion.id)),
  ]).slice(0, 8)

  const userOwnedOrder = uniqueIds([
    ...(overlay.widgetOrder ?? []),
    ...widgets.map((widget) => widget.id),
  ]).filter((id) => widgetIds.has(id)).slice(0, 24)
  const manualWidgetIds = uniqueIds(overlay.manualWidgetIds ?? [])
    .filter((id) => widgetIds.has(id))
    .slice(0, 24)

  const hasMeasurableGoal = overlay.goals.some(
    (goal) => goal.status === 'confirmed' && goal.metric && goal.target && goal.deadline,
  )
  const phase = hasMeasurableGoal && roadmap.length > 0
    ? 'ready'
    : facts.length > 0
      ? 'partial'
      : 'empty'

  return journeyStateSchema.parse({
    ...overlay,
    phase,
    companyName: live.companyName,
    businessDescription: live.businessDescription,
    messages,
    facts,
    roadmap,
    widgets,
    widgetDecisions,
    manualWidgetIds,
    widgetOrder: userOwnedOrder,
    suggestions,
  })
}

/** Strip the live projection before database persistence. Layout shells remain
 * so a user's arrangement survives, while owner-authored goals/messages stay
 * verbatim even when they independently mention the same small number. */
export function redactStoreJourneyState(input: JourneyState): JourneyState {
  const state = journeyStateSchema.parse(input)
  const sensitiveValues = collectSensitiveStoreValues(state)
  const facts = state.facts.filter((fact) => !isStoreFact(fact))
  const factIds = new Set(facts.map((fact) => fact.id))
  const widgets = state.widgets.flatMap((widget) => {
    if (isStoreWidget(widget)) return redactStoreWidget(widget)
    if (widget.kind === 'business_passport') {
      return [journeyWidgetSchema.parse({ ...widget, data: { facts: [] } })]
    }
    // Only user-visible text fields may contain a copied live Store value.
    // Structural strings (ids, URLs, ISO dates, enum values, document ids)
    // must remain byte-for-byte stable or the widget could be corrupted and
    // silently disappear during persistence.
    const scrubbed = scrubSensitiveWidgetPayload(widget, sensitiveValues)
    return [journeyWidgetSchema.parse(scrubbed)]
  })
  const widgetIds = new Set(widgets.map((widget) => widget.id))
  const widgetDecisions = (state.widgetDecisions ?? [])
    .filter((decision) => widgetIds.has(decision.widgetId))
    .map((decision) => ({
      ...decision,
      evidenceFactIds: decision.evidenceFactIds.filter((factId) => factIds.has(factId)),
    }))

  const redacted = {
    ...state,
    companyName: '',
    businessDescription: '',
    messages: state.messages.filter((message) => !isStoreMessage(message)),
    facts,
    roadmap: state.roadmap.filter((item) => !isStoreRoadmapItem(item)),
    widgets,
    widgetDecisions,
    suggestions: state.suggestions.filter(
      (suggestion) => !isStoreSuggestionId(suggestion.id),
    ),
  }
  return journeyStateSchema.parse(redacted)
}

function withStoredLayout(live: JourneyWidget, stored?: JourneyWidget): JourneyWidget {
  if (!stored || stored.kind !== live.kind) return live
  return journeyWidgetSchema.parse({
    ...live,
    collapsed: stored.collapsed,
    hidden: stored.hidden,
    focused: stored.focused,
    position: stored.position,
  })
}

function redactStoreWidget(widget: JourneyWidget): JourneyWidget {
  const base = {
    ...widget,
    title: 'Store · live data',
  }
  switch (widget.kind) {
    case 'finance_cashflow':
      return journeyWidgetSchema.parse({
        ...base,
        data: {
          metrics: [],
          sourceStatus: 'missing',
          nextQuestion: 'Live-данные загружаются с сервера.',
        },
      })
    case 'domain_metrics':
      return journeyWidgetSchema.parse({
        ...base,
        data: {
          domain: 'Store Control Center',
          purpose: 'Live-данные загружаются с сервера.',
          metrics: [{
            label: 'Опубликованные данные',
            status: 'unknown',
            sourceLabel: 'Только сервер',
          }],
          guidance: [],
        },
      })
    case 'domain_process':
      return journeyWidgetSchema.parse({
        ...base,
        data: {
          domain: 'Store Control Center',
          purpose: 'Live-данные загружаются с сервера.',
          stages: [{
            id: 'store:redacted',
            name: 'Опубликованные источники',
            status: 'unknown',
            nextAction: 'Загрузить с сервера',
          }],
        },
      })
    case 'risks_opportunities':
      return journeyWidgetSchema.parse({
        ...base,
        data: { risks: [], opportunities: [] },
      })
    default:
      // Store currently emits only the four allowlisted kinds above. Failing
      // closed prevents a future Store widget from being persisted unredacted.
      throw new JourneyAccessError(`Store widget kind ${widget.kind} не имеет redaction policy.`)
  }
}

function collectSensitiveStoreValues(state: JourneyState): string[] {
  const values = new Set<string>()
  if (state.companyName) addSensitiveValue(values, state.companyName)
  for (const fact of state.facts.filter(isStoreFact)) {
    addSensitiveValue(values, fact.value)
    addSensitiveValue(values, fact.sourceLabel)
  }
  for (const widget of state.widgets.filter(isStoreWidget)) {
    collectNumericStrings(widget.data, values)
  }
  return [...values]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
}

function addSensitiveValue(output: Set<string>, value: string): void {
  if (!value) return
  output.add(value)
  if (!/\d/.test(value)) return
  output.add(value.replace(/\u00a0/g, ' '))
  const compact = value.replace(/[\s\u00a0]/g, '')
  output.add(compact)
  output.add(compact.replace(/[₸%]/g, ''))
  output.add(compact.replace(',', '.'))
  output.add(compact.replace(/[₸%]/g, '').replace(',', '.'))
}

function collectNumericStrings(value: unknown, output: Set<string>): void {
  if (typeof value === 'string') {
    if (/\d/.test(value)) addSensitiveValue(output, value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectNumericStrings(item, output))
    return
  }
  if (!value || typeof value !== 'object') return
  Object.values(value as Record<string, unknown>)
    .forEach((item) => collectNumericStrings(item, output))
}

const SCRUBBABLE_WIDGET_TEXT_KEYS = new Set([
  'basis',
  'currentTool',
  'description',
  'detail',
  'domain',
  'horizon',
  'label',
  'metric',
  'name',
  'nextAction',
  'nextQuestion',
  'nextStep',
  'purpose',
  'reason',
  'source',
  'sourceLabel',
  'statusLabel',
  'statusText',
  'target',
  'text',
  'title',
  'value',
])

function scrubSensitiveWidgetPayload(
  value: unknown,
  sensitiveValues: string[],
  fieldName?: string,
): unknown {
  if (typeof value === 'string') {
    if (!fieldName || !SCRUBBABLE_WIDGET_TEXT_KEYS.has(fieldName)) return value
    let scrubbed = value.replace(/fact:store:[a-zA-Z0-9:_-]+/g, '[Store fact]')
    for (const sensitive of sensitiveValues) {
      if (/^\d{1,2}$/.test(sensitive)) {
        scrubbed = scrubbed.replace(
          new RegExp(`(?<!\\d)${sensitive}(?!\\d)`, 'g'),
          '[Store live]',
        )
      } else {
        scrubbed = sensitive.length < 3
          ? scrubbed === sensitive ? '[Store live]' : scrubbed
          : scrubbed.split(sensitive).join('[Store live]')
      }
    }
    return scrubbed
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubSensitiveWidgetPayload(item, sensitiveValues, fieldName))
  }
  if (!value || typeof value !== 'object') return value

  const source = value as Record<string, unknown>
  const scrubbed = Object.fromEntries(
    Object.entries(source).map(([key, item]) => [
      key,
      scrubSensitiveWidgetPayload(item, sensitiveValues, key),
    ]),
  )
  if (source.status === 'known' && typeof source.value === 'string') {
    delete scrubbed.value
    scrubbed.status = 'unknown'
    scrubbed.sourceLabel = 'Store live · загружается с сервера'
  }
  return scrubbed
}

function isStoreFact(fact: JourneyFact): boolean {
  return fact.id.startsWith(STORE_FACT_PREFIX) ||
    fact.sourceLabel.toLowerCase().startsWith('store control center')
}

function isStoreMessage(message: { id: string }): boolean {
  return message.id.startsWith(STORE_MESSAGE_PREFIX)
}

function isStoreRoadmapItem(item: { id: string }): boolean {
  return item.id.startsWith(STORE_ROADMAP_PREFIX)
}

function isStoreWidget(widget: { id: string }): boolean {
  return isStoreWidgetId(widget.id)
}

// The canonical Store canvas already renders Point B and the A→B roadmap in
// its primary path. Their duplicate widget representations stay available in
// the module dock, but collapsed so the four live Store control modules remain
// simultaneously readable at the 1440×900 acceptance viewport.
const STORE_TRANSFORMATION_WIDGET_KINDS = new Set<JourneyWidget['kind']>([
  'point_b_goals',
  'roadmap_actions',
  'tasks_reminders',
])

function isStoreWidgetId(id: string): boolean {
  return id.startsWith(STORE_WIDGET_PREFIX)
}

function isStoreSuggestionId(id: string): boolean {
  return id.startsWith(STORE_SUGGESTION_PREFIX)
}

function isWorkspaceWelcomeMessage(id: string, workspaceId: string): boolean {
  return id === `welcome-${workspaceId}`.replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 120)
}

function requestCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    const raw = part.slice(separator + 1).trim()
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return undefined
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values)]
}

function uniqueById<T extends { id: string }>(values: T[]): T[]
function uniqueById<T>(values: T[], getId: (value: T) => string): T[]
function uniqueById<T extends { id: string }>(
  values: T[],
  getId: (value: T) => string = (value) => value.id,
): T[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const id = getId(value)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function normalizeRoadmapDependencies(items: JourneyRoadmapItem[]): JourneyRoadmapItem[] {
  const prior = new Set<string>()
  return items.map((item) => {
    const normalized = {
      ...item,
      ...(item.dependsOn
        ? { dependsOn: item.dependsOn.filter((dependency) => prior.has(dependency)) }
        : {}),
    }
    prior.add(item.id)
    return normalized
  })
}
