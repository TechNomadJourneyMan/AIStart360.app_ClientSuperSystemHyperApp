'use client'

/**
 * «ИИ-агенты» — one card per registered agent with config, triggers, 7-day
 * performance, cost and queue, plus a platform summary. Everything comes from
 * GET /api/giga-admin/agents; the enable switch (kill switch) needs
 * agents.manage, «Запустить» needs agents.run.
 */
import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangle, Bot, CalendarClock, Coins, Hourglass, ListChecks, Play, RefreshCw, Stamp, Zap } from 'lucide-react'
import { RequirePermission, useStaff } from '../StaffContext'
import { useWorkspace } from '../WorkspaceContext'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorState, PageHeader, Skeleton, StatTile, cx, fmtAgo, fmtDateTime, gigaFetch, useGigaQuery,
} from '../kit'
import { PLATFORM_EVENT_LABELS, type PlatformEventName } from '@/lib/events/platform-names'
import {
  fmtDuration, fmtPercent, fmtTokens, fmtUsd, runStatusMeta, scopeLabel, summarizeAgents, tierLabel,
} from './model'
import { RunAgentDialog, type RunnableAgent } from './RunAgentDialog'
import type { AgentOverview, AgentsListResponse } from './types'
import { Metric, NoRightHint, StatusChip, Toggle } from './ui'

export function AgentsOverviewPage() {
  const { can } = useStaff()
  const { base } = useWorkspace()
  const q = useGigaQuery<AgentsListResponse>('/api/giga-admin/agents')
  const canRun = can('agents.run') && (q.data?.can.run ?? true)
  const canManage = can('agents.manage') && (q.data?.can.manage ?? true)
  const [runFor, setRunFor] = useState<RunnableAgent | null>(null)
  const [confirmOff, setConfirmOff] = useState<AgentOverview | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const setEnabled = async (agent: AgentOverview, enabled: boolean): Promise<boolean> => {
    setSaving(agent.key)
    try {
      await gigaFetch(`/api/giga-admin/agents/${encodeURIComponent(agent.key)}`, { method: 'PATCH', json: { enabled } })
      q.setData((d) => (d ? { ...d, agents: d.agents.map((a) => (a.key === agent.key ? { ...a, enabled, nextRunAt: enabled ? a.nextRunAt : null } : a)) } : d))
      toast.success(`${agent.name}: ${enabled ? 'включён' : 'выключен'}`)
      if (enabled) void q.reload() // next scheduled run is computed by the server
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить')
      return false
    } finally {
      setSaving(null)
    }
  }

  const agents = q.data?.agents ?? []
  const sum = summarizeAgents(agents)

  return (
    <RequirePermission permission="agents.view">
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: base }, { label: 'ИИ-агенты' }]}
        title="ИИ-агенты"
        description="Кто из агентов включён, как часто и насколько успешно работает, сколько стоит и что ждёт в очереди. Данные за последние 7 дней."
        actions={
          <>
            <Link href={`${base}/agents/tasks`} className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.1] bg-white/[0.05] px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-white/[0.09]"><ListChecks size={13} /> Задачи</Link>
            <Link href={`${base}/agents/approvals`} className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.1] bg-white/[0.05] px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-white/[0.09]"><Stamp size={13} /> Одобрения</Link>
            <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={q.loading && !!q.data} onClick={() => void q.reload()}>Обновить</Button>
          </>
        }
      />

      {q.error && <div className="mb-4"><ErrorState error={q.error} onRetry={() => void q.reload()} /></div>}

      {!q.data && q.loading && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
          <div className="grid gap-4 xl:grid-cols-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-80" />)}</div>
        </>
      )}

      {q.data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Агенты" value={`${sum.enabled} / ${sum.total}`} hint="включено / всего" icon={<Bot size={14} />} />
            <StatTile label="Запусков за 7 дней" value={sum.runs7d.toLocaleString('ru-RU')} hint={`с ошибкой: ${sum.failed7d}`} icon={<Zap size={14} />} tone={sum.failed7d ? 'amber' : 'blue'} href={`${base}/agents/tasks`} />
            <StatTile label="Расход ИИ сегодня" value={fmtUsd(sum.costToday)} hint={`за 7 дней: ${fmtUsd(sum.cost7d)}`} icon={<Coins size={14} />} href={`${base}/agents/costs`} />
            <StatTile label="Ждут одобрения" value={sum.awaiting} hint="задачи ждут решения человека" icon={<Stamp size={14} />} tone={sum.awaiting ? 'amber' : 'neutral'} href={`${base}/agents/approvals`} />
            <StatTile label="Dead-letter за 24 ч" value={sum.dead24h} hint="исчерпаны все попытки" icon={<AlertTriangle size={14} />} tone={sum.dead24h ? 'red' : 'neutral'} href={`${base}/agents/tasks?status=dead`} />
            <StatTile label="В работе" value={sum.queued + sum.running} hint={`в очереди ${sum.queued} · выполняется ${sum.running}`} icon={<Hourglass size={14} />} tone="violet" href={`${base}/agents/tasks?status=queued`} />
          </div>

          {agents.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03]">
              <EmptyState
                icon={<Bot size={18} />}
                title="Агенты не зарегистрированы"
                text="Определения агентов живут в коде (lib/agents/definitions). Когда агент будет добавлен и задеплоен, он появится здесь."
              />
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {agents.map((a) => (
                <AgentCard
                  key={a.key}
                  agent={a}
                  base={base}
                  canRun={canRun}
                  canManage={canManage}
                  saving={saving === a.key}
                  onToggle={(next) => (next ? void setEnabled(a, true) : setConfirmOff(a))}
                  onRun={() => setRunFor({ key: a.key, name: a.name, scope: a.scope, enabled: a.enabled })}
                />
              ))}
            </div>
          )}
        </>
      )}

      <RunAgentDialog
        agent={runFor}
        open={!!runFor}
        base={base}
        onClose={() => setRunFor(null)}
        onStarted={() => void q.reload()}
      />

      <ConfirmDialog
        open={!!confirmOff}
        onClose={() => setConfirmOff(null)}
        title={confirmOff ? `Выключить агента «${confirmOff.name}»?` : ''}
        text={
          <>
            Новые задачи агента — по событиям, расписанию и вручную — перестанут создаваться.
            Задачи, которые уже стоят в очереди, этим не отменяются: при необходимости отмените их в «Задачах агентов».
            Изменение записывается в журнал аудита.
          </>
        }
        confirmLabel="Выключить"
        loading={!!saving}
        onConfirm={async () => {
          if (!confirmOff) return
          if (await setEnabled(confirmOff, false)) setConfirmOff(null)
        }}
      />
    </RequirePermission>
  )
}

