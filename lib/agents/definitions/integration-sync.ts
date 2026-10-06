/**
 * integration_sync — synchronises connected e-commerce integrations (W7,
 * migration 105) and recalculates the metrics their facts feed.
 *
 * Platform scope, cron every 15 minutes (lib/functions/agents.ts
 * enqueueScheduledAgents; GET /api/cron/agents for other schedulers).
 * Deterministic, no model. Each run:
 *   1. integrations.sync_due (RUN_INTEGRATION): at most MAX_CONNECTIONS_PER_RUN
 *      due connections, each bounded by its adapter's request budget, the whole
 *      batch by RUN_DEADLINE_SECONDS. Cursors, needs_reauth on 401 and the
 *      INTEGRATION_FAILED platform event on repeated failures live in
 *      lib/integrations/sync.ts.
 *   2. integrations.refresh_metrics (UPDATE_METRICS) for the connections that
 *      wrote new facts: the company is resolved from the connection row (never
 *      from arguments) and must have synced within the last minutes.
 * Permission ceilings: RUN_INTEGRATION and UPDATE_METRICS are ALLOW at most
 * (lib/agents/permissions.ts); an admin may tighten them to REQUIRE_APPROVAL /
 * DENY in agent_permission_grants.
 */
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { runDueSyncs, type SyncOutcome } from '@/lib/integrations/sync'
import { registerTool } from '../tools'
import { AgentError, type AgentDefinition } from '../types'

export const MAX_CONNECTIONS_PER_RUN = 10
/** Stop starting new connections after this; requests stop at the same deadline. */
export const RUN_DEADLINE_SECONDS = 110
/** A connection counts as «just synced» for a metrics refresh within this window. */
const RECENT_SYNC_MINUTES = 15

export interface IntegrationsIO {
  /** Recalculate public.metrics of a company from all its inputs (incl. integration facts). */
  materialize(companyId: string): Promise<{ written: number; skipped: boolean }>
}

const defaultIO: IntegrationsIO = {
  async materialize(companyId) {
    const [{ createServiceClient }, { materializeForTenant, companyOwnerId }] = await Promise.all([
      import('@/lib/supabase-service'),
      import('@/lib/metrics/materialize-tenant'),
    ])
    const service = createServiceClient()
    const owner = await companyOwnerId(service, companyId)
    // Without a primary owner the inputs cannot be attributed (materialize-tenant rule).
    if (!owner) return { written: 0, skipped: true }
    const { result } = await materializeForTenant(service, service, { companyId, userId: owner })
    return { written: result.written, skipped: false }
  },
}

let io: IntegrationsIO = defaultIO

/** Recalculate a company's metrics after its integration facts changed (agent tool, GIGA «Синхронизировать»). */
export function refreshCompanyMetrics(companyId: string): Promise<{ written: number; skipped: boolean }> {
  return io.materialize(companyId)
}

/** Test seam: inject a materialiser (e.g. over the test database). */
export function __setIntegrationsIOForTests(next: IntegrationsIO | null): void {
  io = next ?? defaultIO
}

export const syncDueTool = registerTool({
  name: 'integrations.sync_due',
  description: 'Синхронизировать подключённые интеграции, у которых подошёл срок (ограничено числом подключений и временем).',
  permission: 'RUN_INTEGRATION',
  companyScoped: false,
  args: z.object({
    limit: z.number().int().min(1).max(MAX_CONNECTIONS_PER_RUN),
    deadline_seconds: z.number().int().min(5).max(RUN_DEADLINE_SECONDS),
  }).strict(),
  handler: async (ctx, a) => {
    const res = await runDueSyncs({ limit: a.limit, deadlineMs: Date.now() + a.deadline_seconds * 1000 })
    for (const o of res.outcomes) ctx.source({ type: 'integration', ref: `${o.provider}:${o.connectionId}` })
    return res
  },
  summarize: (r: { outcomes: SyncOutcome[] }) => {
    const synced = r.outcomes.filter((o) => o.status === 'synced').length
    return `подключений: ${r.outcomes.length}, успешно: ${synced}, фактов: ${r.outcomes.reduce((s, o) => s + o.factsWritten, 0)}`
  },
})

