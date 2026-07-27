import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { parseJson, requiredQuery } from '@/lib/sales-monitoring/http'
import { createProductRequest } from '@/lib/sales-monitoring/product-service'
import { productRequestSchema } from '@/lib/sales-monitoring/schemas'
import { query } from '@/lib/sales-monitoring/database'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const organizationId = requiredQuery(url, 'organizationId')
    await requireSalesPermission(organizationId, 'products:write')
    const data = await query(
      `SELECT id, sale_id, status, sku, barcode, name, size, color, comment,
              sla_deadline, resolved_variant_id, created_at
       FROM product_requests
       WHERE organization_id = $1
         AND ($2 = '' OR status = $2)
       ORDER BY
         CASE WHEN sla_deadline < now() AND status IN ('new','in_review') THEN 0 ELSE 1 END,
         created_at DESC
       LIMIT 200`,
      [organizationId, url.searchParams.get('status') ?? ''],
    )
    return Response.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, productRequestSchema)
    const access = await requireSalesPermission(input.organizationId, 'sales:write')
    const data = await createProductRequest(input, access, request)
    return Response.json({ data }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
