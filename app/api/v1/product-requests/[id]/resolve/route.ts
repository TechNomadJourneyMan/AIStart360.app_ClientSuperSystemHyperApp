import { z } from 'zod'
import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { parseJson } from '@/lib/sales-monitoring/http'
import { resolveProductRequest } from '@/lib/sales-monitoring/product-service'

const schema = z.object({
  organizationId: z.string().min(1),
  productVariantId: z.string().uuid(),
  comment: z.string().max(1000).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const input = await parseJson(request, schema)
    const access = await requireSalesPermission(input.organizationId, 'products:write')
    const data = await resolveProductRequest(
      { ...input, requestId: params.id },
      access,
      request,
    )
    return Response.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}
