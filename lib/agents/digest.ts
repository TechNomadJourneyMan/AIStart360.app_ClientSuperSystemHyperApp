/**
 * lib/agents/digest.ts — the daily agents digest for the admin bot.
 *
 * /api/cron/agents-digest runs it at 09:00 Asia/Almaty (vercel.json "0 4 * * *").
 * Switch: agents_daily_digest (default ON). Recipients: linked staff whose
 * role has agents.view — a scheduled digest they opted into, so level
 * thresholds and quiet hours do not hold it back; a personal mute does. The
 * GIGA feed gets the same row. One digest per local day (dedupe key).
 *
 *   last 24 h   runs, succeeded, failed; tasks that went to dead-letter
 *   now         queued / running tasks, pending approvals
 *   AI spend    today so far and yesterday (local days): agent runs
 *               (agent_runs.cost_usd) + other features (ai_usage_ledger)
 *   top errors  most frequent error codes of failed runs, per agent
 */
import { prisma } from '@/lib/db'
import { addDays, localDate, startOfLocalDay } from '@/lib/automation/time'
import { notifyStaff, type NotifyResult } from '@/lib/notifications/staff'
import { getSiteUrl } from '@/lib/site-url'
import { agentsTimeZone, automationEnabled } from './automation'
import { getAgent } from './registry'

export interface AgentsDigestData {
  /** Local date the digest is for (YYYY-MM-DD). */
  date: string
  runs: number
  succeeded: number
  failed: number
  dead: number
  queued: number
  running: number
  pendingApprovals: number
  spend: {
    today: { total: number; agents: number }
    yesterday: { total: number; agents: number }
  }
  topErrors: Array<{ code: string; agentKey: string; count: number }>
}

const n = (v: unknown) => (v == null ? 0 : Number(v))

export async function collectAgentsDigest(now: Date, timeZone = agentsTimeZone()): Promise<AgentsDigestData> {
  const date = localDate(now, timeZone)
  const todayStart = startOfLocalDay(date, timeZone)
  const yesterdayStart = startOfLocalDay(addDays(date, -1), timeZone)
  const since = new Date(now.getTime() - 24 * 3_600_000)

  const [[runs], [tasks], [approvals], [agentSpend], topErrors] = await Promise.all([
    prisma.$queryRaw<Array<{ runs: unknown; ok: unknown; failed: unknown }>>`
      SELECT count(*) AS runs,
             count(*) FILTER (WHERE status = 'succeeded') AS ok,
             count(*) FILTER (WHERE status = 'failed') AS failed
      FROM public.agent_runs WHERE started_at >= ${since}`,
    prisma.$queryRaw<Array<{ dead: unknown; queued: unknown; running: unknown }>>`
      SELECT count(*) FILTER (WHERE status = 'dead' AND finished_at >= ${since}) AS dead,
             count(*) FILTER (WHERE status = 'queued') AS queued,
             count(*) FILTER (WHERE status = 'running') AS running
      FROM public.agent_tasks
      WHERE status IN ('queued', 'running') OR (status = 'dead' AND finished_at >= ${since})`,
    prisma.$queryRaw<Array<{ pending: unknown }>>`
      SELECT count(*) AS pending FROM public.agent_approvals WHERE status = 'pending' AND expires_at > now()`,
    prisma.$queryRaw<Array<{ today: unknown; yesterday: unknown }>>`
      SELECT coalesce(sum(cost_usd) FILTER (WHERE started_at >= ${todayStart}), 0) AS today,
             coalesce(sum(cost_usd) FILTER (WHERE started_at < ${todayStart}), 0) AS yesterday
      FROM public.agent_runs WHERE started_at >= ${yesterdayStart}`,
    prisma.$queryRaw<Array<{ code: string; agent_key: string; count: unknown }>>`
      SELECT coalesce(error_code, 'UNKNOWN') AS code, agent_key, count(*) AS count
      FROM public.agent_runs
      WHERE started_at >= ${since} AND status = 'failed'
      GROUP BY 1, 2 ORDER BY 3 DESC, 1 LIMIT 5`,
  ])
  let ledger = { today: 0, yesterday: 0 }
  try {
    const [l] = await prisma.$queryRaw<Array<{ today: unknown; yesterday: unknown }>>`
      SELECT coalesce(sum(cost_usd) FILTER (WHERE created_at >= ${todayStart}), 0) AS today,
             coalesce(sum(cost_usd) FILTER (WHERE created_at < ${todayStart}), 0) AS yesterday
      FROM public.ai_usage_ledger WHERE created_at >= ${yesterdayStart}`
    ledger = { today: n(l?.today), yesterday: n(l?.yesterday) }
  } catch (err) {
    // Before migration 093 there is no ledger: agents only.
    if (!/ai_usage_ledger/.test(err instanceof Error ? err.message : '')) throw err
  }
  const agentsToday = n(agentSpend?.today)
  const agentsYesterday = n(agentSpend?.yesterday)
  return {
    date,
    runs: n(runs?.runs),
    succeeded: n(runs?.ok),
    failed: n(runs?.failed),
    dead: n(tasks?.dead),
    queued: n(tasks?.queued),
    running: n(tasks?.running),
    pendingApprovals: n(approvals?.pending),
    spend: {
      today: { total: agentsToday + ledger.today, agents: agentsToday },
      yesterday: { total: agentsYesterday + ledger.yesterday, agents: agentsYesterday },
    },
    topErrors: topErrors.map((e) => ({ code: e.code, agentKey: e.agent_key, count: n(e.count) })),
  }
}

