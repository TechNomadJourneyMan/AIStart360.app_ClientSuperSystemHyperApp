/**
 * lib/agents/runner.ts — executes one claimed agent task.
 *
 *   claim (lease) → agent_runs row → definition.run(ctx) → finish task
 *
 * Every tool call goes through the permission engine and is recorded in
 * agent_tool_calls; every LLM call goes through the budget guard and adds its
 * real usage to the run. Outcomes:
 *   success                    → task succeeded
 *   ApprovalRequiredError      → task awaiting_approval (a human decides; on
 *                                approval the task is re-queued and the exact
 *                                approved action is allowed once)
 *   AgentError(retryable)      → retried with backoff, then dead-letter
 *   AgentError(non-retryable)  → dead immediately (e.g. BUDGET_EXCEEDED, bad input)
 *   unexpected error           → treated as retryable
 */
import {
  callLlm,
  callLlmJson,
  estimateCostUsd,
  modelForTier,
  type LlmRequest,
  type LlmUsage,
  type ModelTier,
} from '@/lib/ai/gateway'
import { effectivePermissions, type Decision, type Permission } from './permissions'
import * as store from './store'
import { getTool, payloadHash, redactArgs, type ToolContext } from './tools'
import { AgentError, ApprovalRequiredError, type AgentContext, type AgentDefinition, type AgentTaskRow, type SourceRef } from './types'

/** Platform-wide daily AI budget (USD). AGENT_PLATFORM_DAILY_BUDGET_USD overrides. */
const PLATFORM_DAILY_BUDGET_USD = () => Number(process.env.AGENT_PLATFORM_DAILY_BUDGET_USD ?? 50)
/** Per-company daily AI budget (USD). AGENT_COMPANY_DAILY_BUDGET_USD overrides. */
const COMPANY_DAILY_BUDGET_USD = () => Number(process.env.AGENT_COMPANY_DAILY_BUDGET_USD ?? 5)

export interface RunReport {
  taskId: string
  runId: string | null
  finalStatus: string | null
  summary: string | null
  errorCode: string | null
}

function summarizeInput(input: Record<string, unknown>): string {
  const keys = Object.keys(input).filter((k) => !k.startsWith('__'))
  return keys.length ? `input: ${keys.join(', ')}` : 'без входных параметров'
}

