/**
 * The diagnostic pipeline agents (docs/platform/05-agents.md §2,
 * lib/diagnostics/pipeline.ts):
 *
 *   diagnostic_orchestrator  opens a session on ONBOARDING_COMPLETED /
 *                            QUESTIONNAIRE_COMPLETED / FILE_PROCESSED / manual
 *                            run, finalises it after the last stage
 *   data_collection → metrics → data_quality → benchmark → diagnostic → recommendation
 *
 * Deterministic stages use no model. `diagnostic` and `recommendation` call
 * the model through the budget guard, only when OPENROUTER_API_KEY is set,
 * only when the evidence changed since the last analysed session (input
 * hash), and degrade to the deterministic result when the model is
 * unavailable or the budget is spent — the stage record says which.
 */
import { z } from 'zod'
import { hasLlmKey } from '@/lib/ai/gateway'
import {
  HYPOTHESES_PROMPT_VERSION, HypothesesSchema, RECOMMENDATIONS_PROMPT_VERSION, RecommendationsSchema,
  acceptHypotheses, acceptRecommendations, buildDiagnosticEvidence, engineRecommendations, findingEvidence,
  hypothesesPrompt, promptInputHash, recommendationsPrompt, type MetricForPrompt,
} from '@/lib/diagnostics/ai'
import { benchmarkFindings } from '@/lib/diagnostics/benchmark'
import type { ActiveFindingRow } from '@/lib/diagnostics/findings-store'
import { ORCHESTRATOR_KEY, STAGE_LABELS, type DiagnosticStageKey } from '@/lib/diagnostics/pipeline'
import { dataQualityFindings, type QualityDocumentRow, type QualityMetricRow } from '@/lib/diagnostics/quality'
import type { CompanyProfile } from '@/lib/diagnostics/scoring'
import type { PointA } from '@/types/onboarding'
import '../tools/diagnostics'
import { notifyStaffTool } from '../tools/notify'
import { AgentError, type AgentContext, type AgentDefinition, type AgentLimits } from '../types'

const empty = z.object({}).passthrough()

const DETERMINISTIC_LIMITS: AgentLimits = {
  maxAttempts: 3, leaseSeconds: 180, perRunBudgetUsd: 0, dailyBudgetUsd: 0, maxLlmCalls: 0, maxOutputTokens: 256,
}

// ─── Stage scaffolding ───────────────────────────────────────────────────────

interface StageResult {
  summary: string
  /** Extra fields of the stage record (counts, llm state, input hash). */
  data?: Record<string, unknown>
  status?: 'done' | 'skipped'
  completeness?: number | null
  sources?: Record<string, unknown>
  /** Stop the pipeline (session cancelled) with this reason. */
  stop?: string
}

async function runStage(ctx: AgentContext, stage: DiagnosticStageKey, body: () => Promise<StageResult>) {
  if (!ctx.sessionId) throw new AgentError('NO_SESSION', `этап «${STAGE_LABELS[stage]}» запускается только внутри сессии диагностики`)
  const started = await ctx.tool<{ active: boolean }>('session.stage', { status: 'running' })
  if (!started.active) return { summary: 'сессия уже закрыта — этап пропущен' }
  const r = await body()
  await ctx.tool('session.stage', {
    status: r.stop ? 'skipped' : r.status ?? 'done',
    summary: r.summary.slice(0, 500),
    ...(r.data ? { data: r.data } : {}),
    ...(r.completeness !== undefined ? { completeness: r.completeness } : {}),
    ...(r.sources ? { sources: r.sources } : {}),
  })
  const adv = await ctx.tool<{ next: string | null }>('pipeline.advance', r.stop ? { outcome: 'stop', reason: r.stop } : { outcome: 'continue' })
  return { summary: r.summary, result: { ...(r.data ?? {}), next: adv.next, stopped: Boolean(r.stop) } }
}

function stageAgent(args: {
  key: DiagnosticStageKey
  name: string
  description: string
  tools: string[]
  permissions: AgentDefinition['permissions']
  tier?: AgentDefinition['tier']
  limits?: AgentLimits
  promptVersion?: string
  body: (ctx: AgentContext) => Promise<StageResult>
}): AgentDefinition {
  return {
    key: args.key,
    name: args.name,
    description: args.description,
    version: '1.0.0',
    scope: 'company',
    tier: args.tier ?? 'none',
    promptVersion: args.promptVersion,
    permissions: { ...args.permissions, EXECUTE_WORKFLOW: 'ALLOW' },
    tools: [...args.tools, 'session.stage', 'pipeline.advance'],
    limits: args.limits ?? DETERMINISTIC_LIMITS,
    inputSchema: empty,
    run: (ctx) => runStage(ctx, args.key, () => args.body(ctx)),
  }
}

