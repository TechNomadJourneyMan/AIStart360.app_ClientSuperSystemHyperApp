/**
 * Agent tools of the diagnostic pipeline (lib/diagnostics/pipeline.ts).
 *
 * Every tool works on the task's company (ctx.companyId) and session
 * (ctx.sessionId); neither is taken from arguments. Pipeline bookkeeping
 * (session, stages) is EXECUTE_WORKFLOW and the index is a computed value
 * (UPDATE_METRICS): none of these tools changes data the client entered, which
 * is WRITE_CLIENT_DATA and always needs a human. Rules the tools enforce
 * regardless of what an agent passes:
 *   • a stage agent records and advances only its own stage;
 *   • findings / recommendations are stamped `agent:<key>` (`:ai` for model
 *     output) and model output is always AI_HYPOTHESIS / hidden from the client;
 *   • CRITICAL_RISK_FOUND is emitted for new critical findings (staff only).
 */
import { z } from 'zod'
import { AgentError } from '../types'
import { registerTool, type ToolContext } from '../tools'
import { DIAGNOSTIC_STAGES, ORCHESTRATOR_KEY, STAGE_LABELS, isDiagnosticStage, nextStage, stageTaskKey, type DiagnosticStageKey } from '@/lib/diagnostics/pipeline'
import { completeSession, endSession, getSession, lastInputAt, openSession, recordStage } from '@/lib/diagnostics/sessions'
import { activeFindings, replaceFindings, replaceRecommendations } from '@/lib/diagnostics/findings-store'
import { companyProfile, diagnosticById, NoSurveyDataError, scoreCompany } from '@/lib/diagnostics/scoring'
import { loadQualityInputs } from '@/lib/diagnostics/quality'
import { diagnosticsIO } from '@/lib/diagnostics/io'
import { prisma } from '@/lib/db'

function company(ctx: ToolContext): string {
  if (!ctx.companyId) throw new AgentError('NO_COMPANY', 'задача не привязана к компании')
  return ctx.companyId
}

function session(ctx: ToolContext): string {
  if (!ctx.sessionId) throw new AgentError('NO_SESSION', 'задача не привязана к сессии диагностики')
  return ctx.sessionId
}

function ownStage(ctx: ToolContext): DiagnosticStageKey {
  if (!isDiagnosticStage(ctx.agentKey)) throw new AgentError('NOT_A_STAGE', `${ctx.agentKey} не является этапом диагностики`)
  return ctx.agentKey
}

async function emit(name: 'DIAGNOSTIC_STARTED' | 'DIAGNOSTIC_COMPLETED' | 'CRITICAL_RISK_FOUND', ctx: ToolContext, args: {
  subjectType: string; subjectId: string; payload: Record<string, unknown>; dedupeKey: string
}) {
  const { emitPlatformEvent } = await import('@/lib/events/platform')
  await emitPlatformEvent({ name, companyId: ctx.companyId, actor: `agent:${ctx.agentKey}`, ...args })
}

async function enqueue(ctx: ToolContext, agentKey: string, sessionId: string, input: Record<string, unknown>, idempotencyKey: string) {
  const { enqueueAgentTask } = await import('../queue')
  return enqueueAgentTask({
    agentKey,
    companyId: company(ctx),
    sessionId,
    parentTaskId: ctx.taskId,
    trigger: 'agent',
    triggerRef: `agent:${ctx.agentKey}`,
    requestedBy: `agent:${ctx.agentKey}`,
    input,
    idempotencyKey,
  })
}

async function agentEnabled(key: string): Promise<boolean> {
  const { loadConfig } = await import('../store')
  const config = await loadConfig(key)
  return !config || config.enabled
}

/**
 * Enqueue the first enabled stage after `from` (null = the first stage), or
 * the orchestrator's finalize when none is left. Disabled stages are recorded
 * as skipped so the session shows why they did not run.
 */
