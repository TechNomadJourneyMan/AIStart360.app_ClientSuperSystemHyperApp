/**
 * Which tools the assistant offers to whom.
 *
 *   admin bot  MCP tools of the staff role's MCP scopes (allowedScopes: PII
 *              only with users.sensitive), the admin read tools of the GIGA
 *              permissions they mirror, client analysis / reports, and the
 *              propose_* actions the role may confirm;
 *   expert bot client-scoped tools only (clients, Point A, diagnostics,
 *              metrics, published reports), client analysis, reports in
 *              review — no actions.
 * The list is rebuilt for every turn from the role the bot just re-resolved,
 * and every tool re-checks `available` before running.
 */
import { zodToJsonSchema } from 'zod-to-json-schema'
import { allowedScopes, type McpScope } from '@/lib/mcp/scopes'
import { PROPOSE_TOOLS } from './actions'
import type { BrainToolSpec } from './llm-port'
import { ADMIN_READ_TOOLS, CLIENT_INSIGHT_TOOLS, EXPERT_BOT_SCOPES, MCP_BRAIN_TOOLS, mcpRoleOf } from './tools-read'
import type { BrainRole, BrainTool } from './types'

export const ALL_BRAIN_TOOLS: readonly BrainTool[] = [...MCP_BRAIN_TOOLS, ...ADMIN_READ_TOOLS, ...CLIENT_INSIGHT_TOOLS, ...PROPOSE_TOOLS]

export function mcpScopesFor(role: BrainRole): McpScope[] {
  const scopes = allowedScopes(mcpRoleOf(role))
  return role.bot === 'expert' ? scopes.filter((s) => EXPERT_BOT_SCOPES.includes(s)) : scopes
}

export function toolsFor(role: BrainRole, scopes: readonly McpScope[] = mcpScopesFor(role)): BrainTool[] {
  return ALL_BRAIN_TOOLS.filter((t) => (role.bot === 'admin' || t.kind === 'read') && t.available(role, scopes))
}

export function toolSpec(t: BrainTool): BrainToolSpec {
  const parameters = zodToJsonSchema(t.input, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>
  delete parameters.$schema
  return { type: 'function', function: { name: t.name, description: t.description, parameters } }
}
