export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/admin/client-scope'
import { companyOfUser } from '@/lib/point-b/plan/flow'
import { authorize, fail, whatIfFailure } from '@/lib/point-b/whatif-http'
import { deleteSaved } from '@/lib/point-b/whatif-store'

/**
 * DELETE /api/v1/point-b/whatif/saved/:id → { ok: true }
 * Deletes the owner’s own saved scenario. Someone else’s scenario, another company’s and an unknown id are all
 * 404 and nothing is deleted. 403 «от имени»; 402 without Pro.
 */
const NOT_FOUND = 'Сценарий не найден'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorize({ write: true })
  if (!auth.ok) return auth.response
  if (!isUuid(params.id)) return fail(NOT_FOUND, 404, { code: 'not_found' })
  try {
    const { service, userId } = auth.caller
    const company = await companyOfUser(service, userId)
    if (!company) return fail(NOT_FOUND, 404, { code: 'not_found' })
    const removed = await deleteSaved(service, { id: params.id, companyId: company.id, userId })
    if (!removed) return fail(NOT_FOUND, 404, { code: 'not_found' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const answer = whatIfFailure(err)
    if (answer) return answer
    console.error('[v1/point-b/whatif/saved DELETE]', err instanceof Error ? err.message : err)
    return fail('Не удалось удалить сценарий', 500)
  }
}
