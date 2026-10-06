'use client'

/**
 * One agent task: what it was asked, every attempt (run) with model, tokens,
 * cost and errors, every tool call with the permission decision and redacted
 * arguments, the structured event log and approvals. Cancel / retry need
 * agents.run and are confirmed in-page. The page refreshes itself while the
 * task is still queued or running.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangle, Ban, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { RequirePermission, useStaff } from '../StaffContext'
import { useWorkspace } from '../WorkspaceContext'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorState, PageHeader, Panel, Skeleton, cx, fmtDateTime, gigaFetch, useGigaQuery,
} from '../kit'
import {
  CANCELLABLE, LIVE_TASK_STATUSES, RETRYABLE, approvalStatusMeta, decidedViaLabel, decisionMeta, durationBetween, eventLevelMeta,
  fmtCountdown, fmtDuration, fmtTokens, fmtUsd, runStatusMeta, shortActor, taskStatusMeta, tierLabel, toNum, toolCallStatusMeta, triggerLabel,
} from './model'
import type { AgentEventRow, RunRow, TaskDetailResponse } from './types'
import { useAgentDirectory } from './useAgentDirectory'
import { ChipFilter, JsonDetails, KV, Metric, Mono, NoRightHint, StatusChip, useNow } from './ui'
import { PERMISSION_LABELS } from '@/lib/agents/permissions'

const LIVE_REFRESH_MS = 5000
const PERMISSION_LABEL: Record<string, string> = PERMISSION_LABELS

export function AgentTaskDetailPage({ taskId }: { taskId: string }) {
  const { can } = useStaff()
  const { base } = useWorkspace()
  const dir = useAgentDirectory()
  const q = useGigaQuery<TaskDetailResponse>(`/api/giga-admin/agents/tasks/${encodeURIComponent(taskId)}`)
  const [action, setAction] = useState<'cancel' | 'retry' | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const canRun = can('agents.run')
  const task = q.data?.task ?? null
  const live = !!task && LIVE_TASK_STATUSES.has(task.status)
  const { reload } = q

  useEffect(() => {
    if (!live) return
    const id = setInterval(() => void reload(), LIVE_REFRESH_MS)
    return () => clearInterval(id)
  }, [live, reload])

  const runAction = async () => {
    if (!action) return
    setBusy(true)
    setActionError(null)
    try {
      await gigaFetch(`/api/giga-admin/agents/tasks/${encodeURIComponent(taskId)}`, { method: 'POST', json: { action } })
      toast.success(action === 'cancel' ? 'Задача отменена' : 'Задача снова в очереди')
      setAction(null)
      await reload()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Не удалось выполнить действие')
    } finally {
      setBusy(false)
    }
  }

  const agentName = task ? dir.names[task.agent_key] ?? task.agent_key : null
  const crumbs = [
    { label: 'GIGA-CRM', href: base },
    { label: 'ИИ-агенты', href: `${base}/agents` },
    { label: 'Задачи агентов', href: `${base}/agents/tasks` },
    { label: taskId.slice(0, 8) },
  ]

  if (q.error && !task) {
    return (
      <RequirePermission permission="agents.view">
        <PageHeader crumbs={crumbs} title="Задача агента" />
        {q.error.status === 404
          ? <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03]"><EmptyState title="Задача не найдена" text="Возможно, ссылка устарела или задача удалена вместе с компанией." action={<Link href={`${base}/agents/tasks`} className="text-xs text-blue-300 hover:underline">Ко всем задачам</Link>} /></div>
          : <ErrorState error={q.error} onRetry={() => void reload()} />}
      </RequirePermission>
    )
  }

  const runs = q.data?.runs ?? []
  const totalCost = runs.reduce((s, r) => s + toNum(r.cost_usd), 0)
  const totalIn = runs.reduce((s, r) => s + toNum(r.tokens_in), 0)
  const totalOut = runs.reduce((s, r) => s + toNum(r.tokens_out), 0)

  return (
    <RequirePermission permission="agents.view">
      <PageHeader
        crumbs={crumbs}
        title={task ? `${agentName}: задача` : 'Задача агента'}
        description={<Mono>{taskId}</Mono>}
        actions={task && (
          <>
            {live && <span className="flex items-center gap-1.5 text-[11px] text-slate-500"><Loader2 size={12} className="animate-spin" /> обновляется автоматически</span>}
            {canRun && CANCELLABLE.has(task.status) && <Button size="sm" variant="danger" icon={<Ban size={12} />} onClick={() => { setActionError(null); setAction('cancel') }}>Отменить</Button>}
            {canRun && RETRYABLE.has(task.status) && <Button size="sm" variant="warning" icon={<RotateCcw size={12} />} onClick={() => { setActionError(null); setAction('retry') }}>Повторить</Button>}
            <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={q.loading} onClick={() => void reload()}>Обновить</Button>
          </>
        )}
      />

      {q.error && <div className="mb-4"><ErrorState error={q.error} onRetry={() => void reload()} /></div>}
      {!task && q.loading && <div className="space-y-4"><Skeleton className="h-48" /><Skeleton className="h-64" /><Skeleton className="h-40" /></div>}

      {task && q.data && (
        <div className="space-y-4">
          {!canRun && (CANCELLABLE.has(task.status) || RETRYABLE.has(task.status)) && (
            <NoRightHint>Отменить или повторить задачу может роль с правом «ИИ-агенты: запуск».</NoRightHint>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Задача" className="lg:col-span-2">
              <KV items={[
                ['Статус', <span key="s" className="flex flex-wrap items-center gap-2"><StatusChip meta={taskStatusMeta(task.status)} />{taskStatusMeta(task.status).hint && <span className="text-[11px] text-slate-500">{taskStatusMeta(task.status).hint}</span>}</span>],
                ['Агент', <Link key="a" href={`${base}/agents/${encodeURIComponent(task.agent_key)}`} className="text-blue-300 hover:underline">{agentName}</Link>],
                ['Компания', task.company_id ? <span key="c">{task.company_name || 'Компания'} <Mono>{task.company_id}</Mono></span> : 'платформа (без компании)'],
                ['Триггер', <span key="t">{triggerLabel(task.trigger)}{task.trigger_ref && <Mono className="ml-1.5">{task.trigger_ref}</Mono>}</span>],
                ['Кто запустил', shortActor(task.requested_by)],
                ['Попытки', `${task.attempts} из ${task.max_attempts}`],
                task.priority != null && ['Приоритет', `${task.priority} (1 — самый высокий)`],
                ['Создана', fmtDateTime(task.created_at)],
                ['Начата', fmtDateTime(task.started_at)],
                ['Завершена', fmtDateTime(task.finished_at)],
                task.status === 'queued' && task.run_after && ['Следующая попытка', fmtDateTime(task.run_after)],
                task.status === 'running' && task.lease_until && ['Аренда исполнителя до', fmtDateTime(task.lease_until)],
                task.cancelled_by && ['Отменил', shortActor(task.cancelled_by)],
                task.parent_task_id && ['Родительская задача', <Link key="p" href={`${base}/agents/tasks/${task.parent_task_id}`} className="font-mono text-[11px] text-blue-300 hover:underline">{task.parent_task_id}</Link>],
                task.session_id && ['Сессия диагностики', <Mono key="ss">{task.session_id}</Mono>],
              ]} />
            </Panel>
            <Panel title="Итого по попыткам">
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Стоимость" value={fmtUsd(totalCost)} />
                <Metric label="Длительность" value={fmtDuration(durationBetween(task.started_at, task.finished_at))} />
                <Metric label="Токены вх." value={fmtTokens(totalIn)} />
                <Metric label="Токены вых." value={fmtTokens(totalOut)} />
                <Metric label="Запусков" value={runs.length} />
                <Metric label="Инструменты" value={q.data.toolCalls.length} hint="вызовов за все попытки" />
              </div>
            </Panel>
          </div>

          {(task.last_error_code || task.last_error) && (
            <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
              <div className="min-w-0 text-xs">
                <p className="font-mono text-red-200">{task.last_error_code || 'Ошибка'}</p>
                {task.last_error && <p className="mt-1 whitespace-pre-wrap break-words text-red-100/80">{task.last_error}</p>}
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Входные данные"><JsonDetails value={task.input} label="Показать вход" defaultOpen /></Panel>
            <Panel title="Результат"><JsonDetails value={task.result_summary} label="Показать результат" defaultOpen /></Panel>
          </div>

          <RunsPanel runs={runs} />
          <ToolCallsPanel data={q.data} base={base} />
          <EventsPanel events={q.data.events} runs={runs} />
          <ApprovalsPanel data={q.data} base={base} />
        </div>
      )}

      <ConfirmDialog
        open={!!action}
        onClose={() => setAction(null)}
        tone={action === 'cancel' ? 'danger' : 'warning'}
        title={action === 'cancel' ? 'Отменить задачу?' : 'Повторить задачу?'}
        text={action === 'cancel'
          ? 'Задача получит статус «Отменена» и больше не будет выполняться. Действие записывается в журнал аудита.'
          : `Задача вернётся в очередь с ещё одной попыткой (сейчас ${task?.attempts ?? 0} из ${task?.max_attempts ?? 0}). Действие записывается в журнал аудита.`}
        confirmLabel={action === 'cancel' ? 'Отменить задачу' : 'Повторить'}
        loading={busy}
        onConfirm={() => void runAction()}
      >
        {actionError && <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{actionError}</p>}
      </ConfirmDialog>
    </RequirePermission>
  )
}

function RunsPanel({ runs }: { runs: RunRow[] }) {
  return (
    <Panel title="Запуски" description="Одна строка — одна попытка выполнить задачу.">
      {runs.length === 0 ? (
        <EmptyState title="Запусков ещё не было" text="Задача ждёт исполнителя. Если она долго в очереди — проверьте Inngest или cron в «Состоянии системы»." />
      ) : (
        <ol className="relative space-y-4 border-l border-white/[0.08] pl-5">
          {runs.map((r) => {
            const meta = runStatusMeta(r.status)
            return (
              <li key={r.id} className="relative">
                <span className={cx('absolute -left-[27px] top-1 flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-bold', {
                  green: 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200',
                  red: 'border-red-500/40 bg-red-500/20 text-red-200',
                  amber: 'border-amber-500/40 bg-amber-500/20 text-amber-200',
                  violet: 'border-violet-500/40 bg-violet-500/20 text-violet-200',
                  blue: 'border-blue-500/40 bg-blue-500/20 text-blue-200',
                  neutral: 'border-white/[0.15] bg-white/[0.06] text-slate-300',
                }[meta.tone])}>{r.attempt}</span>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-200">
                      Попытка {r.attempt} <StatusChip meta={meta} />
                      {r.error_code && <Badge tone="red" className="font-mono">{r.error_code}</Badge>}
                    </p>
                    <time className="text-[10px] text-slate-500" dateTime={r.started_at ?? undefined}>{fmtDateTime(r.started_at)} → {r.finished_at ? fmtDateTime(r.finished_at) : '…'}</time>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <Metric className="col-span-2" label="Модель" value={r.model ?? (r.tier === 'none' ? 'без LLM' : '—')} hint={`tier: ${tierLabel(r.tier)}`} />
                    <Metric label="Промпт" value={r.prompt_version ?? '—'} />
                    <Metric label="Стоимость" value={fmtUsd(toNum(r.cost_usd))} hint={`вызовов LLM: ${toNum(r.llm_calls)}`} />
                    <Metric label="Токены вх." value={fmtTokens(toNum(r.tokens_in))} />
                    <Metric label="Токены вых." value={fmtTokens(toNum(r.tokens_out))} />
                    <Metric label="Длительность" value={fmtDuration(r.duration_ms)} />
                    <Metric label="Инструменты" value={r.tools_used?.length ? r.tools_used.length : 0} hint={r.tools_used?.join(', ') || undefined} />
                  </div>
                  {(r.input_summary || r.output_summary) && (
                    <dl className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                      {r.input_summary && <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Вход</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-slate-300">{r.input_summary}</dd></div>}
                      {r.output_summary && <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Результат</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-slate-300">{r.output_summary}</dd></div>}
                    </dl>
                  )}
                  {r.error_message && <p className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-red-500/20 bg-red-500/[0.06] px-2.5 py-1.5 text-[11px] text-red-200">{r.error_message}</p>}
                  {Array.isArray(r.sources) && r.sources.length > 0 && (
                    <div className="mt-2"><JsonDetails value={r.sources} label={`Источники данных (${r.sources.length})`} /></div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}

function ToolCallsPanel({ data, base }: { data: TaskDetailResponse; base: string }) {
  const attemptOf = useMemo(() => new Map(data.runs.map((r) => [r.id, r.attempt])), [data.runs])
  const calls = data.toolCalls
  return (
    <Panel title="Вызовы инструментов" description="Аргументы показаны в отредактированном виде — без секретов и персональных данных." bodyClassName="p-0">
      {calls.length === 0 ? <EmptyState title="Инструменты не вызывались" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
                <th scope="col" className="px-3 py-2.5 font-medium">Попытка · №</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Инструмент</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Право</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Решение</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Статус</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Аргументы</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Результат</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Время</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id} className="border-b border-white/[0.04] align-top">
                  <td className="px-3 py-2.5 font-mono text-[11px] text-slate-400">{attemptOf.get(c.run_id) ?? '?'} · {c.seq}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-slate-200">{c.tool}</td>
                  <td className="px-3 py-2.5"><span className="text-slate-300">{PERMISSION_LABEL[c.permission] ?? c.permission}</span></td>
                  <td className="px-3 py-2.5"><StatusChip meta={decisionMeta(c.decision)} /></td>
                  <td className="px-3 py-2.5">
                    <StatusChip meta={toolCallStatusMeta(c.status)} />
                    {c.approval_id && <Link href={`${base}/agents/approvals?focus=${c.approval_id}`} className="mt-1 block text-[10px] text-blue-300 hover:underline">к одобрению</Link>}
                  </td>
                  <td className="max-w-[280px] px-3 py-2.5"><JsonDetails value={c.args_redacted} label="аргументы" /></td>
                  <td className="max-w-[260px] px-3 py-2.5 text-slate-300">
                    {c.result_summary ? <span className="whitespace-pre-wrap break-words">{c.result_summary}</span> : <span className="text-slate-600">—</span>}
                    {c.error_code && <p className="mt-1 font-mono text-[10px] text-red-300">{c.error_code}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[11px] text-slate-400">{fmtDuration(c.duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

const LEVEL_ROW: Record<string, string> = {
  error: 'border-l-red-500/60 bg-red-500/[0.04]',
  warn: 'border-l-amber-500/60 bg-amber-500/[0.04]',
  info: 'border-l-blue-500/40',
  debug: 'border-l-white/[0.1]',
}

function EventsPanel({ events, runs }: { events: AgentEventRow[]; runs: RunRow[] }) {
  const [only, setOnly] = useState<'' | 'problems'>('')
  const attemptOf = useMemo(() => new Map(runs.map((r) => [r.id, r.attempt])), [runs])
  const problems = events.filter((e) => e.level === 'warn' || e.level === 'error').length
  const shown = only ? events.filter((e) => e.level === 'warn' || e.level === 'error') : events
  return (
    <Panel
      title="Журнал агента"
      description={events.length >= 500 ? 'Показаны первые 500 записей.' : 'Структурированные записи агента по этой задаче.'}
      actions={events.length > 0 ? (
        <ChipFilter label="Уровень записей" value={only} onChange={setOnly} options={[{ value: '', label: `Все (${events.length})` }, { value: 'problems', label: `Предупреждения и ошибки (${problems})` }]} />
      ) : undefined}
      bodyClassName="p-0"
    >
      {shown.length === 0 ? <EmptyState title={events.length ? 'Предупреждений и ошибок нет' : 'Записей нет'} /> : (
        <ul className="divide-y divide-white/[0.04]">
          {shown.map((e) => {
            const meta = eventLevelMeta(e.level)
            const hasData = !!e.data && typeof e.data === 'object' && Object.keys(e.data as object).length > 0
            return (
              <li key={e.id} className={cx('border-l-2 px-4 py-2', LEVEL_ROW[e.level] ?? 'border-l-transparent')}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <StatusChip meta={meta} />
                  <Mono>{e.type}</Mono>
                  {e.run_id && attemptOf.has(e.run_id) && <span className="text-[10px] text-slate-600">попытка {attemptOf.get(e.run_id)}</span>}
                  <time className="ml-auto text-[10px] text-slate-500" dateTime={e.created_at}>{fmtDateTime(e.created_at)}</time>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-300">{e.message}</p>
                {hasData && <div className="mt-1"><JsonDetails value={e.data} label="данные" /></div>}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function ApprovalsPanel({ data, base }: { data: TaskDetailResponse; base: string }) {
  const now = useNow(30_000)
  if (!data.approvals.length) return null
  return (
    <Panel title="Одобрения" description="Действия, на которые агенту нужно было разрешение человека." actions={<Link href={`${base}/agents/approvals`} className="text-[11px] text-blue-300 hover:underline">Все одобрения</Link>}>
      <ul className="space-y-2">
        {data.approvals.map((a) => {
          const cd = fmtCountdown(a.expires_at, now)
          return (
            <li key={a.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip meta={approvalStatusMeta(a.status)} />
                <span className="text-slate-200">{a.summary}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {PERMISSION_LABEL[a.permission] ?? a.permission} · <span className="font-mono">{a.tool}</span> · запрошено {fmtDateTime(a.requested_at)}
                {a.status === 'pending' && <> · {cd.expired ? 'срок истёк' : `истекает ${cd.text}`}</>}
              </p>
              {a.decided_at && (
                <p className="mt-1 text-[11px] text-slate-400">
                  Решение: {shortActor(a.decided_by)} {decidedViaLabel(a.decided_via)}, {fmtDateTime(a.decided_at)}
                  {a.decision_reason && <> — «{a.decision_reason}»</>}
                </p>
              )}
              {a.executed_at && <p className="mt-1 text-[11px] text-slate-500">Исполнено {fmtDateTime(a.executed_at)}</p>}
              {a.status === 'pending' && <Link href={`${base}/agents/approvals?focus=${a.id}`} className="mt-1 inline-block text-[11px] text-blue-300 hover:underline">Решить</Link>}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
