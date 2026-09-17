import { createServiceClient } from '@/lib/supabase-service'
import type { GigaActor } from '@/lib/admin/giga-actor'

/**
 * Append-only journal of staff actions (`admin_audit_log`, migration 073).
 *
 * Contract: every change a staff member makes to someone's data is recorded
 * with who / whom / what / old → new. For destructive or sensitive operations
 * call with `{ required: true }` BEFORE performing them — if the journal cannot
 * be written, the operation must not happen.
 */

export interface AuditEntry {
  action: string
  entityType?: string
  entityId?: string | null
  targetUserId?: string | null
  oldValue?: unknown
  newValue?: unknown
  metadata?: Record<string, unknown>
  impersonationSessionId?: string | null
}

type AuditActor = Pick<GigaActor, 'id' | 'kind'> & Partial<Pick<GigaActor, 'role' | 'email'>>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_JSON = 64 * 1024

function clampJson(v: unknown): unknown {
  if (v === undefined) return null
  try {
    const s = JSON.stringify(v)
    if (s === undefined) return null
    return s.length > MAX_JSON ? { truncated: true, preview: s.slice(0, 2000) } : v
  } catch {
    return { unserializable: true }
  }
}

export function requestMeta(req?: Request | null): { ip: string | null; ua: string | null } {
  if (!req) return { ip: null, ua: null }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
  return { ip, ua: req.headers.get('user-agent')?.slice(0, 300) ?? null }
}

export async function recordAdminAction(
  actor: AuditActor,
  entry: AuditEntry,
  req?: Request | null,
  opts: { required?: boolean } = {},
): Promise<boolean> {
  const { ip, ua } = requestMeta(req)
  const row = {
    actor_id: actor.id,
    actor_kind: actor.kind,
    actor_role: actor.role ?? null,
    actor_email: actor.email ?? null,
    target_user_id: entry.targetUserId && UUID_RE.test(entry.targetUserId) ? entry.targetUserId : null,
    impersonation_session_id: entry.impersonationSessionId ?? null,
    action: entry.action,
    entity_type: entry.entityType ?? 'system',
    entity_id: entry.entityId ?? null,
    old_value: clampJson(entry.oldValue),
    new_value: clampJson(entry.newValue),
    metadata: (clampJson(entry.metadata ?? {}) as Record<string, unknown>) ?? {},
    ip_address: ip,
    user_agent: ua,
  }
  try {
    const { error } = await createServiceClient().from('admin_audit_log').insert(row)
    if (error) throw new Error(error.message)
    return true
  } catch (err) {
    console.error('[admin-audit] write failed:', err instanceof Error ? err.message : err)
    if (opts.required) throw new Error('Audit log unavailable — action refused')
    return false
  }
}
