import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { parseJson } from '@/lib/sales-monitoring/http'
import { createActionDraft } from '@/lib/sales-monitoring/knowledge-service'
import { actionDraftSchema } from '@/lib/sales-monitoring/schemas'

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, actionDraftSchema)
    const access = await requireSalesPermission(input.organizationId, 'assistant:write')
    const data = await createActionDraft({ ...input, access })
    return Response.json({ data }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
