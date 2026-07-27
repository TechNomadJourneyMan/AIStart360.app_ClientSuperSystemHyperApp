import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { getCashFlow } from '@/lib/sales-monitoring/analytics-service'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { requiredQuery } from '@/lib/sales-monitoring/http'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const organizationId = requiredQuery(url, 'organizationId')
    await requireSalesPermission(organizationId, 'analytics:read')
    const data = await getCashFlow({
      organizationId,
      from: requiredQuery(url, 'from'),
      to: requiredQuery(url, 'to'),
    })
    return Response.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}