function money(v: number): string {
  return v >= 100 ? `$${v.toFixed(0)}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`
}

function dayLabel(date: string): string {
  const [, m, d] = date.split('-')
  return `${d}.${m}`
}

/** Nothing happened and nothing waits: no digest. */
export function digestIsEmpty(d: AgentsDigestData): boolean {
  return !d.runs && !d.dead && !d.queued && !d.running && !d.pendingApprovals && !d.spend.today.total && !d.spend.yesterday.total
}

/** Title and plain-text lines of the digest (escaped by notifyStaff). */
export function formatAgentsDigest(d: AgentsDigestData, nameOf: (key: string) => string = (k) => getAgent(k)?.name ?? k): { title: string; lines: string[] } {
  const rate = d.runs ? Math.round((d.succeeded / d.runs) * 100) : null
  const lines = [
    `За сутки запусков: ${d.runs} · успешно ${d.succeeded}${rate !== null ? ` (${rate}%)` : ''} · с ошибкой ${d.failed}`,
    `В dead-letter за сутки: ${d.dead}`,
    `Сейчас: в очереди ${d.queued} · выполняются ${d.running}`,
    `Ждут одобрения: ${d.pendingApprovals}`,
    `Расход ИИ: сегодня ${money(d.spend.today.total)} (агенты ${money(d.spend.today.agents)}) · вчера ${money(d.spend.yesterday.total)} (агенты ${money(d.spend.yesterday.agents)})`,
  ]
  if (d.topErrors.length) {
    lines.push('', 'Частые ошибки:')
    for (const e of d.topErrors) lines.push(`• ${e.code} × ${e.count} — ${nameOf(e.agentKey)}`)
  }
  return { title: `Сводка ИИ-агентов на ${dayLabel(d.date)}`, lines }
}

export type DigestOutcome =
  | { status: 'disabled' }
  | { status: 'empty'; date: string }
  | { status: 'sent'; date: string; result: NotifyResult }

export async function runAgentsDigest(now = new Date(), deps: { notify?: typeof notifyStaff } = {}): Promise<DigestOutcome> {
  if (!(await automationEnabled('agents_daily_digest'))) return { status: 'disabled' }
  const data = await collectAgentsDigest(now)
  if (digestIsEmpty(data)) return { status: 'empty', date: data.date }
  const { title, lines } = formatAgentsDigest(data)
  const result = await (deps.notify ?? notifyStaff)({
    // INFO: the digest goes to the admin bot (scheduled) and the feed, not to WhatsApp / email.
    level: 'INFO',
    type: 'agent.digest',
    title,
    lines,
    dedupeKey: `agent:digest:${data.date}`,
    link: '/admin-giga-panel/agents',
    audiencePermission: 'agents.view',
    scheduled: true,
    telegramKeyboard: () => {
      const url = getSiteUrl('/admin-giga-panel/agents')
      return url.startsWith('https://') ? [[{ text: '🔎 Открыть агентов', url }]] : []
    },
  })
  return { status: 'sent', date: data.date, result }
}
