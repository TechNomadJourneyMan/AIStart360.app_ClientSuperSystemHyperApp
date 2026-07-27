import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { getSalesDashboard } from '@/lib/sales-monitoring/analytics-service'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { requiredQuery } from '@/lib/sales-monitoring/http'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const organizationId = requiredQuery(url, 'organizationId')
    const access = await requireSalesPermission(organizationId, 'analytics:read')
    const now = new Date()
    const from = url.searchParams.get('from') ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
    const to = url.searchParams.get('to') ?? now.toISOString().slice(0, 10)
    const regionId = url.searchParams.get('regionId') ?? undefined
    const channelId = url.searchParams.get('channelId') ?? undefined
    if (regionId && access.regionIds && !access.regionIds.includes(regionId)) {
      return Response.json({ error: 'REGION_FORBIDDEN' }, { status: 403 })
    }
    const data = await getSalesDashboard({ organizationId, from, to, regionId, channelId })
    return Response.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}
