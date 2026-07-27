import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { requireIdempotencyKey } from '@/lib/sales-monitoring/database'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { idempotentResponse, requiredQuery } from '@/lib/sales-monitoring/http'
import { postSale } from '@/lib/sales-monitoring/sales-service'

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const organizationId = requiredQuery(new URL(request.url), 'organizationId')
    const access = await requireSalesPermission(organizationId, 'sales:post')
    const result = await postSale(
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
