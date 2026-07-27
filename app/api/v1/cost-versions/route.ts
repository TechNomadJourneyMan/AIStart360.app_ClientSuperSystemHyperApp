import { z } from 'zod'
import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { parseJson } from '@/lib/sales-monitoring/http'
import { createCostVersion } from '@/lib/sales-monitoring/product-service'

const money = z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/)
const schema = z.object({
  organizationId: z.string().min(1),
  productVariantId: z.string().uuid(),
  amount: money,
  currency: z.string().regex(/^[A-Z]{3}$/).default('KZT'),
  baseAmount: money,
  validFrom: z.string().datetime({ offset: true }),
  validTo: z.string().datetime({ offset: true }).optional(),
  reason: z.string().min(3).max(1000),
  source: z.string().max(250).optional(),
  supplier: z.string().max(250).optional(),
  batchNumber: z.string().max(120).optional(),
  attachmentPath: z.string().max(1000).optional(),
})

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, schema)
    const access = await requireSalesPermission(input.organizationId, 'products:write')
    const data = await createCostVersion(input, access, request)
    return Response.json({ data }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
