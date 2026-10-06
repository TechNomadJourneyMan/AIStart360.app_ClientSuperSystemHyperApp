/**
 * lib/events/platform.ts — emit a platform domain event.
 *
 * The event is written to the platform_events outbox (086) and dispatched at
 * once: every agent subscribed to it gets a task (idempotent per event), and
 * the notification router (lib/notifications/event-router.ts) decides whether
 * a human should hear about it. A
 * failed dispatch is recorded on the row and retried by the maintenance job.
 */
import { Prisma } from '@prisma/client'
import { runInBackground } from '@/lib/background'
import { prisma } from '@/lib/db'
import type { PlatformEventName } from './platform-names'

export interface PlatformEventInput {
  name: PlatformEventName
  companyId?: string | null
  subjectType?: string | null
  subjectId?: string | null
  actor?: string | null
  payload?: Record<string, unknown>
  /** Same key ⇒ same event (no duplicate tasks / notifications). */
  dedupeKey?: string | null
}

export interface PlatformEventRow {
  id: number
  name: PlatformEventName
  company_id: string | null
  subject_type: string | null
  subject_id: string | null
  actor: string | null
  payload: Record<string, unknown>
}

export type EventListener = (event: PlatformEventRow) => Promise<void>

const listeners: EventListener[] = []

/** Extra consumers (notifications) register here; agents are wired by default. */
export function onPlatformEvent(listener: EventListener): void {
  if (!listeners.includes(listener)) listeners.push(listener)
}

export async function emitPlatformEvent(e: PlatformEventInput): Promise<{ id: number; duplicate: boolean }> {
  const rows = await prisma.$queryRaw<PlatformEventRow[]>`
    INSERT INTO public.platform_events (name, company_id, subject_type, subject_id, actor, payload, dedupe_key)
    VALUES (${e.name}, ${e.companyId ?? null}, ${e.subjectType ?? null}, ${e.subjectId ?? null},
            ${e.actor ?? null}, ${JSON.stringify(e.payload ?? {})}::jsonb, ${e.dedupeKey ?? null})
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id, name, company_id, subject_type, subject_id, actor, payload`
  const row = rows[0]
  if (!row) {
    const existing = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM public.platform_events WHERE dedupe_key = ${e.dedupeKey ?? null}`
    return { id: Number(existing[0]?.id ?? 0), duplicate: true }
  }
  await dispatchEvent({ ...row, id: Number(row.id) })
  return { id: Number(row.id), duplicate: false }
}

/** Fan an event out to subscribed agents and listeners; record the outcome. */
export async function dispatchEvent(event: PlatformEventRow): Promise<void> {
  const errors: string[] = []
  try {
    const { agentsSubscribedTo } = await import('@/lib/agents/registry')
    const { enqueueAgentTask } = await import('@/lib/agents/queue')
    for (const agent of agentsSubscribedTo(event.name)) {
      if (agent.scope === 'company' && !event.company_id) continue
      try {
        await enqueueAgentTask({
          agentKey: agent.key,
          companyId: agent.scope === 'company' ? event.company_id : null,
          trigger: 'event',
          triggerRef: event.name,
          requestedBy: event.actor ?? 'system',
          input: { event: { id: event.id, name: event.name, subject_type: event.subject_type, subject_id: event.subject_id, payload: event.payload } },
          idempotencyKey: `event:${event.id}:${agent.key}`,
        })
      } catch (err) {
        errors.push(`${agent.key}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    errors.push(`agents: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    const { routeEventToStaff } = await import('@/lib/notifications/event-router')
    await routeEventToStaff(event)
  } catch (err) {
    errors.push(`notifications: ${err instanceof Error ? err.message : String(err)}`)
  }
  for (const listener of listeners) {
    try {
      await listener(event)
    } catch (err) {
      errors.push(`listener: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  await prisma.$executeRaw`
    UPDATE public.platform_events
    SET dispatched_at = now(), dispatch_error = ${errors.length ? errors.join('; ').slice(0, 1000) : null}
    WHERE id = ${event.id}`
}

/** Re-dispatch events whose dispatch never completed (crash between insert and dispatch). */
export async function redispatchPending(limit = 50): Promise<number> {
  const rows = await prisma.$queryRaw<PlatformEventRow[]>`
    SELECT id, name, company_id, subject_type, subject_id, actor, payload
    FROM public.platform_events
    WHERE dispatched_at IS NULL AND created_at < now() - interval '1 minute'
    ORDER BY id LIMIT ${limit}`
  for (const row of rows) await dispatchEvent({ ...row, id: Number(row.id) })
  return rows.length
}

/**
 * Fire-and-forget variant for request handlers: never breaks the caller and is
 * registered with waitUntil so Vercel does not drop it after the response.
 */
export function emitPlatformEventSafely(e: PlatformEventInput): void {
  void runInBackground(`platform-event:${e.name}`, async () => {
    try {
      await emitPlatformEvent(e)
    } catch (err) {
      const msg = err instanceof Prisma.PrismaClientKnownRequestError ? err.code : err instanceof Error ? err.message : String(err)
      console.error(`[platform-events] ${e.name} not recorded: ${msg}`)
    }
  })
}
