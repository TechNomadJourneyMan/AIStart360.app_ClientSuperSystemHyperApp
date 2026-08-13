import {
  journeyStateSchema,
  type JourneyGoal,
  type JourneyState,
  type JourneySuggestion,
} from './schema'
import { newJourneyEntityId } from './demo'
import { STORE_POINT_B_CONFIRMATION_MESSAGE } from './store-goal-contract'

const CONFIRM_SUGGESTION_ID = 'journey:confirm-store-point-b'
const REVISE_SUGGESTION_ID = 'journey:revise-store-point-b'

export function isCompleteJourneyGoal(goal: JourneyGoal): boolean {
  return Boolean(goal.metric?.trim() && goal.target?.trim() && goal.deadline?.trim())
}

export function getLatestCompleteStoreDraftGoal(state: JourneyState): JourneyGoal | null {
  for (let index = state.goals.length - 1; index >= 0; index -= 1) {
    const goal = state.goals[index]
    if (goal?.status !== 'draft') continue
    // The confirmation UI always presents the newest draft. Never skip past a
    // newer incomplete candidate and confirm an older hidden goal instead.
    return isCompleteJourneyGoal(goal) ? goal : null
  }
  return null
}

/**
 * Converts only a newly proposed Store goal into a reviewable draft. All
 * transformation roadmap/modules are restored to their pre-turn snapshot;
 * Store's live operational "next action" may remain because it belongs to A.
 */
export function requireStoreGoalConfirmation(
  currentInput: JourneyState,
  proposedInput: JourneyState,
): JourneyState {
  const current = journeyStateSchema.parse(currentInput)
  const proposed = journeyStateSchema.parse(proposedInput)
  const currentGoals = new Map(current.goals.map((goal) => [goal.id, goal]))
  const proposedGoal = [...proposed.goals]
    .reverse()
    .find((goal) => {
      const previous = currentGoals.get(goal.id)
      return !previous || (previous.status === 'draft' && goal.status === 'confirmed')
    })

  if (!proposedGoal) {
    // No new goal does not authorize the model to materialize a transformation
    // plan. Until an already server-confirmed measurable B exists, retain only
    // the persisted A-side roadmap/widgets and preserve every reviewed draft
    // byte-for-byte.
    const hasAuthorizedPointB = current.goals.some((goal) => (
      goal.status === 'confirmed' && isCompleteJourneyGoal(goal)
    ))
    if (hasAuthorizedPointB) return proposed
    return journeyStateSchema.parse({
      ...proposed,
      phase: current.facts.length > 0 ? 'partial' : 'empty',
      facts: current.facts,
      goals: current.goals,
      roadmap: current.roadmap,
      widgets: current.widgets,
      widgetDecisions: current.widgetDecisions,
      manualWidgetIds: current.manualWidgetIds,
      widgetOrder: current.widgetOrder,
      files: current.files,
    })
  }

  const previousDraft = currentGoals.get(proposedGoal.id)
  // A model cannot rewrite a reviewed draft in place while confirming it.
  // Preserve the exact user-visible candidate until explicit confirmation.
  const draft: JourneyGoal = previousDraft?.status === 'draft'
    ? previousDraft
    : { ...proposedGoal, id: newJourneyEntityId('goal'), status: 'draft' }
  const goals = previousDraft
    ? current.goals.map((goal) => goal.id === draft.id ? draft : goal)
    : [...current.goals.slice(-19), draft]
  const messages = replaceLatestAssistantMessage(
    proposed.messages,
    isCompleteJourneyGoal(draft)
      ? `Точка B записана как черновик: «${draft.title}». Проверьте показатель, целевое значение и срок. Путь A→B появится только после отдельного подтверждения.`
      : 'Точка B сохранена как черновик. Чтобы её можно было подтвердить, уточните показатель, целевое значение и срок.',
  )

  return journeyStateSchema.parse({
    ...proposed,
    phase: current.facts.length > 0 ? 'partial' : 'empty',
    facts: current.facts,
    goals,
    roadmap: current.roadmap,
    widgets: current.widgets,
    widgetDecisions: current.widgetDecisions,
    manualWidgetIds: current.manualWidgetIds,
    widgetOrder: current.widgetOrder,
    files: current.files,
    messages,
    suggestions: draftSuggestions(draft),
  })
}

function draftSuggestions(goal: JourneyGoal): JourneySuggestion[] {
  const revise: JourneySuggestion = {
    id: REVISE_SUGGESTION_ID,
    label: 'Изменить формулировку',
    value: `Хочу изменить черновик Точки B: «${goal.title}».`,
    target: 'point-b',
    status: 'active',
  }
  if (!isCompleteJourneyGoal(goal)) return [revise]
  return [
    {
      id: CONFIRM_SUGGESTION_ID,
      label: 'Подтвердить Точку B',
      value: STORE_POINT_B_CONFIRMATION_MESSAGE,
      target: 'point-b',
      status: 'active',
    },
    revise,
  ]
}

function replaceLatestAssistantMessage(
  messages: JourneyState['messages'],
  text: string,
): JourneyState['messages'] {
  const next = [...messages]
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index]?.role !== 'assistant') continue
    next[index] = { ...next[index], text }
    return next
  }
  return next
}
