import { randomUUID } from 'node:crypto'
import { generateObjectViaOpenRouter, hasOpenRouterKey } from '@/lib/ai/structured'
import { deterministicOrchestrator } from './demo'
import { buildJourneyUserPrompt, JOURNEY_SYSTEM_PROMPT } from './prompt'
import { enforceJourneyStatePolicy } from './policy'
import {
  journeyAiUpdateSchema,
  journeyStateSchema,
  type JourneyAiUpdate,
  type JourneyFact,
  type JourneyState,
  type JourneyWidgetDecision,
  type JourneyWidget,
} from './schema'

export interface JourneyOrchestrationResult {
  state: JourneyState
  mode: 'live' | 'demo'
  fallbackReason?: 'missing_key' | 'invalid_ai_response'
}

export async function orchestrateJourneyTurn(
  currentInput: JourneyState,
  message: string,
): Promise<JourneyOrchestrationResult> {
  const current = journeyStateSchema.parse(currentInput)
  if (!hasOpenRouterKey()) {
    return {
      state: deterministicOrchestrator(current, message),
      mode: 'demo',
      fallbackReason: 'missing_key',
    }
  }

  const update = await generateObjectViaOpenRouter({
    system: JOURNEY_SYSTEM_PROMPT,
    user: buildJourneyUserPrompt(current, message),
    schema: journeyAiUpdateSchema,
    complexity: 'high',
    maxTokens: 3_500,
    temperature: 0.2,
    // Two validation attempts must still fit the route's 60s Function budget.
    timeoutMs: 20_000,
    label: 'journey-orchestrator',
  })

  if (!update) {
    return {
      state: deterministicOrchestrator(
        current,
        message,
        'AI-провайдер ответил, но результат не прошёл безопасную проверку. Использована детерминированная демо-логика.',
      ),
      mode: 'demo',
      fallbackReason: 'invalid_ai_response',
    }
  }

  let state: JourneyState
  try {
    state = enforceJourneyStatePolicy(mergeJourneyUpdate(current, message, update))
  } catch {
    return {
      state: deterministicOrchestrator(
        current,
        message,
        'AI-ответ ссылался на неподтверждённые данные или нарушил целостность A→B. Использована безопасная демо-логика.',
      ),
      mode: 'demo',
      fallbackReason: 'invalid_ai_response',
    }
  }
  return {
    state: journeyStateSchema.parse({
      ...state,
      provider: { mode: 'live', label: 'AI онлайн · проверенный structured output' },
    }),
    mode: 'live',
  }
}

export function mergeJourneyUpdate(
  currentInput: JourneyState,
  userMessage: string,
  updateInput: JourneyAiUpdate,
): JourneyState {
  const current = journeyStateSchema.parse(currentInput)
  const update = journeyAiUpdateSchema.parse(updateInput)
  const now = new Date().toISOString()
  const existingFacts = new Map(current.facts.map((fact) => [fact.id, fact]))

  for (const incoming of update.facts) {
    const previous = existingFacts.get(incoming.id)
    // A model can propose facts but cannot silently confirm them. Confirmation
    // is preserved only for a fact the user already confirmed in the UI.
    if (previous?.status === 'confirmed' || previous?.status === 'rejected') {
      existingFacts.set(incoming.id, previous)
      continue
    }
    const status: JourneyFact['status'] = 'pending'
    existingFacts.set(incoming.id, { ...incoming, status })
  }

  const facts = [...existingFacts.values()].slice(0, 80)
  assertDecisionEvidence(update.widgetDecisions, facts)
  const widgetMerge = mergeWidgets(
    current.widgets,
    update.widgets,
    update.widgetDecisions,
    current.manualWidgetIds ?? [],
  )
  const widgets = widgetMerge.widgets.slice(0, 24)

  return journeyStateSchema.parse({
    ...current,
    phase: update.phase,
    companyName: update.companyName ?? current.companyName,
    businessDescription: update.businessDescription ?? mergeBusinessContext(current.businessDescription, userMessage),
    messages: [
      ...current.messages,
      { id: `message-${randomUUID()}`, role: 'user', text: userMessage, createdAt: now },
      { id: `message-${randomUUID()}`, role: 'assistant', text: update.assistantMessage, createdAt: now },
    ].slice(-80),
    facts,
    goals: mergeGoals(current.goals, update.goals, userMessage).slice(0, 20),
    // A non-empty AI roadmap is a complete, schema-validated graph snapshot.
    // Mixing two snapshots can create duplicate ids or dangling dependencies.
    roadmap: (update.roadmap.length ? update.roadmap : current.roadmap).slice(0, 30),
    widgets,
    widgetDecisions: mergeWidgetDecisions(
      current.widgetDecisions ?? [],
      update.widgetDecisions,
      widgets,
      facts,
      widgetMerge.idMap,
    ),
    suggestions: update.suggestions,
    updatedAt: now,
  })
}