interface CurrentDiagnostic {
  diagnostic_id: string | null
  point_a: PointA | null
  profile: { industry: string | null; stage: string | null; size: string | null; business_model: string | null } | null
}

function profileOf(c: CurrentDiagnostic, companyId: string | null): CompanyProfile | null {
  if (!c.profile) return null
  return {
    id: companyId ?? '', name: null, ownerId: null,
    industry: c.profile.industry, stage: c.profile.stage, size: c.profile.size, businessModel: c.profile.business_model,
  }
}

type LlmState = 'done' | 'cached' | 'unavailable' | 'insufficient_data' | 'budget' | 'failed'

/** Transient model errors are retried by the queue while attempts remain; then the stage degrades. */
function isTransient(code: string): boolean {
  return code === 'TIMEOUT' || code === 'RATE_LIMITED' || code === 'PROVIDER_ERROR'
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

const orchestratorInput = z.object({
  action: z.enum(['start', 'finalize']).optional(),
  trigger: z.enum(['manual', 'agent', 'schedule']).optional(),
  reason: z.string().max(200).optional(),
  event: z.object({
    id: z.number().optional(),
    name: z.string(),
    subject_type: z.string().nullable().optional(),
    subject_id: z.string().nullable().optional(),
    payload: z.record(z.unknown()).optional(),
  }).optional(),
}).passthrough()

const EVENT_REASONS: Record<string, string> = {
  ONBOARDING_COMPLETED: 'анкета заполнена',
  QUESTIONNAIRE_COMPLETED: 'анкета обновлена',
  FILE_PROCESSED: 'обработан документ',
}

export const diagnosticOrchestratorAgent: AgentDefinition<z.infer<typeof orchestratorInput>> = {
  key: ORCHESTRATOR_KEY,
  name: 'Оркестратор диагностики',
  description: 'Открывает сессию диагностики, запускает этапы по порядку, сохраняет итоговый Executive Overview и сообщает о завершении.',
  version: '1.0.0',
  scope: 'company',
  tier: 'none',
  permissions: { READ_CLIENT_DATA: 'ALLOW', EXECUTE_WORKFLOW: 'ALLOW' },
  tools: ['session.open', 'diagnostics.finalize'],
  triggers: { events: ['ONBOARDING_COMPLETED', 'QUESTIONNAIRE_COMPLETED', 'FILE_PROCESSED'] },
  limits: { ...DETERMINISTIC_LIMITS, leaseSeconds: 120 },
  inputSchema: orchestratorInput,
  async run(ctx, input) {
    if (input.action === 'finalize') {
      if (!ctx.sessionId) throw new AgentError('NO_SESSION', 'нечего завершать: задача без сессии')
      const r = await ctx.tool<{ finalized: boolean; score?: number | null; critical_findings?: number; rerun_task_id?: string | null }>('diagnostics.finalize', {})
      return {
        summary: r.finalized
          ? `диагностика завершена: индекс ${r.score ?? '—'}, критических выводов ${r.critical_findings ?? 0}${r.rerun_task_id ? '; данные менялись — запущен повторный проход' : ''}`
          : 'сессия уже была закрыта',
        result: r as Record<string, unknown>,
      }
    }

    const ev = input.event
    if (ev?.name === 'FILE_PROCESSED') {
      const p = ev.payload ?? {}
      const fields = Number(p.field_count ?? 0) + Number(p.row_count ?? 0) + Number(p.bound_count ?? 0)
      if (!fields) return { summary: 'документ не дал данных — пересчёт не нужен', result: { skipped: 'empty_document' } }
    }
    const reason = input.reason ?? (ev ? EVENT_REASONS[ev.name] ?? ev.name : 'ручной запуск')
    const r = await ctx.tool<{ session_id: string; created: boolean; next?: string; rerun_requested?: boolean }>('session.open', {
      trigger: ev ? 'event' : input.trigger ?? 'manual',
      reason,
      initiated_by: `agent:${ORCHESTRATOR_KEY}`,
      // A busy session only gets a re-run when inputs really changed after it
      // started (checked at finalize), so asking for one is always safe.
      rerun_if_busy: true,
    })
    return {
      summary: r.created
        ? `сессия открыта (${reason}), первый этап: ${r.next}`
        : `диагностика уже идёт${r.rerun_requested ? ' — после неё будет повторный проход, если данные изменились' : ''}`,
      result: r as Record<string, unknown>,
    }
  },
}

// ─── Deterministic stages ────────────────────────────────────────────────────

interface Snapshot {
  completeness: number
  completeness_level: string
  sources: { surveyStepsCompleted: number; documentsProcessed: number; metricsWithValue: number; griAssessments: number; integrationsConnected: number } & Record<string, unknown>
  data_gaps: string[]
  overall_score: number | null
}

export const dataCollectionAgent = stageAgent({
  key: 'data_collection',
  name: 'Сбор данных',
  description: 'Снимок входных данных компании: анкета, документы, GRI, интеграции, метрики; полнота и пробелы.',
  tools: ['company.snapshot'],
  permissions: { READ_CLIENT_DATA: 'ALLOW' },
  body: async (ctx) => {
    const s = await ctx.tool<Snapshot>('company.snapshot', {})
    const src = s.sources
    if (!src.surveyStepsCompleted && !src.documentsProcessed && !src.metricsWithValue) {
      return {
        summary: 'данных нет: анкета не начата, обработанных документов и метрик нет',
        stop: 'Недостаточно данных для диагностики: заполните анкету или загрузите документы',
        completeness: s.completeness,
        sources: src,
      }
    }
    return {
      summary: `полнота ${Math.round(s.completeness * 100)}%: анкета ${src.surveyStepsCompleted} шаг., документов ${src.documentsProcessed}, метрик ${src.metricsWithValue}`,
      data: { data_gaps: s.data_gaps.slice(0, 5) },
      completeness: s.completeness,
      sources: src,
    }
  },
})

export const metricsAgent = stageAgent({
  key: 'metrics',
  name: 'Метрики и индекс',
  description: 'Пересчитывает метрики из анкеты, документов и интеграций и индекс Точки А по правилам методики.',
  tools: ['metrics.materialize', 'diagnostics.score'],
  permissions: { READ_CLIENT_DATA: 'ALLOW', UPDATE_METRICS: 'ALLOW' },
  limits: { ...DETERMINISTIC_LIMITS, leaseSeconds: 300 },
  body: async (ctx) => {
    const m = await ctx.tool<{ written: number; total: number; skipped: number; errors: number; no_owner?: boolean }>('metrics.materialize', {})
    if (m.errors > 0 && m.written === 0 && m.total > 0) {
      throw new AgentError('MATERIALIZE_FAILED', `метрики не записаны: ошибок ${m.errors}`, true)
    }
    const s = await ctx.tool<{ no_data?: boolean; reason?: string; diagnostic_id?: string; reused?: boolean; overall_score?: number; critical_risks?: number }>('diagnostics.score', {})
    if (s.no_data) return { summary: `метрик записано ${m.written}; индекс не рассчитан`, stop: s.reason ?? 'Анкета не заполнена' }
    return {
      summary: `метрик записано ${m.written} из ${m.total}${m.errors ? ` (ошибок ${m.errors})` : ''}; индекс ${s.overall_score}${s.reused ? ' (актуальный расчёт)' : ''}`,
      data: { metrics_written: m.written, metrics_total: m.total, metric_errors: m.errors, diagnostic_id: s.diagnostic_id, reused: s.reused, critical_risks: s.critical_risks },
    }
  },
})

interface MetricsRead {
  metrics: Array<Omit<QualityMetricRow, 'computed_at'> & { computed_at: string | null }>
  documents: Array<Omit<QualityDocumentRow, 'uploaded_at'> & { uploaded_at: string | null }>
  survey_last_answered_at: string | null
}

const toDate = (v: string | null) => (v ? new Date(v) : null)

export const dataQualityAgent = stageAgent({
  key: 'data_quality',
  name: 'Качество данных',
  description: 'Ищет расхождения между источниками, невозможные и устаревшие значения, необработанные документы.',
  tools: ['metrics.read', 'findings.write'],
  permissions: { READ_CLIENT_DATA: 'ALLOW', CREATE_FINDINGS: 'ALLOW' },
  body: async (ctx) => {
    const d = await ctx.tool<MetricsRead>('metrics.read', {})
    const findings = dataQualityFindings({
      metrics: d.metrics.map((m) => ({ ...m, computed_at: toDate(m.computed_at) })),
      documents: d.documents.map((x) => ({ ...x, uploaded_at: toDate(x.uploaded_at) })),
      surveyLastAnsweredAt: toDate(d.survey_last_answered_at),
      now: new Date(),
    })
    const w = await ctx.tool<{ inserted: number; updated: number; superseded: number }>('findings.write', { variant: 'rules', findings })
    const byKind = findings.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.kind]: (acc[f.kind] ?? 0) + 1 }), {})
    return {
      summary: findings.length
        ? `проблем данных: ${findings.length} (${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ')})`
        : 'проблем с данными не найдено',
      data: { findings: findings.length, by_kind: byKind, inserted: w.inserted, superseded: w.superseded },
    }
  },
})

