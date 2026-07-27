import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { requiredQuery } from '@/lib/sales-monitoring/http'
import { parseJson } from '@/lib/sales-monitoring/http'
import { createProductWithVariant, searchProducts } from '@/lib/sales-monitoring/product-service'
import { createProductSchema } from '@/lib/sales-monitoring/schemas'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const organizationId = requiredQuery(url, 'organizationId')
    await requireSalesPermission(organizationId, 'products:read')
    const data = await searchProducts({
      organizationId,
      q: url.searchParams.get('q') ?? '',
      limit: Number(url.searchParams.get('limit') ?? 20),
    })
    return Response.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, createProductSchema)
    const access = await requireSalesPermission(input.organizationId, 'products:write')
    const data = await createProductWithVariant(input, access, request)
    return Response.json({ data }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
