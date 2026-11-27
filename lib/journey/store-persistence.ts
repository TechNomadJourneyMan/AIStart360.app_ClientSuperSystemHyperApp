import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase-service'
import { JourneyConflictError, JourneyPersistenceUnavailableError } from './persistence'
import { journeyGoalSchema, journeyMessageSchema, journeyRoadmapItemSchema } from './schema'

export const storeLayoutSchema = z.object({
  id: z.string().max(120), collapsed: z.boolean(), hidden: z.boolean(), focused: z.boolean(),
  position: z.object({ x: z.number().min(0).max(1600), y: z.number().min(0).max(1000) }).strict(),
}).strict()

const overlaySchema = z.object({
  kind: z.literal('store-v2'), companyId: z.string().min(1).max(200),
  goals: z.array(journeyGoalSchema).max(20),
  roadmap: z.array(journeyRoadmapItemSchema).max(30),
  messages: z.array(journeyMessageSchema).max(60),
  layout: z.array(storeLayoutSchema).max(24),
  /** Module kinds only: payloads are rebuilt from the confirmed goal and plan. */
  planModules: z.array(z.enum(['point_b_goals', 'roadmap_actions', 'tasks_reminders'])).max(3).optional(),
}).strict()

export type StoreJourneyOverlay = z.infer<typeof overlaySchema>
export type StoredStoreJourney = { overlay: StoreJourneyOverlay; revision: number }

/** The client cannot select a workspace or obtain a generic Journey credential. */
export function storeJourneyWorkspaceId(userId: string, companyId: string): string {
  return `store-v2:${createHash('sha256').update(JSON.stringify([userId, companyId])).digest('hex')}`
}

export function emptyStoreOverlay(companyId: string): StoreJourneyOverlay {
  return { kind: 'store-v2', companyId, goals: [], roadmap: [], messages: [], layout: [] }
}

export async function loadStoreJourneyOverlay(userId: string, companyId: string): Promise<StoredStoreJourney> {
  const client = createServiceClient()
  const { data, error } = await client.from('ai_journey_workspaces')
    .select('state,revision').eq('workspace_key', storeJourneyWorkspaceId(userId, companyId)).eq('user_id', userId).maybeSingle()
  if (error) throw new JourneyPersistenceUnavailableError('Сохранение пути магазина временно недоступно.')
  if (!data) return { overlay: emptyStoreOverlay(companyId), revision: 0 }
  const parsed = overlaySchema.safeParse(data.state)
  if (!parsed.success || parsed.data.companyId !== companyId) {
    throw new JourneyPersistenceUnavailableError('Сохранённый путь магазина требует проверки. Данные не заменены.')
  }
  return { overlay: parsed.data, revision: Number(data.revision) }
}

/** Only plans/dialog/layout are stored; current financial facts are never copied. */
export async function saveStoreJourneyOverlay(userId: string, companyId: string, input: StoreJourneyOverlay, expectedRevision: number): Promise<number> {
  const overlay = overlaySchema.parse(input)
  if (overlay.companyId !== companyId) throw new JourneyPersistenceUnavailableError('Компания рабочего пространства не совпадает.')
  const client = createServiceClient()
  const key = storeJourneyWorkspaceId(userId, companyId)
  const payload = { state: overlay, revision: expectedRevision + 1, updated_at: new Date().toISOString() }
  if (expectedRevision === 0) {
    const { error } = await client.from('ai_journey_workspaces').insert({
      ...payload, workspace_key: key, user_id: userId,
      // Discarded immediately. Generic Journey/token routes cannot open this scope.
      access_token_hash: randomBytes(32).toString('hex'), phase: 'partial',
      profile: {}, facts: [], goals: [], roadmap: [], widget_state: [],
    })
    if (error?.code === '23505') throw new JourneyConflictError(expectedRevision)
    if (error) throw new JourneyPersistenceUnavailableError('Не удалось сохранить путь магазина.')
    return 1
  }
  const { data, error } = await client.from('ai_journey_workspaces').update(payload)
    .eq('workspace_key', key).eq('user_id', userId).eq('revision', expectedRevision).select('revision').maybeSingle()
  if (error) throw new JourneyPersistenceUnavailableError('Не удалось сохранить путь магазина.')
  if (!data) throw new JourneyConflictError(expectedRevision)
  return Number(data.revision)
}
