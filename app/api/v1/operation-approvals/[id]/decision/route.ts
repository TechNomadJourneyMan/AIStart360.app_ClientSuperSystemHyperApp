import { z } from 'zod'
import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { decideApproval } from '@/lib/sales-monitoring/approval-service'
import { requireIdempotencyKey } from '@/lib/sales-monitoring/database'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { idempotentResponse, parseJson } from '@/lib/sales-monitoring/http'

const schema = z.object({
  organizationId: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().max(1000).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const input = await parseJson(request, schema)
    const access = await requireSalesPermission(input.organizationId, 'approvals:decide')
    const result = await decideApproval(
      { ...input, approvalId: params.id },
      access,
      requireIdempotencyKey(request),
      request,
    )
    return idempotentResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
