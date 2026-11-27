import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { hasOpenRouterKey } from '@/lib/ai/structured'
import { isRateLimited, isRateLimitedKey } from '@/lib/rate-limit'
import { journeyErrorResponse } from './http'
import { JourneyConflictError } from './persistence'
import { orchestrateJourneyTurn } from './orchestrator'
import { journeyGoalSchema, type JourneyGoal, type JourneyRoadmapItem, type JourneyState } from './schema'
import { resolveStoreJourneyContext, rehydrateStoreJourney, StoreJourneyAccessError } from './store-context'
import { saveStoreJourneyOverlay, storeLayoutSchema, type StoreJourneyOverlay } from './store-persistence'

const HEADERS = { 'cache-control': 'private, no-store, max-age=0', vary: 'Cookie' }
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const measurableGoalSchema = z.object({
  metric: z.string().trim().min(1).max(160),
  target: z.string().trim().min(1).max(160).regex(/\d/, 'Укажите измеримое целевое значение.'),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'Укажите существующую дату.'),
}).strict()
const mutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('layout'), revision, layout: z.array(storeLayoutSchema).max(24) }).strict(),
  z.object({ action: z.literal('draft-goal'), revision, goal: measurableGoalSchema }).strict(),
  z.object({ action: z.literal('confirm-goal'), revision, goalId: z.string().min(1).max(120) }).strict(),
  z.object({ action: z.literal('roadmap-status'), revision, itemId: z.string().min(1).max(120), done: z.boolean() }).strict(),
])
const chatSchema = z.object({ revision, message: z.string().trim().min(1).max(4000) }).strict()

function checkOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new StoreJourneyAccessError(403, 'store_journey_origin', 'Откройте путь магазина на сайте AIStart360.')
  }
}

function failure(error: unknown) {
  if (error instanceof StoreJourneyAccessError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers: HEADERS })
  const response = journeyErrorResponse(error)
  for (const [key, value] of Object.entries(HEADERS)) response.headers.set(key, value)
  return response
}

export async function getStoreJourney(request: Request) {
  try {
    const context = await resolveStoreJourneyContext(request)
    return NextResponse.json({ state: rehydrateStoreJourney(context.live, context.stored) }, { headers: HEADERS })
  } catch (error) { return failure(error) }
}

export async function patchStoreJourney(request: Request) {
  try {
    checkOrigin(request)
    const context = await resolveStoreJourneyContext(request)
    const payload = mutationSchema.parse(await request.json())
    if (payload.revision !== context.stored.revision) throw new JourneyConflictError(context.stored.revision)
    let overlay = context.stored.overlay
    if (payload.action === 'layout') {
      const liveIds = new Set(rehydrateStoreJourney(context.live, context.stored).widgets.map((widget) => widget.id))
      if (new Set(payload.layout.map((entry) => entry.id)).size !== payload.layout.length || payload.layout.some((entry) => !liveIds.has(entry.id))) {
        throw new StoreJourneyAccessError(400, 'store_layout_invalid', 'В раскладке есть неизвестный модуль.')
      }
      overlay = { ...overlay, layout: payload.layout }
    } else if (payload.action === 'draft-goal') {
      const { metric, target, deadline } = payload.goal
      const goal = journeyGoalSchema.parse({ id: `goal-${randomUUID()}`, title: `${metric}: ${target} к ${deadline}`, metric, target, deadline, status: 'draft' })
      overlay = { ...overlay, goals: appendStoreGoal(overlay.goals, goal) }
    } else if (payload.action === 'roadmap-status') {
      if (!overlay.roadmap.some((item) => item.id === payload.itemId)) throw new StoreJourneyAccessError(404, 'store_task_missing', 'Шаг плана не найден. Обновите доску.')
      overlay = { ...overlay, roadmap: overlay.roadmap.map((item) => item.id === payload.itemId
        ? { ...item, status: payload.done ? 'done' as const : 'planned' as const, progress: payload.done ? 100 : 0 }
        : item) }
    } else {
      const candidate = overlay.goals.at(-1)
      const details = measurableGoalSchema.safeParse({ metric: candidate?.metric, target: candidate?.target, deadline: candidate?.deadline })
      if (!candidate || candidate.status !== 'draft' || candidate.id !== payload.goalId || !details.success) {
        throw new StoreJourneyAccessError(409, 'store_goal_changed', 'Черновик цели изменился. Обновите доску и проверьте его снова.')
      }
      overlay = {
        ...overlay, goals: overlay.goals.map((goal) => goal.id === candidate.id ? { ...goal, ...details.data, status: 'confirmed' as const } : goal),
        roadmap: [{ id: `roadmap-${randomUUID()}`, title: 'Определить первый шаг к цели',
          description: `Для цели «${candidate.title}» выберите действие и ответственного. Прогноз результата пока не рассчитан.`,
          horizon: details.data.deadline, progress: 0, status: 'next' }],
        planModules: ['point_b_goals', 'roadmap_actions', 'tasks_reminders'],
      }
      overlay = await prepareConfirmedStorePlan(context.live, overlay, payload.revision)
    }
    const nextRevision = await saveStoreJourneyOverlay(context.userId, context.companyId, overlay, payload.revision)
    return NextResponse.json({ state: rehydrateStoreJourney(context.live, { overlay, revision: nextRevision }) }, { headers: HEADERS })
  } catch (error) { return failure(error) }
}