export async function runClaimedTask(task: AgentTaskRow, def: AgentDefinition<any>): Promise<RunReport> {
  if (!task.lease_token) throw new Error('runClaimedTask needs a leased task')
  const lease = task.lease_token

  const [config, grants] = await Promise.all([store.loadConfig(def.key), store.loadGrants(def.key)])
  const permissions = effectivePermissions(def.permissions, grants)
  const tier: ModelTier | 'none' = (config?.tier_override as ModelTier | null) ?? def.tier
  const perRunBudget = config?.per_run_budget_usd ?? def.limits.perRunBudgetUsd
  const dailyBudget = config?.daily_budget_usd ?? def.limits.dailyBudgetUsd
  const maxOutputTokens = config?.max_output_tokens ?? def.limits.maxOutputTokens

  const runId = await store.createRun({
    taskId: task.id,
    agentKey: def.key,
    agentVersion: def.version,
    companyId: task.company_id,
    attempt: task.attempts,
    tier,
    promptVersion: def.promptVersion ?? null,
    inputSummary: summarizeInput(task.input),
  })

  const sources: SourceRef[] = []
  const toolsUsed = new Set<string>()
  let seq = 0
  let llmCalls = 0
  let tokensIn = 0
  let tokensOut = 0
  let costUsd = 0
  let lastModel: string | null = null

  const log: AgentContext['log'] = (level, type, message, data) =>
    store.insertEvent({ taskId: task.id, runId, agentKey: def.key, companyId: task.company_id, level, type, message, data })

  const toolCtx: ToolContext = {
    taskId: task.id,
    runId,
    agentKey: def.key,
    companyId: task.company_id,
    sessionId: task.session_id,
    source: (ref) => sources.push(ref),
  }

  const record = (usage: LlmUsage | null) => {
    if (!usage) return
    llmCalls += 1
    tokensIn += usage.tokensIn
    tokensOut += usage.tokensOut
    costUsd += usage.costUsd
    lastModel = usage.model
  }

  /** Budget guard: refuse a call whose worst case would exceed any budget. */
  async function guardBudget(req: Pick<LlmRequest, 'system' | 'user' | 'maxTokens'>, callTier: ModelTier, model: string) {
    if (permissions.CALL_LLM !== 'ALLOW') {
      throw new AgentError('PERMISSION_DENIED', 'агенту не разрешено вызывать языковую модель')
    }
    if (llmCalls >= def.limits.maxLlmCalls) {
      throw new AgentError('LLM_CALL_LIMIT', `превышен лимит вызовов модели за запуск (${def.limits.maxLlmCalls})`)
    }
    const estimate = estimateCostUsd(callTier, model, req.system + req.user, req.maxTokens)
    if (costUsd + estimate > perRunBudget) {
      throw new AgentError('BUDGET_EXCEEDED', `бюджет запуска $${perRunBudget} будет превышен`)
    }
    const [agentDay, companyDay, platformDay] = await Promise.all([
      store.spendToday({ agentKey: def.key }),
      task.company_id ? store.spendToday({ companyId: task.company_id }) : Promise.resolve(0),
      store.spendToday(),
    ])
    if (agentDay + estimate > dailyBudget) throw new AgentError('BUDGET_EXCEEDED', `дневной бюджет агента $${dailyBudget} исчерпан`)
    if (task.company_id && companyDay + estimate > COMPANY_DAILY_BUDGET_USD()) {
      throw new AgentError('BUDGET_EXCEEDED', 'дневной бюджет ИИ для компании исчерпан')
    }
    if (platformDay + estimate > PLATFORM_DAILY_BUDGET_USD()) {
      throw new AgentError('BUDGET_EXCEEDED', 'дневной бюджет ИИ платформы исчерпан')
    }
  }

  const resolveCall = (req: { tier?: ModelTier; maxTokens?: number; model?: string | null }) => {
    if (tier === 'none' && !req.tier) throw new AgentError('PERMISSION_DENIED', 'агент работает без модели')
    const callTier = req.tier ?? (tier as ModelTier)
    const model = modelForTier(callTier, req.model ?? config?.model_override ?? null)
    const maxTokens = Math.min(req.maxTokens ?? maxOutputTokens, maxOutputTokens)
    return { callTier, model, maxTokens }
  }

  const ctx: AgentContext = {
    taskId: task.id,
    runId,
    agentKey: def.key,
    companyId: task.company_id,
    sessionId: task.session_id,
    attempt: task.attempts,
    log,
    source: (ref) => sources.push(ref),
    spentUsd: () => costUsd,

    async llm(req) {
      const { callTier, model, maxTokens } = resolveCall(req)
      await guardBudget({ system: req.system, user: req.user, maxTokens }, callTier, model)
      const res = await callLlm({ ...req, tier: callTier, model, maxTokens, label: `agent:${def.key}` })
      record(res.usage)
      if (!res.ok) await log('warn', 'llm.error', `модель не ответила: ${res.error}`, { code: res.error })
      return res
    },

    async llmJson(req) {
      const { callTier, model, maxTokens } = resolveCall(req)
      await guardBudget({ system: req.system, user: req.user, maxTokens }, callTier, model)
      const res = await callLlmJson({ ...req, tier: callTier, model, maxTokens, label: `agent:${def.key}` })
      record(res.usage)
      if (!res.ok) await log('warn', 'llm.error', `модель не ответила: ${res.error}`, { code: res.error })
      return res
    },

    async tool(name, rawArgs) {
      const tool = getTool(name)
      seq += 1
      const mySeq = seq
      if (!tool || !def.tools.includes(name)) {
        await store.insertToolCall({
          runId, seq: mySeq, tool: name, permission: tool?.permission ?? 'UNKNOWN', decision: 'DENY',
          status: 'denied', argsRedacted: {}, errorCode: 'TOOL_NOT_ALLOWED',
        })
        throw new AgentError('TOOL_NOT_ALLOWED', `инструмент ${name} не разрешён агенту ${def.key}`)
      }
      if (tool.companyScoped && !task.company_id) {
        throw new AgentError('NO_COMPANY', `инструмент ${name} требует задачу, привязанную к компании`)
      }
      const parsed = tool.args.safeParse(rawArgs)
      if (!parsed.success) {
        await store.insertToolCall({
          runId, seq: mySeq, tool: name, permission: tool.permission, decision: 'DENY',
          status: 'error', argsRedacted: {}, errorCode: 'INVALID_ARGS',
        })
        throw new AgentError('INVALID_ARGS', `неверные аргументы инструмента ${name}`)
      }
      const args = parsed.data as Record<string, unknown>
      const redacted = redactArgs(tool, args)
      const decision: Decision = permissions[tool.permission as Permission]

      if (decision === 'DENY') {
        await store.insertToolCall({
          runId, seq: mySeq, tool: name, permission: tool.permission, decision, status: 'denied', argsRedacted: redacted,
          errorCode: 'PERMISSION_DENIED',
        })
        await log('warn', 'tool.denied', `отказано: ${name} (${tool.permission})`)
        throw new AgentError('PERMISSION_DENIED', `нет разрешения ${tool.permission} для ${name}`)
      }

      let approvalId: string | null = null
      if (decision === 'REQUIRE_APPROVAL') {
        const hash = payloadHash(name, args)
        approvalId = await store.findApprovedAction(task.id, hash)
        if (!approvalId) {
          const summary = tool.describe?.(args) ?? `${def.name}: ${name}`
          const id = await store.createApproval({
            taskId: task.id, runId, agentKey: def.key, companyId: task.company_id,
            tool: name, permission: tool.permission, summary, payload: { tool: name, args: redacted }, payloadHash: hash,
          })
          await store.insertToolCall({
            runId, seq: mySeq, tool: name, permission: tool.permission, decision, status: 'pending_approval',
            argsRedacted: redacted, approvalId: id,
          })
          await log('info', 'approval.requested', summary, { approval_id: id })
          throw new ApprovalRequiredError(id, summary)
        }
      }

      const started = Date.now()
      try {
        const result = await tool.handler(toolCtx, args)
        toolsUsed.add(name)
        await store.insertToolCall({
          runId, seq: mySeq, tool: name, permission: tool.permission, decision, status: 'ok', argsRedacted: redacted,
          resultSummary: tool.summarize?.(result) ?? null, approvalId, durationMs: Date.now() - started,
        })
        if (approvalId) await store.markApprovalExecuted(approvalId, true)
        return result as any
      } catch (err) {
        const code = err instanceof AgentError ? err.code : 'TOOL_FAILED'
        await store.insertToolCall({
          runId, seq: mySeq, tool: name, permission: tool.permission, decision, status: 'error', argsRedacted: redacted,
          errorCode: code, approvalId, durationMs: Date.now() - started,
        })
        if (approvalId) await store.markApprovalExecuted(approvalId, false)
        throw err
      }
    },
  }

  let runStatus: 'succeeded' | 'failed' | 'awaiting_approval' = 'failed'
  let outcome: store.FinishOutcome = 'failed'
  let summary: string | null = null
  let result: Record<string, unknown> | null = null
  let errorCode: string | null = null
  let errorMessage: string | null = null
  let retryable = true

  try {
    if (def.scope === 'company' && !task.company_id) {
      throw new AgentError('NO_COMPANY', 'задача агента не привязана к компании')
    }
    const parsedInput = def.inputSchema.safeParse(task.input)
    if (!parsedInput.success) throw new AgentError('INVALID_INPUT', 'неверные входные данные задачи')
    await log('info', 'run.started', `запуск ${def.name}, попытка ${task.attempts}`)
    const out = await def.run(ctx, parsedInput.data)
    summary = out.summary
    result = out.result ?? null
    runStatus = 'succeeded'
    outcome = 'succeeded'
    await log('info', 'run.succeeded', out.summary)
  } catch (err) {
    if (err instanceof ApprovalRequiredError) {
      runStatus = 'awaiting_approval'
      outcome = 'awaiting_approval'
      summary = `ожидает одобрения: ${err.message}`
      errorCode = 'APPROVAL_REQUIRED'
    } else if (err instanceof AgentError) {
      errorCode = err.code
      errorMessage = err.message
      retryable = err.retryable
      await log('error', 'run.failed', `${err.code}: ${err.message}`)
    } else {
      errorCode = 'UNEXPECTED'
      errorMessage = err instanceof Error ? err.message.slice(0, 500) : 'unknown error'
      await log('error', 'run.failed', `UNEXPECTED: ${errorMessage}`)
    }
  }

  await store.finishRun({
    runId,
    status: runStatus,
    model: lastModel,
    outputSummary: summary,
    toolsUsed: [...toolsUsed],
    llmCalls, tokensIn, tokensOut, costUsd,
    sources,
    errorCode,
    errorMessage,
  })
  const finalStatus = await store.finishTask({
    taskId: task.id,
    leaseToken: lease,
    outcome,
    errorCode,
    error: errorMessage,
    result: result ?? (summary ? { summary } : null),
    retryable,
  })
  return { taskId: task.id, runId, finalStatus, summary, errorCode }
}
