/**
 * lib/mcp/manage.ts — who may manage MCP tokens through the web routes
 * (app/api/mcp/tokens): a GIGA staff member (panel session, second factor
 * passed — requireGiga) or an expert of the expert portal (resolveExpert,
 * same second-factor rule). People manage only their OWN tokens.
 *
 * Creating a token needs a fresh personal session: a staff_cookie actor
 * (the panel kept open while impersonating a client) may list and revoke,
 * but not mint new credentials.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { isSameOriginMutation, requireGiga, type GigaActor } from '@/lib/admin/giga-actor'
import { expertBlockResponse, resolveExpert } from '@/lib/expert-auth'
import type { AuditActor } from '@/lib/admin/audit'
import { resolveMcpPrincipal, type McpPrincipal } from './principal'

export interface TokenManager {
  principal: McpPrincipal
  via: 'giga' | 'expert'
  /** May mint new tokens (personal session, not an impersonation cookie). */
  canCreate: boolean
  auditActor: AuditActor
}

export async function resolveTokenManager(req: NextRequest): Promise<{ manager: TokenManager } | { response: NextResponse }> {
  if (!isSameOriginMutation(req)) return { response: NextResponse.json({ ok: false, error: 'Cross-site request blocked' }, { status: 403 }) }
  const guard = await requireGiga(req, 'dashboard.view')
  let userId: string
  let via: TokenManager['via']
  let actor: GigaActor | null = null
  let email: string | null = null
  if (guard.actor) {
    actor = guard.actor
    userId = guard.actor.id
    via = 'giga'
  } else if (guard.staff) {
    // Staff are governed by the panel's rules only — never by the expert path.
    return { response: guard.response }
  } else {
    const expert = await resolveExpert()
    if (!expert.ok) return { response: expertBlockResponse(expert.block) }
    userId = expert.viewer.id
    email = expert.viewer.email
    via = 'expert'
  }
  let principal: McpPrincipal | null
  try {
    principal = await resolveMcpPrincipal(userId)
  } catch {
    return { response: NextResponse.json({ ok: false, error: 'Не удалось проверить права' }, { status: 503 }) }
  }
  if (!principal) return { response: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) }
  return {
    manager: {
      principal,
      via,
      canCreate: via === 'expert' || actor?.kind === 'session',
      auditActor: actor
        ? { id: actor.id, kind: actor.kind, role: actor.role, email: actor.email }
        : { id: userId, kind: 'session', email: email ?? undefined },
    },
  }
}
