import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { requireIdempotencyKey } from '@/lib/sales-monitoring/database'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { idempotentResponse, parseJson } from '@/lib/sales-monitoring/http'
import { createPlan } from '@/lib/sales-monitoring/plan-service'
import { createPlanSchema } from '@/lib/sales-monitoring/schemas'

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, createPlanSchema)
    const access = await requireSalesPermission(input.organizationId, 'plans:write')
    const result = await createPlan(input, access, requireIdempotencyKey(request), request)
    return idempotentResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