export const benchmarkAgent = stageAgent({
  key: 'benchmark',
  name: 'Бенчмарки',
  description: 'Сравнивает баллы блоков с ориентирами отрасли (экспертная оценка методики, с пометкой источника).',
  tools: ['diagnostics.current', 'findings.write'],
  permissions: { READ_CLIENT_DATA: 'ALLOW', CREATE_FINDINGS: 'ALLOW' },
  body: async (ctx) => {
    const c = await ctx.tool<CurrentDiagnostic>('diagnostics.current', {})
    if (!c.point_a || !c.diagnostic_id) return { summary: 'нет расчёта Точки А — сравнивать нечего', status: 'skipped' }
    const r = benchmarkFindings({ pointA: c.point_a, industry: c.profile?.industry ?? null, stage: c.profile?.stage ?? null, diagnosticId: c.diagnostic_id })
    await ctx.tool('findings.write', { variant: 'rules', findings: r.findings })
    if (r.skippedReason) return { summary: `сравнение не выполнено: ${r.skippedReason}`, status: 'skipped', data: { reason: r.skippedReason } }
    const gaps = r.findings.filter((f) => f.kind === 'gap').length
    return {
      summary: `ориентир «${r.benchmark?.industry}»: отставаний ${gaps}, сильных сторон ${r.findings.length - gaps}`,
      data: { benchmark: r.benchmark, gaps, strengths: r.findings.length - gaps },
    }
  },
})