export function eventLabel(name: string): string {
  return PLATFORM_EVENT_LABELS[name as PlatformEventName] ?? name
}

export function AgentTriggers({ agent }: { agent: Pick<AgentOverview, 'triggers' | 'nextRunAt' | 'enabled' | 'scope'> }) {
  const { events, cron } = agent.triggers
  if (!events.length && !cron) return <p className="text-[11px] text-slate-500">Только ручной запуск или по команде другого агента.</p>
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {events.map((e) => <Badge key={e} tone="blue" title={e}><Zap size={10} /> {eventLabel(e)}</Badge>)}
      {cron && (
        <Badge tone="violet" title="Расписание cron, UTC">
          <CalendarClock size={10} /> <span className="font-mono">{cron}</span>
        </Badge>
      )}
      {cron && agent.scope === 'platform' && (
        <span className="text-[10px] text-slate-500">
          {!agent.enabled ? 'расписание на паузе — агент выключен' : agent.nextRunAt ? `следующий запуск ${fmtDateTime(agent.nextRunAt)}` : 'в ближайшие дни запусков нет'}
        </span>
      )}
    </div>
  )
}

function AgentCard({ agent, base, canRun, canManage, saving, onToggle, onRun }: {
  agent: AgentOverview
  base: string
  canRun: boolean
  canManage: boolean
  saving: boolean
  onToggle: (next: boolean) => void
  onRun: () => void
}) {
  const s = agent.stats
  const href = `${base}/agents/${encodeURIComponent(agent.key)}`
  const tasksHref = (status: string) => `${base}/agents/tasks?agent=${encodeURIComponent(agent.key)}&status=${status}`
  const errTone = s.errorRate == null ? undefined : s.errorRate >= 0.5 ? 'red' : s.errorRate >= 0.2 ? 'amber' : undefined
  const okTone = s.successRate == null ? undefined : s.successRate >= 0.9 ? 'green' : s.successRate < 0.5 ? 'red' : undefined
  const headingId = `agent-${agent.key}`

  return (
    <section aria-labelledby={headingId} className={cx('flex flex-col gap-3 rounded-2xl border bg-white/[0.03] p-4', agent.enabled ? 'border-white/[0.07]' : 'border-white/[0.05] opacity-90')}>
      <header className="flex items-start gap-3">
        <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', agent.enabled ? 'border-blue-500/30 bg-blue-500/15 text-blue-300' : 'border-white/[0.08] bg-white/[0.04] text-slate-500')}>
          <Bot size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="truncate text-sm font-semibold text-slate-100">
            <Link href={href} className="hover:text-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">{agent.name}</Link>
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
            <span className="font-mono">{agent.key}</span>
            <span>· v{agent.version}</span>
            <Badge tone={agent.enabled ? 'green' : 'neutral'}>{agent.enabled ? 'включён' : 'выключен'}</Badge>
            <Badge>{scopeLabel(agent.scope)}</Badge>
          </p>
        </div>
        {canManage ? (
          <Toggle checked={agent.enabled} disabled={saving} onChange={onToggle} label={agent.enabled ? `Выключить агента ${agent.name}` : `Включить агента ${agent.name}`} />
        ) : null}
      </header>

      <p className="line-clamp-2 text-xs leading-relaxed text-slate-400">{agent.description}</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span>Модель: <span className="text-slate-300">{tierLabel(agent.tier)}</span>{agent.model ? <span className="ml-1 font-mono text-slate-300">· {agent.model}</span> : agent.tier !== 'none' ? <span className="ml-1">· по tier</span> : null}</span>
        {agent.promptVersion && <span>Промпт: <span className="font-mono text-slate-300">{agent.promptVersion}</span></span>}
      </div>

      <AgentTriggers agent={agent} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Успешных" value={fmtPercent(s.successRate)} tone={okTone} hint={s.runs7d ? `${s.succeeded7d} из ${s.runs7d}` : 'нет запусков'} />
        <Metric label="С ошибкой" value={fmtPercent(s.errorRate)} tone={errTone} hint={s.runs7d ? `${s.failed7d} из ${s.runs7d}` : undefined} />
        <Metric label="Запусков 7 дн" value={s.runs7d.toLocaleString('ru-RU')} />
        <Metric label="Среднее время" value={fmtDuration(s.avgDurationMs)} />
        <Metric label="Токены 7 дн" value={fmtTokens(s.tokensIn7d + s.tokensOut7d)} hint={`вх. ${fmtTokens(s.tokensIn7d)} · вых. ${fmtTokens(s.tokensOut7d)}`} />
        <Metric label="Расход 7 дн" value={fmtUsd(s.costUsd7d)} hint={`лимит/день ${fmtUsd(agent.limits.dailyBudgetUsd)}`} />
        <Metric label="Сегодня" value={fmtUsd(s.costUsdToday)} tone={agent.limits.dailyBudgetUsd > 0 && s.costUsdToday >= agent.limits.dailyBudgetUsd ? 'red' : undefined} />
        <Metric label="Лимит запуска" value={fmtUsd(agent.limits.perRunBudgetUsd)} />
      </div>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <QueueLink href={tasksHref('queued')} label="В очереди" n={s.queued} tone="blue" />
        <QueueLink href={tasksHref('running')} label="Выполняется" n={s.running} tone="violet" />
        <QueueLink href={tasksHref('awaiting_approval')} label="Ждут одобрения" n={s.awaitingApproval} tone="amber" />
        <QueueLink href={tasksHref('dead')} label="Dead за 24 ч" n={s.dead24h} tone="red" />
      </div>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05] pt-3">
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
          Последний запуск:
          {s.lastRunAt ? (
            <>
              <StatusChip meta={runStatusMeta(s.lastRunStatus)} />
              <time dateTime={s.lastRunAt} title={fmtDateTime(s.lastRunAt)}>{fmtAgo(s.lastRunAt)}</time>
            </>
          ) : <span className="text-slate-400">ещё не было</span>}
        </p>
        <div className="flex items-center gap-2">
          {canRun ? (
            <Button size="sm" variant="secondary" icon={<Play size={12} />} disabled={!agent.enabled} title={agent.enabled ? undefined : 'Агент выключен'} onClick={onRun}>
              Запустить
            </Button>
          ) : (
            <NoRightHint>запуск — право «ИИ-агенты: запуск»</NoRightHint>
          )}
          <Link href={href} className="inline-flex items-center rounded-xl border border-blue-400/40 bg-blue-500 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
            Открыть
          </Link>
        </div>
      </footer>
    </section>
  )
}

function QueueLink({ href, label, n, tone }: { href: string; label: string; n: number; tone: 'blue' | 'violet' | 'amber' | 'red' }) {
  const active = n > 0
  const cls = {
    blue: 'border-blue-500/25 bg-blue-500/10 text-blue-200',
    violet: 'border-violet-500/25 bg-violet-500/10 text-violet-200',
    amber: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
    red: 'border-red-500/25 bg-red-500/10 text-red-200',
  }[tone]
  return (
    <Link
      href={href}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
        active ? cls : 'border-white/[0.06] bg-white/[0.02] text-slate-500 hover:text-slate-300',
      )}
    >
      {label} <span className="font-mono font-semibold tabular-nums">{n}</span>
    </Link>
  )
}
