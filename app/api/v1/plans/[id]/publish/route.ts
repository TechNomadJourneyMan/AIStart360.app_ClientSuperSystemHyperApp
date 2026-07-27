import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { requireIdempotencyKey } from '@/lib/sales-monitoring/database'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { idempotentResponse, requiredQuery } from '@/lib/sales-monitoring/http'
import { publishPlan } from '@/lib/sales-monitoring/plan-service'

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const organizationId = requiredQuery(new URL(request.url), 'organizationId')
    const access = await requireSalesPermission(organizationId, 'plans:publish')
    const result = await publishPlan(
      organizationId,
      params.id,
      access,
      requireIdempotencyKey(request),
      request,
    )
    return idempotentResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
