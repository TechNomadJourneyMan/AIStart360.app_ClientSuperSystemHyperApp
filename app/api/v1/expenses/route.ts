import { requireSalesPermission } from '@/lib/sales-monitoring/access'
import { requireIdempotencyKey } from '@/lib/sales-monitoring/database'
import { errorResponse } from '@/lib/sales-monitoring/errors'
import { createExpense } from '@/lib/sales-monitoring/expense-service'
import { idempotentResponse, parseJson } from '@/lib/sales-monitoring/http'
import { createExpenseSchema } from '@/lib/sales-monitoring/schemas'

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, createExpenseSchema)
    const access = await requireSalesPermission(input.organizationId, 'expenses:write')
    const result = await createExpense(input, access, requireIdempotencyKey(request), request)
    return idempotentResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