async function advanceFrom(ctx: ToolContext, sessionId: string, from: DiagnosticStageKey | null) {
  let stage = nextStage(from)
  const skipped: string[] = []
  while (stage && !(await agentEnabled(stage))) {
    await recordStage(sessionId, stage, { status: 'skipped', summary: 'агент отключён администратором' })
    skipped.push(stage)
    stage = nextStage(stage)
  }
  if (stage) {
    const res = await enqueue(ctx, stage, sessionId, {}, stageTaskKey(sessionId, stage))
    return { next: stage, task_id: res.id, skipped }
  }
  const res = await enqueue(ctx, ORCHESTRATOR_KEY, sessionId, { action: 'finalize' }, stageTaskKey(sessionId, 'finalize'))
  return { next: 'finalize', task_id: res.id, skipped }
}

// ─── Session and workflow ────────────────────────────────────────────────────

registerTool({
  name: 'session.open',
  description: 'Открыть сессию диагностики компании и поставить первый этап. Если сессия уже идёт — отметить, что нужен повторный проход.',
  permission: 'EXECUTE_WORKFLOW',
  companyScoped: true,
  args: z.object({
    trigger: z.enum(['manual', 'event', 'schedule', 'agent']),
    reason: z.string().max(200),
    initiated_by: z.string().max(100).nullable().default(null),
    rerun_if_busy: z.boolean().default(true),
  }).strict(),
  handler: async (ctx, a) => {
    if (ctx.agentKey !== ORCHESTRATOR_KEY) throw new AgentError('NOT_ORCHESTRATOR', 'сессию открывает только оркестратор')
    const companyId = company(ctx)
    const { session: s, created } = await openSession({
      companyId, trigger: a.trigger, initiatedBy: a.initiated_by ?? null, orchestratorTaskId: ctx.taskId, rerunIfBusy: a.rerun_if_busy ?? true,
    })
    if (!created) return { session_id: s.id, created: false, rerun_requested: s.rerun_requested }
    await emit('DIAGNOSTIC_STARTED', ctx, {
      subjectType: 'diagnostic_session', subjectId: s.id, payload: { reason: a.reason, agent_key: ctx.agentKey }, dedupeKey: `diagnostic_started:${s.id}`,
    })
    const adv = await advanceFrom(ctx, s.id, null)
    return { session_id: s.id, created: true, ...adv }
  },
  summarize: (r: { session_id: string; created: boolean }) => (r.created ? `сессия ${r.session_id.slice(0, 8)} открыта` : 'сессия уже идёт'),
})

registerTool({
  name: 'session.stage',
  description: 'Отметить состояние своего этапа в сессии диагностики (running / done / skipped / failed) с кратким итогом.',
  permission: 'EXECUTE_WORKFLOW',
  companyScoped: true,
  args: z.object({
    status: z.enum(['running', 'done', 'skipped', 'failed']),
    summary: z.string().max(500).optional(),
    data: z.record(z.unknown()).optional(),
    completeness: z.number().min(0).max(1).nullable().optional(),
    sources: z.record(z.unknown()).optional(),
  }).strict(),
  handler: async (ctx, a) => {
    const stage = ownStage(ctx)
    const active = await recordStage(session(ctx), stage, { ...(a.data ?? {}), status: a.status, summary: a.summary, task_id: ctx.taskId }, {
      completeness: a.completeness, sources: a.sources,
    })
    return { active }
  },
  summarize: (r: { active: boolean }) => (r.active ? 'записано' : 'сессия уже закрыта'),
})