export async function postStoreJourneyChat(request: Request) {
  try {
    checkOrigin(request)
    const context = await resolveStoreJourneyContext(request)
    const payload = chatSchema.parse(await request.json())
    if (payload.revision !== context.stored.revision) throw new JourneyConflictError(context.stored.revision)
    if (await isRateLimited(request, 'journey-store-chat-ip', { max: 30, windowMs: 60 * 60_000 }) ||
        await isRateLimitedKey(context.live.workspaceId, 'journey-store-chat-owner', { max: 12, windowMs: 60_000 })) {
      return NextResponse.json({ error: { code: 'JOURNEY_RATE_LIMIT', message: 'Слишком много сообщений. Попробуйте через минуту.' } }, { status: 429, headers: HEADERS })
    }
    if (!hasOpenRouterKey()) throw new StoreJourneyAccessError(503, 'store_ai_unavailable', 'AI сейчас не подключён. Задайте цель вручную; опубликованные данные доступны на доске.')
    const current = rehydrateStoreJourney(context.live, context.stored)
    const result = await orchestrateJourneyTurn(current, payload.message)
    if (result.mode !== 'live') throw new StoreJourneyAccessError(503, 'store_ai_unavailable', 'AI не ответил достоверно. Данные и подтверждённая цель сохранены без изменений.')
    const overlay = reviewedStoreProposal(context.stored.overlay, current, result.state)
    const nextRevision = await saveStoreJourneyOverlay(context.userId, context.companyId, overlay, payload.revision)
    return NextResponse.json({ state: rehydrateStoreJourney(context.live, { overlay, revision: nextRevision }) }, { headers: HEADERS })
  } catch (error) { return failure(error) }
}

/** The model may suggest a goal; only the explicit confirmation action can approve it. */
export function reviewedStoreProposal(overlay: StoreJourneyOverlay, current: JourneyState, proposed: JourneyState): StoreJourneyOverlay {
  const previousIds = new Set(current.goals.map((goal) => goal.id))
  const goal = [...proposed.goals].reverse().find((candidate) => !previousIds.has(candidate.id))
  const sourceIds = new Set(current.messages.map((message) => message.id))
  const newMessages = proposed.messages.filter((message) => !sourceIds.has(message.id) && message.role !== 'system')
  if (goal) {
    const lastAssistant = newMessages.findLastIndex((message) => message.role === 'assistant')
    if (lastAssistant >= 0) newMessages[lastAssistant] = {
      ...newMessages[lastAssistant], text: `Предложен черновик Точки B: «${goal.title}». Проверьте метрику, целевое значение и точную дату в карточке цели. Подтвердите цель отдельной кнопкой.`,
    }
  }
  return {
    ...overlay,
    goals: goal ? appendStoreGoal(overlay.goals, { ...goal, id: `goal-${randomUUID()}`, status: 'draft' }) : overlay.goals,
    messages: [...overlay.messages, ...newMessages].slice(-60),
    // Business facts, widget payloads and confirmed plans never come from the browser/model.
    roadmap: overlay.roadmap,
  }
}

