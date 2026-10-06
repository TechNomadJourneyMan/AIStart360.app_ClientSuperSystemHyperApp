export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { listPayments } from '@/lib/payments/billing'
import { billingErrorResponse } from '@/lib/payments/billing-http'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/giga-admin/users/:id/billing/transactions — the client's payment
 * history (payment_transactions under both tenant keys), newest first.
 * Read-only (users.view): payments change only through the providers.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'users.view')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  try {
    const transactions = await listPayments(params.id)
    return NextResponse.json({ ok: true, transactions })
  } catch (e) {
    return billingErrorResponse(e, 'giga-admin/users/billing/transactions GET')
  }
}