registerTool({
  name: 'pipeline.advance',
  description: 'Завершить свой этап: поставить следующий этап диагностики (continue) или остановить сессию с причиной (stop).',
  permission: 'EXECUTE_WORKFLOW',
  companyScoped: true,
  args: z.object({
    outcome: z.enum(['continue', 'stop']),
    reason: z.string().max(300).optional(),
  }).strict(),
  handler: async (ctx, a) => {
    const stage = ownStage(ctx)
    const sessionId = session(ctx)
    if (a.outcome === 'stop') {
      const stopped = await endSession(sessionId, 'cancelled', a.reason ?? `Остановлено на этапе «${STAGE_LABELS[stage]}»`)
      return { next: null, stopped }
    }
    const s = await getSession(sessionId)
    if (!s || (s.status !== 'collecting' && s.status !== 'processing')) return { next: null, stopped: false, closed: true }
    return advanceFrom(ctx, sessionId, stage)
  },
  summarize: (r: { next: string | null }) => (r.next ? `дальше: ${r.next}` : 'пайплайн остановлен'),
})

registerTool({
  name: 'diagnostics.finalize',
  description: 'Завершить сессию: снимок Executive Overview, статус ready, событие DIAGNOSTIC_COMPLETED; повторный проход, если данные изменились во время сессии.',
  permission: 'EXECUTE_WORKFLOW',
  companyScoped: true,
  args: z.object({}).strict(),
  handler: async (ctx) => {
    if (ctx.agentKey !== ORCHESTRATOR_KEY) throw new AgentError('NOT_ORCHESTRATOR', 'завершает сессию только оркестратор')
    const companyId = company(ctx)
    const sessionId = session(ctx)
    const before = await getSession(sessionId)
    if (!before || (before.status !== 'collecting' && before.status !== 'processing')) {
      return { finalized: false, status: before?.status ?? 'missing' }
    }
    const overview = await diagnosticsIO().overview(companyId)
    const done = await completeSession(sessionId, { overview, completeness: overview.completeness })
    if (!done) return { finalized: false, status: 'closed' }

    const findings = await activeFindings(companyId)
    const critical = findings.filter((f) => f.severity === 'critical' && f.provenance_type !== 'AI_HYPOTHESIS').length
      + overview.keyRisks.filter((r) => r.severity === 'critical' && r.source === 'engine:point_a_v1').length
    await emit('DIAGNOSTIC_COMPLETED', ctx, {
      subjectType: 'diagnostic_session',
      subjectId: sessionId,
      dedupeKey: `diagnostic_completed:${sessionId}`,
      payload: {
        session_id: sessionId,
        diagnostic_id: done.diagnostic_id,
        score: overview.overallScore,
        critical_findings: critical,
        files_processed: overview.sources.documentsProcessed,
        metrics_calculated: overview.sources.metricsWithValue,
        completeness: overview.completeness,
        agent_key: ctx.agentKey,
        agent_name: 'Оркестратор диагностики',
      },
    })

    let rerun: string | null = null
    if (done.rerun_requested) {
      const changed = await lastInputAt(companyId)
      if (changed && changed.getTime() > done.started_at.getTime()) {
        const { enqueueAgentTask } = await import('../queue')
        const res = await enqueueAgentTask({
          agentKey: ORCHESTRATOR_KEY, companyId, trigger: 'agent', triggerRef: `rerun:${sessionId}`,
          requestedBy: `agent:${ctx.agentKey}`, input: { action: 'start', trigger: 'agent', reason: 'новые данные во время прошлой диагностики' },
          idempotencyKey: `diag:${sessionId}:rerun`,
        })
        rerun = res.id
      }
    }
    return { finalized: true, score: overview.overallScore, critical_findings: critical, rerun_task_id: rerun }
  },
  summarize: (r: { finalized: boolean; score?: number | null }) => (r.finalized ? `готово, индекс ${r.score ?? '—'}` : 'сессия уже закрыта'),
})

// ─── Data ────────────────────────────────────────────────────────────────────

registerTool({
  name: 'company.snapshot',
  description: 'Снимок входных данных компании: полнота, источники (анкета, документы, GRI, интеграции, метрики), чего не хватает.',
  permission: 'READ_CLIENT_DATA',
  companyScoped: true,
  args: z.object({}).strict(),
  handler: async (ctx) => {
    const o = await diagnosticsIO().overview(company(ctx))
    ctx.source({ type: 'platform', ref: `overview:${o.companyId}` })
    return {
      completeness: o.completeness,
      completeness_level: o.completenessLevel,
      sources: o.sources,
      data_gaps: o.dataGaps,
      status: o.status,
      overall_score: o.overallScore,
    }
  },
  summarize: (r: { completeness: number }) => `полнота ${Math.round(r.completeness * 100)}%`,
})

