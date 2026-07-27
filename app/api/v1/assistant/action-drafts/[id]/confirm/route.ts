import { errorResponse } from '@/lib/sales-monitoring/errors'
import { parseJson } from '@/lib/sales-monitoring/http'
import { confirmActionDraft } from '@/lib/sales-monitoring/knowledge-service'
import { actionConfirmSchema } from '@/lib/sales-monitoring/schemas'

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const input = await parseJson(request, actionConfirmSchema)
    const data = await confirmActionDraft({
      organizationId: input.organizationId,
      draftId: params.id,
      checksum: input.checksum,
      request,
    })
    return Response.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}