/** Keep the current confirmed goal while bounding review history. */
function appendStoreGoal(goals: JourneyGoal[], goal: JourneyGoal): JourneyGoal[] {
  const confirmed = [...goals].reverse().find((item) => item.status === 'confirmed')
  return [...(confirmed ? [confirmed] : []), ...goals.slice(-18).filter((item) => item.id !== confirmed?.id), goal]
}

async function prepareConfirmedStorePlan(live: JourneyState, overlay: StoreJourneyOverlay, currentRevision: number): Promise<StoreJourneyOverlay> {
  let message = 'Точка B подтверждена. AI сейчас не подключён; сохранён первый шаг для самостоятельного планирования.'
  let next = overlay
  if (hasOpenRouterKey()) {
    message = 'Точка B подтверждена. AI не подготовил проверяемый план; сохранён первый шаг. Подтверждённая цель и данные магазина сохранены.'
    try {
      if (!await isRateLimitedKey(live.workspaceId, 'journey-store-plan', { max: 12, windowMs: 60 * 60_000 })) {
        const current = rehydrateStoreJourney(live, { overlay, revision: currentRevision })
        const goal = overlay.goals.at(-1)!
        const result = await orchestrateJourneyTurn(current,
          `Владелец отдельно подтвердил Точку B: «${goal.title}». Составь выполнимую дорожную карту к этой цели и выбери модули целей, дорожной карты и задач. Используй только подтверждённую Точку A; неизвестные показатели оставь неизвестными. Все новые шаги ещё не выполнены. Не меняй подтверждённую цель и не придумывай прогноз результата.`)
        if (result.mode === 'live') {
          const roadmap = validatedStorePlan(current, result.state)
          if (roadmap.length) {
            next = { ...overlay, roadmap }
            message = `Точка B подтверждена. AI предложил план. Шагов в плане: ${roadmap.length}. Это рекомендации; отметки выполнения ставьте после реальной работы. Прогноз показателей пока не рассчитан.`
          }
        }
      } else {
        message = 'Точка B подтверждена. Лимит подготовки AI-планов временно исчерпан; сохранён первый шаг для самостоятельного планирования.'
      }
    } catch { /* Confirmation still succeeds; a failed model never fabricates a plan. */ }
  }
  return { ...next, messages: [...next.messages, {
    id: `message-${randomUUID()}`, role: 'assistant' as const, text: message, createdAt: new Date().toISOString(),
  }].slice(-60) }
}

/** Accept plan text only. Never accept AI facts, metric payloads or completed work. */
export function validatedStorePlan(current: JourneyState, proposed: JourneyState): JourneyRoadmapItem[] {
  const currentItems = new Map(current.roadmap.map((item) => [item.id, item]))
  const candidates = [...new Map(proposed.roadmap.filter((item) => {
    if (item.id.startsWith('roadmap:store:')) return false
    const previous = currentItems.get(item.id)
    return !previous || item.title !== previous.title || item.description !== previous.description || item.horizon !== previous.horizon
  }).slice(0, 28).map((item) => [item.id, item])).values()]
  const remaining = new Map(candidates.map((item) => [item.id, item]))
  const sorted: JourneyRoadmapItem[] = []
  // Topologically order known dependencies; a cyclic proposal is not a usable plan.
  while (remaining.size) {
    const ready = [...remaining.values()].filter((item) => !(item.dependsOn ?? []).some((id) => remaining.has(id)))
    if (!ready.length) return []
    for (const item of ready) { sorted.push(item); remaining.delete(item.id) }
  }
  const ids = new Map(sorted.map((item) => [item.id, `roadmap-${randomUUID()}`]))
  return sorted.map((item, index) => ({
    ...item, id: ids.get(item.id)!, progress: 0, status: index === 0 ? 'next' : 'planned',
    dependsOn: (item.dependsOn ?? []).filter((id) => ids.has(id)).map((id) => ids.get(id)!),
  }))
}