// ─── Model stages ────────────────────────────────────────────────────────────

const DIAGNOSTIC_LIMITS: AgentLimits = {
  maxAttempts: 3, leaseSeconds: 300, perRunBudgetUsd: 0.4, dailyBudgetUsd: 10, maxLlmCalls: 1, maxOutputTokens: 3000,
}
const RECOMMENDATION_LIMITS: AgentLimits = {
  maxAttempts: 3, leaseSeconds: 300, perRunBudgetUsd: 0.3, dailyBudgetUsd: 8, maxLlmCalls: 1, maxOutputTokens: 3000,
}

/**
 * One budgeted model call with the shared policy: no key → unavailable;
 * budget refused → budget; transient error → retry while attempts remain,
 * then failed. Returns the parsed output or the state to record.
 */
async function modelCall<T>(
  ctx: AgentContext,
  maxAttempts: number,
  req: { system: string; user: string; schema: z.ZodSchema<T> },
): Promise<{ ok: true; data: T; model: string; costUsd: number } | { ok: false; state: LlmState; reason: string }> {
  if (!hasLlmKey()) return { ok: false, state: 'unavailable', reason: 'модель не настроена (OPENROUTER_API_KEY)' }
  let res
  try {
    res = await ctx.llmJson<T>({ system: req.system, user: req.user, schema: req.schema, temperature: 0.2 })
  } catch (err) {
    if (err instanceof AgentError && (err.code === 'BUDGET_EXCEEDED' || err.code === 'LLM_CALL_LIMIT')) {
      return { ok: false, state: 'budget', reason: err.message }
    }
    throw err
  }
  if (res.ok) return { ok: true, data: res.data, model: res.usage.model, costUsd: res.usage.costUsd }
  if (isTransient(res.error) && ctx.attempt < maxAttempts) {
    throw new AgentError(res.error, `модель временно недоступна: ${res.message}`, true)
  }
  return { ok: false, state: 'failed', reason: `${res.error}: ${res.message}`.slice(0, 300) }
}

