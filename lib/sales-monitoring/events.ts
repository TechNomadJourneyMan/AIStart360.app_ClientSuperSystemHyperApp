import type { PoolClient } from 'pg'
import type { SalesAccessContext } from './access'

export async function writeAudit(
  client: PoolClient,
  input: {
    access: SalesAccessContext
    entityType: string
    entityId: string
    action: string
    reason?: string
    before?: unknown
    after?: unknown
    request?: Request
    approvalId?: string
  },
) {
  await client.query(
    `INSERT INTO financial_audit_events
       (organization_id, actor_id, actor_role, entity_type, entity_id, action,
        reason, before_value, after_value, ip_address, user_agent, approval_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::inet,$11,$12::uuid)`,
    [
      input.access.organizationId,
      input.access.actorId,
      input.access.role,
      input.entityType,
      input.entityId,
      input.action,
      input.reason ?? null,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      input.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      input.request?.headers.get('user-agent') ?? null,
      input.approvalId ?? null,
    ],
  )
}

export async function writeOutbox(
  client: PoolClient,
  input: {
    access: SalesAccessContext
    eventType: string
    entityType: string
    entityId: string
    payload?: Record<string, unknown>
  },
) {
  await client.query(
    `INSERT INTO outbox_events
       (organization_id, event_type, entity_type, entity_id, actor_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      input.access.organizationId,
      input.eventType,
      input.entityType,
      input.entityId,
      input.access.actorId,
      JSON.stringify(input.payload ?? {}),
    ],
  )
}

export async function signalAnalytics(
  client: PoolClient,
  organizationId: string,
  eventType: string,
  entityType: string,
  entityId: string,
) {
  await client.query(
    `INSERT INTO analytics_update_signals
       (organization_id, event_type, entity_type, entity_id)
     VALUES ($1,$2,$3,$4)`,
    [organizationId, eventType, entityType, entityId],
  )
}
