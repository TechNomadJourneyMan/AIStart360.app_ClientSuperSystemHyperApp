import { inngest } from '@/lib/inngest'
import { query } from '@/lib/sales-monitoring/database'

export const dispatchSalesOutbox = inngest.createFunction(
  {
    id: 'dispatch-sales-outbox',
    retries: 2,
    triggers: { cron: '* * * * *' },
  },
  async ({ step }) => {
    const events = await step.run('load-pending-events', () =>
      query<{
        id: string
        event_type: string
        organization_id: string
        entity_type: string
        entity_id: string
        actor_id: string
        payload: Record<string, unknown>
        occurred_at: Date
      }>(
        `SELECT id, event_type, organization_id, entity_type, entity_id,
           actor_id, payload, occurred_at
         FROM outbox_events
         WHERE dispatched_at IS NULL
         ORDER BY occurred_at
         LIMIT 100`,
      ),
    )

    for (const event of events) {
      await step.run(`dispatch-${event.id}`, async () => {
        try {
          await inngest.send({
            name: event.event_type,
            data: {
              eventId: event.id,
              version: 1,
              organizationId: event.organization_id,
              entityType: event.entity_type,
              entityId: event.entity_id,
              actorId: event.actor_id,
              occurredAt: new Date(event.occurred_at).toISOString(),
              payload: event.payload,
            },
          })
          await query(
            `UPDATE outbox_events
             SET dispatched_at = now(), attempts = attempts + 1, last_error = NULL
             WHERE id = $1::uuid`,
            [event.id],
          )
        } catch (error) {
          await query(
            `UPDATE outbox_events
             SET attempts = attempts + 1, last_error = $2
             WHERE id = $1::uuid`,
            [event.id, error instanceof Error ? error.message.slice(0, 2000) : 'Dispatch failed'],
          )
          throw error
        }
      })
    }
    return { dispatched: events.length }
  },
)
