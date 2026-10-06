/**
 * Agent tools of the `report` agent (docs/platform/05-agents.md §2).
 *
 *   report.snapshot        READ_CLIENT_DATA  build the frozen Point A snapshot of
 *                                            the company (in memory) and compare
 *                                            its data hash with the latest version
 *   report.create_version  CREATE_REPORT     rebuild the snapshot, check that the
 *                                            data did not change since
 *                                            report.snapshot, store it as a
 *                                            'ready' version, emit REPORT_GENERATED
 *
 * Rules the tools enforce whatever the agent passes:
 *   • both work on ctx.companyId only; a session id from the event is accepted
 *     only when it belongs to that company;
 *   • the content is built here from the database, never taken from arguments
 *     (the agent cannot put text into a report); the only model text is the
 *     optional narrative, stored as AI_HYPOTHESIS with model and prompt
 *     version, and accepted only when every number in it is in the snapshot;
 *   • a version is created in status 'ready' — publishing is a human action
 *     (GIGA, reports.publish), there is no tool for it;
 *   • the same data never creates a second version (data_hash), and
 *     REPORT_GENERATED is deduplicated per version.
 */
import { z } from 'zod'
import { AgentError } from '../types'
import { registerTool, type ToolContext } from '../tools'
import {
  acceptNarrative, buildPointAReportContent, narrativeInputText, NARRATIVE_PROMPT_VERSION, type SnapshotResult,
} from '@/lib/reports/snapshot'
import { createReadyVersion, latestVersion, loadSnapshotInputs, type VersionHead } from '@/lib/reports/versions'
import type { PointAReportContent, ReportProvenance } from '@/lib/reports/types'

export const REPORT_TOOL_NAMES = ['report.snapshot', 'report.create_version'] as const

function company(ctx: ToolContext): string {
  if (!ctx.companyId) throw new AgentError('NO_COMPANY', 'задача не привязана к компании')
  return ctx.companyId
}

async function build(companyId: string, sessionId: string | null): Promise<
  { ok: true; snap: SnapshotResult; sessionId: string } | { ok: false; reason: string; message: string }
> {
  const load = await loadSnapshotInputs(companyId, sessionId)
  if (!load.ok) return { ok: false, reason: load.reason, message: load.message }
  return { ok: true, snap: buildPointAReportContent({ ...load.inputs, generatedAt: new Date() }), sessionId: load.inputs.session.id }
}

async function narrativeEnabled(agentKey: string): Promise<boolean> {
  const { loadConfig } = await import('../store')
  const config = await loadConfig(agentKey)
  return config?.settings?.narrative === true
}

export interface ReportSnapshotToolResult {
  ready: boolean
  reason?: string
  message?: string
  session_id?: string
  diagnostic_id?: string
  data_hash?: string
  latest?: VersionHead | null
  /** The latest version already has exactly this data. */
  unchanged?: boolean
  counts?: { findings: number; recommendations: number; hidden_hypotheses: number; unreviewed_model_recommendations: number }
  /** agent_configs.settings.narrative === true */
  narrative_enabled?: boolean
  /** In-memory snapshot for the narrative prompt (never logged: only `summarize` is stored). */
  content?: PointAReportContent
}

registerTool({
  name: 'report.snapshot',
  description: 'Собрать снимок отчёта Точки А по данным компании (балл, блоки, видимые клиенту выводы и рекомендации, полнота, источники) и сравнить его хеш с последней версией отчёта.',
  permission: 'READ_CLIENT_DATA',
  companyScoped: true,
  args: z.object({ session_id: z.string().uuid().nullable().optional() }).strict(),
  handler: async (ctx, a): Promise<ReportSnapshotToolResult> => {
    const companyId = company(ctx)
    const b = await build(companyId, a.session_id ?? null)
    if (!b.ok) return { ready: false, reason: b.reason, message: b.message }
    const { snap } = b
    ctx.source({ type: 'diagnostic', ref: snap.content.diagnostic.id })
    ctx.source({ type: 'platform', ref: `diagnostic_session:${b.sessionId}` })
    const latest = await latestVersion(companyId, 'point_a')
    return {
      ready: true,
      session_id: b.sessionId,
      diagnostic_id: snap.content.diagnostic.id,
      data_hash: snap.dataHash,
      latest,
      unchanged: Boolean(latest && latest.data_hash === snap.dataHash && latest.status !== 'failed'),
      counts: {
        findings: snap.content.findings.length,
        recommendations: snap.content.recommendations.length,
        hidden_hypotheses: snap.excluded.hiddenHypotheses,
        unreviewed_model_recommendations: snap.excluded.unreviewedModelRecommendations,
      },
      narrative_enabled: await narrativeEnabled(ctx.agentKey),
      content: snap.content,
    }
  },
  summarize: (r: ReportSnapshotToolResult) =>
    !r.ready ? `нет данных: ${r.message ?? r.reason}`
    : r.unchanged ? `данные как в версии ${r.latest?.version}`
    : `выводов ${r.counts?.findings ?? 0}, рекомендаций ${r.counts?.recommendations ?? 0}, скрыто гипотез ${r.counts?.hidden_hypotheses ?? 0}`,
})

