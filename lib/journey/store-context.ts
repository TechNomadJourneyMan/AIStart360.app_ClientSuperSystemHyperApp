import { createClient } from '@/lib/supabase/server'
import { authorizeStore } from '@/lib/store/request'
import { loadStoreOverview } from '@/lib/store/loader'
import { hasOpenRouterKey } from '@/lib/ai/structured'
import { journeyWidgetSchema, type JourneyState, type JourneyWidget } from './schema'
import { buildStoreJourneyState } from './store-seed'
import { loadStoreJourneyOverlay, storeJourneyWorkspaceId, type StoredStoreJourney } from './store-persistence'

export class StoreJourneyAccessError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

export async function resolveStoreJourneyContext(request: Request) {
  const companyId = new URL(request.url).searchParams.get('companyId')
  const supabase = await createClient()
  const access = await authorizeStore(supabase, companyId)
  if (!access.ok) throw new StoreJourneyAccessError(access.error.status, access.error.code, access.error.message)
  const [overview, stored] = await Promise.all([
    loadStoreOverview(supabase, access.userId, access.company.id),
    loadStoreJourneyOverlay(access.userId, access.company.id),
  ])
  const live = buildStoreJourneyState(overview, { workspaceId: storeJourneyWorkspaceId(access.userId, access.company.id) })
  return { userId: access.userId, companyId: access.company.id, live, stored }
}

/** Store facts and widget payloads always come from the latest authorised read. */
export function rehydrateStoreJourney(live: JourneyState, stored: StoredStoreJourney): JourneyState {
  const layout = new Map(stored.overlay.layout.map((entry) => [entry.id, entry]))
  const planWidgets = storePlanWidgets(stored.overlay)
  const widgets = [...live.widgets, ...planWidgets]
  return {
    ...live,
    phase: stored.overlay.goals.some((goal) => goal.status === 'confirmed') ? 'ready' : live.phase,
    goals: stored.overlay.goals,
    roadmap: [...live.roadmap, ...stored.overlay.roadmap].slice(0, 30),
    messages: [...live.messages, ...stored.overlay.messages].slice(-80),
    widgets: widgets.map((widget) => ({ ...widget, ...layout.get(widget.id) })),
    widgetOrder: widgets.map((widget) => widget.id),
    provider: hasOpenRouterKey()
      ? { mode: 'live', label: 'AI подключён · данные магазина' }
      : { mode: 'unavailable', label: 'AI не подключён · цель можно задать вручную' },
    serverRevision: stored.revision,
  }
}

/** No model-authored metrics: these modules are projections of reviewed state. */
function storePlanWidgets(overlay: StoredStoreJourney['overlay']): JourneyWidget[] {
  const goal = [...overlay.goals].reverse().find((candidate) => candidate.status === 'confirmed')
  if (!goal) return []
  const kinds = overlay.planModules ?? ['point_b_goals', 'roadmap_actions', 'tasks_reminders']
  return [...new Set(kinds)].map((kind, index) => journeyWidgetSchema.parse({
    id: `widget:store:plan:${kind}`, kind, priority: 80 - index,
    title: { point_b_goals: 'Подтверждённая цель', roadmap_actions: 'План к цели', tasks_reminders: 'Задачи плана' }[kind],
    position: { x: 100 + index * 330, y: 860 }, collapsed: true, hidden: false, focused: false,
    data: kind === 'point_b_goals' ? { goals: [goal] }
      : kind === 'roadmap_actions' ? { items: overlay.roadmap.slice(0, 20) }
      : { items: overlay.roadmap.slice(0, 20).map((item) => ({ id: item.id, text: item.title, due: item.horizon, done: item.status === 'done' })) },
  }))
}
