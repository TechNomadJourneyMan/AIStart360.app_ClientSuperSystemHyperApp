import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { requireIdempotencyKey } from '@/lib/sales-monitoring/database'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { idempotentResponse, parseJson, requiredQuery } from '@/lib/sales-monitoring/http'
import { createSaleSchema } from '@/lib/sales-monitoring/schemas'
import { createSale, listSales } from '@/lib/sales-monitoring/sales-service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const organizationId = requiredQuery(url, 'organizationId')
    const access = await requireSalesPermission(organizationId, 'sales:read')
    const data = await listSales({
      organizationId,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      regionIds: access.regionIds,
      channelIds: access.channelIds,
      limit: Number(url.searchParams.get('limit') ?? 50),
      offset: Number(url.searchParams.get('offset') ?? 0),
    })
    return Response.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, createSaleSchema)
    const access = await requireSalesPermission(input.organizationId, 'sales:write')
    const result = await createSale(input, access, requireIdempotencyKey(request), request)
    return idempotentResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
