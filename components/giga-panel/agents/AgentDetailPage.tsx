'use client'

/**
 * Agent card (/agents/[key]): overview, permissions, settings, latest tasks.
 * Data: GET /api/giga-admin/agents/:key. The permission catalog (labels and
 * code ceilings) is the same constant the API uses (lib/agents/permissions).
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Play, RefreshCw, Wrench } from 'lucide-react'
import { RequirePermission, useStaff } from '../StaffContext'
import { useWorkspace } from '../WorkspaceContext'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorState, PageHeader, Panel, Skeleton, Tabs, fmtAgo, fmtDateTime, gigaFetch, useGigaQuery,
} from '../kit'
import { PERMISSIONS, PERMISSION_CEILING, PERMISSION_LABELS } from '@/lib/agents/permissions'
import { AgentTriggers } from './AgentsOverviewPage'
import { AgentSettingsForm } from './AgentSettingsForm'
import {
  DECISION, decisionMeta, fmtDuration, fmtPercent, fmtTokens, fmtUsd, runStatusMeta, scopeLabel, tierLabel,
  type CatalogEntry, type Decision,
} from './model'
import { PermissionMatrix } from './PermissionMatrix'
import { RunAgentDialog } from './RunAgentDialog'
import { TasksTable } from './TasksTable'
import type { AgentDetailResponse } from './types'
import { KV, Metric, NoRightHint, StatusChip, Toggle } from './ui'

type Tab = 'overview' | 'permissions' | 'settings' | 'tasks'
const TAB_KEYS: readonly Tab[] = ['overview', 'permissions', 'settings', 'tasks']

const CATALOG: CatalogEntry[] = PERMISSIONS.map((p) => ({ key: p, label: PERMISSION_LABELS[p], ceiling: PERMISSION_CEILING[p] }))
const PERMISSION_LABEL: Record<string, string> = PERMISSION_LABELS

export function AgentDetailPage({ agentKey }: { agentKey: string }) {
  const { can } = useStaff()
  const { base } = useWorkspace()
  const sp = useSearchParams()
  const initialTab = sp.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(initialTab && TAB_KEYS.includes(initialTab) ? initialTab : 'overview')
  const q = useGigaQuery<AgentDetailResponse>(`/api/giga-admin/agents/${encodeURIComponent(agentKey)}`)
  const canRun = can('agents.run')
  const canManage = can('agents.manage')
  const [runOpen, setRunOpen] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const [toggling, setToggling] = useState(false)

  const agent = q.data?.agent ?? null

  const setEnabled = async (enabled: boolean): Promise<boolean> => {
    if (!agent) return false
    setToggling(true)
    try {
      await gigaFetch(`/api/giga-admin/agents/${encodeURIComponent(agent.key)}`, { method: 'PATCH', json: { enabled } })
      toast.success(`${agent.name}: ${enabled ? 'включён' : 'выключен'}`)
      await q.reload()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить')
      return false
    } finally {
      setToggling(false)
    }
  }
  const onToggle = (next: boolean) => (next ? void setEnabled(true) : setConfirmOff(true))

  const crumbs = [{ label: 'GIGA-CRM', href: base }, { label: 'ИИ-агенты', href: `${base}/agents` }, { label: agent?.name ?? agentKey }]

  if (q.error && !agent) {
    return (
      <RequirePermission permission="agents.view">
        <PageHeader crumbs={crumbs} title={agentKey} />
        {q.error.status === 404 ? (
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03]">
            <EmptyState title="Агент не найден" text="Такого агента нет в реестре. Возможно, его переименовали или удалили из кода." action={<Link href={`${base}/agents`} className="text-xs text-blue-300 hover:underline">Ко всем агентам</Link>} />
          </div>
        ) : <ErrorState error={q.error} onRetry={() => void q.reload()} />}
      </RequirePermission>
    )
  }

  return (
    <RequirePermission permission="agents.view">
      <PageHeader
        crumbs={crumbs}
        title={agent?.name ?? agentKey}
        description={agent ? <span className="font-mono text-[11px]">{agent.key} · v{agent.version}</span> : undefined}
        actions={agent && (
          <>
            {canManage && (
              <span className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-1">
                <span className="text-[11px] text-slate-400">{agent.enabled ? 'Включён' : 'Выключен'}</span>
                <Toggle checked={agent.enabled} disabled={toggling} onChange={onToggle} label={agent.enabled ? 'Выключить агента' : 'Включить агента'} />
              </span>
            )}
            {canRun && (
              <Button size="sm" variant="primary" icon={<Play size={12} />} disabled={!agent.enabled} title={agent.enabled ? undefined : 'Агент выключен'} onClick={() => setRunOpen(true)}>
                Запустить
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={q.loading} onClick={() => void q.reload()}>Обновить</Button>
          </>
        )}
      />

      {q.error && <div className="mb-4"><ErrorState error={q.error} onRetry={() => void q.reload()} /></div>}
      {!agent && q.loading && <div className="space-y-4"><Skeleton className="h-10" /><Skeleton className="h-64" /><Skeleton className="h-48" /></div>}

      {agent && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <Badge tone={agent.enabled ? 'green' : 'neutral'}>{agent.enabled ? 'включён' : 'выключен'}</Badge>
            <Badge>{scopeLabel(agent.scope)}</Badge>
            {agent.stats.lastRunAt
              ? <span className="flex items-center gap-1.5 text-[11px] text-slate-500">последний запуск <StatusChip meta={runStatusMeta(agent.stats.lastRunStatus)} /> {fmtAgo(agent.stats.lastRunAt)}</span>
              : <span className="text-[11px] text-slate-500">запусков ещё не было</span>}
            {agent.stats.awaitingApproval > 0 && <Link href={`${base}/agents/approvals`}><Badge tone="amber">ждут одобрения: {agent.stats.awaitingApproval}</Badge></Link>}
            {agent.stats.dead24h > 0 && <Link href={`${base}/agents/tasks?agent=${encodeURIComponent(agent.key)}&status=dead`}><Badge tone="red">dead за 24 ч: {agent.stats.dead24h}</Badge></Link>}
          </div>

          <Tabs
            className="mb-4"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'overview', label: 'Обзор' },
              { key: 'permissions', label: 'Права' },
              { key: 'settings', label: 'Настройки' },
              { key: 'tasks', label: 'Задачи', count: q.data?.tasks.length ?? null },
            ]}
          />

          {tab === 'overview' && <OverviewTab data={q.data!} base={base} />}
          {tab === 'permissions' && (
            <PermissionMatrix
              agentKey={agent.key}
              catalog={CATALOG}
              effective={agent.permissions}
              tools={agent.tools}
              canManage={canManage}
              onSaved={(effective) => q.setData((d) => (d ? { ...d, agent: { ...d.agent, permissions: { ...d.agent.permissions, ...effective } } } : d))}
            />
          )}
          {tab === 'settings' && (
            <AgentSettingsForm agent={agent} canManage={canManage} toggling={toggling} onToggleEnabled={onToggle} onSaved={() => q.reload()} />
          )}
          {tab === 'tasks' && (
            <Panel
              title="Последние задачи"
              description="До 30 последних задач агента."
              bodyClassName="p-0"
              actions={<Link href={`${base}/agents/tasks?agent=${encodeURIComponent(agent.key)}`} className="text-[11px] text-blue-300 hover:underline">Все задачи агента</Link>}
            >
              <TasksTable
                rows={q.data?.tasks}
                loading={q.loading}
                base={base}
                hideAgent
                empty={<EmptyState title="Задач ещё не было" text={canRun ? 'Запустите агента вручную или дождитесь события, на которое он подписан.' : 'Агент ещё не запускался.'} />}
              />
            </Panel>
          )}

          <RunAgentDialog agent={runOpen ? { key: agent.key, name: agent.name, scope: agent.scope, enabled: agent.enabled } : null} open={runOpen} base={base} onClose={() => setRunOpen(false)} onStarted={() => void q.reload()} />
          <ConfirmDialog
            open={confirmOff}
            onClose={() => setConfirmOff(false)}
            title={`Выключить агента «${agent.name}»?`}
            text="Новые задачи агента — по событиям, расписанию и вручную — перестанут создаваться. Задачи, которые уже стоят в очереди, этим не отменяются. Изменение пишется в журнал аудита."
            confirmLabel="Выключить"
            loading={toggling}
            onConfirm={async () => { if (await setEnabled(false)) setConfirmOff(false) }}
          />
        </>
      )}
    </RequirePermission>
  )
}

function OverviewTab({ data, base }: { data: AgentDetailResponse; base: string }) {
  const { agent } = data
  const s = agent.stats
  const tasksHref = (status: string) => `${base}/agents/tasks?agent=${encodeURIComponent(agent.key)}&status=${status}`
  const toolRows = useMemo(() => agent.tools.map((t) => ({
    ...t,
    decision: (agent.permissions as Record<string, Decision | undefined>)[t.permission] ?? null,
  })), [agent])

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Описание" className="lg:col-span-2">
        <p className="mb-3 text-sm leading-relaxed text-slate-300">{agent.description}</p>
        <KV items={[
          ['Ключ', <span key="k" className="font-mono">{agent.key}</span>],
          ['Версия', `v${agent.version}`],
          ['Тип', `${scopeLabel(agent.scope)}${agent.scope === 'company' ? ' — работает с данными одной компании' : ' — работает без привязки к компании'}`],
          ['Модель', <span key="m">{tierLabel(agent.tier)}{agent.model ? <span className="ml-1 font-mono">· {agent.model}</span> : agent.tier !== 'none' ? ' · по tier' : ''}</span>],
          ['Версия промпта', agent.promptVersion ? <span key="p" className="font-mono">{agent.promptVersion}</span> : '—'],
          ['Триггеры', <AgentTriggers key="t" agent={agent} />],
        ]} />
      </Panel>

      <Panel title="Работа за 7 дней">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Metric label="Успешных" value={fmtPercent(s.successRate)} hint={s.runs7d ? `${s.succeeded7d} из ${s.runs7d}` : 'нет запусков'} tone={s.successRate != null && s.successRate >= 0.9 ? 'green' : s.successRate != null && s.successRate < 0.5 ? 'red' : undefined} />
          <Metric label="С ошибкой" value={fmtPercent(s.errorRate)} hint={s.runs7d ? `${s.failed7d} из ${s.runs7d}` : undefined} tone={s.errorRate != null && s.errorRate >= 0.2 ? (s.errorRate >= 0.5 ? 'red' : 'amber') : undefined} />
          <Metric label="Запусков" value={s.runs7d.toLocaleString('ru-RU')} />
          <Metric label="Среднее время" value={fmtDuration(s.avgDurationMs)} />
          <Metric label="Токены вх." value={fmtTokens(s.tokensIn7d)} />
          <Metric label="Токены вых." value={fmtTokens(s.tokensOut7d)} />
          <Metric label="Расход 7 дн" value={fmtUsd(s.costUsd7d)} />
          <Metric label="Сегодня" value={fmtUsd(s.costUsdToday)} hint={`лимит ${fmtUsd(agent.limits.dailyBudgetUsd)}`} tone={agent.limits.dailyBudgetUsd > 0 && s.costUsdToday >= agent.limits.dailyBudgetUsd ? 'red' : undefined} />
          <Metric label="Последний запуск" value={s.lastRunAt ? fmtAgo(s.lastRunAt) : '—'} hint={s.lastRunAt ? fmtDateTime(s.lastRunAt) : undefined} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {([['queued', 'В очереди', s.queued], ['running', 'Выполняется', s.running], ['awaiting_approval', 'Ждут одобрения', s.awaitingApproval], ['dead', 'Dead за 24 ч', s.dead24h]] as const).map(([st, label, n]) => (
            <Link key={st} href={tasksHref(st)} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-2 py-1 text-slate-400 hover:text-slate-200">
              {label}: <span className="font-mono font-semibold text-slate-200">{n}</span>
            </Link>
          ))}
        </div>
      </Panel>

      <Panel title="Лимиты и бюджеты" description="Действующие значения: настройка администратора или умолчание из кода агента.">
        <KV items={[
          ['На один запуск', fmtUsd(agent.limits.perRunBudgetUsd)],
          ['В сутки на агента', fmtUsd(agent.limits.dailyBudgetUsd)],
          ['Токенов ответа (макс.)', agent.limits.maxOutputTokens.toLocaleString('ru-RU')],
          ['Попыток на задачу', String(agent.limits.maxAttempts)],
        ]} />
        <p className="mt-3 text-[11px] text-slate-500">
          Общие суточные бюджеты платформы и компании — на странице <Link href={`${base}/agents/costs`} className="text-blue-300 hover:underline">«Стоимость ИИ»</Link>.
        </p>
      </Panel>

      <Panel title="Инструменты" description="Что агент умеет делать и какое право нужно каждому действию." className="lg:col-span-2" bodyClassName="p-0">
        {toolRows.length === 0 ? <EmptyState icon={<Wrench size={18} />} title="Инструментов нет" text="Агент не вызывает инструменты." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-4 py-2.5 font-medium">Инструмент</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Что делает</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Право</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Сейчас</th>
                </tr>
              </thead>
              <tbody>
                {toolRows.map((t) => (
                  <tr key={t.name} className="border-b border-white/[0.04] align-top">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-200">{t.name}</td>
                    <td className="px-3 py-2.5 text-slate-400">{t.description || '—'}</td>
                    <td className="px-3 py-2.5">
                      {t.permission === 'UNKNOWN'
                        ? <Badge tone="red" title="Инструмент не найден в реестре">не зарегистрирован</Badge>
                        : <><span className="text-slate-300">{PERMISSION_LABEL[t.permission] ?? t.permission}</span><span className="ml-1.5 font-mono text-[10px] text-slate-600">{t.permission}</span></>}
                    </td>
                    <td className="px-3 py-2.5">{t.decision ? <StatusChip meta={decisionMeta(t.decision)} /> : <StatusChip meta={DECISION.DENY} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-white/[0.05] px-4 py-2.5">
          <NoRightHint>Решение «Нужно одобрение» означает: агент остановится и попросит человека в «Одобрениях» или в Telegram.</NoRightHint>
        </div>
      </Panel>
    </div>
  )
}