function mergeWidgetDecisions(
  current: JourneyWidgetDecision[],
  incoming: JourneyWidgetDecision[],
  widgets: JourneyWidget[],
  facts: JourneyFact[],
  normalizedIds: Map<string, string>,
): JourneyWidgetDecision[] {
  const widgetKinds = new Map(widgets.map((widget) => [widget.id, widget.kind]))
  const factIds = new Set(
    facts.filter((fact) => fact.status !== 'rejected').map((fact) => fact.id),
  )
  const merged = new Map(current.map((decision) => [decision.widgetId, decision]))
  for (const decision of incoming) {
    const widgetId = normalizedIds.get(decision.widgetId) ?? decision.widgetId
    merged.set(widgetId, {
      ...decision,
      widgetId,
    })
  }

  return [...merged.values()]
    .filter(
      (decision) =>
        widgetKinds.get(decision.widgetId) === decision.kind &&
        decision.evidenceFactIds.every((factId) => factIds.has(factId)),
    )
    .slice(0, 24)
}

function assertDecisionEvidence(
  decisions: JourneyWidgetDecision[],
  facts: JourneyFact[],
): void {
  const factsById = new Map(facts.map((fact) => [fact.id, fact]))
  for (const decision of decisions) {
    for (const factId of decision.evidenceFactIds) {
      const fact = factsById.get(factId)
      if (!fact || fact.status === 'rejected') {
        throw new Error(`Invalid widget evidence: ${factId}`)
      }
    }
  }
}

function mergeBusinessContext(current: string, message: string): string {
  const text = message.trim()
  if (!text || current.toLowerCase().includes(text.toLowerCase())) return current
  if (!/(?:страхов|полис|андеррайт|renewal\s*rate|помидор|овощ|магазин|crm|клиент|прода|команд|выруч)/i.test(text)) {
    return current
  }
  return [current, text].filter(Boolean).join('\n').slice(0, 4_000)
}

function mergeGoals(
  current: JourneyState['goals'],
  incoming: JourneyState['goals'],
  userMessage: string,
): JourneyState['goals'] {
  const merged = new Map(current.map((goal) => [goal.id, goal]))
  const userExplicitlyChangedGoal = /(?:цель|хочу|планир|открыть|увелич|сниз|достичь|вырасти)/i.test(userMessage)
  for (const goal of incoming) {
    const previous = merged.get(goal.id)
    // A confirmed Point B is user-owned. The model must propose a new goal id
    // for a revision; it may never mutate the confirmed goal in place.
    if (previous?.status === 'confirmed') {
      merged.set(goal.id, previous)
      continue
    }
    merged.set(goal.id, {
      ...goal,
      status: userExplicitlyChangedGoal ? goal.status : 'draft',
    })
  }
  return [...merged.values()]
}

function mergeWidgets(
  current: JourneyWidget[],
  incoming: JourneyWidget[],
  decisions: JourneyWidgetDecision[],
  manualWidgetIds: string[],
): { widgets: JourneyWidget[]; idMap: Map<string, string> } {
  const merged = new Map(current.map((item) => [item.kind, item]))
  const decisionsById = new Map(decisions.map((decision) => [decision.widgetId, decision]))
  const manualIds = new Set(manualWidgetIds)
  const idMap = new Map<string, string>()
  for (const item of incoming) {
    const previous = merged.get(item.kind)
    const resolvedId = previous?.id ?? item.id
    idMap.set(item.id, resolvedId)
    const shouldHide = decisionsById.get(item.id)?.action === 'hide' && !manualIds.has(resolvedId)
    merged.set(item.kind, previous
      ? {
          ...item,
          id: resolvedId,
          collapsed: previous.collapsed,
          hidden: shouldHide ? true : previous.hidden,
          focused: previous.focused,
          position: previous.position,
        } as JourneyWidget
      : { ...item, hidden: shouldHide || item.hidden } as JourneyWidget)
  }
  let expanded = 0
  const widgets = [...merged.values()]
    .sort((a, b) => b.priority - a.priority)
    .map((item) => {
      if (item.hidden || item.collapsed) return item
      expanded += 1
      return expanded <= 4 ? item : { ...item, collapsed: true } as JourneyWidget
    })
  return { widgets, idMap }
}