const LLM_STATE_TEXT: Record<LlmState, string> = {
  done: 'гипотезы построены',
  cached: 'данные не изменились с прошлого анализа — прежние результаты в силе',
  unavailable: 'модель не настроена',
  insufficient_data: 'данных мало для анализа моделью',
  budget: 'бюджет ИИ исчерпан',
  failed: 'модель не ответила',
}

export const diagnosticAgent = stageAgent({
  key: 'diagnostic',
  name: 'Гипотезы ИИ',
  description: 'Строит гипотезы о причинах проблем по доказательствам (метрики, баллы, выводы). Гипотезы скрыты от клиента до проверки сотрудником; о критических рисках сообщает команде.',
  tools: ['diagnostics.current', 'metrics.read', 'findings.read', 'diagnostics.ai_cache', 'findings.write', 'notify.staff'],
  permissions: { READ_CLIENT_DATA: 'ALLOW', CREATE_FINDINGS: 'ALLOW', CALL_LLM: 'ALLOW', SEND_TELEGRAM: 'ALLOW' },
  tier: 'standard',
  promptVersion: HYPOTHESES_PROMPT_VERSION,
  limits: DIAGNOSTIC_LIMITS,
  body: async (ctx) => {
    const c = await ctx.tool<CurrentDiagnostic>('diagnostics.current', {})
    if (!c.point_a || !c.diagnostic_id) return { summary: 'нет расчёта Точки А — анализировать нечего', status: 'skipped' }

    // Critical risks of the rule engine: one message to the team per distinct
    // set of risks (a re-run with the same risks does not repeat it).
    const critical = c.point_a.risks.filter((r) => r.level === 'critical')
    if (critical.length) {
      const texts = critical.map((r) => r.text.trim()).sort()
      await ctx.tool(notifyStaffTool.name, {
        level: 'CRITICAL',
        type: 'diagnostic.critical_risk',
        title: critical.length === 1 ? 'Найден критический риск' : `Найдено критических рисков: ${critical.length}`,
        lines: critical.slice(0, 6).map((r) => `${r.area}: ${r.text}`.slice(0, 300)),
        dedupe_key: `engine_risks:${ctx.companyId}:${promptInputHash('engine_risks', texts.join('\n'))}`,
        link: '/admin-giga-panel/agents',
      })
    }

    const [m, f] = await Promise.all([
      ctx.tool<MetricsRead>('metrics.read', {}),
      ctx.tool<{ findings: ActiveFindingRow[] }>('findings.read', {}),
    ])
    const items = buildDiagnosticEvidence({
      diagnosticId: c.diagnostic_id,
      pointA: c.point_a,
      metrics: m.metrics.map((x): MetricForPrompt => ({ metric_key: x.metric_key, metric_value: x.metric_value, metric_unit: x.metric_unit, source: x.source, period_year: x.period_year })),
      findings: f.findings,
    })
    const base = { critical_engine_risks: critical.length, evidence_items: items.length }
    if (items.length < 6) {
      return { summary: `критических рисков ${critical.length}; ${LLM_STATE_TEXT.insufficient_data}`, data: { ...base, llm: 'insufficient_data' } }
    }
    const prompt = hypothesesPrompt(profileOf(c, ctx.companyId), items)
    const inputHash = promptInputHash(HYPOTHESES_PROMPT_VERSION, prompt.system + prompt.text)
    const cache = await ctx.tool<{ hit: boolean }>('diagnostics.ai_cache', { input_hash: inputHash })
    if (cache.hit) {
      return { summary: `критических рисков ${critical.length}; ${LLM_STATE_TEXT.cached}`, data: { ...base, llm: 'done', cached: true, input_hash: inputHash } }
    }
    const res = await modelCall(ctx, DIAGNOSTIC_LIMITS.maxAttempts, { system: prompt.system, user: prompt.user, schema: HypothesesSchema })
    if (!res.ok) {
      await ctx.log('warn', 'diagnostic.llm_skipped', `гипотезы не построены: ${res.reason}`, { state: res.state })
      return { summary: `критических рисков ${critical.length}; ${LLM_STATE_TEXT[res.state]}`, data: { ...base, llm: res.state, llm_reason: res.reason } }
    }
    const accepted = acceptHypotheses(res.data, items)
    const w = await ctx.tool<{ inserted: number; updated: number; superseded: number; critical: number }>('findings.write', {
      variant: 'ai', findings: accepted.accepted, model: res.model, prompt_version: HYPOTHESES_PROMPT_VERSION,
    })
    return {
      summary: `гипотез ${accepted.accepted.length} (отброшено ${accepted.dropped} без доказательств), на проверке у команды; критических рисков ${critical.length}`,
      data: { ...base, llm: 'done', input_hash: inputHash, model: res.model, cost_usd: res.costUsd, hypotheses: accepted.accepted.length, dropped: accepted.dropped, inserted: w.inserted },
    }
  },
})

