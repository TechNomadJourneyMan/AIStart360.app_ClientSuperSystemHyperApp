/**
 * Shared types of the bot assistant (lib/telegram/brain).
 */
import type { z } from 'zod'
import { hasPermission, type Permission, type StaffRole } from '@/lib/admin/rbac'
import type { BotContext } from '../bots/dispatcher'
import type { BrainLlm } from './llm-port'
import type { BrainMemory, RememberedFile } from './memory'
import type { BrainScope } from './scope'
import type { McpScope } from '@/lib/mcp/scopes'

/** Who talks to the assistant, re-resolved by the bot on every update. */
export type BrainRole =
  | { bot: 'admin'; userId: string; email: string | null; staffRole: StaffRole }
  | { bot: 'expert'; userId: string; email: string | null; profileRole: string; staffRole: StaffRole | null }

/** Staff permission of the role (admin bot only — experts are not GIGA staff). */
export function roleCan(role: BrainRole, perm: Permission): boolean {
  return role.bot === 'admin' && hasPermission(role.staffRole, perm)
}

export interface BrainDeps {
  llm: BrainLlm
  memory: BrainMemory
  /** true = limited (per chat, AI turns). */
  rateLimit(key: string): Promise<boolean>
  /** Client scope of the person (lib/telegram/brain/scope.ts). */
  scope(userId: string): Promise<BrainScope>
  now(): Date
}

/** What a tool sees while it runs (one assistant turn). */
export interface ToolRunContext {
  role: BrainRole
  scope: BrainScope
  /** May contacts be shown unmasked (users.sensitive / clients:pii)? */
  pii: boolean
  /** MCP scopes of the role (lib/mcp/scopes.ts allowedScopes). */
  mcpScopes: readonly McpScope[]
  now: Date
  ctx: BotContext<unknown>
  deps: BrainDeps
  turn: {
    /** An action card was shown in this turn (one per turn). */
    proposed: boolean
    /** The file the person sent in this turn, or the last one they sent. */
    file: RememberedFile | null
  }
}

export interface BrainTool {
  name: string
  description: string
  /** read: returns data; propose: shows a confirmation card, changes nothing. */
  kind: 'read' | 'propose'
  input: z.ZodTypeAny
  /** Which roles get the tool (checked when the tool list is built AND before it runs). */
  available(role: BrainRole, mcpScopes: readonly McpScope[]): boolean
  run(args: unknown, t: ToolRunContext): Promise<Record<string, unknown>>
}

/** A failure the model can act on (bad argument, client not found / not assigned). */
export class BrainToolError extends Error {}
