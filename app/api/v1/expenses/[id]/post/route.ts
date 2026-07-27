import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { requireIdempotencyKey } from '@/lib/sales-monitoring/database'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { postExpense } from '@/lib/sales-monitoring/expense-service'
import { idempotentResponse, requiredQuery } from '@/lib/sales-monitoring/http'

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const organizationId = requiredQuery(new URL(request.url), 'organizationId')
    const access = await requireSalesPermission(organizationId, 'expenses:post')
    const result = await postExpense(
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