export const recommendationAgent = stageAgent({
  key: 'recommendation',
  name: 'Рекомендации',
  description: 'Собирает рекомендации из правил методики (видны клиенту) и предлагает действия моделью по выводам (скрыты до проверки сотрудником).',
  tools: ['diagnostics.current', 'findings.read', 'diagnostics.ai_cache', 'recommendations.write'],
  permissions: { READ_CLIENT_DATA: 'ALLOW', CREATE_FINDINGS: 'ALLOW', CALL_LLM: 'ALLOW' },
  tier: 'standard',
  promptVersion: RECOMMENDATIONS_PROMPT_VERSION,
  limits: RECOMMENDATION_LIMITS,
  body: async (ctx) => {
    const c = await ctx.tool<CurrentDiagnostic>('diagnostics.current', {})
    if (!c.point_a) return { summary: 'нет расчёта Точки А — рекомендовать нечего', status: 'skipped' }
    const rules = engineRecommendations(c.point_a)
    await ctx.tool('recommendations.write', { variant: 'rules', recommendations: rules })

    const f = await ctx.tool<{ findings: ActiveFindingRow[] }>('findings.read', {})
    const items = findingEvidence(f.findings.filter((x) => x.kind !== 'strength'))
    const base = { rule_recommendations: rules.length, findings_considered: items.length }
    if (items.length === 0) return { summary: `по правилам: ${rules.length}; ${LLM_STATE_TEXT.insufficient_data}`, data: { ...base, llm: 'insufficient_data' } }

    const prompt = recommendationsPrompt(profileOf(c, ctx.companyId), items, rules.map((r) => r.title))
    const inputHash = promptInputHash(RECOMMENDATIONS_PROMPT_VERSION, prompt.system + prompt.text)
    const cache = await ctx.tool<{ hit: boolean }>('diagnostics.ai_cache', { input_hash: inputHash })
    if (cache.hit) return { summary: `по правилам: ${rules.length}; ${LLM_STATE_TEXT.cached}`, data: { ...base, llm: 'done', cached: true, input_hash: inputHash } }

    const res = await modelCall(ctx, RECOMMENDATION_LIMITS.maxAttempts, { system: prompt.system, user: prompt.user, schema: RecommendationsSchema })
    if (!res.ok) {
      await ctx.log('warn', 'recommendation.llm_skipped', `предложения модели не получены: ${res.reason}`, { state: res.state })
      return { summary: `по правилам: ${rules.length}; ${LLM_STATE_TEXT[res.state]}`, data: { ...base, llm: res.state, llm_reason: res.reason } }
    }
    const accepted = acceptRecommendations(res.data, items)
    await ctx.tool('recommendations.write', { variant: 'ai', recommendations: accepted.accepted, model: res.model, prompt_version: RECOMMENDATIONS_PROMPT_VERSION })
    return {
      summary: `по правилам: ${rules.length}; предложений модели ${accepted.accepted.length} (на проверке), отброшено ${accepted.dropped}`,
      data: { ...base, llm: 'done', input_hash: inputHash, model: res.model, cost_usd: res.costUsd, ai_recommendations: accepted.accepted.length, dropped: accepted.dropped },
    }
  },
})

export const DIAGNOSTIC_AGENTS: AgentDefinition<any>[] = [
  diagnosticOrchestratorAgent,
  dataCollectionAgent,
  metricsAgent,
  dataQualityAgent,
  benchmarkAgent,
  diagnosticAgent,
  recommendationAgent,
]
