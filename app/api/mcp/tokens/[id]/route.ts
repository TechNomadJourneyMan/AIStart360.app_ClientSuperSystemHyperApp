/**
 * DELETE /api/mcp/tokens/:id            revoke one of the caller's personal tokens
 * DELETE /api/mcp/tokens/:id?kind=oauth revoke one of the caller's OAuth sign-ins (token family)
 * Revocation never waits for the audit journal (a failed journal write must
 * not keep a credential alive); the row is written best-effort.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { recordAdminAction } from '@/lib/admin/audit'
import { resolveTokenManager } from '@/lib/mcp/manage'
import { revokeOAuthGrant } from '@/lib/mcp/oauth'
import { revokePat } from '@/lib/mcp/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await resolveTokenManager(req)
  if ('response' in r) return r.response
  const { principal, auditActor } = r.manager
  const oauth = req.nextUrl.searchParams.get('kind') === 'oauth'
  let done: boolean
  try {
    done = oauth ? await revokeOAuthGrant(principal.userId, params.id) : await revokePat(principal.userId, params.id)
  } catch {
    return NextResponse.json({ ok: false, error: 'Не удалось отозвать доступ' }, { status: 500 })
  }
  if (!done) return NextResponse.json({ ok: false, error: 'Не найдено или уже отозвано' }, { status: 404 })
  await recordAdminAction(auditActor, {
    action: oauth ? 'mcp.oauth.revoke' : 'mcp.token.revoke',
    entityType: oauth ? 'oauth_grant' : 'mcp_token',
    entityId: params.id,
    targetUserId: principal.userId,
  }, req).catch(() => false)
  return NextResponse.json({ ok: true })
}
