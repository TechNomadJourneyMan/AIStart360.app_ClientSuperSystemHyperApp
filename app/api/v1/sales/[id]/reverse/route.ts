import { z } from 'zod'
import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { requireIdempotencyKey } from '@/lib/sales-monitoring/database'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { idempotentResponse, parseJson } from '@/lib/sales-monitoring/http'
import { reverseSale } from '@/lib/sales-monitoring/sales-service'

const schema = z.object({
  organizationId: z.string().min(1),
  reason: z.string().min(3).max(1000),
  reversedAt: z.string().datetime({ offset: true }).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const input = await parseJson(request, schema)
    const access = await requireSalesPermission(input.organizationId, 'sales:reverse')
    const result = await reverseSale(
      { ...input, saleId: params.id },
      access,
      requireIdempotencyKey(request),
      request,
    )
    return idempotentResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
