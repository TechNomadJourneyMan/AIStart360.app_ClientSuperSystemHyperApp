/**
 * Agent runtime types (docs/platform/05-agents.md).
 */
import type { ZodSchema } from 'zod'
import type { LlmJsonResult, LlmRequest, LlmResult, ModelTier } from '@/lib/ai/gateway'
import type { Decision, Permission } from './permissions'
import type { PlatformEventName } from '@/lib/events/platform-names'

export type TaskStatus = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'dead' | 'cancelled'
export type TaskTrigger = 'manual' | 'event' | 'schedule' | 'agent' | 'approval'

export interface AgentTaskRow {
  id: string
  agent_key: string
  company_id: string | null
  session_id: string | null
  parent_task_id: string | null
  trigger: TaskTrigger
  trigger_ref: string | null
  requested_by: string | null
  input: Record<string, unknown>
  status: TaskStatus
  attempts: number
  max_attempts: number
  lease_token: string | null
}

export interface AgentLimits {
  maxAttempts: number
  leaseSeconds: number
  /** Hard stop for one run; null = use agent_configs / platform default. */
  perRunBudgetUsd: number
  dailyBudgetUsd: number
  maxLlmCalls: number
  maxOutputTokens: number
}

export interface AgentDefinition<I = Record<string, unknown>> {
  key: string
  name: string
  description: string
  version: string
  /** company: needs a company_id; platform: runs without one (monitoring). */
  scope: 'company' | 'platform'
  tier: ModelTier | 'none'
  promptVersion?: string
  permissions: Partial<Record<Permission, Decision>>
  tools: readonly string[]
  triggers?: { events?: readonly PlatformEventName[]; cron?: string }
  limits: AgentLimits
  inputSchema: ZodSchema<I>
  run(ctx: AgentContext, input: I): Promise<AgentOutcome>
}

export interface AgentOutcome {
  /** One-line human summary, stored as agent_runs.output_summary. */
  summary: string
  result?: Record<string, unknown>
}

export interface SourceRef {
  type: 'survey' | 'document' | 'metric' | 'gri' | 'integration' | 'diagnostic' | 'finding' | 'platform'
  ref: string
}

export interface AgentContext {
  readonly taskId: string
  readonly runId: string
  readonly agentKey: string
  readonly companyId: string | null
  readonly sessionId: string | null
  readonly attempt: number
  /** Call a registered tool through the permission engine (logged as an agent action). */
  tool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>
  /** LLM call through the budget guard (needs CALL_LLM). */
  llm(req: Omit<LlmRequest, 'tier' | 'label' | 'maxTokens'> & { tier?: ModelTier; maxTokens?: number }): Promise<LlmResult>
  llmJson<T>(req: Omit<LlmRequest, 'tier' | 'label' | 'maxTokens'> & { tier?: ModelTier; maxTokens?: number; schema: ZodSchema<T> }): Promise<LlmJsonResult<T>>
  log(level: 'debug' | 'info' | 'warn' | 'error', type: string, message: string, data?: Record<string, unknown>): Promise<void>
  /** Record an input the agent read (provenance). */
  source(ref: SourceRef): void
  /** Running spend of this run in USD. */
  spentUsd(): number
}

export class AgentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

/** Thrown by ctx.tool when a REQUIRE_APPROVAL action was parked for a human. */
export class ApprovalRequiredError extends AgentError {
  constructor(readonly approvalId: string, summary: string) {
    super('APPROVAL_REQUIRED', summary, false)
    this.name = 'ApprovalRequiredError'
  }
}