export const NARRATIVE_STATES = ['disabled', 'not_needed', 'done', 'unavailable', 'budget', 'denied', 'failed', 'rejected'] as const
export type NarrativeState = (typeof NARRATIVE_STATES)[number]

export interface CreateVersionToolResult {
  created: boolean
  id: string
  version: number
  status: string
  superseded: string[]
  narrative: { state: NarrativeState; reason: string | null }
}

registerTool({
  name: 'report.create_version',
  description: 'Сохранить снимок отчёта как новую версию в статусе «готов к проверке» (ready), если данные отличаются от последней версии; прежние неопубликованные версии становятся superseded. Публикует клиенту только сотрудник.',
  permission: 'CREATE_REPORT',
  companyScoped: true,
  args: z.object({
    expected_data_hash: z.string().regex(/^[0-9a-f]{64}$/),
    session_id: z.string().uuid().nullable().optional(),
    narrative_state: z.enum(NARRATIVE_STATES),
    narrative_reason: z.string().max(300).nullable().optional(),
    narrative_summary: z.string().max(2500).nullable().optional(),
    narrative_key_points: z.array(z.string().max(300)).max(6).nullable().optional(),
    narrative_model: z.string().max(100).nullable().optional(),
  }).strict(),
  redact: ['narrative_summary', 'narrative_key_points'],
  handler: async (ctx, a): Promise<CreateVersionToolResult> => {
    const companyId = company(ctx)
    const b = await build(companyId, a.session_id ?? null)
    if (!b.ok) throw new AgentError('NO_SNAPSHOT', `снимок не собран: ${b.message}`)
    const { snap } = b
    if (snap.dataHash !== a.expected_data_hash) {
      throw new AgentError('DATA_CHANGED', 'данные компании изменились во время сборки отчёта — повтор', true)
    }

    // The narrative is model text: accepted only when grounded in this very snapshot.
    let narrative: { state: NarrativeState; reason: string | null } = { state: a.narrative_state, reason: a.narrative_reason ?? null }
    const content: PointAReportContent = { ...snap.content }
    if (a.narrative_state === 'done') {
      if (!a.narrative_summary || !a.narrative_key_points?.length || !a.narrative_model) {
        narrative = { state: 'rejected', reason: 'нарратив неполный' }
      } else {
        const check = acceptNarrative({ summary: a.narrative_summary, key_points: a.narrative_key_points }, narrativeInputText(snap.content))
        if (check.ok) {
          content.narrative = { ...check.narrative, model: a.narrative_model, generated_at: content.generated_at }
        } else {
          narrative = { state: 'rejected', reason: check.reason }
        }
      }
    }

    const generatedAt = content.generated_at
    const provenance: ReportProvenance = {
      agent_key: ctx.agentKey,
      run_ids: [ctx.runId],
      model: content.narrative?.model ?? null,
      prompt_version: content.narrative ? NARRATIVE_PROMPT_VERSION : null,
      tools: content.narrative ? [...REPORT_TOOL_NAMES, 'llm.narrative'] : [...REPORT_TOOL_NAMES],
      sources: snap.sourceRefs,
      data_hash: snap.dataHash,
      generated_at: generatedAt,
      staff: {
        hidden_hypotheses: snap.excluded.hiddenHypotheses,
        unreviewed_model_recommendations: snap.excluded.unreviewedModelRecommendations,
        narrative,
      },
    }

    const res = await createReadyVersion({
      companyId,
      sessionId: b.sessionId,
      reportType: 'point_a',
      title: content.title,
      content,
      provenance,
      confidence: snap.confidence,
      dataHash: snap.dataHash,
      createdBy: `agent:${ctx.agentKey}`,
    })
    const head = res.created
      ? { id: res.id, version: res.version, status: 'ready' as const }
      : { id: res.unchanged.id, version: res.unchanged.version, status: res.unchanged.status }

    // One event per version (dedupe key). Re-emitting for an unchanged ready
    // version is a no-op unless an earlier attempt crashed before emitting.
    if (head.status === 'ready') {
      const { emitPlatformEvent } = await import('@/lib/events/platform')
      await emitPlatformEvent({
        name: 'REPORT_GENERATED',
        companyId,
        subjectType: 'report_version',
        subjectId: head.id,
        actor: `agent:${ctx.agentKey}`,
        dedupeKey: `report_generated:${head.id}`,
        payload: {
          report_version_id: head.id,
          report_type: 'point_a',
          version: head.version,
          session_id: b.sessionId,
          data_hash: snap.dataHash,
          findings: content.findings.length,
          recommendations: content.recommendations.length,
          hidden_hypotheses: snap.excluded.hiddenHypotheses,
          unreviewed_model_recommendations: snap.excluded.unreviewedModelRecommendations,
          narrative: narrative.state,
          agent_key: ctx.agentKey,
        },
      })
    }
    return {
      created: res.created,
      id: head.id,
      version: head.version,
      status: head.status,
      superseded: res.created ? res.superseded : [],
      narrative,
    }
  },
  summarize: (r: CreateVersionToolResult) =>
    r.created ? `версия ${r.version} создана (ready)` : `данные не изменились — версия ${r.version} остаётся`,
})
