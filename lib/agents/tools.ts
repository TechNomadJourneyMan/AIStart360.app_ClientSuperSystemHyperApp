/**
 * lib/agents/tools.ts — the tool registry.
 *
 * A tool is the only way an agent touches data or the outside world. Each tool
 * declares the permission it needs, validates its arguments with Zod (exported
 * as JSON Schema, i.e. MCP-compatible), and receives a ToolContext that is
 * bound to the task's company: a tool never accepts a company id from the model
 * or from arguments, so an agent working for company A cannot reach company B.
 */
import { createHash } from 'node:crypto'
import type { ZodSchema } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Permission } from './permissions'
import type { SourceRef } from './types'

export interface ToolContext {
  readonly taskId: string
  readonly runId: string
  readonly agentKey: string
  /** The company the task is bound to (null only for platform-scope agents). */
  readonly companyId: string | null
  readonly sessionId: string | null
  source(ref: SourceRef): void
}

export interface ToolDefinition<A = Record<string, unknown>, R = unknown> {
  name: string
  description: string
  permission: Permission
  /** Requires a company-bound task. */
  companyScoped: boolean
  args: ZodSchema<A>
  /** Fields of args that must never be stored in logs (replaced by a hash). */
  redact?: readonly string[]
  /** Short text describing the action for an approval card («Отправить письмо …»). */
  describe?(args: A): string
  handler(ctx: ToolContext, args: A): Promise<R>
  /** One-line summary of the result for agent_tool_calls.result_summary. */
  summarize?(result: R): string
}

const registry = new Map<string, ToolDefinition<any, any>>()

export function registerTool<A, R>(tool: ToolDefinition<A, R>): ToolDefinition<A, R> {
  if (registry.has(tool.name) && registry.get(tool.name) !== tool) {
    throw new Error(`tool ${tool.name} registered twice`)
  }
  registry.set(tool.name, tool)
  return tool
}

export function getTool(name: string): ToolDefinition<any, any> | undefined {
  return registry.get(name)
}

export function listTools(): ToolDefinition<any, any>[] {
  return [...registry.values()]
}

/** MCP-style descriptor: name, description, JSON Schema of the input. */
export function toolDescriptor(tool: ToolDefinition<any, any>) {
  return {
    name: tool.name,
    description: tool.description,
    permission: tool.permission,
    inputSchema: zodToJsonSchema(tool.args, { target: 'jsonSchema7', $refStrategy: 'none' }),
  }
}

/** Stable hash of an action, used to match an approval to its execution. */
export function payloadHash(tool: string, args: unknown): string {
  return createHash('sha256').update(tool).update('\u0000').update(stableStringify(args)).digest('hex')
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

const SECRETISH = /(token|secret|password|api[_-]?key|authorization|cookie|session)/i

/** Copy of args safe for logs: redacted fields and secret-looking keys hashed. */
export function redactArgs(tool: ToolDefinition<any, any>, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args ?? {})) {
    if (tool.redact?.includes(k) || SECRETISH.test(k)) {
      out[k] = `sha256:${createHash('sha256').update(String(v)).digest('hex').slice(0, 12)}`
    } else if (typeof v === 'string' && v.length > 500) {
      out[k] = `${v.slice(0, 500)}… (${v.length} символов)`
    } else {
      out[k] = v
    }
  }
  return out
}

/** Test helper. */
export function __resetToolsForTests(): void {
  registry.clear()
}
