/**
 * GET /api/v1/client/slots?company_id=xxx&user_id=xxx&paths=a,b,c
 *
 * Resolves UI slots via lib/ai/slot-mapper. Returns { slot_path: {value, source, confidence, updatedAt} }.
 *
 * `paths` is optional — if omitted, all slots in SLOT_MAP are resolved.
 * For large result sets pass specific paths to limit payload.
 */

export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'

import { resolveSlots } from '@/lib/ai/slot-mapper'

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('company_id')
  const userId = req.nextUrl.searchParams.get('user_id')
  const pathsParam = req.nextUrl.searchParams.get('paths')

  if (!companyId || !userId) {
    return NextResponse.json(
      { ok: false, error: 'company_id and user_id required' },
      { status: 400 }
    )
  }

  const paths = pathsParam ? pathsParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined

  try {
    const slots = await resolveSlots({ companyId, userId, paths })
    return NextResponse.json({ ok: true, data: slots })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
