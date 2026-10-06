/**
 * Monitoring agent — platform health without an LLM.
 *
 * Checks the things that silently rot: dead and stuck agent tasks, failure
 * rate, undispatched platform events, documents stuck in processing, overdue
 * approvals, failing CRM syncs and today's AI spend versus the platform
 * budget. Each check yields ok / warn / critical; anything not ok is logged as
 * an agent event and returned in the run result (the notification router turns
 * critical results into staff alerts).
 */
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { registerTool } from '../tools'
import type { AgentDefinition } from '../types'

export type CheckStatus = 'ok' | 'warn' | 'critical'

export interface HealthCheck {
  key: string
  label: string
  status: CheckStatus
  value: number
  detail: string
}

const n = (v: unknown) => Number(v ?? 0)

export async function platformHealthSnapshot(): Promise<HealthCheck[]> {
  const [q] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      (SELECT count(*) FROM public.agent_tasks WHERE status = 'dead' AND finished_at > now() - interval '24 hours') AS dead_24h,
      (SELECT count(*) FROM public.agent_tasks WHERE status = 'running' AND lease_until < now()) AS stuck,
      (SELECT count(*) FROM public.agent_tasks WHERE status = 'queued' AND run_after < now() - interval '15 minutes') AS backlog,
      (SELECT count(*) FROM public.agent_runs WHERE started_at > now() - interval '24 hours') AS runs_24h,
      (SELECT count(*) FROM public.agent_runs WHERE started_at > now() - interval '24 hours' AND status = 'failed') AS failed_24h,
      (SELECT count(*) FROM public.platform_events WHERE dispatched_at IS NULL AND created_at < now() - interval '5 minutes') AS undispatched,
      (SELECT count(*) FROM public.documents WHERE parse_status = 'processing' AND uploaded_at < now() - interval '30 minutes') AS docs_stuck,
      (SELECT count(*) FROM public.documents WHERE parse_status = 'queued' AND uploaded_at < now() - interval '1 hour') AS docs_queued,
      (SELECT count(*) FROM public.agent_approvals WHERE status = 'pending' AND requested_at < now() - interval '12 hours') AS approvals_overdue,
      (SELECT count(*) FROM public.crm_provider_connections WHERE is_active AND last_sync_status = 'error') AS crm_errors,
      (SELECT coalesce(sum(cost_usd), 0) FROM public.agent_runs WHERE started_at >= date_trunc('day', now())) AS spend_today`
  const budget = Number(process.env.AGENT_PLATFORM_DAILY_BUDGET_USD ?? 50)
  const runs = n(q.runs_24h)
  const failRate = runs ? n(q.failed_24h) / runs : 0
  const spend = n(q.spend_today)

  const check = (key: string, label: string, value: number, warnAt: number, critAt: number, detail: string): HealthCheck => ({
    key, label, value, detail,
    status: value >= critAt ? 'critical' : value >= warnAt ? 'warn' : 'ok',
  })

  return [
    check('agent_dead_24h', 'Агенты: задачи в dead-letter за 24 ч', n(q.dead_24h), 1, 5, 'исчерпаны все попытки'),
    check('agent_stuck', 'Агенты: зависшие задачи', n(q.stuck), 1, 3, 'аренда истекла, ждут повторного запуска'),
    check('agent_backlog', 'Агенты: очередь старше 15 мин', n(q.backlog), 5, 20, 'задачи ждут исполнителя — проверьте Inngest'),
    {
      key: 'agent_fail_rate', label: 'Агенты: доля неуспешных запусков за 24 ч', value: Math.round(failRate * 100),
      detail: `${n(q.failed_24h)} из ${runs}`,
      status: runs >= 5 && failRate >= 0.5 ? 'critical' : runs >= 5 && failRate >= 0.2 ? 'warn' : 'ok',
    },
    check('events_undispatched', 'События платформы без обработки', n(q.undispatched), 1, 10, 'outbox не разослан'),
    check('documents_stuck', 'Документы зависли в обработке (>30 мин)', n(q.docs_stuck), 1, 5, 'нужен перезапуск обработки'),
    check('documents_queued', 'Документы ждут обработки (>1 ч)', n(q.docs_queued), 1, 10, 'обработка не запущена'),
    check('approvals_overdue', 'Одобрения без решения (>12 ч)', n(q.approvals_overdue), 1, 5, 'агенты ждут человека'),
    check('crm_sync_errors', 'Интеграции CRM с ошибкой синхронизации', n(q.crm_errors), 1, 5, 'Bitrix24 / amoCRM'),
    {
      key: 'ai_spend_today', label: 'Расход ИИ сегодня, $', value: Math.round(spend * 100) / 100,
      detail: `бюджет платформы $${budget}`,
      status: spend >= budget ? 'critical' : spend >= budget * 0.8 ? 'warn' : 'ok',
    },
  ]
}

const healthTool = registerTool({
  name: 'platform.health_snapshot',
  description: 'Снимок здоровья платформы: очередь агентов, документы, интеграции, расход ИИ.',
  permission: 'READ_CLIENT_DATA',
  companyScoped: false,
  args: z.object({}).strict(),
  handler: async (ctx) => {
    ctx.source({ type: 'platform', ref: 'health_snapshot' })
    return platformHealthSnapshot()
  },
  summarize: (checks: HealthCheck[]) => `${checks.filter((c) => c.status !== 'ok').length} проблем из ${checks.length} проверок`,
})

export const monitoringAgent: AgentDefinition<Record<string, never>> = {
  key: 'monitoring',
  name: 'Monitoring Agent',
  description: 'Следит за очередью агентов, обработкой документов, интеграциями и расходом ИИ.',
  version: '1.0.0',
  scope: 'platform',
  tier: 'none',
  permissions: { READ_CLIENT_DATA: 'ALLOW', SEND_TELEGRAM: 'ALLOW' },
  tools: [healthTool.name],
  triggers: { cron: '*/15 * * * *' },
  limits: { maxAttempts: 2, leaseSeconds: 120, perRunBudgetUsd: 0, dailyBudgetUsd: 0, maxLlmCalls: 0, maxOutputTokens: 256 },
  inputSchema: z.object({}).passthrough() as unknown as z.ZodType<Record<string, never>>,
  async run(ctx) {
    const checks = await ctx.tool<HealthCheck[]>('platform.health_snapshot', {})
    const problems = checks.filter((c) => c.status !== 'ok')
    for (const p of problems) {
      await ctx.log(p.status === 'critical' ? 'error' : 'warn', `health.${p.key}`, `${p.label}: ${p.value} (${p.detail})`, {
        status: p.status, value: p.value,
      })
    }
    const critical = problems.filter((p) => p.status === 'critical').length
    return {
      summary: problems.length
        ? `проблем: ${problems.length} (критичных: ${critical})`
        : 'все проверки в норме',
      result: { checks, critical, warnings: problems.length - critical },
    }
  },
}