registerTool({
  name: 'metrics.materialize',
  description: 'Пересчитать метрики компании из анкеты, документов и интеграций (резолвер реестра) и записать значения с источником.',
  permission: 'UPDATE_METRICS',
  companyScoped: true,
  args: z.object({}).strict(),
  handler: async (ctx) => {
    const companyId = company(ctx)
    const profile = await companyProfile(companyId)
    if (!profile?.ownerId) return { written: 0, total: 0, skipped: 0, errors: 0, no_owner: true }
    return diagnosticsIO().materialize(companyId, profile.ownerId)
  },
  summarize: (r: { written: number; total: number }) => `записано ${r.written} из ${r.total}`,
})

registerTool({
  name: 'diagnostics.score',
  description: 'Рассчитать индекс Точки А по правилам (или переиспользовать актуальный расчёт) и привязать его к сессии.',
  permission: 'UPDATE_METRICS',
  companyScoped: true,
  args: z.object({}).strict(),
  handler: async (ctx) => {
    const companyId = company(ctx)
    const sessionId = session(ctx)
    try {
      const r = await scoreCompany(companyId, sessionId)
      await recordStage(sessionId, ownStage(ctx), {}, { diagnosticId: r.diagnosticId })
      ctx.source({ type: 'diagnostic', ref: r.diagnosticId })
      return {
        diagnostic_id: r.diagnosticId,
        reused: r.reused,
        overall_score: r.pointA.overall_score,
        stage: r.pointA.stage,
        critical_risks: r.pointA.risks.filter((x) => x.level === 'critical').length,
        answered_keys: r.answeredKeys,
      }
    } catch (err) {
      if (err instanceof NoSurveyDataError) return { no_data: true, reason: err.message }
      throw err
    }
  },
  summarize: (r: { overall_score?: number; reused?: boolean; no_data?: boolean }) =>
    r.no_data ? 'нет данных анкеты' : `индекс ${r.overall_score}${r.reused ? ' (актуальный расчёт)' : ''}`,
})

registerTool({
  name: 'diagnostics.current',
  description: 'Результат Точки А этой сессии (баллы блоков, риски, быстрые победы) и профиль компании (отрасль, стадия, размер).',
  permission: 'READ_CLIENT_DATA',
  companyScoped: true,
  args: z.object({}).strict(),
  handler: async (ctx) => {
    const companyId = company(ctx)
    const s = await getSession(session(ctx))
    const profile = await companyProfile(companyId)
    const diag = s?.diagnostic_id ? await diagnosticById(companyId, s.diagnostic_id) : null
    if (diag) ctx.source({ type: 'diagnostic', ref: diag.id })
    return {
      diagnostic_id: diag?.id ?? null,
      point_a: diag?.pointA ?? null,
      profile: profile ? { industry: profile.industry, stage: profile.stage, size: profile.size, business_model: profile.businessModel } : null,
    }
  },
  summarize: (r: { diagnostic_id: string | null }) => (r.diagnostic_id ? 'расчёт найден' : 'расчёта нет'),
})

registerTool({
  name: 'metrics.read',
  description: 'Материализованные метрики компании (значение, единица, источник, период) и состояние документов — для проверок качества.',
  permission: 'READ_CLIENT_DATA',
  companyScoped: true,
  args: z.object({}).strict(),
  handler: async (ctx) => {
    const inp = await loadQualityInputs(company(ctx))
    ctx.source({ type: 'metric', ref: `company:${ctx.companyId}` })
    return {
      metrics: inp.metrics.map((m) => ({ ...m, computed_at: m.computed_at ? m.computed_at.toISOString() : null })),
      documents: inp.documents.map((d) => ({ ...d, uploaded_at: d.uploaded_at ? d.uploaded_at.toISOString() : null })),
      survey_last_answered_at: inp.surveyLastAnsweredAt ? inp.surveyLastAnsweredAt.toISOString() : null,
    }
  },
  summarize: (r: { metrics: unknown[]; documents: unknown[] }) => `метрик ${r.metrics.length}, документов ${r.documents.length}`,
})

