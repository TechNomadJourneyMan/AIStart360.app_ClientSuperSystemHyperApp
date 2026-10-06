/**
 * Response shapes of /api/giga-admin/agents/** as the UI reads them.
 *
 * `AgentOverview` is imported as a type from the data layer so the cards stay
 * in sync with the API. Task / run / tool-call rows are raw SQL rows on the
 * server (Record<string, unknown>), so their fields are spelled out here and
 * every one is treated as possibly missing.
 */
import type { AgentOverview } from '@/lib/agents/admin'
import type { Decision } from './model'

export type { AgentOverview }

export interface AgentsListResponse {
  agents: AgentOverview[]
  permissionCatalog: Array<{ key: string; label: string; ceiling: Decision }>
  can: { run: boolean; manage: boolean }
}

export interface TaskRow {
  id: string
  agent_key: string
  company_id: string | null
  company_name: string | null
  trigger: string
  trigger_ref: string | null
  requested_by: string | null
  status: string
  attempts: number
  max_attempts: number
  run_after: string | null
  last_error_code: string | null
  last_error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  cost_usd: number
  [key: string]: unknown
}

export interface AgentDetailResponse { agent: AgentOverview; tasks: TaskRow[] }

export interface TasksResponse { items: TaskRow[]; nextCursor: string | null }

export interface TaskFull extends TaskRow {
  session_id?: string | null
  parent_task_id?: string | null
  input?: unknown
  priority?: number | null
  lease_until?: string | null
  result_summary?: unknown
  cancelled_by?: string | null
  updated_at?: string | null
  idempotency_key?: string | null
}

export interface RunRow {
  id: string
  attempt: number
  status: string
  tier: string | null
  model: string | null
  prompt_version: string | null
  input_summary: string | null
  output_summary: string | null
  tools_used: string[] | null
  llm_calls: number | null
  tokens_in: number | null
  tokens_out: number | null
  cost_usd: number
  sources: unknown
  error_code: string | null
  error_message: string | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  [key: string]: unknown
}

export interface ToolCallRow {
  id: number
  run_id: string
  seq: number
  tool: string
  permission: string
  decision: string
  status: string
  args_redacted: unknown
  result_summary: string | null
  error_code: string | null
  approval_id: string | null
  duration_ms: number | null
  created_at: string
  [key: string]: unknown
}

export interface AgentEventRow {
  id: number
  run_id: string | null
  level: string
  type: string
  message: string
  data: unknown
  created_at: string
  [key: string]: unknown
}

export interface ApprovalRow {
  id: string
  task_id?: string
  agent_key?: string
  company_id?: string | null
  company_name?: string | null
  tool: string
  permission: string
  summary: string
  status: string
  requested_at: string
  expires_at: string
  decided_by: string | null
  decided_via: string | null
  decision_reason: string | null
  decided_at: string | null
  executed_at?: string | null
  [key: string]: unknown
}

export interface TaskDetailResponse {
  task: TaskFull
  runs: RunRow[]
  toolCalls: ToolCallRow[]
  events: AgentEventRow[]
  approvals: ApprovalRow[]
}

export interface ApprovalsResponse { items: ApprovalRow[]; canDecide: boolean }

export interface CostsResponse {
  days: number
  byDay: Array<Record<string, unknown>>
  byAgent: Array<Record<string, unknown>>
  byModel: Array<Record<string, unknown>>
  byCompany: Array<Record<string, unknown>>
  budgets: { platformDailyUsd: number; companyDailyUsd: number }
}

export interface PlatformEventRow {
  id: number
  name: string
  company_id: string | null
  subject_type: string | null
  subject_id: string | null
  actor: string | null
  payload: unknown
  dispatched_at: string | null
  dispatch_error: string | null
  created_at: string
  [key: string]: unknown
}

export interface EventsResponse { items: PlatformEventRow[]; labels: Record<string, string> }

export interface StaffNotificationRow {
  id: string
  level: string
  type: string
  title: string
  body: string | null
  company_id: string | null
  company_name: string | null
  entity_type: string | null
  entity_id: string | null
  approval_id: string | null
  agent_key: string | null
  created_at: string
  sent: number
  failed: number
  [key: string]: unknown
}

export interface TelegramLinkStatus { linked: boolean; username: string | null; minLevel: string; botConfigured: boolean; bot?: 'admin' | 'client' }
