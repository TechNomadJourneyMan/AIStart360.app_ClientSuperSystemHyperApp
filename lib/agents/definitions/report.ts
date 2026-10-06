/**
 * The `report` agent (docs/platform/05-agents.md §2): turns a finished
 * diagnostic session into a frozen, versioned Point A report with provenance.
 *
 *   trigger  DIAGNOSTIC_COMPLETED (the session of the event) or a manual run
 *            from GIGA (the latest ready session)
 *   output   report_versions row in status 'ready' + REPORT_GENERATED.
 *            A person publishes it to the client in GIGA; this agent has no
 *            way to publish.
 *
 * Deterministic by default ($0). The executive narrative by the premium
 * model is OFF unless agent_configs.settings = {"narrative": true}; then it
 * runs only when the data changed (the same data never reaches the model
 * twice), under the run budget, built only from the snapshot (fenced, without
 * company name or contact data), and the version is created without it —
 * with the reason recorded — when there is no key, no budget, no permission,
 * or the text states numbers that are not in the data.
 */
import { z } from 'zod'
import { hasLlmKey } from '@/lib/ai/gateway'
import { NARRATIVE_PROMPT_VERSION, NarrativeSchema, acceptNarrative, narrativePrompt, type NarrativeOutput } from '@/lib/reports/snapshot'
import type { PointAReportContent } from '@/lib/reports/types'
import '../tools/reports'
import type { CreateVersionToolResult, NarrativeState, ReportSnapshotToolResult } from '../tools/reports'
import { AgentError, type AgentContext, type AgentDefinition } from '../types'

const input = z.object({
  session_id: z.string().uuid().optional(),
  event: z.object({
    id: z.number().optional(),
    name: z.string(),
    subject_type: z.string().nullable().optional(),
    subject_id: z.string().nullable().optional(),
    payload: z.record(z.unknown()).optional(),
  }).optional(),
}).passthrough()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sessionOf(i: z.infer<typeof input>): string | null {
  const fromPayload = i.event?.payload?.session_id
  if (typeof fromPayload === 'string' && UUID.test(fromPayload)) return fromPayload
  if (i.event?.subject_type === 'diagnostic_session' && i.event.subject_id && UUID.test(i.event.subject_id)) return i.event.subject_id
  return i.session_id ?? null
}

const NARRATIVE_TEXT: Record<NarrativeState, string> = {
  disabled: 'резюме модели выключено',
  not_needed: 'резюме модели не нужно',
  done: 'резюме модели добавлено',
  unavailable: 'модель не настроена — резюме не добавлено',
  budget: 'бюджет ИИ исчерпан — резюме не добавлено',
  denied: 'вызов модели запрещён правами — резюме не добавлено',
  failed: 'модель не ответила — резюме не добавлено',
  rejected: 'резюме отклонено проверкой — не добавлено',
}

type Narrative =
  | { state: 'done'; data: NarrativeOutput; model: string }
  | { state: Exclude<NarrativeState, 'done'>; reason: string | null }

/** One budgeted premium call; never retried (a report without a narrative is a valid report). */
async function narrativeFor(ctx: AgentContext, content: PointAReportContent): Promise<Narrative> {
  if (!hasLlmKey()) return { state: 'unavailable', reason: 'OPENROUTER_API_KEY не задан' }
  const prompt = narrativePrompt(content)
  let res
  try {
    res = await ctx.llmJson<NarrativeOutput>({ system: prompt.system, user: prompt.user, schema: NarrativeSchema, temperature: 0.3 })
  } catch (err) {
    if (err instanceof AgentError && (err.code === 'BUDGET_EXCEEDED' || err.code === 'LLM_CALL_LIMIT')) return { state: 'budget', reason: err.message }
    if (err instanceof AgentError && err.code === 'PERMISSION_DENIED') return { state: 'denied', reason: err.message }
    throw err
  }
  if (!res.ok) return { state: 'failed', reason: `${res.error}: ${res.message}`.slice(0, 300) }
  const check = acceptNarrative(res.data, prompt.text)
  if (!check.ok) return { state: 'rejected', reason: check.reason }
  return { state: 'done', data: res.data, model: res.usage.model }
}

