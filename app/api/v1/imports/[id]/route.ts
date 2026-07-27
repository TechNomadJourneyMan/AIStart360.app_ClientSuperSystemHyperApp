import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { requiredQuery } from '@/lib/sales-monitoring/http'
import { getImportJob } from '@/lib/sales-monitoring/import-service'

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const organizationId = requiredQuery(new URL(request.url), 'organizationId')
    await requireSalesPermission(organizationId, 'imports:write')
    return Response.json({ data: await getImportJob(organizationId, params.id) })
  } catch (error) {
    return errorResponse(error)
  }
}
