/**
 * lib/mcp/audit.ts — the journal of MCP calls (public.mcp_audit, 101).
 *
 * One row per JSON-RPC request: who (user + credential), which method/tool,
 * an argument summary WITHOUT personal data, the outcome and the latency.
 * The summary keeps identifiers (company / user / task ids — needed to answer
 * «who looked at this client») and enum/number arguments; free text (a search
 * query may be an e-mail or a name) is reduced to its length.
 */
import { prisma } from '@/lib/db'

export type AuditStatus = 'ok' | 'error' | 'denied' | 'rate_limited' | 'unauthorized' | 'invalid'

export interface AuditRow {
  userId: string | null
  credentialKind: 'pat' | 'oauth' | null
  credentialId: string | null
  clientId: string | null
  method: string
  tool: string | null
  args: unknown
  status: AuditStatus
  errorCode: string | null
  latencyMs: number
  protocolVersion: string | null
  ipHash: string | null
}

const ID_KEYS = new Set(['company_id', 'user_id', 'task_id', 'session_id', 'report_version_id'])
const ENUM_KEYS = new Set(['status', 'group_by', 'agent_key'])

/** Summary of tool arguments that never contains free text or personal data. */
export function summarizeArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args as Record<string, unknown>).slice(0, 20)) {
    const key = k.slice(0, 40)
    if (typeof v === 'number' || typeof v === 'boolean') out[key] = v
    else if (typeof v === 'string' && ID_KEYS.has(k) && /^[A-Za-z0-9_-]{1,64}$/.test(v)) out[key] = v
    else if (typeof v === 'string' && ENUM_KEYS.has(k) && /^[a-z0-9_.-]{1,80}$/.test(v)) out[key] = v
    else if (typeof v === 'string') out[key] = { len: v.length }
    else if (Array.isArray(v)) out[key] = { items: v.length }
    else if (v === null) out[key] = null
    else out[key] = { type: typeof v }
  }
  return out
}

export async function writeMcpAudit(r: AuditRow): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO public.mcp_audit
      (user_id, credential_kind, credential_id, client_id, method, tool, args_summary, status, error_code, latency_ms, protocol_version, ip_hash)
    VALUES (${r.userId}::uuid, ${r.credentialKind}, ${r.credentialId}::uuid, ${r.clientId}, ${r.method.slice(0, 100)},
            ${r.tool ? r.tool.slice(0, 128) : null}, ${JSON.stringify(summarizeArgs(r.args))}::jsonb, ${r.status},
            ${r.errorCode ? r.errorCode.slice(0, 100) : null}, ${Math.max(0, Math.round(r.latencyMs))}::int,
            ${r.protocolVersion ? r.protocolVersion.slice(0, 32) : null}, ${r.ipHash})`
}