registerTool({
  name: 'findings.read',
  description: 'Активные выводы диагностики компании (с типом происхождения и уверенностью).',
  permission: 'READ_CLIENT_DATA',
  companyScoped: true,
  args: z.object({}).strict(),
  handler: async (ctx) => {
    const rows = await activeFindings(company(ctx))
    return { findings: rows.map((r) => ({ ...r, reviewed_at: r.reviewed_at ? r.reviewed_at.toISOString() : null })) }
  },
  summarize: (r: { findings: unknown[] }) => `выводов ${r.findings.length}`,
})

registerTool({
  name: 'diagnostics.ai_cache',
  description: 'Проверить, анализировала ли модель ровно эти данные в прошлой завершённой сессии (тогда повторный вызов не нужен).',
  permission: 'READ_CLIENT_DATA',
  companyScoped: true,
  args: z.object({ input_hash: z.string().regex(/^[0-9a-f]{16,64}$/) }).strict(),
  handler: async (ctx, a) => {
    const stage = ownStage(ctx)
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM public.diagnostic_sessions
      WHERE company_id = ${company(ctx)} AND status = 'ready'
        AND stages -> ${stage} ->> 'input_hash' = ${a.input_hash}
        AND stages -> ${stage} ->> 'llm' = 'done'
      ORDER BY completed_at DESC LIMIT 1`
    return { hit: Boolean(rows[0]), session_id: rows[0]?.id ?? null }
  },
  summarize: (r: { hit: boolean }) => (r.hit ? 'данные не менялись' : 'новые данные'),
})

// ─── Findings and recommendations ────────────────────────────────────────────

const evidenceSchema = z.object({
  type: z.string().max(30),
  ref: z.string().max(200),
  field: z.string().max(100).optional(),
  value: z.union([z.string().max(500), z.number(), z.null()]).optional(),
  quote: z.string().max(300).optional(),
}).passthrough()

const findingSchema = z.object({
  key: z.string().min(1).max(300),
  kind: z.enum(['risk', 'gap', 'bottleneck', 'opportunity', 'strength', 'data_gap', 'anomaly', 'inconsistency']),
  area: z.string().min(1).max(40),
  title: z.string().min(1).max(300),
  body: z.string().max(2000).nullable().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  provenance: z.enum(['FACT', 'CALCULATED', 'INFERRED', 'AI_HYPOTHESIS']),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceSchema).min(1).max(12),
})

registerTool({
  name: 'findings.write',
  description: 'Записать полный текущий набор выводов этого агента (прежние, которых нет в наборе, станут superseded). variant "ai" — гипотезы модели, скрыты от клиента до проверки.',
  permission: 'CREATE_FINDINGS',
  companyScoped: true,
  args: z.object({
    variant: z.enum(['rules', 'ai']),
    findings: z.array(findingSchema).max(60),
    model: z.string().max(100).nullable().optional(),
    prompt_version: z.string().max(60).nullable().optional(),
  }).strict(),
  handler: async (ctx, a) => {
    const companyId = company(ctx)
    const producedBy = a.variant === 'ai' ? `agent:${ctx.agentKey}:ai` : `agent:${ctx.agentKey}`
    // Provenance follows the variant, not the payload.
    const drafts = a.findings.map((f) => ({
      ...f,
      provenance: a.variant === 'ai' ? 'AI_HYPOTHESIS' as const : f.provenance === 'AI_HYPOTHESIS' ? 'INFERRED' as const : f.provenance,
    }))
    const res = await replaceFindings({
      companyId, sessionId: ctx.sessionId, producedBy, agentRunId: ctx.runId,
      model: a.variant === 'ai' ? a.model ?? null : null, promptVersion: a.prompt_version ?? null,
    }, drafts)
    for (const c of res.newCritical) {
      await emit('CRITICAL_RISK_FOUND', ctx, {
        subjectType: 'diagnostic_finding', subjectId: c.id, dedupeKey: `critical_finding:${c.id}`,
        payload: { title: c.title, area: c.area, agent_key: ctx.agentKey, provenance: a.variant === 'ai' ? 'AI_HYPOTHESIS' : 'RULES', needs_review: a.variant === 'ai' },
      })
    }
    return { inserted: res.inserted, updated: res.updated, superseded: res.superseded, rejected: res.rejected, critical: res.newCritical.length }
  },
  summarize: (r: { inserted: number; updated: number; superseded: number }) => `новых ${r.inserted}, обновлено ${r.updated}, заменено ${r.superseded}`,
})

const recommendationSchema = z.object({
  key: z.string().min(1).max(300),
  area: z.string().min(1).max(40),
  title: z.string().min(1).max(300),
  body: z.string().max(2000).nullable().optional(),
  expectedImpact: z.string().max(300).nullable().optional(),
  effort: z.enum(['low', 'medium', 'high']).nullable().optional(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  horizonDays: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]).nullable().optional(),
  provenance: z.enum(['CALCULATED', 'INFERRED', 'AI_HYPOTHESIS', 'RECOMMENDATION']),
  confidence: z.number().min(0).max(1),
  findingIds: z.array(z.string().uuid()).max(12).optional(),
  visibleToClient: z.boolean(),
})

registerTool({
  name: 'recommendations.write',
  description: 'Записать текущий набор предложенных рекомендаций этого агента (прежние предложенные заменяются; принятые людьми не трогаются). variant "ai" — предложения модели, скрыты от клиента до проверки.',
  permission: 'CREATE_FINDINGS',
  companyScoped: true,
  args: z.object({
    variant: z.enum(['rules', 'ai']),
    recommendations: z.array(recommendationSchema).max(40),
    model: z.string().max(100).nullable().optional(),
    prompt_version: z.string().max(60).nullable().optional(),
  }).strict(),
  handler: async (ctx, a) => {
    const companyId = company(ctx)
    const ai = a.variant === 'ai'
    // Finding ids must belong to this company.
    const ids = [...new Set(a.recommendations.flatMap((r) => r.findingIds ?? []))]
    const owned = ids.length
      ? new Set((await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id::text FROM public.diagnostic_findings WHERE company_id = ${companyId} AND id = ANY(${ids}::uuid[])`).map((r) => r.id))
      : new Set<string>()
    const drafts = a.recommendations.map((r) => ({
      ...r,
      findingIds: (r.findingIds ?? []).filter((id) => owned.has(id)),
      visibleToClient: ai ? false : r.visibleToClient,
    }))
    const res = await replaceRecommendations({
      companyId, sessionId: ctx.sessionId, producedBy: ai ? `agent:${ctx.agentKey}:ai` : `agent:${ctx.agentKey}`,
      agentRunId: ctx.runId, model: ai ? a.model ?? 'unknown' : null, promptVersion: a.prompt_version ?? null,
    }, drafts)
    return res
  },
  summarize: (r: { inserted: number; superseded: number }) => `предложено ${r.inserted}, заменено ${r.superseded}`,
})

export const DIAGNOSTIC_TOOL_NAMES = [
  'session.open', 'session.stage', 'pipeline.advance', 'diagnostics.finalize', 'company.snapshot',
  'metrics.materialize', 'diagnostics.score', 'diagnostics.current', 'metrics.read', 'findings.read',
  'diagnostics.ai_cache', 'findings.write', 'recommendations.write',
] as const

export { DIAGNOSTIC_STAGES }
