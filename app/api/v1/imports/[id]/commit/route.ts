import { z } from 'zod'
import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { parseJson } from '@/lib/sales-monitoring/http'
import { commitSalesImport } from '@/lib/sales-monitoring/import-service'

const schema = z.object({
  organizationId: z.string().min(1),
  partial: z.boolean().default(false),
})

export const maxDuration = 300

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const input = await parseJson(request, schema)
    const access = await requireSalesPermission(input.organizationId, 'imports:write')
    const data = await commitSalesImport({
      ...input,
      partial: input.partial ?? false,
      jobId: params.id,
      access,
    })
    return Response.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}