export const reportAgent: AgentDefinition<z.infer<typeof input>> = {
  key: 'report',
  name: 'Отчёт',
  description: 'Собирает версию отчёта Точки А из завершённой диагностики: баллы, видимые клиенту выводы и рекомендации с происхождением и уверенностью, полнота данных и источники. Версия ждёт проверки; публикует клиенту только сотрудник.',
  version: '1.0.0',
  scope: 'company',
  tier: 'premium',
  promptVersion: NARRATIVE_PROMPT_VERSION,
  // CALL_LLM is used only for the optional narrative (agent_configs.settings.narrative).
  permissions: { READ_CLIENT_DATA: 'ALLOW', CREATE_REPORT: 'ALLOW', CALL_LLM: 'ALLOW' },
  tools: ['report.snapshot', 'report.create_version'],
  triggers: { events: ['DIAGNOSTIC_COMPLETED'] },
  limits: { maxAttempts: 3, leaseSeconds: 300, perRunBudgetUsd: 1, dailyBudgetUsd: 10, maxLlmCalls: 1, maxOutputTokens: 1500 },
  inputSchema: input,
  async run(ctx, i) {
    const sessionId = sessionOf(i)
    const snap = await ctx.tool<ReportSnapshotToolResult>('report.snapshot', { session_id: sessionId })
    if (!snap.ready || !snap.data_hash || !snap.content) {
      return { summary: `отчёт не сформирован: ${snap.message ?? snap.reason ?? 'нет данных'}`, result: { skipped: snap.reason ?? 'no_data' } }
    }

    let narrative: Narrative = { state: snap.narrative_enabled ? 'not_needed' : 'disabled', reason: null }
    if (snap.narrative_enabled && !snap.unchanged) {
      narrative = await narrativeFor(ctx, snap.content)
      if (narrative.state !== 'done') {
        await ctx.log('warn', 'report.narrative_skipped', `резюме модели не добавлено: ${narrative.reason ?? narrative.state}`, { state: narrative.state })
      }
    }

    const created = await ctx.tool<CreateVersionToolResult>('report.create_version', {
      expected_data_hash: snap.data_hash,
      session_id: snap.session_id ?? sessionId,
      narrative_state: narrative.state,
      narrative_reason: narrative.state === 'done' ? null : narrative.reason,
      ...(narrative.state === 'done'
        ? { narrative_summary: narrative.data.summary, narrative_key_points: narrative.data.key_points, narrative_model: narrative.model }
        : {}),
    })

    const counts = snap.counts!
    const hidden = counts.hidden_hypotheses + counts.unreviewed_model_recommendations
    const result = {
      created: created.created,
      report_version_id: created.id,
      version: created.version,
      status: created.status,
      session_id: snap.session_id,
      data_hash: snap.data_hash,
      findings: counts.findings,
      recommendations: counts.recommendations,
      hidden_hypotheses: counts.hidden_hypotheses,
      unreviewed_model_recommendations: counts.unreviewed_model_recommendations,
      superseded: created.superseded.length,
      narrative: created.narrative.state,
      narrative_reason: created.narrative.reason,
    }
    if (!created.created) {
      return { summary: `данные не изменились с версии ${created.version} — новая версия не создана`, result: { ...result, unchanged: true } }
    }
    return {
      summary: `версия ${created.version} готова к проверке: выводов ${counts.findings}, рекомендаций ${counts.recommendations}`
        + `${hidden ? `; не вошло без проверки сотрудником: ${hidden}` : ''}; ${NARRATIVE_TEXT[created.narrative.state]}`,
      result,
    }
  },
}
