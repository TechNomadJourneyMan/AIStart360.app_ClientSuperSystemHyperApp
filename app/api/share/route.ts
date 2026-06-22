export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Shareable read-only report links.
 *
 *   POST /api/share   { type, companyId }   → { token, url: '/r/<token>' }
 *   DELETE /api/share { token }             → { ok: true }
 *
 * AUTHORIZATION (mirrors /api/export/report + the v1 diagnostics routes):
 *   • The caller must be authenticated (Supabase session).
 *   • They may share a company ONLY if they OWN it (companies.user_id === caller)
 *     OR they are staff (expert / admin / super_admin). Any other companyId is
 *     rejected — a client can never mint a link to another client's report.
 *
 * Token lifecycle lives in lib/share/tokens.ts; this route only enforces access.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { requireExpert } from '@/lib/expert-auth'
import { createShare, revokeShare, getShareByToken } from '@/lib/share/tokens'
import type { SharedReportType } from '@prisma/client'

const VALID_TYPES = new Set<SharedReportType>(['survey', 'gri', 'point_a', 'point_b'])

/**
 * Confirm the authenticated caller may share `companyId`. Returns true when the
 * caller owns the company (RLS-scoped read) or is staff (service-role check via
 * requireExpert). Returns false otherwise.
 */
async function canShareCompany(
  sb: ReturnType<typeof createServerClient>,
  callerId: string,
  companyId: string,
): Promise<boolean> {
  // Owner path — RLS scopes companies to the caller, so a hit means ownership.
  const { data: own } = await sb
    .from('companies')
    .select('id, user_id')
    .eq('id', companyId)
    .maybeSingle()
  if (own && (own.user_id as string) === callerId) return true

  // Staff path — expert / admin / super_admin may share any company.
  const viewer = await requireExpert()
  return viewer !== null
}

export async function POST(req: NextRequest) {
  let body: { type?: unknown; companyId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const type = body.type as SharedReportType | undefined
  const companyId = typeof body.companyId === 'string' ? body.companyId.trim() : ''

  if (!type || !VALID_TYPES.has(type)) {
    return NextResponse.json(
      { error: 'invalid_type', valid: Array.from(VALID_TYPES) },
      { status: 400 },
    )
  }
  if (!companyId) {
    return NextResponse.json({ error: 'missing_company' }, { status: 400 })
  }

  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allowed = await canShareCompany(sb, user.id, companyId)
  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  try {
    const { token } = await createShare({
      type,
      companyId,
      createdById: user.id,
    })
    return NextResponse.json({ token, url: `/r/${token}` })
  } catch (err) {
    console.error('[share] create failed:', err)
    return NextResponse.json({ error: 'create_failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  let body: { token?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!token) {
    return NextResponse.json({ error: 'missing_token' }, { status: 400 })
  }

  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Scope the revoke: only someone who could share the company may revoke its
  // link. Unknown / already-revoked / expired tokens are treated as a no-op so
  // DELETE stays idempotent and does not leak token existence.
  const share = await getShareByToken(token)
  if (!share) {
    return NextResponse.json({ ok: true })
  }
  const allowed = await canShareCompany(sb, user.id, share.companyId)
  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  try {
    await revokeShare(token)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[share] revoke failed:', err)
    return NextResponse.json({ error: 'revoke_failed' }, { status: 500 })
  }
}
