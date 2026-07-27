import type { CreatePlanInput } from '@/types/sales-monitoring'
import type { SalesAccessContext } from './access'
import { executeIdempotent } from './database'
import { DomainError } from './errors'
import { signalAnalytics, writeAudit, writeOutbox } from './events'

export async function createPlan(
  input: CreatePlanInput,
  access: SalesAccessContext,
  idempotencyKey: string,
  request?: Request,
) {
  return executeIdempotent(
    {
      organizationId: input.organizationId,
      actorId: access.actorId,
      operation: 'plan.create',
      key: idempotencyKey,
    },
    async (client) => {
      const version = await client.query<{ version_number: number }>(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number
         FROM sales_plan_versions
         WHERE organization_id = $1 AND period_start = $2::date AND period_end = $3::date`,
        [input.organizationId, input.periodStart, input.periodEnd],
      )
      const inserted = await client.query<{
        id: string
        status: string
        version_number: number
      }>(
        `INSERT INTO sales_plan_versions (
           organization_id, period_start, period_end, version_number, currency, created_by
         ) VALUES ($1,$2::date,$3::date,$4,$5,$6)
         RETURNING id, status, version_number`,
        [
          input.organizationId,
          input.periodStart,
          input.periodEnd,
          version.rows[0].version_number,
          input.currency ?? 'KZT',
          access.actorId,
        ],
      )
      const plan = inserted.rows[0]
      for (const line of input.lines) {
        await client.query(
          `INSERT INTO sales_plan_lines (
             plan_version_id, region_id, channel_id, product_id, manager_id,
             revenue_target, gross_profit_target, quantity_target,
             average_price_target, average_cost_target
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10)`,
          [
            plan.id,
            line.regionId ?? null,
            line.channelId ?? null,
            line.productId ?? null,
            line.managerId ?? null,
            line.revenueTarget,
            line.grossProfitTarget,
            line.quantityTarget,
            line.averagePriceTarget ?? null,
            line.averageCostTarget ?? null,
          ],
        )
      }
      const response = {
        id: plan.id,
        organizationId: input.organizationId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        versionNumber: plan.version_number,
        status: plan.status,
        currency: input.currency ?? 'KZT',
        lines: input.lines,
      }
      await writeAudit(client, {
        access,
        entityType: 'plan',
        entityId: plan.id,
        action: 'plan.created',
        after: response,
        request,
      })
      return { status: 201, body: { data: response } }
    },
  )
}

export async function publishPlan(
  organizationId: string,
  planId: string,
  access: SalesAccessContext,
  idempotencyKey: string,
  request?: Request,
) {
  return executeIdempotent(
    {
      organizationId,
      actorId: access.actorId,
      operation: `plan.publish:${planId}`,
      key: idempotencyKey,
    },
    async (client) => {
      const current = await client.query<{
        id: string
        status: string
        period_start: string | Date
        period_end: string | Date
        version_number: number
      }>(
        `SELECT id, status, period_start, period_end, version_number
         FROM sales_plan_versions
         WHERE id = $1::uuid AND organization_id = $2
         FOR UPDATE`,
        [planId, organizationId],
      )
      const plan = current.rows[0]
      if (!plan) throw new DomainError('PLAN_NOT_FOUND', 'План не найден', 404)
      if (plan.status !== 'draft') throw new DomainError('PLAN_NOT_PUBLISHABLE', 'Опубликовать можно только черновик', 409)

      const lineCheck = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM sales_plan_lines WHERE plan_version_id = $1::uuid`,
        [planId],
      )
      if (Number(lineCheck.rows[0].count) === 0) {
        throw new DomainError('PLAN_EMPTY', 'План не содержит строк', 422)
      }

      await client.query(
        `UPDATE sales_plan_versions
         SET status = 'superseded', updated_at = now()
         WHERE organization_id = $1
           AND period_start = $2::date AND period_end = $3::date
           AND status = 'published'`,
        [organizationId, plan.period_start, plan.period_end],
      )
      await client.query(
        `UPDATE sales_plan_versions
         SET status = 'published', published_by = $2, published_at = now(), updated_at = now()
         WHERE id = $1::uuid`,
        [planId, access.actorId],
      )
      await writeAudit(client, {
        access,
        entityType: 'plan',
        entityId: planId,
        action: 'plan.published',
        before: { status: 'draft' },
        after: { status: 'published' },
        request,
      })
      await writeOutbox(client, {
        access,
        eventType: 'plan.published',
        entityType: 'plan',
        entityId: planId,
        payload: { versionNumber: plan.version_number },
      })
      await signalAnalytics(client, organizationId, 'plan.published', 'plan', planId)
      return {
        status: 200,
        body: {
          data: { id: planId, status: 'published', versionNumber: plan.version_number },
        },
      }
    },
  )
}
