import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { parseJson } from '@/lib/sales-monitoring/http'
import { answerQuestion } from '@/lib/sales-monitoring/knowledge-service'
import { assistantQuerySchema } from '@/lib/sales-monitoring/schemas'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, assistantQuerySchema)
    const access = await requireSalesPermission(input.organizationId, 'knowledge:read')
    const data = await answerQuestion({ ...input, filters: input.filters ?? {}, access })
    return Response.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}