export const refreshMetricsTool = registerTool({
  name: 'integrations.refresh_metrics',
  description: 'Пересчитать метрики компании после синхронизации её интеграции (компания определяется по подключению).',
  permission: 'UPDATE_METRICS',
  companyScoped: false,
  args: z.object({ connection_id: z.string().uuid() }).strict(),
  handler: async (ctx, a) => {
    const rows = await prisma.$queryRaw<Array<{ company_id: string }>>`
      SELECT company_id FROM public.integration_connections
      WHERE id = ${a.connection_id}::uuid
        AND last_sync_at > now() - make_interval(mins => ${RECENT_SYNC_MINUTES}::int)`
    const companyId = rows[0]?.company_id
    if (!companyId) throw new AgentError('NOT_RECENTLY_SYNCED', 'подключение не синхронизировалось в этом запуске')
    ctx.source({ type: 'integration', ref: a.connection_id })
    return { companyId, ...(await refreshCompanyMetrics(companyId)) }
  },
  summarize: (r: { written: number; skipped: boolean }) => (r.skipped ? 'у компании нет владельца — пересчёт пропущен' : `метрик записано: ${r.written}`),
})

export const integrationSyncAgent: AgentDefinition<Record<string, never>> = {
  key: 'integration_sync',
  name: 'Синхронизация интеграций',
  description: 'Забирает заказы, выручку, возвраты, остатки и трафик из подключённых МоегоСклада, Kaspi, Wildberries, GA4, Метрики и Shopify и обновляет метрики.',
  version: '1.0.0',
  scope: 'platform',
  tier: 'none',
  permissions: { RUN_INTEGRATION: 'ALLOW', UPDATE_METRICS: 'ALLOW' },
  tools: [syncDueTool.name, refreshMetricsTool.name],
  triggers: { cron: '*/15 * * * *' },
  limits: {
    maxAttempts: 1,
    leaseSeconds: 180,
    perRunBudgetUsd: 0,
    dailyBudgetUsd: 0,
    maxLlmCalls: 0,
    maxOutputTokens: 256,
    // Deadline 110 s + one in-flight request (≤ 25 s) + bookkeeping; fits the 300 s drain.
    maxRunSeconds: 150,
  },
  inputSchema: z.object({}).passthrough() as unknown as z.ZodType<Record<string, never>>,

  async run(ctx) {
    const res = await ctx.tool<{ outcomes: SyncOutcome[]; companiesWithNewFacts: string[] }>('integrations.sync_due', {
      limit: MAX_CONNECTIONS_PER_RUN,
      deadline_seconds: RUN_DEADLINE_SECONDS,
    })
    let refreshed = 0
    const seen = new Set<string>()
    for (const o of res.outcomes) {
      if (o.status !== 'synced' || o.factsWritten === 0 || seen.has(o.companyId)) continue
      seen.add(o.companyId)
      try {
        await ctx.tool('integrations.refresh_metrics', { connection_id: o.connectionId })
        refreshed += 1
      } catch (err) {
        // A failed recalculation does not undo the synced facts; the next sync retries it.
        await ctx.log('warn', 'integrations.refresh_failed', `пересчёт метрик не выполнен (${o.provider})`, {
          error: err instanceof Error ? err.message.slice(0, 200) : 'error',
        })
      }
    }
    for (const o of res.outcomes.filter((x) => x.status !== 'synced')) {
      await ctx.log(o.status === 'needs_reauth' || o.alerted ? 'error' : 'warn', `integrations.${o.status}`, `${o.provider}: ${o.message ?? o.status}`, {
        connection_id: o.connectionId, error_kind: o.errorKind ?? null,
      })
    }
    const synced = res.outcomes.filter((o) => o.status === 'synced').length
    return {
      summary: res.outcomes.length
        ? `подключений: ${res.outcomes.length}, успешно: ${synced}, метрики пересчитаны: ${refreshed}`
        : 'нет подключений к синхронизации',
      result: {
        outcomes: res.outcomes.map(({ connectionId, provider, status, factsWritten, errorKind, alerted }) => ({ connectionId, provider, status, factsWritten, errorKind, alerted })),
        refreshed,
      },
    }
  },
}
