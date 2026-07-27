import type { SalesAccessContext } from './access'
import { executeIdempotent } from './database'
import { DomainError } from './errors'
import { writeAudit, writeOutbox } from './events'

export async function decideApproval(
  input: {
    organizationId: string
    approvalId: string
    decision: 'approved' | 'rejected'
    comment?: string
  },
  access: SalesAccessContext,
  idempotencyKey: string,
  request?: Request,
) {
  return executeIdempotent(
    {
      organizationId: input.organizationId,
      actorId: access.actorId,
      operation: `approval.decide:${input.approvalId}`,
      key: idempotencyKey,
    },
    async (client) => {
      const current = await client.query<{
        id: string
        entity_type: string
        entity_id: string
        status: string
        requested_by: string
      }>(
        `SELECT id, entity_type, entity_id::text, status, requested_by
         FROM operation_approvals
         WHERE id = $1::uuid AND organization_id = $2
         FOR UPDATE`,
        [input.approvalId, input.organizationId],
      )
      const approval = current.rows[0]
      if (!approval) throw new DomainError('APPROVAL_NOT_FOUND', 'Согласование не найдено', 404)
      if (approval.status !== 'pending') {
        throw new DomainError('APPROVAL_ALREADY_DECIDED', 'Согласование уже обработано', 409)
      }
      if (approval.requested_by === access.actorId) {
        throw new DomainError('SELF_APPROVAL_FORBIDDEN', 'Нельзя согласовать собственную операцию', 403)
      }

      await client.query(
        `UPDATE operation_approvals
         SET status = $2, comment = COALESCE($3, comment),
             decided_by = $4, decided_at = now()
         WHERE id = $1::uuid`,
        [input.approvalId, input.decision, input.comment ?? null, access.actorId],
      )
      if (input.decision === 'rejected' && approval.entity_type === 'sale') {
        await client.query(
          `UPDATE sales SET status = 'draft', version = version + 1 WHERE id = $1::uuid`,
          [approval.entity_id],
        )
      }
      await writeAudit(client, {
        access,
        entityType: 'approval',
        entityId: input.approvalId,
        action: `approval.${input.decision}`,
        reason: input.comment,
        before: { status: 'pending' },
        after: { status: input.decision },
        request,
        approvalId: input.approvalId,
      })
      await writeOutbox(client, {
        access,
        eventType: `approval.${input.decision}`,
        entityType: approval.entity_type,
        entityId: approval.entity_id,
        payload: { approvalId: input.approvalId },
      })
      return {
        status: 200,
        body: {
          data: {
            id: input.approvalId,
            entityType: approval.entity_type,
            entityId: approval.entity_id,
            status: input.decision,
          },
        },
      }
    },
  )
}
